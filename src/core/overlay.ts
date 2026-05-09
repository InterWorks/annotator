import type { Annotation, ExportFormat } from "./types.ts";
import { Store } from "./store.ts";
import { buildSelector } from "./selector.ts";
import { buildPreview } from "./preview.ts";
import { getComponentInfo } from "../adapters/react-fiber.ts";
import { getSourceLocation } from "../adapters/react-source.ts";
import { EXPORTS, render as renderExport } from "../exports/index.ts";
import { copyToClipboard } from "../transports/clipboard.ts";
import { downloadFile } from "../transports/download.ts";
import { postJson } from "../transports/http.ts";

const STYLE = `
  #ann-toggle {
    position: fixed; bottom: 20px; right: 20px;
    background: #0b1220; color: #fff; border: none;
    padding: 10px 16px; border-radius: 6px; cursor: pointer;
    font: 600 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    z-index: 2147483646; box-shadow: 0 4px 12px rgba(0,0,0,0.25);
    letter-spacing: 0.02em;
  }
  #ann-toggle:hover { background: #1a365d; }
  #ann-toggle.active { background: #b45309; }
  .ann-hover { outline: 2px solid #b45309 !important; outline-offset: 1px !important; }
  body.ann-active { cursor: crosshair !important; }
  body.ann-active a, body.ann-active button, body.ann-active select,
  body.ann-active input, body.ann-active textarea { cursor: crosshair !important; }
  #ann-panel * { cursor: auto !important; }
  #ann-toggle, #ann-toggle * { cursor: pointer !important; }

  #ann-panel {
    position: fixed; top: 0; right: 0; bottom: 0;
    width: 380px; background: #fff;
    border-left: 1px solid #d8dee7;
    z-index: 2147483645; display: flex; flex-direction: column;
    font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    box-shadow: -2px 0 12px rgba(0,0,0,0.08);
    color: #0b1220;
  }
  #ann-panel.hidden { display: none; }
  #ann-panel header {
    padding: 14px 16px; border-bottom: 1px solid #d8dee7;
    display: flex; justify-content: space-between; align-items: center;
    gap: 8px;
  }
  #ann-panel header h3 { margin: 0; font-size: 13px; font-weight: 600; }
  #ann-panel header .actions { display: flex; gap: 4px; align-items: center; }
  #ann-panel header button, #ann-panel header select {
    background: #fff; border: 1px solid #d8dee7;
    padding: 4px 10px; border-radius: 4px; cursor: pointer;
    font: 12px -apple-system, sans-serif; color: #0b1220;
  }
  #ann-panel header button:hover, #ann-panel header select:hover { background: #f6f7f9; }
  #ann-panel header button.primary { background: #0b1220; color: #fff; border-color: #0b1220; }
  #ann-panel header button.primary:hover { background: #1a365d; border-color: #1a365d; }

  #ann-export-row {
    padding: 8px 16px; border-bottom: 1px solid #d8dee7;
    display: flex; gap: 6px; align-items: center; flex-wrap: wrap;
    background: #f9fafb;
  }
  #ann-export-row label { font-size: 11px; color: #475569; }
  #ann-export-row select { flex: 1; min-width: 120px; }
  #ann-export-row button { padding: 4px 8px; font-size: 11.5px; }

  #ann-list { flex: 1; overflow-y: auto; padding: 10px; }
  #ann-list:empty::after {
    content: "Click \\"Annotate\\", then click any element on the page.";
    display: block; padding: 20px; color: #94a3b8; font-style: italic; font-size: 12px;
  }
  .ann-item {
    border: 1px solid #d8dee7; border-radius: 5px;
    padding: 10px; margin-bottom: 8px; background: #fafbfc;
  }
  .ann-item.editing { background: #fffbeb; border-color: #f0e6cc; }
  .ann-item .head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .ann-item .num {
    display: inline-flex; align-items: center; justify-content: center;
    width: 22px; height: 22px;
    background: #b45309; color: #fff; border-radius: 50%;
    font-weight: 600; font-size: 11px; flex-shrink: 0;
  }
  .ann-item .title {
    font-size: 12px; font-weight: 600; color: #0b1220;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    flex: 1;
  }
  .ann-item .meta {
    font: 10.5px ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    color: #475569; word-break: break-all; line-height: 1.4;
    margin-bottom: 4px;
  }
  .ann-item .meta .strategy {
    display: inline-block; background: #eef2f7; color: #475569;
    padding: 1px 5px; border-radius: 3px; margin-right: 4px;
    font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.05em;
  }
  .ann-item .meta .source { color: #2563eb; }
  .ann-item .preview {
    font-size: 11.5px; color: #475569; margin: 4px 0 6px 0;
    font-style: italic;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .ann-item .comment { font-size: 13px; color: #0b1220; margin: 6px 0; white-space: pre-wrap; }
  .ann-item textarea {
    width: 100%; box-sizing: border-box;
    border: 1px solid #d8dee7; border-radius: 4px;
    padding: 8px; font: 13px -apple-system, sans-serif; resize: vertical;
    min-height: 60px; color: #0b1220; background: #fff;
  }
  .ann-item .row { margin-top: 6px; display: flex; gap: 6px; align-items: center; }
  .ann-item .row .spacer { flex: 1; }
  .ann-item .row button {
    font: 11.5px -apple-system, sans-serif;
    padding: 4px 10px; border: 1px solid #d8dee7;
    background: #fff; border-radius: 3px; cursor: pointer; color: #0b1220;
  }
  .ann-item .row button:hover { background: #f6f7f9; }
  .ann-item .row button.primary { background: #0b1220; color: #fff; border-color: #0b1220; }
  .ann-item .row button.primary:hover { background: #1a365d; }
  .ann-item .row button.danger { color: #b91c1c; border-color: #f3cccc; }
  .ann-item .row button.danger:hover { background: #fdf0f0; }
  .ann-item .row .hint { font-size: 10.5px; color: #94a3b8; }

  .ann-marker {
    position: absolute;
    width: 22px; height: 22px;
    background: #b45309; color: #fff; border-radius: 50%;
    font: 600 11px -apple-system, sans-serif;
    display: flex; align-items: center; justify-content: center;
    z-index: 2147483644;
    box-shadow: 0 2px 6px rgba(0,0,0,0.25);
    pointer-events: none;
    transform: translate(-50%, -50%);
  }

  body.ann-panel-open { padding-right: 380px; transition: padding-right 0.15s ease; }
  body.ann-panel-open #ann-toggle { right: 400px; transition: right 0.15s ease; }

  #ann-status {
    position: fixed; bottom: 60px; right: 20px;
    background: #0b1220; color: #fff;
    padding: 8px 12px; border-radius: 4px; font-size: 12px;
    z-index: 2147483647; opacity: 0; transition: opacity 0.2s ease;
    pointer-events: none; max-width: 320px;
  }
  #ann-status.visible { opacity: 1; }
  body.ann-panel-open #ann-status { right: 400px; }

  @media (prefers-color-scheme: dark) {
    #ann-toggle { background: #1a2335; color: #e6edf6; box-shadow: 0 4px 14px rgba(0,0,0,0.5); }
    #ann-toggle:hover { background: #243047; }
    #ann-toggle.active { background: #d4a73a; color: #0a0f1a; }
    #ann-panel { background: #131c2d; color: #e6edf6; border-left-color: #243047; box-shadow: -2px 0 16px rgba(0,0,0,0.5); }
    #ann-panel header { border-bottom-color: #243047; }
    #ann-panel header button, #ann-panel header select { background: #1a2335; border-color: #2a3855; color: #e6edf6; }
    #ann-panel header button:hover, #ann-panel header select:hover { background: #243047; }
    #ann-panel header button.primary { background: #d4a73a; color: #0a0f1a; border-color: #d4a73a; }
    #ann-panel header button.primary:hover { background: #e8bf52; border-color: #e8bf52; }
    #ann-export-row { background: #0f1626; border-bottom-color: #243047; }
    #ann-export-row label { color: #8a99ad; }
    #ann-list:empty::after { color: #6b7891; }
    .ann-item { background: #1a2335; border-color: #243047; color: #e6edf6; }
    .ann-item.editing { background: #2a2010; border-color: #d4a73a; }
    .ann-item .meta { color: #8a99ad; }
    .ann-item .meta .strategy { background: #243047; color: #c2cdd9; }
    .ann-item .preview { color: #8a99ad; }
    .ann-item .comment { color: #e6edf6; }
    .ann-item textarea { background: #0f1626; color: #e6edf6; border-color: #2a3855; }
    .ann-item .row button { background: #131c2d; border-color: #2a3855; color: #e6edf6; }
    .ann-item .row button:hover { background: #243047; }
    .ann-item .row button.primary { background: #d4a73a; color: #0a0f1a; border-color: #d4a73a; }
    .ann-item .row button.primary:hover { background: #e8bf52; }
    .ann-item .row button.danger { color: #f87171; border-color: #4a1f1f; }
    .ann-item .row button.danger:hover { background: #2a0f0f; }
    .ann-item .row .hint { color: #6b7891; }
    .ann-marker { box-shadow: 0 2px 8px rgba(0,0,0,0.6); }
    .ann-hover { outline-color: #d4a73a !important; }
  }

  @media print {
    #ann-toggle, #ann-panel, .ann-marker, #ann-status, #ann-style { display: none !important; }
    body.ann-panel-open { padding-right: 0 !important; }
  }
`;

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!),
  );
}

