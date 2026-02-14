import { html, nothing } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import type { KnowledgeBaseEditorMode } from "../controllers/knowledge-base.js";
import type { WorkspaceEntry, WorkspaceReadResult } from "../types.js";
import { icons } from "../icons.js";
import { toSanitizedMarkdownHtml } from "../markdown.js";
import { renderMarkdownEditor, type MarkdownEditorProps } from "./markdown-editor.js";

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

type ParsedFrontmatter = {
  meta: Record<string, string>;
  body: string;
};

function parseFrontmatter(content: string): ParsedFrontmatter {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) {
    return { meta: {}, body: content };
  }
  const raw = match[1];
  const body = content.slice(match[0].length);
  const meta: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const kvMatch = line.match(/^(\w[\w\s]*?):\s*(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1].trim();
      let value = kvMatch[2].trim();
      // Strip surrounding quotes
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      meta[key] = value;
    }
  }
  return { meta, body };
}

// ---------------------------------------------------------------------------
// File type helpers
// ---------------------------------------------------------------------------

function fileIcon(entryPath: string) {
  if (entryPath.startsWith("links/")) {
    return icons.link;
  }
  if (entryPath.startsWith("images/")) {
    return icons.image;
  }
  if (entryPath.startsWith("review/")) {
    return icons.scrollText;
  }
  return icons.fileText;
}

function isEditablePath(filePath: string): boolean {
  return (
    (filePath.startsWith("notes/") || filePath.startsWith("links/")) &&
    filePath.toLowerCase().endsWith(".md")
  );
}

// ---------------------------------------------------------------------------
// Section helpers
// ---------------------------------------------------------------------------

