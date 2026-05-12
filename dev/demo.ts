#!/usr/bin/env bun
/**
 * Playwright recorder for the annotator marketing demo.
 *
 * Layers branded overlays (intro card, beat captions, outro CTA) onto the
 * playground via DOM injection, then drives a scripted ~25s flow with a
 * synthetic cursor and post-processes the .webm into .mp4 + .gif via ffmpeg.
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir, rm, readdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

const ROOT = join(import.meta.dir, "..");
const OUT = join(ROOT, "docs");
const VIEWPORT = { width: 1280, height: 800 };
const SERVER_PORT = 5780;

async function sleep(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)); }

async function withServer<T>(fn: () => Promise<T>): Promise<T> {
  const proc = spawn("bun", ["run", "dev/serve.ts"], {
    cwd: ROOT,
    stdio: "ignore",
    env: { ...process.env, PORT: String(SERVER_PORT) },
  });
  proc.unref();
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://localhost:${SERVER_PORT}/`);
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

const ACCENT = "212, 167, 58";
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

const OVERLAY_CSS = `
  #__demo_cursor__ {
    position: fixed; pointer-events: none; z-index: 2147483645;
    width: 24px; height: 24px;
    transform: translate(-3px, -3px);
    transition: transform 0.05s linear, opacity 0.25s ${EASE};
  }
  #__demo_cursor__ svg { width: 100%; height: 100%; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.5)); }
  #__demo_cursor__.click::after {
    content: ""; position: absolute; left: 12px; top: 12px;
    width: 8px; height: 8px; border-radius: 50%;
    background: rgba(${ACCENT}, 0.9);
    animation: __demo_pulse__ 0.4s ease-out;
  }
  @keyframes __demo_pulse__ {
    from { transform: scale(0.5); opacity: 1; }
    to   { transform: scale(4);   opacity: 0; }
  }

  body.__demo_zoom__ {
    transform-origin: var(--zoom-x, 50%) var(--zoom-y, 50%);
    transform: scale(1.35);
    transition: transform 0.45s ${EASE};
  }
  body.__demo_unzoom__ {
    transform: scale(1);
    transition: transform 0.45s ${EASE};
  }

  .__demo_card__ {
    position: fixed; inset: 0; z-index: 2147483646;
    display: flex; flex-direction: column; justify-content: center; align-items: center;
    background: radial-gradient(120% 90% at 30% 20%, #20180c 0%, #0c0a07 70%);
    color: #f5efe2;
    font: 500 18px/1.4 "Inter", "SF Pro Text", system-ui, -apple-system, sans-serif;
    letter-spacing: -0.01em;
    opacity: 0;
    transition: opacity 0.55s ${EASE};
  }
  .__demo_card__.in { opacity: 1; }
  .__demo_card__ .title {
    font-size: 64px; font-weight: 700; letter-spacing: -0.035em;
    margin: 0 0 18px;
    background: linear-gradient(180deg, #fffaf0 0%, rgba(${ACCENT}, 1) 100%);
    -webkit-background-clip: text; background-clip: text; color: transparent;
    transform: translateY(14px); opacity: 0;
    transition: transform 0.7s ${EASE} 0.05s, opacity 0.7s ${EASE} 0.05s;
  }
  .__demo_card__ .tagline {
    font-size: 24px; color: #cdc4b3; font-weight: 400; letter-spacing: -0.01em;
    transform: translateY(14px); opacity: 0;
    transition: transform 0.7s ${EASE} 0.18s, opacity 0.7s ${EASE} 0.18s;
  }
  .__demo_card__ .rule {
    width: 56px; height: 3px; margin: 28px 0;
    background: rgba(${ACCENT}, 0.9); border-radius: 2px;
    transform: scaleX(0); transform-origin: left;
    transition: transform 0.6s ${EASE} 0.28s;
  }
  .__demo_card__ .codeline {
    font: 500 22px/1.4 "JetBrains Mono", "SF Mono", ui-monospace, monospace;
    color: #f5efe2;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(${ACCENT}, 0.35);
    padding: 12px 22px; border-radius: 10px;
    margin-top: 4px;
    transform: translateY(14px); opacity: 0;
    transition: transform 0.7s ${EASE} 0.34s, opacity 0.7s ${EASE} 0.34s;
  }
  .__demo_card__ .codeline .prompt { color: rgba(${ACCENT}, 1); margin-right: 10px; }
  .__demo_card__.in .title,
  .__demo_card__.in .tagline,
  .__demo_card__.in .codeline { transform: translateY(0); opacity: 1; }
  .__demo_card__.in .rule { transform: scaleX(1); }

  #__demo_caption__ {
    position: fixed;
    left: 50%; bottom: 38px;
    transform: translate(-50%, 12px);
    z-index: 2147483644;
    padding: 12px 22px;
    background: rgba(12, 10, 7, 0.88);
    backdrop-filter: blur(8px);
    color: #f5efe2;
    font: 600 22px/1.2 "Inter", "SF Pro Text", system-ui, -apple-system, sans-serif;
    letter-spacing: -0.015em;
    border-radius: 999px;
    border: 1px solid rgba(${ACCENT}, 0.35);
    box-shadow: 0 8px 24px rgba(0,0,0,0.35);
    opacity: 0;
    transition: opacity 0.35s ${EASE}, transform 0.35s ${EASE};
    pointer-events: none;
    max-width: 70vw;
    white-space: nowrap;
    text-align: center;
  }
  #__demo_caption__.in {
    opacity: 1;
    transform: translate(-50%, 0);
  }
  #__demo_caption__ .dot {
    display: inline-block;
    width: 7px; height: 7px; margin-right: 12px; vertical-align: middle;
    background: rgba(${ACCENT}, 1);
    border-radius: 50%;
    box-shadow: 0 0 12px rgba(${ACCENT}, 0.7);
  }

  #__demo_vignette__ {
    position: fixed; inset: 0; pointer-events: none; z-index: 2147483643;
    box-shadow: inset 0 0 120px rgba(0,0,0,0.18);
    opacity: 0;
    transition: opacity 0.6s ${EASE};
  }
  #__demo_vignette__.in { opacity: 1; }
`;

const CURSOR_SVG = `
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M5 3l6 14 2-6 6-2z" fill="#ffffff" stroke="#0b1220" stroke-width="1.5" stroke-linejoin="round"/>
  </svg>
`;

async function injectOverlays(page: import("playwright").Page) {
  await page.evaluate(({ css, svg }) => {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);

    // Mount overlays on <html> instead of <body> so that body.__demo_zoom__
    // (which applies a `transform`) doesn't scope our `position: fixed`
    // overlays to the body's box.
    const root = document.documentElement;

    const vignette = document.createElement("div");
    vignette.id = "__demo_vignette__";
    root.appendChild(vignette);

    const cursor = document.createElement("div");
    cursor.id = "__demo_cursor__";
    cursor.innerHTML = svg;
    cursor.style.opacity = "0";
    root.appendChild(cursor);

    const caption = document.createElement("div");
    caption.id = "__demo_caption__";
    caption.innerHTML = `<span class="dot"></span><span class="text"></span>`;
    root.appendChild(caption);

    document.addEventListener("mousemove", (e) => {
      cursor.style.left = e.clientX + "px";
      cursor.style.top = e.clientY + "px";
    }, true);
    document.addEventListener("click", () => {
      cursor.classList.remove("click");
      void cursor.offsetWidth;
      cursor.classList.add("click");
    }, true);
  }, { css: OVERLAY_CSS, svg: CURSOR_SVG });
}

async function showCard(page: import("playwright").Page, html: string) {
  await page.evaluate((html) => {
    let card = document.getElementById("__demo_card__");
    if (card) card.remove();
    card = document.createElement("div");
    card.id = "__demo_card__";
    card.className = "__demo_card__";
    card.innerHTML = html;
    document.documentElement.appendChild(card);
    void card.offsetWidth;
    card.classList.add("in");
  }, html);
}

async function hideCard(page: import("playwright").Page) {
  await page.evaluate(() => {
    const card = document.getElementById("__demo_card__");
    if (!card) return;
    card.classList.remove("in");
    setTimeout(() => card.remove(), 700);
  });
  await sleep(600);
}

async function setCaption(page: import("playwright").Page, text: string) {
  await page.evaluate((text) => {
    const cap = document.getElementById("__demo_caption__")!;
    const t = cap.querySelector(".text") as HTMLElement;
    if (cap.classList.contains("in") && t.textContent !== text) {
      cap.classList.remove("in");
      setTimeout(() => {
        t.textContent = text;
        cap.classList.add("in");
      }, 280);
    } else {
      t.textContent = text;
      cap.classList.add("in");
    }
  }, text);
}

async function clearCaption(page: import("playwright").Page) {
  await page.evaluate(() => {
    document.getElementById("__demo_caption__")?.classList.remove("in");
  });
}

async function showCursor(page: import("playwright").Page, on: boolean) {
  await page.evaluate((on) => {
    const c = document.getElementById("__demo_cursor__");
    if (c) c.style.opacity = on ? "1" : "0";
  }, on);
}

async function setVignette(page: import("playwright").Page, on: boolean) {
  await page.evaluate((on) => {
    document.getElementById("__demo_vignette__")?.classList.toggle("in", on);
  }, on);
}

async function moveTo(
  page: import("playwright").Page,
  selector: string,
  opts: { steps?: number; pause?: number; scroll?: boolean } = {},
) {
  const loc = page.locator(selector).first();
  if (opts.scroll !== false) await loc.scrollIntoViewIfNeeded();
  const box = await loc.boundingBox();
  if (!box) throw new Error(`no bounding box for ${selector}`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y, { steps: opts.steps ?? 22 });
  if (opts.pause) await sleep(opts.pause);
  return { x, y };
}

async function clickAt(page: import("playwright").Page, selector: string, opts: { pause?: number } = {}) {
  const { x, y } = await moveTo(page, selector, { pause: opts.pause ?? 160 });
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

  await page.goto(`http://localhost:${SERVER_PORT}/?demo=1#`);
  await page.evaluate(() => { try { localStorage.clear(); } catch {} });
  await page.reload();
  await page.waitForFunction(() => !!document.getElementById("ann-toggle"));
  await page.waitForSelector('tr[data-row-id="phase-0"] td[data-col="cost"]', { state: "attached" });

  await injectOverlays(page);

  await page.mouse.move(640, 760, { steps: 1 });
  await showCursor(page, false);

  await showCard(page, `
    <h1 class="title">annotator</h1>
    <div class="rule"></div>
    <p class="tagline">Click an element. Comment. Ship it to Claude.</p>
  `);
  await sleep(2500);
  await hideCard(page);
  await setVignette(page, true);
  await sleep(180);
  await showCursor(page, true);

  await setCaption(page, "Click any element");
  await sleep(450);
  await clickAt(page, "#ann-toggle", { pause: 200 });
  await sleep(380);
  await moveTo(page, '[data-testid="primary-cta"]', { steps: 26, pause: 280 });
  await clickAt(page, '[data-testid="primary-cta"]');
  await sleep(260);

  await setCaption(page, "Stable selectors — auto-picked");
  await page.keyboard.type("Make this gradient — flat looks dated", { delay: 32 });
  await sleep(220);
  await page.keyboard.press("Control+Enter");
  await sleep(360);

  await setCaption(page, "React-aware: knows the component & source");
  await moveTo(page, 'tr[data-row-id="phase-0"] td[data-col="cost"]', { steps: 30, pause: 250 });
  await clickAt(page, 'tr[data-row-id="phase-0"] td[data-col="cost"]');
  await sleep(280);
  await page.keyboard.type("Round to $200 please", { delay: 32 });
  await sleep(220);
  await page.keyboard.press("Control+Enter");
  await sleep(380);

  await setCaption(page, "Export — markdown, JSON, Slack, issue");
  await moveTo(page, "#ann-format", { steps: 20, pause: 180 });
  await page.locator("#ann-format").selectOption("markdown-verbose");
  await sleep(320);
  await clickAt(page, "#ann-copy", { pause: 140 });
  await sleep(220);

  // Success beat: swap the caption to a "Copied" pill, then settle.
  await setCaption(page, "✓ Copied — paste into Claude");
  await sleep(1300);

  await clearCaption(page);
  await showCursor(page, false);
  await setVignette(page, false);
  await showCard(page, `
    <h1 class="title">Try it on your app</h1>
    <div class="rule"></div>
    <div class="codeline"><span class="prompt">$</span>bunx @rld/annotator dev http://localhost:5173</div>
    <p class="tagline" style="margin-top:22px;">github.com/rld/annotator</p>
  `);
  await sleep(2600);

  await context.close();
  await browser.close();

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

  await ffmpeg([
    "-i", webm,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryslow",
    "-crf", "20",
    "-movflags", "+faststart",
    "-an",
    mp4,
  ]);

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
