import type { ComponentInfo } from "../core/types.ts";

interface FiberLike {
  type?: any;
  elementType?: any;
  stateNode?: any;
  return?: FiberLike | null;
  _debugOwner?: FiberLike | null;
  _debugSource?: { fileName: string; lineNumber: number; columnNumber?: number } | null;
  memoizedProps?: any;
  pendingProps?: any;
  key?: string | null;
  tag?: number;
}

// React internal fiber tag values we care about — host components are 5/6/26/27, fragments are 7,
// providers/consumers are 10/11. Function components: 0, ClassComponent: 1, ForwardRef: 11,
// Memo: 14. We treat any non-host, non-fragment, non-provider as a "user component".
const HOST_TAGS = new Set([5, 6, 26, 27]); // HostComponent, HostText, HostHoistable, HostSingleton
const SKIP_TAGS = new Set([7, 9, 10, 12]); // Fragment, ContextConsumer, ContextProvider, Profiler

function getFiberKey(node: Element): string | null {
  for (const k of Object.keys(node)) {
    if (k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$")) return k;
  }
  return null;
}

export function getFiberFromElement(el: Element): FiberLike | null {
  const key = getFiberKey(el);
  if (!key) return null;
  return (el as any)[key] as FiberLike;
}

function getComponentName(fiber: FiberLike): string | null {
  const t = fiber.type ?? fiber.elementType;
  if (!t) return null;
  if (typeof t === "string") return null; // host component
  if (typeof t === "function") return t.displayName || t.name || null;
  if (typeof t === "object") {
    // ForwardRef: { $$typeof, render: fn }
    if (t.displayName) return t.displayName;
    if (t.render) return t.render.displayName || t.render.name || "ForwardRef";
    if (t.type) return t.type.displayName || t.type.name || "Memo";
  }
  return null;
}

function isUserComponent(fiber: FiberLike): boolean {
  if (fiber.tag !== undefined) {
    if (HOST_TAGS.has(fiber.tag)) return false;
    if (SKIP_TAGS.has(fiber.tag)) return false;
  }
  return getComponentName(fiber) != null;
}

function pickPrimitiveProps(props: any): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!props || typeof props !== "object") return out;
  const keys = ["id", "name", "label", "title", "type", "role", "kind", "variant", "value", "href", "to"];
  for (const k of keys) {
    const v = props[k];
    if (v == null) continue;
    if (typeof v === "string" && v.length <= 100) out[k] = v;
    else if (typeof v === "number") out[k] = v;
    else if (typeof v === "boolean") out[k] = v;
  }
  return out;
}

function getComponentFn(fiber: FiberLike): Function | null {
  const t = fiber.type ?? fiber.elementType;
  if (typeof t === "function") return t;
  if (t && typeof t === "object") {
    if (typeof t.render === "function") return t.render;
    if (typeof t.type === "function") return t.type;
  }
  return null;
}

function findNearestUserFiber(el: Element): FiberLike | null {
  const fiber = getFiberFromElement(el);
  if (!fiber) return null;
  let cur: FiberLike | null = fiber;
  while (cur) {
    if (isUserComponent(cur)) return cur;
    cur = cur.return ?? null;
  }
  return null;
}

export function getComponentInfo(el: Element): ComponentInfo | undefined {
  const fiber = getFiberFromElement(el);
  if (!fiber) return undefined;

  // Find nearest user component up the return chain.
  let cur: FiberLike | null = fiber;
  let nearest: FiberLike | null = null;
  while (cur) {
    if (isUserComponent(cur)) { nearest = cur; break; }
    cur = cur.return ?? null;
  }
  if (!nearest) return undefined;

  const name = getComponentName(nearest) || "Anonymous";
  const props = pickPrimitiveProps(nearest.memoizedProps ?? nearest.pendingProps);
  const ancestors: string[] = [];
  let p: FiberLike | null = nearest.return ?? null;
  while (p && ancestors.length < 4) {
    if (isUserComponent(p)) {
      const n = getComponentName(p);
      if (n) ancestors.push(n);
    }
    p = p.return ?? null;
  }

  const result: ComponentInfo = { name, ancestors, props };
  if (typeof nearest.key === "string") result.key = nearest.key;
  return result;
}

export function getComponentFiberFn(el: Element): Function | null {
  const nearest = findNearestUserFiber(el);
  if (!nearest) return null;
  return getComponentFn(nearest);
}
