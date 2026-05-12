import type { Annotation } from "../core/types.ts";

function header(annotations: Annotation[]): string[] {
  const title = document.title || location.pathname;
  const ts = new Date().toISOString().replace("T", " ").slice(0, 16);
  return [`# Feedback — ${title}`, "", `_${annotations.length} item(s) · ${ts} · ${location.href}_`, ""];
}

function propsLine(props: Record<string, string | number | boolean>): string {
  const parts = Object.entries(props).map(([k, v]) =>
    typeof v === "string" ? `${k}="${v}"` : `${k}=${v}`,
  );
  return parts.length ? ` (${parts.join(", ")})` : "";
}

/**
 * Path that goes into rendered markdown. If we don't have the absolute path
 * yet (we usually don't on the client), we emit a placeholder that the server
 * rewrites after it writes the PNG to disk. In no-server / download mode the
 * client patches `screenshot.path` to a shell-expandable downloads path
 * (`~/Downloads/<filename>` on Unix, `%USERPROFILE%\Downloads\<filename>`
 * on Windows) before render.
 */
function shotPath(a: Annotation): string | null {
  if (!a.screenshot) return null;
  return a.screenshot.path ?? `__SCREENSHOT_PATH_${a.screenshot.filename}__`;
}

export function toMarkdown(annotations: Annotation[]): string {
  const lines = header(annotations);
  for (const a of annotations) {
    lines.push(`## ${a.id}. \`${a.selector.value}\``);
    if (a.preview.text) lines.push(`> ${a.preview.text}`);
    const shot = shotPath(a);
    if (shot) lines.push(`![screenshot](${shot})`);
    lines.push("");
    lines.push(a.comment || "_(no comment)_");
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}

export function toMarkdownVerbose(annotations: Annotation[]): string {
  const lines = header(annotations);
  for (const a of annotations) {
    const stamp = a.component ? `${a.component.name}${propsLine(a.component.props)}` : a.preview.tagName;
    lines.push(`## ${a.id}. ${stamp}`);
    lines.push("");
    lines.push(`- **selector** (\`${a.selector.strategy}\`${a.selector.unique ? "" : ", *not unique*"}): \`${a.selector.value}\``);
    if (a.component) {
      const chain = [a.component.name, ...a.component.ancestors].reverse().join(" > ");
      lines.push(`- **component**: ${chain}`);
      if (a.component.key) lines.push(`- **key**: \`${a.component.key}\``);
    }
    if (a.source) {
      const col = a.source.columnNumber != null ? `:${a.source.columnNumber}` : "";
      lines.push(`- **source**: \`${a.source.fileName}:${a.source.lineNumber}${col}\``);
    }
    if (a.tags?.length) lines.push(`- **tags**: ${a.tags.join(", ")}`);
    if (a.preview.text) {
      lines.push(`- **preview**: > ${a.preview.text}`);
    }
    const shot = shotPath(a);
    if (shot) lines.push(`- **screenshot**: \`${shot}\``);
    lines.push("");
    lines.push(a.comment || "_(no comment)_");
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}

export function toMarkdownTerse(annotations: Annotation[]): string {
  const lines: string[] = [];
  for (const a of annotations) {
    lines.push(`- \`${a.selector.value}\` — ${a.comment || "(no comment)"}`);
  }
  return lines.join("\n") + "\n";
}

export function toClaudePrompt(annotations: Annotation[]): string {
  const lines: string[] = [
    `Please make the following changes to ${document.title || location.pathname} (${location.href}):`,
    "",
  ];
  for (const a of annotations) {
    const target =
      a.source
        ? `\`${a.source.fileName}:${a.source.lineNumber}\` (component \`${a.component?.name ?? "?"}\`)`
        : a.component
        ? `component \`${a.component.name}\`${propsLine(a.component.props)} — selector \`${a.selector.value}\``
        : `selector \`${a.selector.value}\``;
    lines.push(`${a.id}. ${target}`);
    if (a.preview.text) lines.push(`   Currently: "${a.preview.text}"`);
    const shot = shotPath(a);
    if (shot) lines.push(`   Screenshot: ${shot}`);
    lines.push(`   Change: ${a.comment || "(no comment)"}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}

export function toGithubIssue(annotations: Annotation[]): string {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 16);
  const lines = [
    `**Captured from**: ${location.href}`,
    `**At**: ${ts}`,
    `**Items**: ${annotations.length}`,
    "",
    "---",
    "",
  ];
  for (const a of annotations) {
    lines.push(`### ${a.id}. ${a.component?.name ?? a.preview.tagName}`);
    lines.push("");
    lines.push(`- Selector: \`${a.selector.value}\``);
    if (a.source) {
      const col = a.source.columnNumber != null ? `:${a.source.columnNumber}` : "";
      lines.push(`- Source: \`${a.source.fileName}:${a.source.lineNumber}${col}\``);
    }
    if (a.preview.text) lines.push(`- Preview: > ${a.preview.text}`);
    const shot = shotPath(a);
    if (shot) lines.push(`- Screenshot: \`${shot}\``);
    lines.push("");
    lines.push(a.comment || "_(no comment)_");
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}

export function toSlack(annotations: Annotation[]): string {
  const lines = [`*Feedback — ${document.title || location.pathname}* (${annotations.length})`, ""];
  for (const a of annotations) {
    const sel = "`" + a.selector.value + "`";
    lines.push(`${a.id}. ${sel}`);
    if (a.comment) lines.push(`   • ${a.comment}`);
  }
  return lines.join("\n");
}
