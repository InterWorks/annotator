import type { Annotation, ExportFormat } from "../core/types.ts";
import {
  toMarkdown,
  toMarkdownVerbose,
  toMarkdownTerse,
  toClaudePrompt,
  toGithubIssue,
  toSlack,
} from "./markdown.ts";
import { toJson } from "./json.ts";

export interface ExportSpec {
  id: ExportFormat;
  label: string;
  description: string;
  mime: string;
  ext: string;
}

export const EXPORTS: ExportSpec[] = [
  { id: "markdown", label: "Markdown", description: "Default — selector + comment", mime: "text/markdown", ext: "md" },
  { id: "markdown-verbose", label: "Markdown (verbose)", description: "+ component, source, props", mime: "text/markdown", ext: "md" },
  { id: "markdown-terse", label: "Markdown (terse)", description: "One line per item", mime: "text/markdown", ext: "md" },
  { id: "claude-prompt", label: "Claude prompt", description: "Ready-to-paste prompt", mime: "text/plain", ext: "md" },
  { id: "github-issue", label: "GitHub issue", description: "Issue body", mime: "text/markdown", ext: "md" },
  { id: "slack", label: "Slack", description: "Slack-flavored", mime: "text/plain", ext: "txt" },
  { id: "json", label: "JSON", description: "Raw structured", mime: "application/json", ext: "json" },
];

export function render(format: ExportFormat, annotations: Annotation[]): string {
  switch (format) {
    case "markdown": return toMarkdown(annotations);
    case "markdown-verbose": return toMarkdownVerbose(annotations);
    case "markdown-terse": return toMarkdownTerse(annotations);
    case "claude-prompt": return toClaudePrompt(annotations);
    case "github-issue": return toGithubIssue(annotations);
    case "slack": return toSlack(annotations);
    case "json": return toJson(annotations);
  }
}
