#!/usr/bin/env bun
import { rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const root = import.meta.dir;
const dist = join(root, "dist");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const watch = process.argv.includes("--watch");

async function build() {
  const iife = await Bun.build({
    entrypoints: [join(root, "src/entries/iife.ts")],
    outdir: dist,
    format: "iife",
    target: "browser",
    minify: false,
    naming: "annotator.iife.js",
  });
  if (!iife.success) throw new Error("IIFE build failed: " + iife.logs.map(String).join("\n"));

  const esm = await Bun.build({
    entrypoints: [join(root, "src/entries/module.ts")],
    outdir: dist,
    format: "esm",
    target: "browser",
    naming: "index.js",
  });
  if (!esm.success) throw new Error("ESM build failed: " + esm.logs.map(String).join("\n"));

  const vite = await Bun.build({
    entrypoints: [join(root, "src/vite/plugin.ts")],
    outdir: dist,
    format: "esm",
    target: "node",
    external: ["vite", "node:fs", "node:path", "node:url"],
    naming: "vite.js",
  });
  if (!vite.success) throw new Error("Vite plugin build failed: " + vite.logs.map(String).join("\n"));

  console.log("✓ built", new Date().toISOString());
}

await build();

if (watch) {
  const fs = await import("node:fs");
  fs.watch(join(root, "src"), { recursive: true }, async (event, file) => {
    if (!file || file.endsWith("~")) return;
    try { await build(); } catch (e) { console.error(e); }
  });
  console.log("watching src/...");
}