function countFiles(entries: WorkspaceEntry[]): number {
  return entries.filter((e) => e.kind === "file").length;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type KnowledgeBaseProps = {
  connected: boolean;
  loading: boolean;
  error: string | null;
  entries: {
    notes: WorkspaceEntry[];
    links: WorkspaceEntry[];
    review: WorkspaceEntry[];
    images: WorkspaceEntry[];
  };
  readLoading: boolean;
  readError: string | null;
  readResult: WorkspaceReadResult | null;
  selectedPath: string | null;
  activeView: "browse" | "review-queue";
  reviewQueueList: string[];
  embeddingSettingsLoading: boolean;
  embeddingSettingsSaving: boolean;
  embeddingSettingsError: string | null;
  embeddingSettingsNotice: string | null;
  embeddingSettings: {
    provider: "auto" | "local" | "openai" | "gemini" | "voyage";
    fallback: "none" | "local" | "openai" | "gemini" | "voyage";
    localModelPath: string;
  };
  // Editor
  editorMode: KnowledgeBaseEditorMode;
  editorTitle: string;
  editorContent: string;
  editorSaving: boolean;
  editorError: string | null;
  editorNotice: string | null;
  editorPreviewOpen: boolean;
  editorTags: string;
  editorDirty: boolean;
  // Delete
  deleteConfirmPath: string | null;
  deleting: boolean;
  deleteError: string | null;
  // Link
  linkUrl: string;
  linkAnalyzing: boolean;
  linkError: string | null;
  // Upload
  uploading: boolean;
  uploadError: string | null;
  // Collapsed sections
  collapsedSections: Set<string>;
  // Callbacks — existing
  onRefresh: () => void;
  onSelectFile: (path: string) => void;
  onOpenReviewQueue: () => void;
  onRefreshEmbeddingSettings: () => void;
  onProviderChange: (provider: "auto" | "local" | "openai" | "gemini" | "voyage") => void;
  onFallbackChange: (fallback: "none" | "local" | "openai" | "gemini" | "voyage") => void;
  onLocalModelPathChange: (path: string) => void;
  onUseLocalPreset: () => void;
  onSaveEmbeddingSettings: () => void;
  // Callbacks — editor
  onCreateNote: () => void;
  onEditNote: () => void;
  onSaveNote: () => void;
  onCancelEditor: () => void;
  onEditorTitleChange: (title: string) => void;
  onEditorContentChange: (content: string) => void;
  onEditorTogglePreview: () => void;
  onEditorTagsChange: (tags: string) => void;
  // Callbacks — delete
  onDeleteEntry: (path: string) => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  // Callbacks — link
  onSaveLinkStart: () => void;
  onLinkUrlChange: (url: string) => void;
  onSaveLink: () => void;
  // Callbacks — upload
  onUploadImageStart: () => void;
  onUploadImage: (file: File) => void;
  // Callbacks — sections
  onToggleSection: (section: string) => void;
};

export function renderKnowledgeBase(props: KnowledgeBaseProps) {
  const preview = renderPreviewPane(props);
  const embeddingDisabled =
    !props.connected || props.embeddingSettingsLoading || props.embeddingSettingsSaving;
  return html`
    <section class="card">
      <div class="kb-header">
        <div>
          <div class="card-title">Knowledge Base</div>
          <div class="card-sub">Shared knowledge repository for notes, links, and images.</div>
        </div>
        <div class="kb-actions">
          <button
            class="btn"
            @click=${props.onCreateNote}
            ?disabled=${!props.connected}
            title="Create a new note"
          >
            ${icons.edit}
            New Note
          </button>
          <button
            class="btn"
            @click=${props.onSaveLinkStart}
            ?disabled=${!props.connected}
            title="Save and analyze a link"
          >
            ${icons.link}
            Save Link
          </button>
          <button
            class="btn"
            @click=${props.onUploadImageStart}
            ?disabled=${!props.connected}
            title="Upload an image"
          >
            ${icons.image}
            Upload Image
          </button>
          <button class="btn" @click=${props.onOpenReviewQueue} ?disabled=${!props.connected}>
            ${icons.scrollText}
            Review Queue
          </button>
          <button class="btn" @click=${props.onRefresh} ?disabled=${!props.connected || props.loading}>
            ${icons.loader}
            Refresh
          </button>
        </div>
      </div>

      ${
        !props.connected
          ? html`
              <div class="callout danger" style="margin-top: 12px">Disconnected from gateway.</div>
            `
          : nothing
      }

      <div class="kb-embeddings" style="margin-top: 12px;">
        <div class="kb-embeddings-header">
          <div>
            <div class="kb-embeddings-title">Memory Embeddings</div>
            <div class="muted">
              Configure default semantic memory embeddings in <span class="mono">agents.defaults.memorySearch</span>.
            </div>
          </div>
          <div class="kb-actions">
            <button
              class="btn"
              @click=${props.onRefreshEmbeddingSettings}
              ?disabled=${!props.connected || props.embeddingSettingsLoading}
            >
              ${icons.loader}
              Refresh Settings
            </button>
            <button class="btn" @click=${props.onUseLocalPreset} ?disabled=${embeddingDisabled}>
              Use Local Preset
            </button>
            <button class="btn primary" @click=${props.onSaveEmbeddingSettings} ?disabled=${embeddingDisabled}>
              ${props.embeddingSettingsSaving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
        ${
          props.embeddingSettingsError
            ? html`<div class="callout danger" style="margin-top: 10px;">${props.embeddingSettingsError}</div>`
            : nothing
        }
        ${
          props.embeddingSettingsNotice
            ? html`<div class="callout success" style="margin-top: 10px;">${props.embeddingSettingsNotice}</div>`
            : nothing
        }
        <div class="form-grid" style="margin-top: 10px;">
          <label class="field">
            <span>Provider</span>
            <select
              .value=${props.embeddingSettings.provider}
              @change=${(event: Event) => {
                const value = (event.target as HTMLSelectElement).value as
                  | "auto"
                  | "local"
                  | "openai"
                  | "gemini"
                  | "voyage";
                props.onProviderChange(value);
              }}
              ?disabled=${embeddingDisabled}
            >
              <option value="auto">auto</option>
              <option value="local">local</option>
              <option value="openai">openai</option>
              <option value="gemini">gemini</option>
              <option value="voyage">voyage</option>
            </select>
          </label>
          <label class="field">
            <span>Fallback</span>
            <select
              .value=${props.embeddingSettings.fallback}
              @change=${(event: Event) => {
                const value = (event.target as HTMLSelectElement).value as
                  | "none"
                  | "local"
                  | "openai"
                  | "gemini"
                  | "voyage";
                props.onFallbackChange(value);
              }}
              ?disabled=${embeddingDisabled}
            >
              <option value="none">none</option>
              <option value="local">local</option>
              <option value="openai">openai</option>
              <option value="gemini">gemini</option>
              <option value="voyage">voyage</option>
            </select>
          </label>
          <label class="field full">
            <span>Local Model Path (GGUF file or hf: URI)</span>
            <input
              type="text"
              .value=${props.embeddingSettings.localModelPath}
              placeholder="hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf"
              @input=${(event: Event) =>
                props.onLocalModelPathChange((event.target as HTMLInputElement).value)}
              ?disabled=${embeddingDisabled}
            />
          </label>
        </div>
        <div class="muted" style="margin-top: 8px;">
          Saving this patch restarts the gateway, then reconnects automatically.
        </div>
      </div>

      ${
        props.connected
          ? html`
              ${
                props.error
                  ? html`<div class="callout warn" style="margin-top: 12px;">${props.error}</div>`
                  : nothing
              }
              ${renderDeleteConfirm(props)}
              <div class="kb-layout" style="margin-top: 12px;">
                <div class="kb-tree">
                  ${
                    props.loading
                      ? html`
                          <div class="kb-skeleton">
                            <div class="kb-skeleton-line" style="width: 45%"></div>
                            <div class="kb-skeleton-line" style="width: 70%"></div>
                            <div class="kb-skeleton-line" style="width: 55%"></div>
                            <div class="kb-skeleton-line" style="width: 60%"></div>
                          </div>
                        `
                      : html`
                          ${renderTreeSection("Notes", props.entries.notes, props)}
                          ${renderTreeSection("Links", props.entries.links, props)}
                          ${renderTreeSection("Images", props.entries.images, props)}
                          ${renderTreeSection("Review", props.entries.review, props)}
                        `
                  }
                </div>
                <div class="kb-preview">
                  ${preview}
                </div>
              </div>
            `
          : nothing
      }
    </section>
  `;
}

function renderDeleteConfirm(props: KnowledgeBaseProps) {
  if (!props.deleteConfirmPath) {
    return nothing;
  }
  return html`
    <div class="callout warn" style="margin-top: 12px;">
      <div>Delete <strong>${props.deleteConfirmPath}</strong>? This cannot be undone.</div>
      ${props.deleteError ? html`<div style="margin-top: 4px; color: var(--danger);">${props.deleteError}</div>` : nothing}
      <div style="margin-top: 8px; display: flex; gap: 8px;">
        <button class="btn" @click=${props.onCancelDelete} ?disabled=${props.deleting}>Cancel</button>
        <button class="btn danger" @click=${props.onConfirmDelete} ?disabled=${props.deleting}>
          ${props.deleting ? "Deleting..." : "Delete"}
        </button>
      </div>
    </div>
  `;
}

function renderTreeSection(label: string, entries: WorkspaceEntry[], props: KnowledgeBaseProps) {
  const rows = Array.isArray(entries) ? entries : [];
  const fileCount = countFiles(rows);
  const sectionKey = label.toLowerCase();
  const collapsed = props.collapsedSections.has(sectionKey);

  return html`
    <div class="kb-section">
      <button
        class="kb-section-toggle"
        @click=${() => props.onToggleSection(sectionKey)}
        aria-expanded=${!collapsed}
      >
        <svg class="kb-chevron ${collapsed ? "" : "kb-chevron--open"}" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        <span class="kb-section-title">${label}</span>
        ${fileCount > 0 ? html`<span class="kb-section-count">${fileCount}</span>` : nothing}
      </button>
      ${
        collapsed
          ? nothing
          : html`
              <div class="kb-section-items">
                ${
                  rows.length === 0
                    ? renderEmptySection(label, props)
                    : rows.map((entry) => renderEntryRow(entry, props))
                }
              </div>
            `
      }
    </div>
  `;
}

function renderEmptySection(label: string, props: KnowledgeBaseProps) {
  const lower = label.toLowerCase();
  if (lower === "notes") {
    return html`
      <div class="kb-empty-state">
        <div class="kb-empty-state-icon">${icons.edit}</div>
        <div class="kb-empty-state-text">No notes yet</div>
        <button class="btn btn-sm" @click=${props.onCreateNote} ?disabled=${!props.connected}>New Note</button>
      </div>
    `;
  }
  if (lower === "links") {
    return html`
      <div class="kb-empty-state">
        <div class="kb-empty-state-icon">${icons.link}</div>
        <div class="kb-empty-state-text">No links saved</div>
        <button class="btn btn-sm" @click=${props.onSaveLinkStart} ?disabled=${!props.connected}>Save Link</button>
      </div>
    `;
  }
  if (lower === "images") {
    return html`
      <div class="kb-empty-state">
        <div class="kb-empty-state-icon">${icons.image}</div>
        <div class="kb-empty-state-text">No images uploaded</div>
        <button class="btn btn-sm" @click=${props.onUploadImageStart} ?disabled=${!props.connected}>Upload</button>
      </div>
    `;
  }
  return html`
    <div class="muted kb-empty">No entries.</div>
  `;
}

function isWritablePath(filePath: string): boolean {
  return (
    filePath.startsWith("notes/") || filePath.startsWith("links/") || filePath.startsWith("images/")
  );
}

function renderEntryRow(entry: WorkspaceEntry, props: KnowledgeBaseProps) {
  const entryPath = String(entry?.path ?? "");
  const kind = entry?.kind === "dir" ? "dir" : "file";
  const segments = entryPath.split("/").filter(Boolean);
  const depth = Math.max(0, segments.length - 2);
  const name = segments[segments.length - 1] ?? entryPath;
  const isFile = kind === "file";
  const isSelected = props.activeView === "browse" && props.selectedPath === entryPath;
  const indent = depth * 14;
  const canDelete = isFile && isWritablePath(entryPath);

  return html`
    <div class="kb-row ${isSelected ? "kb-row--active" : ""}" style="padding-left: ${indent}px;">
      ${
        isFile
          ? html`
              <button class="kb-item" @click=${() => props.onSelectFile(entryPath)} title=${entryPath}>
                <span class="kb-icon">${fileIcon(entryPath)}</span>
                <span class="kb-name">${name}</span>
              </button>
              ${
                canDelete
                  ? html`
                      <button
                        class="kb-row-action"
                        @click=${(e: Event) => {
                          e.stopPropagation();
                          props.onDeleteEntry(entryPath);
                        }}
                        title="Delete"
                      >
                        ${icons.x}
                      </button>
                    `
                  : nothing
              }
            `
          : html`
              <div class="kb-item kb-item--dir" title=${entryPath}>
                <span class="kb-icon">${icons.folder}</span>
                <span class="kb-name">${name}</span>
              </div>
            `
      }
    </div>
  `;
}

function renderPreviewPane(props: KnowledgeBaseProps) {
  // Editor modes take priority over browse preview
  if (props.editorMode === "create-note" || props.editorMode === "edit-note") {
    const editorProps: MarkdownEditorProps = {
      title: props.editorTitle,
      content: props.editorContent,
      saving: props.editorSaving,
      error: props.editorError,
      notice: props.editorNotice,
      previewOpen: props.editorPreviewOpen,
      tags: props.editorTags,
      onTitleChange: props.onEditorTitleChange,
      onContentChange: props.onEditorContentChange,
      onTogglePreview: props.onEditorTogglePreview,
      onTagsChange: props.onEditorTagsChange,
      onSave: props.onSaveNote,
      onCancel: () => {
        if (props.editorDirty) {
          if (!confirm("You have unsaved changes. Discard them?")) {
            return;
          }
        }
        props.onCancelEditor();
      },
    };
    return renderMarkdownEditor(editorProps);
  }

  if (props.editorMode === "save-link") {
    return renderLinkSave(props);
  }

  if (props.editorMode === "upload-image") {
    return renderImageUpload(props);
  }

  // Standard browse/preview
  if (props.readLoading) {
    return html`
      <div class="kb-skeleton">
        <div class="kb-skeleton-line" style="width: 60%"></div>
        <div class="kb-skeleton-line" style="width: 30%; height: 10px"></div>
        <div class="kb-skeleton-line" style="width: 100%; height: 1px; margin: 12px 0"></div>
        <div class="kb-skeleton-line" style="width: 80%"></div>
        <div class="kb-skeleton-line" style="width: 90%"></div>
        <div class="kb-skeleton-line" style="width: 65%"></div>
      </div>
    `;
  }
  if (props.readError) {
    return html`<div class="callout danger">${props.readError}</div>`;
  }

  if (props.activeView === "review-queue" && !props.readResult) {
    return html`
      <div class="kb-preview-header">
        <div class="kb-preview-title">Review Queue</div>
        <div class="kb-preview-sub">Showing markdown files under <span class="mono">review/</span>.</div>
      </div>
      ${
        props.reviewQueueList.length === 0
          ? html`
              <div class="muted">No markdown files found.</div>
            `
          : html`
              <div class="kb-queue-list">
                ${props.reviewQueueList.map(
                  (p) => html`
                    <button class="kb-queue-item" @click=${() => props.onSelectFile(p)}>
                      <span class="kb-icon">${icons.fileText}</span>
                      <span class="kb-name">${p.replace(/^review\//, "")}</span>
                    </button>
                  `,
                )}
              </div>
            `
      }
    `;
  }

  if (!props.readResult) {
    return html`
      <div class="kb-empty-state" style="margin-top: 40px;">
        <div class="kb-empty-state-icon">${icons.search}</div>
        <div class="kb-empty-state-text">Select a file to preview</div>
        <div class="muted" style="font-size: 12px;">Click any entry in the tree to view its contents</div>
      </div>
    `;
  }

  const file = props.readResult;
  const isMarkdown =
    file.contentType === "text/markdown" || file.path.toLowerCase().endsWith(".md");
  const isJson =
    file.contentType === "application/json" || file.path.toLowerCase().endsWith(".json");
  const isImage = file.contentType.startsWith("image/");
  const canEdit = isEditablePath(file.path) && isMarkdown;

  // Parse frontmatter for markdown files
  const parsed = isMarkdown ? parseFrontmatter(file.content) : null;
  const hasMeta = parsed && Object.keys(parsed.meta).length > 0;

  // Extract URL from link frontmatter
  const linkUrl = parsed?.meta?.url || null;
  const linkStatus = parsed?.meta?.status || null;

  return html`
    <div class="kb-preview-fade">
      <div class="kb-preview-header">
        <div style="flex: 1; min-width: 0;">
          <div class="kb-preview-title">
            ${parsed?.meta?.title || file.path}
          </div>
          <div class="kb-preview-sub">
            <span class="mono">${file.contentType}</span>
            ${
              file.truncated
                ? html`
                    <span class="kb-truncated">(truncated)</span>
                  `
                : nothing
            }
            ${
              linkStatus
                ? html`<span class="kb-status-badge kb-status-badge--${linkStatus}">${linkStatus}</span>`
                : nothing
            }
          </div>
        </div>
        <div style="display: flex; gap: 6px; flex-shrink: 0;">
          ${
            linkUrl
              ? html`
                  <a
                    class="btn btn-sm"
                    href=${linkUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open link in browser"
                  >
                    ${icons.globe} Open
                  </a>
                `
              : nothing
          }
          ${
            canEdit
              ? html`
                  <button class="btn btn-sm" @click=${props.onEditNote}>
                    ${icons.edit} Edit
                  </button>
                `
              : nothing
          }
          ${
            isWritablePath(file.path)
              ? html`
                  <button
                    class="btn btn-sm danger"
                    @click=${() => props.onDeleteEntry(file.path)}
                    title="Delete this file"
                  >
                    ${icons.x} Delete
                  </button>
                `
              : nothing
          }
        </div>
      </div>
      ${
        file.truncated
          ? html`
              <div class="callout warn" style="margin-top: 12px">Content truncated for safety.</div>
            `
          : nothing
      }
      ${
        props.linkAnalyzing && file.path.startsWith("links/")
          ? html`
              <div class="callout info" style="margin-top: 8px">Bot is analyzing this link...</div>
            `
          : nothing
      }
      ${
        hasMeta
          ? html`
              <div class="kb-meta-card">
                ${Object.entries(parsed.meta).map(([key, value]) => {
                  // Render tags as pills
                  if (key === "tags") {
                    const tagValues = value
                      .replace(/^\[|\]$/g, "")
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean);
                    if (tagValues.length === 0) {
                      return nothing;
                    }
                    return html`
                      <div class="kb-meta-row">
                        <span class="kb-meta-key">${key}</span>
                        <span class="kb-meta-value">
                          ${tagValues.map((tag) => html`<span class="kb-tag">${tag}</span>`)}
                        </span>
                      </div>
                    `;
                  }
                  // Render URL as clickable link
                  if (
                    key === "url" &&
                    (value.startsWith("http://") || value.startsWith("https://"))
                  ) {
                    return html`
                      <div class="kb-meta-row">
                        <span class="kb-meta-key">${key}</span>
                        <span class="kb-meta-value">
                          <a href=${value} target="_blank" rel="noopener noreferrer" class="kb-meta-link">${value}</a>
                        </span>
                      </div>
                    `;
                  }
                  return html`
                    <div class="kb-meta-row">
                      <span class="kb-meta-key">${key}</span>
                      <span class="kb-meta-value">${value}</span>
                    </div>
                  `;
                })}
              </div>
            `
          : nothing
      }
      <div class="kb-preview-body">
        ${
          isImage
            ? html`<img
                class="kb-image-preview"
                src="data:${file.contentType};base64,${file.content}"
                alt="${file.path}"
              />`
            : isMarkdown && parsed
              ? html`<div class="kb-markdown">${
                  parsed.body.trim()
                    ? unsafeHTML(toSanitizedMarkdownHtml(parsed.body))
                    : html`
                        <span class="muted">No body content.</span>
                      `
                }</div>`
              : isJson
                ? html`<pre class="kb-pre">${file.content}</pre>`
                : html`<pre class="kb-pre">${file.content}</pre>`
        }
      </div>
    </div>
  `;
}

function renderLinkSave(props: KnowledgeBaseProps) {
  return html`
    <div class="kb-editor">
      <div class="kb-preview-header">
        <div class="kb-preview-title">Save Link</div>
        <div class="kb-preview-sub">Enter a URL to save. The bot will fetch, analyze, and tag it automatically.</div>
      </div>
      <label class="field full" style="margin-top: 12px;">
        <span>URL</span>
        <input
          type="url"
          placeholder="https://..."
          .value=${props.linkUrl}
          @input=${(e: Event) => props.onLinkUrlChange((e.target as HTMLInputElement).value)}
          ?disabled=${props.linkAnalyzing}
        />
      </label>
      ${props.linkError ? html`<div class="callout danger" style="margin-top: 8px;">${props.linkError}</div>` : nothing}
      ${
        props.linkAnalyzing
          ? html`
              <div class="callout info" style="margin-top: 8px">Bot is fetching and analyzing this link...</div>
            `
          : nothing
      }
      <div class="kb-editor-actions" style="margin-top: 12px;">
        <button class="btn" @click=${props.onCancelEditor} ?disabled=${props.linkAnalyzing}>Cancel</button>
        <button
          class="btn primary"
          @click=${props.onSaveLink}
          ?disabled=${props.linkAnalyzing || !props.linkUrl.trim()}
        >
          ${props.linkAnalyzing ? "Analyzing..." : "Save & Analyze"}
        </button>
      </div>
    </div>
  `;
}

function renderImageUpload(props: KnowledgeBaseProps) {
  return html`
    <div class="kb-editor">
      <div class="kb-preview-header">
        <div class="kb-preview-title">Upload Image</div>
        <div class="kb-preview-sub">Drop an image or click to select. Supports PNG, JPG, GIF, WebP, SVG.</div>
      </div>
      <div
        class="kb-dropzone"
        style="margin-top: 12px;"
        @dragover=${(e: DragEvent) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement).classList.add("kb-dropzone--active");
        }}
        @dragleave=${(e: DragEvent) => {
          (e.currentTarget as HTMLElement).classList.remove("kb-dropzone--active");
        }}
        @drop=${(e: DragEvent) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement).classList.remove("kb-dropzone--active");
          const files = e.dataTransfer?.files;
          if (files) {
            for (let i = 0; i < files.length; i++) {
              const file = files[i];
              if (file.type.startsWith("image/")) {
                props.onUploadImage(file);
              }
            }
          }
        }}
      >
        <div class="muted" style="padding: 32px; text-align: center;">
          <div>${icons.image}</div>
          <div style="margin-top: 8px;">Drop images here</div>
          <div style="margin-top: 4px;">or</div>
          <input
            type="file"
            accept="image/*"
            multiple
            style="margin-top: 8px;"
            @change=${(e: Event) => {
              const input = e.target as HTMLInputElement;
              const files = input.files;
              if (files) {
                for (let i = 0; i < files.length; i++) {
                  props.onUploadImage(files[i]);
                }
              }
              input.value = "";
            }}
          />
        </div>
      </div>
      ${
        props.uploading
          ? html`
              <div class="callout info" style="margin-top: 8px">Uploading...</div>
            `
          : nothing
      }
      ${props.uploadError ? html`<div class="callout danger" style="margin-top: 8px;">${props.uploadError}</div>` : nothing}
      <div class="kb-editor-actions" style="margin-top: 12px;">
        <button class="btn" @click=${props.onCancelEditor} ?disabled=${props.uploading}>Cancel</button>
      </div>
    </div>
  `;
}
