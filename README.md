# annotator

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/types-typescript-3178c6.svg)](https://www.typescriptlang.org/)
[![Built with Bun](https://img.shields.io/badge/built%20with-bun-fbf0df.svg)](https://bun.sh)

**Click any element on a page → leave a comment → export.** Works on any HTML, anywhere.

![demo](./docs/demo.gif)

[demo.mp4](./docs/demo.mp4) · [demo.webm](./docs/demo.webm)

---

## Quick start

> **Status:** not yet published to npm. Requires [Bun](https://bun.sh) (the CLI uses `#!/usr/bin/env bun`).

Install once with `bun link`, then `annotator` is available from any directory:

```sh
# 1. Clone + register the CLI globally
git clone https://github.com/InterWorks/annotator.git
cd annotator
bun link

# 2. Use it anywhere (auto-builds the IIFE bundle on first run)
annotator dev http://localhost:5173     # → opens at http://localhost:5800
annotator copy                           # IIFE → clipboard for devtools paste
annotator init                           # embed into a Vite or static project
```

To remove it later: `bun unlink` from the `annotator` directory.

> Working on the annotator itself? `bun install` to pull devDeps (TypeScript, Playwright, Vite types) and `bun run typecheck` / `bun run playground` / `bun run demo`.

---

## What it does

- **Click** any element on the page — the annotator picks the best stable selector for it (`data-testid` → ARIA → semantic class → ancestor-anchored fallback).
- **Comment** in the side panel.
- **Screenshot** (optional) — toggle 📷 Shots to capture a cropped PNG of each annotated element via one screen-share prompt.
- **Export** — markdown for Claude, JSON, GitHub issue body, Slack, or POST to your dev server. Clipboard, download, or HTTP.
- **React-aware** — captures the component name (`Cell`, `BudgetTable`), key props, and the JSX source location (`src/components/X.tsx:42:7`) from `fiber._debugSource`. Production bundles? Falls back to source-map decoding to recover the real component name from a minified symbol.

The point: you've spotted something off in your UI, you want a teammate (or Claude) to fix it. Don't paragraph-describe. Click the thing. Type the change. Send.

---

## How to use it (pick one)

### 1. Zero-touch, on a localhost dev server (any framework)

```sh
annotator dev http://localhost:5173
# → http://localhost:5800
```

A localhost proxy injects the overlay into HTML responses on the fly. **No files are written to your project.** Sessions land in `~/.annotator/<projectname>/<timestamp>.{json,md}` so an agent can read them without copy/paste.

### 2. Zero-touch, on any page in the world (paste-once)

```sh
annotator copy
```

Paste the contents into the devtools console of any page (your app in prod, a third-party site, anything). Floating "Annotate" button appears.

For repeatable use, `annotator bookmarklet` prints a `javascript:` URL — drag it to your bookmarks bar.

### 3. Embedded in a Vite project (one-time setup, zero-friction thereafter)

```sh
cd my-vite-app
annotator init
```

Adds `@interworks/annotator/vite` to `vite.config.ts` (via `bun link`), `.annotator/` to `.gitignore`, and that's it. Auto-injects in dev (`vite serve`), absent from `vite build`. The "Send" button POSTs sessions straight to `<project>/.annotator/`.

### 4. Embedded in a static HTML project

```sh
cd my-static-site
annotator init
```

Symlinks the IIFE into the project and adds a `<script>` tag to your HTML.

---

## CLI reference

```
annotator dev <upstream>       Zero-touch localhost proxy (recommended)
annotator copy                 IIFE → clipboard (devtools paste)
annotator print                IIFE → stdout
annotator bookmarklet          javascript: URL bookmarklet
annotator path                 Absolute path to the IIFE bundle
annotator init [path]          Embed in a Vite or static project (writes files)
annotator build                Rebuild the IIFE bundle from source
annotator help
```

---

## What lands in the export

A markdown item looks like this when in verbose mode (best for handoff to Claude):

```md
## 2. Cell (col=cost, kind=number)

- **selector** (`ancestor-nth`): `#react-root div.budget > table > tbody > tr > td:nth-of-type(3)`
- **component**: App > BudgetTable > Row > Cell
- **source**: `src/components/BudgetTable.tsx:42:7`
- **screenshot**: `~/Downloads/ann-2-cell.png`
- **preview**: > $205

Round to $200 — no cents on display.
```

The selector strategy adapts per element: a `[data-testid="primary-cta"]` produces `TESTID [data-testid="primary-cta"]`, an unlabeled cell produces an ancestor-anchored chain. You always get the most specific stable identifier available.

---

## Using with AI agents (Claude, Cursor, etc.)

The annotator is built around the idea that **you shouldn't have to describe a UI problem in prose** when you can just click the thing. Output formats are tuned for agent consumption:

```sh
# Markdown export ("Claude prompt" format) — paste straight into Claude:
#
#   Make these changes in the codebase:
#
#   1. <Cell> at src/components/BudgetTable.tsx:42:7
#      Currently: "$205"
#      Screenshot: ~/Downloads/ann-2-cell.png
#      Change: round to $200 — no cents on display
#
# The agent now has: selector, component, file:line, screenshot, your intent.
```

### Recommended workflow with Claude Code / Cursor / Aider

1. Run `annotator dev http://localhost:5173` (or `annotator init` in your Vite project).
2. Click things, type changes, hit **Send** (server mode) or **Download** (file mode).
3. Tell your agent: *"read `~/.annotator/<project>/*.md` and apply those changes"*.

Sessions include the original file:line, so the agent can open the right file without searching. Screenshots are saved alongside as PNGs and referenced inline — agents with vision (Claude 3.5+, GPT-4o) read them automatically.

### Output formats

| Format | Best for |
|--------|---------|
| `claude-prompt` | Pasting directly into a chat with Claude / GPT |
| `markdown-verbose` | Long-lived issue-tracker bodies, agent-readable handoffs |
| `markdown` | Lightweight summaries |
| `github-issue` | GitHub issue body |
| `json` | Programmatic consumption (CI, custom tools, MCP servers) |

---

## Cross-platform

Code paths for **Linux**, **macOS**, and **Windows** (Linux is the primary dev target; macOS/Windows paths are written but not yet exercised in CI):

- Clipboard: `clip.exe` / PowerShell `Set-Clipboard` on Windows · `pbcopy` on macOS · `wl-copy` / `xclip` / `xsel` on Linux
- Paths: uses `os.homedir()`, splits on `/` and `\`, screenshot paths use `%USERPROFILE%\Downloads\<file>` on Windows and `~/Downloads/<file>` elsewhere
- Vite plugin: pure Node APIs, runs anywhere Vite runs

---

## Develop

```sh
bun install
bun run build       # → dist/{annotator.iife.js, index.js, vite.js}
bun run playground  # → http://localhost:5780 (test fixture, vanilla + React)
bun run demo        # re-record docs/demo.{webm,mp4,gif} via Playwright
bun run typecheck
```

---

## License

[MIT](./LICENSE) © [InterWorks, Inc.](https://www.interworks.com)
