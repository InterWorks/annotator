import type { Annotation } from "../core/types.ts";

export function toJson(annotations: Annotation[]): string {
  return JSON.stringify(
    {
      version: 1,
      url: location.href,
      title: document.title,
      capturedAt: new Date().toISOString(),
      annotations: annotations.map(({ editing, ...rest }) => rest),
    },
    null,
    2,
  );
}
