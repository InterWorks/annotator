import type { Plugin, ViteDevServer } from "vite";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface AnnotatorOptions {
  /** Where to write annotation sessions. Default: <projectRoot>/.annotator */
  outDir?: string;
  /** Endpoint path the script POSTs to. Default: /__annotator */
  endpoint?: string;
  /** Disable the plugin entirely (e.g. behind an env flag). Default false. */
  disabled?: boolean;
}

const SCRIPT_PATH = "/@annotator/iife.js";

export default function annotator(opts: AnnotatorOptions = {}): Plugin {
  const endpoint = opts.endpoint ?? "/__annotator";
  let projectRoot = process.cwd();

  return {
    name: "annotator",
    apply: "serve",

    configResolved(config) {
      projectRoot = config.root;
    },

    transformIndexHtml() {
      if (opts.disabled) return;
      return [
        {
          tag: "script",
          attrs: { type: "text/javascript" },
          children: `window.__ANNOTATOR_ENDPOINT__ = ${JSON.stringify(endpoint)};`,
          injectTo: "head",
        },
        {
          tag: "script",
          attrs: { src: SCRIPT_PATH, defer: true },
          injectTo: "body",
        },
      ];
    },

    configureServer(server: ViteDevServer) {
      if (opts.disabled) return;

      // Serve the IIFE bundle from this package's dist.
      server.middlewares.use(SCRIPT_PATH, async (req, res, next) => {
        try {
          // Look up the IIFE relative to this file (dist/vite.js → dist/annotator.iife.js)
          const candidates = [
            resolve(__dirname, "annotator.iife.js"),
            resolve(__dirname, "../dist/annotator.iife.js"),
          ];
          for (const p of candidates) {
            if (existsSync(p)) {
              const body = await readFile(p, "utf8");
              res.setHeader("content-type", "application/javascript; charset=utf-8");
              res.setHeader("cache-control", "no-cache");
              res.end(body);
              return;
            }
          }
          res.statusCode = 404;
          res.end("// annotator IIFE not found — run `bun run build` in the annotator package");
        } catch (e) {
          next(e);
        }
      });

      // Receive POSTed sessions and write to disk.
      server.middlewares.use(endpoint, async (req, res, next) => {
        if (req.method !== "POST") return next();
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const body = Buffer.concat(chunks).toString("utf8");
          let parsed: any;
          try { parsed = JSON.parse(body); } catch {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: "invalid JSON" }));
            return;
          }
          const outDir = opts.outDir ? resolve(projectRoot, opts.outDir) : join(projectRoot, ".annotator");
          await mkdir(outDir, { recursive: true });
          const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
          const slug = (parsed.title || "session").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
          const file = join(outDir, `${stamp}-${slug || "session"}.json`);
          await writeFile(file, JSON.stringify(parsed, null, 2));
          // Also write a .md if rendered content exists.
          if (typeof parsed.rendered === "string") {
            const ext = parsed.format === "json" ? "json" : "md";
            await writeFile(file.replace(/\.json$/, `.${ext}`), parsed.rendered);
          }
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ ok: true, file }));
          server.config.logger.info(`[annotator] wrote ${file}`, { timestamp: true });
        } catch (e) {
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false, error: (e as Error).message }));
        }
      });
    },
  };
}
