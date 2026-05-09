import type { PreviewInfo } from "./types.ts";

export function buildPreview(el: Element): PreviewInfo {
  const text = (el.textContent || "").replace(/\s+/g, " ").trim();
  const rect = el.getBoundingClientRect();
  return {
    text: text.length > 200 ? text.slice(0, 200) + "…" : text,
    rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
    tagName: el.tagName.toLowerCase(),
  };
}
