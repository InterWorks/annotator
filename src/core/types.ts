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
