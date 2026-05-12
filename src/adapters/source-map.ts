import type { SourceLocation } from "../core/types.ts";

interface RawMap {
  version: number;
  sources: (string | null)[];
  sourcesContent?: (string | null)[];
  names: string[];
  mappings: string;
  sourceRoot?: string;
  file?: string;
}

interface Mapping {
  genCol: number;
  sourceIdx: number;
  origLine: number;
  origCol: number;
  nameIdx: number;
}

interface ParsedMap {
  raw: RawMap;
  lines: Mapping[][];
}

interface LoadedScript {
  text: string;
  map: ParsedMap | null;
}

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
    const ch = s[i]!;
    const c = B64[ch];
    if (c == null) return [];
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

function parseMap(raw: RawMap): ParsedMap {
  const lines: Mapping[][] = [];
  let prevSource = 0,
    prevOrigLine = 0,
    prevOrigCol = 0,
    prevName = 0;
  const ms = raw.mappings || "";
  let lineStart = 0;
  let segStart = 0;
  let prevGenCol = 0;
  let curLine: Mapping[] = [];

  const flushSegment = (end: number) => {
    if (end > segStart) {
      const seg = ms.slice(segStart, end);
      const fields = decodeVLQSegment(seg);
      if (fields.length > 0) {
        prevGenCol += fields[0]!;
        const m: Mapping = {
          genCol: prevGenCol,
          sourceIdx: -1,
          origLine: -1,
          origCol: -1,
          nameIdx: -1,
        };
        if (fields.length >= 4) {
          prevSource += fields[1]!;
          prevOrigLine += fields[2]!;
          prevOrigCol += fields[3]!;
          m.sourceIdx = prevSource;
          m.origLine = prevOrigLine;
          m.origCol = prevOrigCol;
          if (fields.length >= 5) {
            prevName += fields[4]!;
            m.nameIdx = prevName;
          }
        }
        curLine.push(m);
      }
    }
    segStart = end + 1;
  };

  for (let i = 0; i <= ms.length; i++) {
    const ch = i === ms.length ? ";" : ms[i];
    if (ch === ",") {
      flushSegment(i);
    } else if (ch === ";") {
      flushSegment(i);
      lines.push(curLine);
      curLine = [];
      prevGenCol = 0;
      lineStart = i + 1;
      segStart = lineStart;
    }
  }
  return { raw, lines };
}

function findMapping(map: ParsedMap, line: number, col: number): Mapping | null {
  const segs = map.lines[line];
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

const scriptCache = new Map<string, Promise<LoadedScript | null>>();

async function loadScript(url: string): Promise<LoadedScript | null> {
  const cached = scriptCache.get(url);
  if (cached) return cached;
  const promise = (async () => {
    try {
      const r = await fetch(url, { credentials: "omit" });
      if (!r.ok) return null;
      const text = await r.text();
      const tail = text.slice(Math.max(0, text.length - 2000));
      const m = tail.match(/[#@]\s*sourceMappingURL=(.+?)\s*$/m);
      if (!m) return { text, map: null } as LoadedScript;
      const ref = m[1]!.trim();
      let mapJson: any = null;
      if (ref.startsWith("data:")) {
        const idx = ref.indexOf("base64,");
        if (idx >= 0) {
          try {
            mapJson = JSON.parse(atob(ref.slice(idx + 7)));
          } catch {}
        }
      } else {
        try {
          const mr = await fetch(new URL(ref, url).href, { credentials: "omit" });
          if (mr.ok) mapJson = await mr.json();
        } catch {}
      }
      return { text, map: mapJson ? parseMap(mapJson) : null } as LoadedScript;
    } catch {
      return null;
    }
  })();
  scriptCache.set(url, promise);
  return promise;
}

function posAt(text: string, byteIdx: number): { line: number; column: number } {
  let line = 0;
  let lastNL = -1;
  const cap = Math.min(byteIdx, text.length);
  for (let i = 0; i < cap; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lastNL = i;
    }
  }
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

function extractNameFromSource(content: string, line: number): string | undefined {
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

function normalizeSourcePath(map: ParsedMap, idx: number): string | null {
  const raw = map.raw.sources[idx];
  if (!raw) return null;
  const root = map.raw.sourceRoot || "";
  let p = root + raw;
  // Strip vite/webpack-style prefixes: webpack:///, file://, ./
  p = p.replace(/^webpack:\/\/\/?/, "").replace(/^file:\/\/\/?/, "/");
  p = p.replace(/^\.\//, "");
  return p;
}

export interface ResolvedFunction {
  name?: string;
  source?: SourceLocation;
}

const fnCache = new WeakMap<Function, ResolvedFunction | null>();

function collectScriptUrls(): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const sc of document.querySelectorAll<HTMLScriptElement>("script[src]")) {
    const src = sc.src;
    if (!src || seen.has(src)) continue;
    try {
      const u = new URL(src, location.href);
      if (u.origin !== location.origin) continue;
    } catch {
      continue;
    }
    seen.add(src);
    out.push(src);
  }
  return out;
}

export async function resolveFunctionFromBundles(fn: Function): Promise<ResolvedFunction | null> {
  if (fnCache.has(fn)) return fnCache.get(fn) ?? null;
  const fnSrc = String(fn);
  if (fnSrc.length < 16) {
    fnCache.set(fn, null);
    return null;
  }

  const urls = collectScriptUrls();

  for (const url of urls) {
    const loaded = await loadScript(url);
    if (!loaded) continue;
    const idx = loaded.text.indexOf(fnSrc);
    if (idx === -1) continue;
    if (loaded.text.indexOf(fnSrc, idx + 1) !== -1) continue; // ambiguous
    if (!loaded.map) continue;

    const { line, column } = posAt(loaded.text, idx);

    let mapping = findMapping(loaded.map, line, column);
    // The mapping at the very start of a function declaration sometimes points
    // back to a less informative spot (the `function` keyword or import). Try a
    // few positions inside the function body to land on the JSX/return.
    const probeOffsets = [0, 5, 12, 20, 40, 80];
    let bestMapping: Mapping | null = mapping;
    for (const off of probeOffsets) {
      const probeIdx = idx + off;
      if (probeIdx >= idx + fnSrc.length) break;
      const p = posAt(loaded.text, probeIdx);
      const m = findMapping(loaded.map, p.line, p.column);
      if (m && m.sourceIdx >= 0) {
        bestMapping = m;
        if (m.nameIdx >= 0) break; // prefer mappings with names
      }
    }
    mapping = bestMapping;
    if (!mapping || mapping.sourceIdx < 0) continue;

    const sourcePath = normalizeSourcePath(loaded.map, mapping.sourceIdx);
    const result: ResolvedFunction = {};
    if (sourcePath) {
      result.source = {
        fileName: sourcePath,
        lineNumber: mapping.origLine + 1,
        columnNumber: mapping.origCol,
      };
      const nameFromMap =
        mapping.nameIdx >= 0 ? loaded.map.raw.names[mapping.nameIdx] : undefined;
      if (nameFromMap && /^[A-Z_$]/.test(nameFromMap)) {
        result.name = nameFromMap;
      } else {
        const content = loaded.map.raw.sourcesContent?.[mapping.sourceIdx];
        if (content) {
          const extracted = extractNameFromSource(content, mapping.origLine);
          if (extracted) result.name = extracted;
        }
      }
    }

    fnCache.set(fn, result);
    return result;
  }

  fnCache.set(fn, null);
  return null;
}
