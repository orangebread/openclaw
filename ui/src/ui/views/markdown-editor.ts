import { html, nothing } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { toSanitizedMarkdownHtml } from "../markdown.js";

export type MarkdownEditorProps = {
  title: string;
  content: string;
  saving: boolean;
  error: string | null;
  notice: string | null;
  previewOpen: boolean;
  tags: string;
  onTitleChange: (title: string) => void;
  onContentChange: (content: string) => void;
  onTogglePreview: () => void;
  onTagsChange: (tags: string) => void;
  onSave: () => void;
  onCancel: () => void;
};

// ---------------------------------------------------------------------------
// Toolbar icons — compact inline SVGs (Lucide-style, 16×16)
// ---------------------------------------------------------------------------

const tbIcon = (d: string) =>
  html`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${html`<path d=${d} />`}</svg>`;

const tbIcons = {
  bold: html`
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" />
      <path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" />
    </svg>
  `,
  italic: html`
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <line x1="19" y1="4" x2="10" y2="4" />
      <line x1="14" y1="20" x2="5" y2="20" />
      <line x1="15" y1="4" x2="9" y2="20" />
    </svg>
  `,
  heading: tbIcon("M6 12h12M6 4v16M18 4v16"),
  list: html`
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  `,
  link: tbIcon("M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"),
  quote: html`
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path
        d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z"
      />
      <path
        d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3z"
      />
    </svg>
  `,
  code: html`
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  `,
  strikethrough: html`
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M16 4H9a3 3 0 0 0-3 3v0a3 3 0 0 0 3 3h6" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <path d="M8 20h7a3 3 0 0 0 3-3v0a3 3 0 0 0-3-3h-1" />
    </svg>
  `,
  hr: html`
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <line x1="3" y1="12" x2="21" y2="12" />
    </svg>
  `,
  checklist: html`
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M12 6h8" />
      <path d="M12 12h8" />
      <path d="M12 18h8" />
      <rect x="3" y="4" width="4" height="4" rx="1" />
      <path d="M3.5 14l1.5 1.5L8 12" />
      <rect x="3" y="16" width="4" height="4" rx="1" />
    </svg>
  `,
  // Panel-right: rectangle with vertical divider showing right panel (Lucide panel-right)
  panelRight: html`
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="15" y1="3" x2="15" y2="21" />
    </svg>
  `,
  // Panel-right-close: same but with a collapse arrow (Lucide panel-right-close)
  panelRightClose: html`
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="15" y1="3" x2="15" y2="21" />
      <path d="m8 9 3 3-3 3" />
    </svg>
  `,
};

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function getTextarea(): HTMLTextAreaElement | null {
  return document.querySelector<HTMLTextAreaElement>(".kb-editor-content");
}

function wrapSelection(prefix: string, suffix: string) {
  const ta = getTextarea();
  if (!ta) {
    return;
  }
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const selected = ta.value.slice(start, end);
  const replacement = `${prefix}${selected || "text"}${suffix}`;
  ta.setRangeText(replacement, start, end, "select");
  ta.focus();
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}

function insertPrefix(prefix: string) {
  const ta = getTextarea();
  if (!ta) {
    return;
  }
  const start = ta.selectionStart;
  const text = ta.value;
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const before = text.slice(0, lineStart);
  const after = text.slice(lineStart);
  ta.value = `${before}${prefix}${after}`;
  ta.selectionStart = ta.selectionEnd = start + prefix.length;
  ta.focus();
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}

function insertBlock(block: string) {
  const ta = getTextarea();
  if (!ta) {
    return;
  }
  const start = ta.selectionStart;
  const text = ta.value;
  const needsNewline = start > 0 && text[start - 1] !== "\n" ? "\n" : "";
  ta.setRangeText(`${needsNewline}${block}\n`, start, start, "end");
  ta.focus();
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}

// ---------------------------------------------------------------------------
// Keyboard shortcut handler
// ---------------------------------------------------------------------------

function makeEditorKeydownHandler(onTogglePreview: () => void) {
  return (e: KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) {
      return;
    }

    switch (e.key.toLowerCase()) {
      case "b":
        e.preventDefault();
        wrapSelection("**", "**");
        break;
      case "i":
        e.preventDefault();
        wrapSelection("*", "*");
        break;
      case "k":
        e.preventDefault();
        wrapSelection("[", "](url)");
        break;
      case "e":
        e.preventDefault();
        wrapSelection("`", "`");
        break;
      case "d":
        if (e.shiftKey) {
          e.preventDefault();
          wrapSelection("~~", "~~");
        }
        break;
      case "p":
        if (e.shiftKey) {
          e.preventDefault();
          onTogglePreview();
        }
        break;
    }
  };
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

