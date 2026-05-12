#!/usr/bin/env bun
// Probe a live production bundle to verify source-map decoding finds real
// source positions and component names for a list of minified symbols.
//
// Usage:
//   bun run dev/test-sourcemap.ts <host> <sym1> [sym2 ...]
//   bun run dev/test-sourcemap.ts http://localhost:4173 _d Ke $d Se

const HOST = process.argv[2] ?? "http://localhost:4173";
const SYMBOLS = process.argv.slice(3);
if (!SYMBOLS.length) {
  console.error("usage: bun run dev/test-sourcemap.ts <host> <sym1> [sym2 ...]");
  process.exit(1);
}
const html = await (await fetch(HOST + "/")).text();
const m = html.match(/\/(chunk-[a-z0-9]+\.js)/);
if (!m) throw new Error("could not locate bundle in HTML");
const BUNDLE = HOST + "/" + m[1];
const MAP = BUNDLE + ".map";
console.log(`bundle: ${BUNDLE}`);

const B64: Record<string, number> = (() => {
  const t = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const m: Record<string, number> = {};
  for (let i = 0; i < t.length; i++) m[t[i]!] = i;
  return m;
})();

function decodeVLQSegment(s: string): number[] {
  const out: number[] = [];
  let value = 0;
  let shift = 0;
  for (let i = 0; i < s.length; i++) {
    const c = B64[s[i]!]!;
    const cont = c & 32;
    value |= (c & 31) << shift;
    shift += 5;
    if (!cont) {
      const sign = value & 1;
      const v = value >>> 1;
      out.push(sign ? -v : v);
      value = 0;
      shift = 0;
    }
  }
  return out;
}

interface Mapping {
  genCol: number;
  sourceIdx: number;
  origLine: number;
  origCol: number;
  nameIdx: number;
}

function parseMappings(ms: string) {
  const lines: Mapping[][] = [];
  let prevSource = 0,
    prevOrigLine = 0,
    prevOrigCol = 0,
    prevName = 0;
  for (const lineStr of ms.split(";")) {
    const segs: Mapping[] = [];
    let prevGenCol = 0;
    if (lineStr.length) {
      for (const segStr of lineStr.split(",")) {
        if (!segStr) continue;
        const f = decodeVLQSegment(segStr);
        if (!f.length) continue;
        prevGenCol += f[0]!;
        const m: Mapping = {
          genCol: prevGenCol,
          sourceIdx: -1,
          origLine: -1,
          origCol: -1,
          nameIdx: -1,
        };
        if (f.length >= 4) {
          prevSource += f[1]!;
          prevOrigLine += f[2]!;
          prevOrigCol += f[3]!;
          m.sourceIdx = prevSource;
          m.origLine = prevOrigLine;
          m.origCol = prevOrigCol;
          if (f.length >= 5) {
            prevName += f[4]!;
            m.nameIdx = prevName;
          }
        }
        segs.push(m);
      }
    }
    lines.push(segs);
  }
  return lines;
}

function findMapping(lines: Mapping[][], line: number, col: number) {
  const segs = lines[line];
  if (!segs || !segs.length) return null;
  let lo = 0,
    hi = segs.length - 1,
    best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segs[mid]!.genCol <= col) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (best < 0) return null;
  const m = segs[best]!;
  if (m.sourceIdx < 0) return null;
  return m;
}

function posAt(text: string, byteIdx: number) {
  let line = 0,
    lastNL = -1;
  for (let i = 0; i < byteIdx; i++) if (text.charCodeAt(i) === 10) { line++; lastNL = i; }
  return { line, column: byteIdx - lastNL - 1 };
}

const NAME_PATTERNS: RegExp[] = [
  /\bexport\s+default\s+function\s+([A-Z_$][\w$]*)/,
  /\bexport\s+function\s+([A-Z_$][\w$]*)/,
  /\bexport\s+(?:const|let|var)\s+([A-Z_$][\w$]*)/,
  /\bfunction\s+([A-Z_$][\w$]*)/,
  /\b(?:const|let|var)\s+([A-Z_$][\w$]*)\s*=/,
  /\bclass\s+([A-Z_$][\w$]*)/,
];

function extractName(content: string, line: number) {
  const lines = content.split("\n");
  const start = Math.max(0, line - 4);
  const end = Math.min(lines.length, line + 1);
  const window = lines.slice(start, end).join("\n");
  let best: string | undefined;
  let bestIdx = -1;
  for (const re of NAME_PATTERNS) {
    const m = re.exec(window);
    if (m && m.index > bestIdx) {
      best = m[1];
      bestIdx = m.index;
    }
  }
  return best;
}

const text = await (await fetch(BUNDLE)).text();
const map = await (await fetch(MAP)).json();
const lines = parseMappings(map.mappings);
console.log(`bundle ${text.length} bytes, ${text.split("\n").length} lines`);
console.log(`map: sources=${map.sources.length}, names=${map.names.length}, hasContent=${!!map.sourcesContent}`);

// Find each minified component's function definition and resolve
for (const sym of SYMBOLS) {
  // common forms: `function _d(`, `var _d=`, `let _d=`, `const _d=`
  const patterns = [
    new RegExp(`function\\s+\\${sym[0]}${sym.slice(1)}\\b`),
    new RegExp(`(?:^|[^\\w$])\\${sym[0]}${sym.slice(1)}\\s*=\\s*function\\b`),
    new RegExp(`(?:^|[^\\w$])\\${sym[0]}${sym.slice(1)}\\s*=\\s*\\(`),
  ];
  let found: { idx: number; pat: string } | null = null;
  for (const p of patterns) {
    const m = p.exec(text);
    if (m) {
      found = { idx: m.index, pat: p.source };
      break;
    }
  }
  if (!found) {
    console.log(`\n${sym}: NOT FOUND in bundle`);
    continue;
  }
  const { line, column } = posAt(text, found.idx);
  console.log(`\n${sym}: bundle pos line=${line} col=${column} (matched: ${text.slice(found.idx, found.idx + 40)})`);
  // Try probing
  for (const off of [0, 5, 12, 20, 40]) {
    const p = posAt(text, found.idx + off);
    const m = findMapping(lines, p.line, p.column);
    if (m) {
      const src = map.sources[m.sourceIdx];
      const sc = map.sourcesContent?.[m.sourceIdx];
      const name = sc ? extractName(sc, m.origLine) : undefined;
      console.log(
        `  off=${off}: ${src}:${m.origLine + 1}:${m.origCol}  name=${name ?? "(no name extracted)"}`,
      );
    }
  }
}
