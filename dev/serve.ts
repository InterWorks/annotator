#!/usr/bin/env bun
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const port = 5780;

const server = Bun.serve({
  port,
  hostname: "0.0.0.0",
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname === "/" ? "/dev/playground.html" : url.pathname;
    const file = Bun.file(join(root, path));
    if (await file.exists()) return new Response(file);
    return new Response("not found: " + path, { status: 404 });
  },
});

console.log(`playground: http://localhost:${server.port}`);
