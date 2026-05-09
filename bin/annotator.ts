#!/usr/bin/env bun
/**
 * annotator CLI — drop the click-to-comment overlay into any project.
 */
import { readFile, writeFile, mkdir, symlink, stat, access, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IIFE_PATH = join(PACKAGE_ROOT, "dist", "annotator.iife.js");

type Mode = "vite" | "static" | "auto";

const args = process.argv.slice(2);
const cmd = args[0];

function help(): never {
  console.log(`annotator — drop a click-to-comment overlay into any project

ZERO-TOUCH (your project untouched):
  annotator dev <upstream>       Run a localhost proxy that injects the overlay
                                 into upstream HTML responses on the fly.
    --port=N                     Proxy port (default 5800)
    --out=DIR                    Where to save sessions (default ~/.annotator)

  annotator copy                 Copy the IIFE to clipboard (paste into devtools)
  annotator print                Print the IIFE to stdout
  annotator bookmarklet          Print a javascript: bookmarklet URL
  annotator path                 Print the absolute path to the IIFE

OPT-IN (writes files into your project):
  annotator init [path]          Auto-detect Vite vs static, wire up
    --mode=vite|static           Force a specific mode
    --no-link                    Skip 'bun link', just edit files
    --dry-run                    Print what would happen, no writes

OTHER:
  annotator build                Rebuild the IIFE bundle from source
  annotator help                 Show this message

Examples:
  annotator dev http://localhost:5173       # then open http://localhost:5800
  annotator copy                            # paste into devtools on any page
  cd my-project && annotator init           # embed it (opt-in)
`);
  process.exit(0);
}

async function ensureBuilt(): Promise<void> {
  if (existsSync(IIFE_PATH)) return;
  console.error("annotator: dist/ missing — building now...");
  const proc = Bun.spawn(["bun", "run", "build"], { cwd: PACKAGE_ROOT, stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code !== 0) { console.error("build failed"); process.exit(1); }
}

function flag(name: string): string | true | undefined {
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  if (args.includes(`--${name}`)) return true;
  return undefined;
}

async function fileExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

async function detectMode(root: string): Promise<Mode> {
  for (const f of ["vite.config.ts", "vite.config.js", "vite.config.mjs", "vite.config.mts"]) {
    if (await fileExists(join(root, f))) return "vite";
  }
  if (await findHtmlFile(root)) return "static";
  return "auto";
}

async function findHtmlFile(root: string): Promise<string | null> {
  // Preferred names first.
  for (const f of ["index.html", "public/index.html", "src/index.html"]) {
    const p = join(root, f);
    if (await fileExists(p)) return p;
  }
  // Fallback: any .html at the root or in public/.
  const { readdir } = await import("node:fs/promises");
  for (const dir of [root, join(root, "public"), join(root, "src")]) {
    if (!(await fileExists(dir))) continue;
    let entries: string[] = [];
    try { entries = await readdir(dir); } catch { continue; }
    const html = entries.find((e) => e.endsWith(".html"));
    if (html) return join(dir, html);
  }
  return null;
}

async function findViteConfig(root: string): Promise<string | null> {
  for (const f of ["vite.config.ts", "vite.config.js", "vite.config.mjs", "vite.config.mts"]) {
    const p = join(root, f);
    if (await fileExists(p)) return p;
  }
  return null;
}

async function ensureGitignore(root: string, entry: string, dryRun: boolean): Promise<void> {
  const path = join(root, ".gitignore");
  let body = "";
  if (await fileExists(path)) body = await readFile(path, "utf8");
  if (body.split(/\r?\n/).some((line) => line.trim() === entry)) return;
  const next = body && !body.endsWith("\n") ? body + "\n" + entry + "\n" : body + entry + "\n";
  if (dryRun) { console.log(`  [dry-run] would append "${entry}" to .gitignore`); return; }
  await writeFile(path, next);
  console.log(`  ✓ added "${entry}" to .gitignore`);
}

async function bunLink(target: string): Promise<void> {
  // (a) ensure annotator package is registered globally as a link target.
  console.log(`  · running 'bun link' in ${PACKAGE_ROOT}`);
  const reg = Bun.spawn(["bun", "link"], { cwd: PACKAGE_ROOT, stdout: "inherit", stderr: "inherit" });
  if ((await reg.exited) !== 0) throw new Error("bun link (registration) failed");

  // (b) consume the link in the target project.
  console.log(`  · running 'bun link @rld/annotator' in ${target}`);
  const use = Bun.spawn(["bun", "link", "@rld/annotator"], { cwd: target, stdout: "inherit", stderr: "inherit" });
  if ((await use.exited) !== 0) throw new Error("bun link (consume) failed");
}

async function patchViteConfig(configPath: string, dryRun: boolean): Promise<void> {
  const original = await readFile(configPath, "utf8");
  if (original.includes("@rld/annotator/vite")) {
    console.log(`  · ${relative(process.cwd(), configPath)} already references @rld/annotator/vite — leaving alone`);
    return;
  }

  // Insert import after the last existing import statement.
  const lines = original.split(/\r?\n/);
  let lastImportIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*import\s/.test(lines[i]!)) lastImportIdx = i;
  }
  const importLine = `import annotator from "@rld/annotator/vite";`;
  if (lastImportIdx >= 0) lines.splice(lastImportIdx + 1, 0, importLine);
  else lines.unshift(importLine);

  // Try to inject `annotator()` into the plugins array. Look for `plugins: [`.
  let body = lines.join("\n");
  const pluginsRe = /plugins\s*:\s*\[/;
  if (pluginsRe.test(body)) {
    if (!/\bannotator\(\)/.test(body)) {
      body = body.replace(pluginsRe, (m) => `${m}annotator(), `);
    }
  } else {
    console.warn(
      `  ! couldn't find a 'plugins: [' array in ${relative(process.cwd(), configPath)}.\n` +
      `    Add manually:  plugins: [annotator(), /* ... */]`,
    );
  }

  if (dryRun) {
    console.log(`  [dry-run] would patch ${relative(process.cwd(), configPath)}:`);
    console.log("    + " + importLine);
    console.log("    + plugins: [annotator(), ...]");
    return;
  }
  await writeFile(configPath, body);
  console.log(`  ✓ patched ${relative(process.cwd(), configPath)}`);
}

async function patchHtml(htmlPath: string, scriptSrc: string, dryRun: boolean): Promise<void> {
  const html = await readFile(htmlPath, "utf8");
  if (html.includes(scriptSrc) || html.includes("/annotator.iife.js")) {
    console.log(`  · ${relative(process.cwd(), htmlPath)} already includes annotator — leaving alone`);
    return;
  }
  const tag = `    <script src="${scriptSrc}" defer></script>`;
  let next: string;
  if (/<\/body>/i.test(html)) next = html.replace(/<\/body>/i, `${tag}\n  </body>`);
  else next = html + "\n" + tag + "\n";
  if (dryRun) { console.log(`  [dry-run] would inject script tag into ${relative(process.cwd(), htmlPath)}`); return; }
  await writeFile(htmlPath, next);
  console.log(`  ✓ injected <script> into ${relative(process.cwd(), htmlPath)}`);
}

async function symlinkOrCopy(src: string, dest: string, dryRun: boolean): Promise<void> {
  if (await fileExists(dest)) {
    console.log(`  · ${relative(process.cwd(), dest)} already exists — leaving alone`);
    return;
  }
  if (dryRun) { console.log(`  [dry-run] would symlink ${relative(process.cwd(), dest)} → ${src}`); return; }
  await mkdir(dirname(dest), { recursive: true });
  try {
    await symlink(src, dest);
    console.log(`  ✓ symlinked ${relative(process.cwd(), dest)} → ${src}`);
  } catch {
    await copyFile(src, dest);
    console.log(`  ✓ copied ${src} → ${relative(process.cwd(), dest)}`);
  }
}

async function cmdInit(): Promise<void> {
  await ensureBuilt();

  const targetArg = args.slice(1).find((a) => !a.startsWith("--"));
  const target = resolve(targetArg ?? process.cwd());
  const noLink = flag("no-link") === true;
  const dryRun = flag("dry-run") === true;
  const modeFlag = flag("mode") as Mode | undefined;

  if (!(await fileExists(target))) { console.error(`annotator: ${target} does not exist`); process.exit(1); }
  const targetStat = await stat(target);
  if (!targetStat.isDirectory()) { console.error(`annotator: ${target} is not a directory`); process.exit(1); }

  console.log(`annotator init → ${target}${dryRun ? " (dry-run)" : ""}`);

  let mode: Mode = modeFlag ?? (await detectMode(target));
  if (mode === "auto") {
    console.error("annotator: couldn't detect Vite or static HTML project here.");
    console.error("           pass --mode=vite or --mode=static to force one.");
    process.exit(1);
  }
  console.log(`  mode: ${mode}`);

  if (mode === "vite") {
    const cfg = await findViteConfig(target);
    if (!cfg) { console.error("annotator: no vite.config found"); process.exit(1); }
    if (!noLink && !dryRun) await bunLink(target);
    else if (noLink) console.log("  · skipping bun link (--no-link). Make sure @rld/annotator resolves.");
    else console.log("  [dry-run] would 'bun link' annotator into project");
    await patchViteConfig(cfg, dryRun);
    await ensureGitignore(target, ".annotator/", dryRun);
    console.log("\n  Next:  bun run dev   (the Annotate button shows up automatically)");
  } else {
    // static
    const html = await findHtmlFile(target);
    if (!html) { console.error("annotator: no index.html found"); process.exit(1); }

    // Decide where to drop the script. Prefer public/, then alongside the html.
    const publicDir = join(target, "public");
    const dest = (await fileExists(publicDir))
      ? join(publicDir, "annotator.iife.js")
      : join(dirname(html), "annotator.iife.js");
    const scriptSrc = (await fileExists(publicDir)) ? "/annotator.iife.js" : "./annotator.iife.js";

    await symlinkOrCopy(IIFE_PATH, dest, dryRun);
    await patchHtml(html, scriptSrc, dryRun);
    await ensureGitignore(target, "annotator.iife.js", dryRun);
    console.log("\n  Next:  open the page — the Annotate button shows up bottom-right");
  }
}

async function cmdCopy(): Promise<void> {
  await ensureBuilt();
  const body = await readFile(IIFE_PATH, "utf8");

  // Try Wayland (omarchy default), then xclip, then macOS pbcopy.
  const candidates: string[][] = [
    ["wl-copy"],
    ["xclip", "-selection", "clipboard"],
    ["pbcopy"],
  ];
  for (const cmd of candidates) {
    try {
      const proc = Bun.spawn(cmd, { stdin: "pipe", stdout: "ignore", stderr: "ignore" });
      proc.stdin.write(body);
      await proc.stdin.end();
      const code = await proc.exited;
      if (code === 0) { console.log(`copied ${body.length} bytes via ${cmd[0]}`); return; }
    } catch {}
  }
  console.error("annotator: no clipboard tool found (tried wl-copy, xclip, pbcopy).");
  console.error("           use 'annotator print | <your clipboard cmd>' instead");
  process.exit(1);
}

async function cmdPrint(): Promise<void> {
  await ensureBuilt();
  const body = await readFile(IIFE_PATH, "utf8");
  process.stdout.write(body);
}

async function cmdBookmarklet(): Promise<void> {
  await ensureBuilt();
  const body = await readFile(IIFE_PATH, "utf8");
  // The IIFE is already wrapped in (() => { ... })(); — fine to dump as-is.
  // For a bookmarklet we need to URL-encode and prefix javascript:.
  const encoded = encodeURIComponent(body);
  console.log(`javascript:${encoded}`);
}

async function cmdPath(): Promise<void> {
  await ensureBuilt();
  console.log(IIFE_PATH);
}

async function cmdBuild(): Promise<void> {
  const proc = Bun.spawn(["bun", "run", "build"], { cwd: PACKAGE_ROOT, stdout: "inherit", stderr: "inherit" });
  process.exit(await proc.exited);
}

async function cmdDev(): Promise<void> {
  await ensureBuilt();
  const upstreamArg = args.slice(1).find((a) => !a.startsWith("--"));
  if (!upstreamArg) {
    console.error("annotator dev: missing upstream URL\n  example: annotator dev http://localhost:5173");
    process.exit(1);
  }
  let upstream: URL;
  try { upstream = new URL(upstreamArg); }
  catch { console.error(`annotator dev: invalid URL '${upstreamArg}'`); process.exit(1); }

  const port = Number(flag("port")) || 5800;
  const outDir = (typeof flag("out") === "string" ? flag("out") as string : null)
    ?? join(process.env["HOME"] ?? ".", ".annotator");

  const slug = (process.cwd().split("/").pop() || "session").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "session";
  const sessionDir = join(outDir, slug);

  const iifeBody = await readFile(IIFE_PATH, "utf8");

  const INJECT_TAG = `
<script>window.__ANNOTATOR_ENDPOINT__ = "/__annotator__/post";</script>
<script src="/__annotator__/iife.js" defer></script>
`;

  const server = Bun.serve({
    port,
    hostname: "0.0.0.0",
    async fetch(req) {
      const url = new URL(req.url);

      // 1. Serve the IIFE directly.
      if (url.pathname === "/__annotator__/iife.js") {
        return new Response(iifeBody, {
          headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-cache" },
        });
      }

      // 2. Receive POSTed sessions.
      if (url.pathname === "/__annotator__/post" && req.method === "POST") {
        try {
          const body = await req.text();
          let parsed: any;
          try { parsed = JSON.parse(body); } catch { return new Response(JSON.stringify({ ok: false, error: "invalid JSON" }), { status: 400 }); }
          await mkdir(sessionDir, { recursive: true });
          const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
          const titleSlug = (parsed.title || "session").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
          const file = join(sessionDir, `${stamp}-${titleSlug || "session"}.json`);
          await writeFile(file, JSON.stringify(parsed, null, 2));
          if (typeof parsed.rendered === "string") {
            const ext = parsed.format === "json" ? "json" : "md";
            await writeFile(file.replace(/\.json$/, `.${ext}`), parsed.rendered);
          }
          console.log(`[annotator] wrote ${file}`);
          return new Response(JSON.stringify({ ok: true, file }), { headers: { "content-type": "application/json" } });
        } catch (e) {
          return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), { status: 500 });
        }
      }

      // 3. Proxy everything else to the upstream.
      const targetUrl = new URL(url.pathname + url.search, upstream);
      const headers = new Headers(req.headers);
      headers.set("host", upstream.host);
      headers.delete("accept-encoding"); // upstream may gzip; we want plain text for HTML rewriting

      let upstreamRes: Response;
      try {
        upstreamRes = await fetch(targetUrl, {
          method: req.method,
          headers,
          body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
          redirect: "manual",
        });
      } catch (e) {
        return new Response(`annotator proxy: upstream fetch failed (${(e as Error).message})\n  upstream: ${upstream.origin}\n  target:   ${targetUrl}`, { status: 502, headers: { "content-type": "text/plain" } });
      }

      const ct = upstreamRes.headers.get("content-type") || "";
      // Only rewrite HTML.
      if (ct.includes("text/html")) {
        const text = await upstreamRes.text();
        const injected = text.includes("</body>")
          ? text.replace(/<\/body>/i, `${INJECT_TAG}</body>`)
          : text + INJECT_TAG;
        const respHeaders = new Headers(upstreamRes.headers);
        respHeaders.delete("content-length");
        respHeaders.delete("content-encoding");
        return new Response(injected, { status: upstreamRes.status, statusText: upstreamRes.statusText, headers: respHeaders });
      }

      // Pass through everything else as-is.
      return upstreamRes;
    },
  });

  console.log(`annotator proxy: ${upstream.origin} → http://localhost:${server.port}`);
  console.log(`  · open http://localhost:${server.port} to use your app with the overlay`);
  console.log(`  · sessions write to ${sessionDir}`);
  console.log(`  · note: WebSocket-based HMR doesn't tunnel — refresh manually if needed`);
  console.log(`  · Ctrl-C to stop`);
}

switch (cmd) {
  case "init":         await cmdInit(); break;
  case "copy":         await cmdCopy(); break;
  case "print":        await cmdPrint(); break;
  case "bookmarklet":  await cmdBookmarklet(); break;
  case "path":         await cmdPath(); break;
  case "build":        await cmdBuild(); break;
  case "dev":          await cmdDev(); break;
  case "help": case "--help": case "-h": case undefined: help();
  default:
    console.error(`annotator: unknown command '${cmd}'`);
    help();
}
