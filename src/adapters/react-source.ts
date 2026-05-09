import type { SourceLocation } from "../core/types.ts";
import { getFiberFromElement } from "./react-fiber.ts";

export function getSourceLocation(el: Element): SourceLocation | undefined {
  const fiber = getFiberFromElement(el);
  if (!fiber) return undefined;

  // Walk up the return chain looking for the first _debugSource. The DOM's own fiber
  // typically lacks one; the user component above it carries the JSX source.
  let cur: any = fiber;
  while (cur) {
    if (cur._debugSource && typeof cur._debugSource.fileName === "string") {
      const ds = cur._debugSource;
      const result: SourceLocation = {
        fileName: ds.fileName,
        lineNumber: ds.lineNumber,
      };
      if (typeof ds.columnNumber === "number") result.columnNumber = ds.columnNumber;
      return result;
    }
    cur = cur.return ?? null;
  }
  return undefined;
}