export interface MountOptions {
  /** Enable POST-to-server export (used by Vite plugin). Default false. */
  endpoint?: string;
  /** Override storage scope. Default location.pathname. */
  scope?: string;
}

export interface MountHandle {
  toggle: () => void;
  open: () => void;
  close: () => void;
  unmount: () => void;
  store: Store;
}

const GLOBAL_KEY = "__annotator__";

export function mount(opts: MountOptions = {}): MountHandle {
  if ((window as any)[GLOBAL_KEY]) {
    const existing = (window as any)[GLOBAL_KEY] as MountHandle;
    existing.toggle();
    return existing;
  }

  const store = new Store(opts.scope);
  let active = false;
  let lastHover: Element | null = null;

  // ---------- Styles ----------
  const style = document.createElement("style");
  style.id = "ann-style";
  style.textContent = STYLE;
  document.head.appendChild(style);

  // ---------- Toggle button ----------
  const toggle = document.createElement("button");
  toggle.id = "ann-toggle";
  document.body.appendChild(toggle);

  // ---------- Panel ----------
  const panel = document.createElement("div");
  panel.id = "ann-panel";
  panel.className = "hidden";
  panel.innerHTML = `
    <header>
      <h3>Annotations (<span id="ann-count">0</span>)</h3>
      <div class="actions">
        <button id="ann-clear">Clear</button>
        <button id="ann-close" title="Close panel">×</button>
      </div>
    </header>
    <div id="ann-export-row">
      <label for="ann-format">Export</label>
      <select id="ann-format">
        ${EXPORTS.map((e) => `<option value="${e.id}" title="${escapeHtml(e.description)}">${escapeHtml(e.label)}</option>`).join("")}
      </select>
      <button id="ann-copy" class="primary">Copy</button>
      <button id="ann-download">Download</button>
      ${opts.endpoint ? `<button id="ann-post">Send</button>` : ""}
    </div>
    <div id="ann-list"></div>
  `;
  document.body.appendChild(panel);

  const status = document.createElement("div");
  status.id = "ann-status";
  document.body.appendChild(status);

  let statusTimer: number | undefined;
  function showStatus(msg: string, ms = 1600) {
    status.textContent = msg;
    status.classList.add("visible");
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => status.classList.remove("visible"), ms);
  }

  // ---------- Refs ----------
  const list = panel.querySelector("#ann-list") as HTMLDivElement;
  const countEl = panel.querySelector("#ann-count") as HTMLSpanElement;
  const formatSel = panel.querySelector("#ann-format") as HTMLSelectElement;

  // ---------- Render ----------
  function syncBodyClass() {
    document.body.classList.toggle("ann-panel-open", !panel.classList.contains("hidden"));
  }

  function renderItem(a: Annotation, idx: number): string {
    const sourceFrag = a.source
      ? ` <span class="source">${escapeHtml(a.source.fileName.split("/").pop() ?? a.source.fileName)}:${a.source.lineNumber}</span>`
      : "";
    const titleText = a.component
      ? `${a.component.name}${a.component.props.id ? ` #${a.component.props.id}` : ""}`
      : a.preview.tagName;
    const meta = `
      <div class="meta"><span class="strategy">${a.selector.strategy}</span>${escapeHtml(a.selector.value)}${sourceFrag}</div>
    `;
    if (a.editing) {
      return `
        <div class="head">
          <span class="num">${a.id}</span>
          <span class="title">${escapeHtml(titleText)}</span>
        </div>
        ${meta}
        ${a.preview.text ? `<div class="preview">"${escapeHtml(a.preview.text)}"</div>` : ""}
        <textarea data-idx="${idx}" placeholder="Your comment…">${escapeHtml(a.comment || "")}</textarea>
        <div class="row">
          <span class="hint">⌘/Ctrl + Enter to save · Esc to cancel</span>
          <span class="spacer"></span>
          <button data-action="cancel" data-idx="${idx}">Cancel</button>
          <button class="primary" data-action="save" data-idx="${idx}">Save</button>
        </div>
      `;
    }
    return `
      <div class="head">
        <span class="num">${a.id}</span>
        <span class="title">${escapeHtml(titleText)}</span>
      </div>
      ${meta}
      ${a.preview.text ? `<div class="preview">"${escapeHtml(a.preview.text)}"</div>` : ""}
      <div class="comment">${escapeHtml(a.comment || "(no comment)")}</div>
      <div class="row">
        <span class="spacer"></span>
        <button data-action="edit" data-idx="${idx}">Edit</button>
        <button class="danger" data-action="delete" data-idx="${idx}">Delete</button>
      </div>
    `;
  }

  function render() {
    const items = store.list();
    countEl.textContent = String(items.length);
    syncBodyClass();
    list.innerHTML = "";
    items.forEach((a, i) => {
      const item = document.createElement("div");
      item.className = "ann-item" + (a.editing ? " editing" : "");
      item.innerHTML = renderItem(a, i);
      list.appendChild(item);
    });
    renderMarkers();
    updateToggle();
  }

  function renderMarkers() {
    document.querySelectorAll(".ann-marker").forEach((m) => m.remove());
    for (const a of store.list()) {
      try {
        const el = document.querySelector(a.selector.value);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        const m = document.createElement("div");
        m.className = "ann-marker";
        m.textContent = String(a.id);
        m.style.top = window.scrollY + r.top + "px";
        m.style.left = window.scrollX + r.left + "px";
        document.body.appendChild(m);
      } catch {}
    }
  }

  function updateToggle() {
    const n = store.count();
    toggle.textContent = active ? "✓ Annotating — click any element" : `Annotate${n ? " (" + n + ")" : ""}`;
    toggle.classList.toggle("active", active);
  }

  store.subscribe(render);

  // ---------- Interactions ----------
  function isOurNode(t: Element | null): boolean {
    if (!t) return false;
    return !!(t.closest("#ann-panel") || t.closest("#ann-toggle") || t.closest(".ann-marker") || t.closest("#ann-status"));
  }

  function onMouseMove(e: MouseEvent) {
    if (!active) return;
    const t = e.target as Element | null;
    if (!t || isOurNode(t)) {
      if (lastHover) { lastHover.classList.remove("ann-hover"); lastHover = null; }
      return;
    }
    if (t === lastHover) return;
    if (lastHover) lastHover.classList.remove("ann-hover");
    t.classList.add("ann-hover");
    lastHover = t;
  }

  function onClick(e: MouseEvent) {
    if (!active) return;
    const t = e.target as Element | null;
    if (!t || isOurNode(t)) return;
    e.preventDefault();
    e.stopPropagation();

    const selector = buildSelector(t);
    const preview = buildPreview(t);
    const component = getComponentInfo(t);
    const source = getSourceLocation(t);

    const partial: Omit<Annotation, "id" | "timestamp" | "url"> = {
      selector, preview, comment: "", editing: true,
    };
    if (component) partial.component = component;
    if (source) partial.source = source;

    const created = store.add(partial);
    panel.classList.remove("hidden");
    setTimeout(() => {
      const idx = store.list().findIndex((a) => a.id === created.id);
      const ta = panel.querySelector(`textarea[data-idx="${idx}"]`) as HTMLTextAreaElement | null;
      if (ta) { ta.focus(); ta.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
    }, 30);
  }

  panel.addEventListener("click", (e) => {
    const btn = (e.target as Element).closest("button");
    if (!btn) return;
    const idx = Number(btn.getAttribute("data-idx"));
    const action = btn.getAttribute("data-action");
    const items = store.list();
    if (Number.isFinite(idx) && action) {
      const a = items[idx];
      if (!a) return;
      if (action === "save") {
        const ta = panel.querySelector(`textarea[data-idx="${idx}"]`) as HTMLTextAreaElement | null;
        store.update(a.id, { comment: (ta?.value || "").trim(), editing: false });
      } else if (action === "cancel") {
        if (!a.comment) store.remove(a.id);
        else store.update(a.id, { editing: false });
      } else if (action === "edit") {
        store.update(a.id, { editing: true });
      } else if (action === "delete") {
        store.remove(a.id);
      }
    }
  });

  panel.addEventListener("keydown", (e) => {
    const ta = e.target as HTMLTextAreaElement;
    if (ta.tagName !== "TEXTAREA" || ta.dataset.idx == null) return;
    const idx = Number(ta.dataset.idx);
    const a = store.list()[idx];
    if (!a) return;
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      store.update(a.id, { comment: ta.value.trim(), editing: false });
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (!a.comment) store.remove(a.id);
      else store.update(a.id, { editing: false });
    }
  });

  toggle.addEventListener("click", () => {
    active = !active;
    document.body.classList.toggle("ann-active", active);
    if (!active && lastHover) { lastHover.classList.remove("ann-hover"); lastHover = null; }
    if (active || store.count()) panel.classList.remove("hidden");
    updateToggle();
    syncBodyClass();
  });

  (panel.querySelector("#ann-close") as HTMLButtonElement).addEventListener("click", () => {
    panel.classList.add("hidden");
    syncBodyClass();
  });

  (panel.querySelector("#ann-clear") as HTMLButtonElement).addEventListener("click", () => {
    if (!store.count()) return;
    if (confirm(`Clear all ${store.count()} annotation(s)?`)) store.clear();
  });

  function getCurrentExport(): { spec: typeof EXPORTS[number]; payload: string } {
    const id = formatSel.value as ExportFormat;
    const spec = EXPORTS.find((e) => e.id === id) ?? EXPORTS[0]!;
    const payload = renderExport(spec.id, store.list().filter((a) => !a.editing || a.comment));
    return { spec, payload };
  }

  (panel.querySelector("#ann-copy") as HTMLButtonElement).addEventListener("click", async () => {
    const { spec, payload } = getCurrentExport();
    const ok = await copyToClipboard(payload);
    showStatus(ok ? `Copied ${spec.label} ✓` : `Copy failed (logged to console)`);
  });

  (panel.querySelector("#ann-download") as HTMLButtonElement).addEventListener("click", () => {
    const { spec, payload } = getCurrentExport();
    const slug = (document.title || "annotations").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "annotations";
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    downloadFile(`${slug}-${stamp}.${spec.ext}`, payload, spec.mime);
    showStatus(`Downloaded ${spec.label}`);
  });

  const postBtn = panel.querySelector("#ann-post") as HTMLButtonElement | null;
  if (postBtn && opts.endpoint) {
    postBtn.addEventListener("click", async () => {
      const { spec, payload } = getCurrentExport();
      const res = await postJson(opts.endpoint!, {
        format: spec.id,
        url: location.href,
        title: document.title,
        capturedAt: new Date().toISOString(),
        annotations: store.list(),
        rendered: payload,
      });
      showStatus(res.ok ? `Sent to ${opts.endpoint} ✓` : `Send failed (${res.status})`);
    });
  }

  document.addEventListener("mousemove", onMouseMove, true);
  document.addEventListener("click", onClick, true);
  window.addEventListener("scroll", renderMarkers, { passive: true });
  window.addEventListener("resize", renderMarkers);

  if (store.count()) panel.classList.remove("hidden");
  render();

  const handle: MountHandle = {
    toggle: () => toggle.click(),
    open: () => { panel.classList.remove("hidden"); syncBodyClass(); },
    close: () => { panel.classList.add("hidden"); syncBodyClass(); },
    unmount: () => {
      document.removeEventListener("mousemove", onMouseMove, true);
      document.removeEventListener("click", onClick, true);
      style.remove();
      toggle.remove();
      panel.remove();
      status.remove();
      document.body.classList.remove("ann-active", "ann-panel-open");
      delete (window as any)[GLOBAL_KEY];
    },
    store,
  };
  (window as any)[GLOBAL_KEY] = handle;
  return handle;
}
