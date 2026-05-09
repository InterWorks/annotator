import type { SelectorResult, SelectorStrategy } from "./types.ts";

const TEST_ATTRS = ["data-testid", "data-test-id", "data-test", "data-cy", "data-qa"];

// Generated id patterns to skip:
//   :r1:, :rab:    - React useId
//   uuid-shaped    - 8-4-4-4-12 hex
//   long random    - 8+ alnum with no separators
const GEN_ID_PATTERNS = [
  /^:r[a-z0-9]+:$/i,
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
];

function isStableId(id: string): boolean {
  if (!id) return false;
  for (const p of GEN_ID_PATTERNS) if (p.test(id)) return false;
  // Heuristic: long, all-lowercase-alnum strings with no separators are usually generated.
  if (/^[a-z0-9]{16,}$/.test(id)) return false;
  return true;
}

// Drop hash classes like css-1abc2def, sc-1a2b3c, emotion-cache-XYZ, _abc123_456_.
// Keep semantic classes: button-primary, card, header, my-class, nav-item.
function isSemanticClass(cls: string): boolean {
  if (!cls) return false;
  if (cls.startsWith("pf-") || cls.startsWith("ann-")) return false; // our own UI
  // Hash-like: short prefix + long alnum chunk
  if (/^(css|sc|jsx|emotion|chakra|mui|css-modules?)-[a-z0-9]{4,}$/i.test(cls)) return false;
  // Pure hash chunks: long alnum with no hyphens at all
  if (/^[a-z0-9]{8,}$/.test(cls)) return false;
  // Underscore-wrapped CSS-modules: _name_hash_n
  if (/^_[A-Za-z]+_[a-z0-9]{4,}_[0-9]+$/.test(cls)) return false;
  // Tailwind utility classes are kept — they're stable, even if verbose.
  return true;
}

function escapeAttr(s: string): string {
  return s.replace(/(["\\])/g, "\\$1");
}

function isUnique(sel: string, target: Element): boolean {
  try {
    const matches = document.querySelectorAll(sel);
    return matches.length === 1 && matches[0] === target;
  } catch {
    return false;
  }
}

function tryTestId(el: Element): SelectorResult | null {
  for (const attr of TEST_ATTRS) {
    const val = el.getAttribute(attr);
    if (val) {
      const sel = `[${attr}="${escapeAttr(val)}"]`;
      if (isUnique(sel, el)) {
        return { strategy: attr === "data-testid" ? "testid" : "data-attr", value: sel, unique: true };
      }
    }
  }
  return null;
}

function tryStableId(el: Element): SelectorResult | null {
  const id = el.id;
  if (!isStableId(id)) return null;
  const sel = `#${CSS.escape(id)}`;
  return { strategy: "id", value: sel, unique: isUnique(sel, el) };
}

function tryAria(el: Element): SelectorResult | null {
  const role = el.getAttribute("role");
  const label = el.getAttribute("aria-label");
  const tag = el.tagName.toLowerCase();

  if (role && label) {
    const sel = `${tag}[role="${escapeAttr(role)}"][aria-label="${escapeAttr(label)}"]`;
    if (isUnique(sel, el)) return { strategy: "aria-role", value: sel, unique: true };
  }
  if (label) {
    const sel = `${tag}[aria-label="${escapeAttr(label)}"]`;
    if (isUnique(sel, el)) return { strategy: "aria-label", value: sel, unique: true };
  }
  return null;
}

function semanticClassPart(el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (typeof el.className !== "string") return tag;
  const classes = el.className.trim().split(/\s+/).filter(isSemanticClass).slice(0, 2);
  return classes.length ? `${tag}.${classes.join(".")}` : tag;
}

function nthOfType(el: Element): string {
  const parent = el.parentElement;
  if (!parent) return el.tagName.toLowerCase();
  const sib = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
  if (sib.length <= 1) return el.tagName.toLowerCase();
  return `${el.tagName.toLowerCase()}:nth-of-type(${sib.indexOf(el) + 1})`;
}

function buildPath(el: Element, useNth: boolean): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur !== document.body && parts.length < 6) {
    let part = useNth ? nthOfType(cur) : semanticClassPart(cur);
    if (useNth && cur.parentElement) {
      // nth + class for stability
      const cls = semanticClassPart(cur);
      if (cls.includes(".")) part = cls + (part.includes(":nth-of-type") ? part.replace(cur.tagName.toLowerCase(), "") : "");
    }
    parts.unshift(part);
    cur = cur.parentElement;
  }
  return parts.join(" > ");
}

function tryAncestorAnchored(el: Element): SelectorResult | null {
  // Walk up looking for an ancestor with a stable identifier; build a relative path from there.
  let anchor: Element | null = el.parentElement;
  const tail: string[] = [semanticClassPart(el)];
  while (anchor && anchor !== document.body) {
    const anchorSel =
      tryTestId(anchor)?.value ||
      tryStableId(anchor)?.value ||
      tryAria(anchor)?.value;
    if (anchorSel) {
      const sel = `${anchorSel} ${tail.reverse().join(" > ")}`;
      if (isUnique(sel, el)) return { strategy: "ancestor-nth", value: sel, unique: true };
      // Add nth-of-type to the leaf if not unique:
      const leafIdx = tail.length - 1;
      tail.reverse();
      tail[leafIdx] = nthOfType(el);
      const sel2 = `${anchorSel} ${tail.join(" > ")}`;
      if (isUnique(sel2, el)) return { strategy: "ancestor-nth", value: sel2, unique: true };
      return { strategy: "ancestor-nth", value: sel2, unique: false };
    }
    tail.unshift(semanticClassPart(anchor));
    anchor = anchor.parentElement;
  }
  return null;
}

function fullPath(el: Element): SelectorResult {
  const value = buildPath(el, true);
  return { strategy: "nth-of-type", value, unique: isUnique(value, el) };
}

export function buildSelector(el: Element): SelectorResult {
  return (
    tryTestId(el) ||
    tryStableId(el) ||
    tryAria(el) ||
    tryAncestorAnchored(el) ||
    fullPath(el)
  );
}
