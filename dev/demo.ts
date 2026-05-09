#!/usr/bin/env bun
/**
 * Playwright recorder for the annotator marketing demo.
 *
 * Spawns the playground server, drives a scripted ~13s flow with a visible
 * synthetic cursor and a brief zoom on the success moment, post-processes
 * the .webm into .mp4 + .gif via ffmpeg.
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir, rm, readdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

const ROOT = join(import.meta.dir, "..");
const OUT = join(ROOT, "docs");
const PORT = 5781;

const VIEWPORT = { width: 1280, height: 800 };

async function sleep(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)); }

async function withServer<T>(fn: () => Promise<T>): Promise<T> {
  const proc = spawn("bun", ["run", "dev/serve.ts"], {
    cwd: ROOT,
    stdio: "ignore",
    env: { ...process.env, PORT: String(PORT) },
  });
  // serve.ts uses port 5780 — override via env or just use the fixed 5780.
  // Here, we'll run with the script's default 5780.
  proc.unref();

  // Wait for server to come up.
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch("http://localhost:5780/");
      if (res.ok) break;
    } catch {}
    await sleep(80);
  }
  try {
    return await fn();
  } finally {
    proc.kill("SIGTERM");
  }
}

const CURSOR_CSS = `
  #__demo_cursor__ {
    position: fixed; pointer-events: none; z-index: 2147483647;
    width: 24px; height: 24px;
    transform: translate(-3px, -3px);
    transition: transform 0.05s linear;
  }
  #__demo_cursor__ svg { width: 100%; height: 100%; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.5)); }
  #__demo_cursor__.click::after {
    content: ""; position: absolute; left: 12px; top: 12px;
    width: 8px; height: 8px; border-radius: 50%;
    background: rgba(212, 167, 58, 0.9);
    animation: __demo_pulse__ 0.4s ease-out;
  }
  @keyframes __demo_pulse__ {
    from { transform: scale(0.5); opacity: 1; }
    to { transform: scale(4); opacity: 0; }
  }
  body.__demo_zoom__ {
    transform-origin: var(--zoom-x, 50%) var(--zoom-y, 50%);
    transform: scale(1.4);
    transition: transform 0.45s cubic-bezier(0.22, 1, 0.36, 1);
  }
  body.__demo_unzoom__ {
    transform: scale(1);
    transition: transform 0.45s cubic-bezier(0.22, 1, 0.36, 1);
  }
`;

const CURSOR_SVG = `
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M5 3l6 14 2-6 6-2z" fill="#ffffff" stroke="#0b1220" stroke-width="1.5" stroke-linejoin="round"/>
  </svg>
`;

async function injectCursor(page: import("playwright").Page) {
  await page.evaluate(({ css, svg }) => {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    const cursor = document.createElement("div");
    cursor.id = "__demo_cursor__";
    cursor.innerHTML = svg;
    document.body.appendChild(cursor);
    document.addEventListener("mousemove", (e) => {
      cursor.style.left = e.clientX + "px";
      cursor.style.top = e.clientY + "px";
    }, true);
    document.addEventListener("click", () => {
      cursor.classList.remove("click");
      // re-trigger animation
      void cursor.offsetWidth;
      cursor.classList.add("click");
    }, true);
  }, { css: CURSOR_CSS, svg: CURSOR_SVG });
}

async function moveTo(page: import("playwright").Page, selector: string, opts: { steps?: number; pause?: number; scroll?: boolean } = {}) {
  const loc = page.locator(selector).first();
  if (opts.scroll !== false) await loc.scrollIntoViewIfNeeded();
  const box = await loc.boundingBox();
  if (!box) throw new Error(`no bounding box for ${selector}`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y, { steps: opts.steps ?? 24 });
  if (opts.pause) await sleep(opts.pause);
  return { x, y };
}

async function clickAt(page: import("playwright").Page, selector: string) {
  const { x, y } = await moveTo(page, selector, { pause: 200 });
  await page.mouse.down();
  await sleep(60);
  await page.mouse.up();
  return { x, y };
}

async function zoomTo(page: import("playwright").Page, x: number, y: number) {
  await page.evaluate(({ x, y }) => {
    document.body.style.setProperty("--zoom-x", `${x}px`);
    document.body.style.setProperty("--zoom-y", `${y}px`);
    document.body.classList.remove("__demo_unzoom__");
    document.body.classList.add("__demo_zoom__");
  }, { x, y });
}

async function unzoom(page: import("playwright").Page) {
  await page.evaluate(() => {
    document.body.classList.remove("__demo_zoom__");
    document.body.classList.add("__demo_unzoom__");
  });
}

async function record() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    recordVideo: { dir: OUT, size: VIEWPORT },
  });
  const page = await context.newPage();

  await page.goto(`http://localhost:5780/?demo=1#`);
  // Clear any prior annotations from a previous run.
  await page.evaluate(() => { try { localStorage.clear(); } catch {} });
  await page.reload();
  await page.waitForFunction(() => !!document.getElementById("ann-toggle"));
  await injectCursor(page);

  // Move cursor to a starting offscreen-ish position.
  await page.mouse.move(640, 760, { steps: 1 });
  await sleep(400);

  // 1. Click "Annotate".
  await clickAt(page, "#ann-toggle");
  await sleep(400);

  // 2. Hover, then click testid CTA.
  await moveTo(page, '[data-testid="primary-cta"]', { steps: 30, pause: 350 });
  await clickAt(page, '[data-testid="primary-cta"]');
  await sleep(300);

  // 3. Type comment in the textarea.
  await page.keyboard.type("Make this gradient — flat looks dated", { delay: 38 });
  await sleep(250);

  // 4. Save with Cmd+Enter.
  await page.keyboard.press("Control+Enter");
  await sleep(500);

  // 5. Move to React Cell ($205 in budget table).
  await moveTo(page, 'tr[data-row-id="phase-0"] td[data-col="cost"]', { steps: 30, pause: 250 });
  await clickAt(page, 'tr[data-row-id="phase-0"] td[data-col="cost"]');
  await sleep(250);

  // 6. Type comment showcasing the React component info in the meta line.
  await page.keyboard.type("Round to $200 please", { delay: 36 });
  await sleep(200);
  await page.keyboard.press("Control+Enter");
  await sleep(450);

  // 7. Move to format dropdown, pick verbose markdown.
  await moveTo(page, "#ann-format", { steps: 22, pause: 200 });
  await page.locator("#ann-format").selectOption("markdown-verbose");
  await sleep(250);

  // 8. Hit Copy — toast appears.
  await clickAt(page, "#ann-copy");
  await sleep(2000);

  // Close — Playwright finalizes the video on context.close().
  await context.close();
  await browser.close();

  // Find the recorded .webm.
  const files = await readdir(OUT);
  const webm = files.find((f) => f.endsWith(".webm"));
  if (!webm) throw new Error("no .webm produced");
  const webmPath = join(OUT, webm);
  const finalWebm = join(OUT, "demo.webm");
  await rename(webmPath, finalWebm);
  return finalWebm;
}

async function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", ["-y", ...args], { stdio: "ignore" });
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`))));
  });
}

async function postProcess(webm: string) {
  const mp4 = join(OUT, "demo.mp4");
  const gif = join(OUT, "demo.gif");
  const palette = join(OUT, "_palette.png");

  // High-quality MP4 (H.264, web-safe).
  await ffmpeg([
    "-i", webm,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryslow",
    "-crf", "20",
    "-movflags", "+faststart",
    "-an",
    mp4,
  ]);

  // GIF via two-pass palette generation for crisp colors.
  await ffmpeg([
    "-i", webm,
    "-vf", "fps=18,scale=960:-1:flags=lanczos,palettegen=stats_mode=diff",
    palette,
  ]);
  await ffmpeg([
    "-i", webm,
    "-i", palette,
    "-lavfi", "fps=18,scale=960:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle",
    gif,
  ]);
  if (existsSync(palette)) await rm(palette);
  return { mp4, gif };
}

await withServer(async () => {
  console.log("recording…");
  const webm = await record();
  console.log("encoding mp4 + gif…");
  const { mp4, gif } = await postProcess(webm);
  console.log("\n✓ demo ready");
  console.log("  webm:", webm);
  console.log("  mp4: ", mp4);
  console.log("  gif: ", gif);
});

process.exit(0);