function countStats(text: string): { words: number; chars: number } {
  const trimmed = text.trim();
  const words = trimmed ? trimmed.split(/\s+/).length : 0;
  return { words, chars: text.length };
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

function toolbarButton(
  icon: unknown,
  label: string,
  action: () => void,
  disabled: boolean,
  opts?: { shortcut?: string; active?: boolean },
) {
  const title = opts?.shortcut ? `${label} (${opts.shortcut})` : label;
  const cls = opts?.active ? "mde-tb-btn mde-tb-btn--active" : "mde-tb-btn";
  return html`
    <button
      class=${cls}
      @click=${action}
      title=${title}
      ?disabled=${disabled}
      aria-label=${label}
    >
      ${icon}
    </button>
  `;
}

function toolbarSep() {
  return html`
    <span class="mde-tb-sep"></span>
  `;
}

// ---------------------------------------------------------------------------
// Main render
// ---------------------------------------------------------------------------

export function renderMarkdownEditor(props: MarkdownEditorProps) {
  const { words, chars } = countStats(props.content);
  const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
  const mod = isMac ? "\u2318" : "Ctrl+";

  const previewHtml = props.previewOpen ? toSanitizedMarkdownHtml(props.content) : "";
  const handleKeydown = makeEditorKeydownHandler(props.onTogglePreview);

  return html`
    <div class="mde">
      <!-- Title -->
      <input
        class="mde-title"
        type="text"
        placeholder="Note title\u2026"
        .value=${props.title}
        @input=${(e: Event) => props.onTitleChange((e.target as HTMLInputElement).value)}
        ?disabled=${props.saving}
        autofocus
      />

      <!-- Tags -->
      <input
        class="mde-tags"
        type="text"
        placeholder="Tags (comma-separated)\u2026"
        .value=${props.tags}
        @input=${(e: Event) => props.onTagsChange((e.target as HTMLInputElement).value)}
        ?disabled=${props.saving}
      />

      <!-- Toolbar -->
      <div class="mde-toolbar">
        <div class="mde-tb-group">
          ${toolbarButton(tbIcons.bold, "Bold", () => wrapSelection("**", "**"), props.saving, { shortcut: `${mod}B` })}
          ${toolbarButton(tbIcons.italic, "Italic", () => wrapSelection("*", "*"), props.saving, { shortcut: `${mod}I` })}
          ${toolbarButton(tbIcons.strikethrough, "Strikethrough", () => wrapSelection("~~", "~~"), props.saving, { shortcut: `${mod}Shift+D` })}
          ${toolbarSep()}
          ${toolbarButton(tbIcons.heading, "Heading", () => insertPrefix("## "), props.saving)}
          ${toolbarButton(tbIcons.list, "Bullet list", () => insertPrefix("- "), props.saving)}
          ${toolbarButton(tbIcons.checklist, "Checklist", () => insertPrefix("- [ ] "), props.saving)}
          ${toolbarSep()}
          ${toolbarButton(tbIcons.link, "Link", () => wrapSelection("[", "](url)"), props.saving, { shortcut: `${mod}K` })}
          ${toolbarButton(tbIcons.quote, "Blockquote", () => insertPrefix("> "), props.saving)}
          ${toolbarButton(tbIcons.code, "Code", () => wrapSelection("`", "`"), props.saving, { shortcut: `${mod}E` })}
          ${toolbarButton(tbIcons.hr, "Divider", () => insertBlock("---"), props.saving)}
        </div>
        <div class="mde-tb-spacer"></div>
        ${toolbarButton(
          props.previewOpen ? tbIcons.panelRightClose : tbIcons.panelRight,
          props.previewOpen ? "Close preview" : "Preview",
          props.onTogglePreview,
          false,
          { shortcut: `${mod}Shift+P`, active: props.previewOpen },
        )}
      </div>

      <!-- Body: editor + optional preview -->
      <div class="mde-body ${props.previewOpen ? "mde-body--split" : ""}">
        <textarea
          class="kb-editor-content mde-content"
          placeholder="Write your note in markdown\u2026"
          .value=${props.content}
          @input=${(e: Event) => props.onContentChange((e.target as HTMLTextAreaElement).value)}
          @keydown=${handleKeydown}
          ?disabled=${props.saving}
        ></textarea>
        ${
          props.previewOpen
            ? html`
                <div class="mde-preview">
                  <div class="mde-preview-label">Preview</div>
                  <div class="mde-preview-content kb-markdown">
                    ${
                      props.content.trim()
                        ? unsafeHTML(previewHtml)
                        : html`
                            <span class="muted">Nothing to preview yet.</span>
                          `
                    }
                  </div>
                </div>
              `
            : nothing
        }
      </div>

      <!-- Status bar -->
      ${props.error ? html`<div class="callout danger" style="margin: 0;">${props.error}</div>` : nothing}
      ${props.notice ? html`<div class="callout success" style="margin: 0;">${props.notice}</div>` : nothing}

      <div class="mde-footer">
        <div class="mde-stats">
          <span>${words} ${words === 1 ? "word" : "words"}</span>
          <span class="mde-stats-sep">&middot;</span>
          <span>${chars} ${chars === 1 ? "char" : "chars"}</span>
        </div>
        <div class="mde-actions">
          <button class="btn" @click=${props.onCancel} ?disabled=${props.saving}>Cancel</button>
          <button class="btn primary" @click=${props.onSave} ?disabled=${props.saving}>
            ${props.saving ? "Saving\u2026" : "Save"}
          </button>
        </div>
      </div>
    </div>
  `;
}
