export type SelectorStrategy =
  | "testid"
  | "data-attr"
  | "id"
  | "aria-role"
  | "aria-label"
  | "semantic-class"
  | "ancestor-nth"
  | "nth-of-type";

export interface SelectorResult {
  strategy: SelectorStrategy;
  value: string;
  unique: boolean;
}

export interface ComponentInfo {
  name: string;
  ancestors: string[];
  props: Record<string, string | number | boolean>;
  key?: string;
}

export interface SourceLocation {
  fileName: string;
  lineNumber: number;
  columnNumber?: number;
}

export interface PreviewInfo {
  text: string;
  rect: { top: number; left: number; width: number; height: number };
  tagName: string;
}

export interface Screenshot {
  /** Bare filename (e.g. "ann-7-cell.png") — the server / download writes this. */
  filename: string;
  /** Absolute filesystem path once written. May be a `__SCREENSHOT_PATH_<filename>__` placeholder at render time. */
  path?: string;
  /** Base64 data URL of the image. Held in memory; stripped before persisting big sessions. */
  dataUrl?: string;
  /** Rect within the captured viewport, in CSS pixels relative to the viewport. */
  bounds: { x: number; y: number; width: number; height: number };
  /** What the image actually contains. */
  mode: "element" | "viewport" | "page";
}

export interface Annotation {
  id: number;
  timestamp: string;
  url: string;
  selector: SelectorResult;
  component?: ComponentInfo;
  source?: SourceLocation;
  preview: PreviewInfo;
  comment: string;
  tags?: string[];
  screenshot?: Screenshot;
  editing?: boolean;
}

export type ExportFormat =
  | "markdown"
  | "markdown-verbose"
  | "markdown-terse"
  | "claude-prompt"
  | "json"
  | "github-issue"
  | "slack";

export type Transport = "clipboard" | "download-md" | "download-json" | "http-post";
