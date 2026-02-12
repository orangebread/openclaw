import { html, nothing } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import type { WorkspaceEntry, WorkspaceReadResult } from "../types.js";
import { icons } from "../icons.js";
import { toSanitizedMarkdownHtml } from "../markdown.js";

export type KnowledgeBaseProps = {
  connected: boolean;
  loading: boolean;
  error: string | null;
  entries: {
    notes: WorkspaceEntry[];
    links: WorkspaceEntry[];
    review: WorkspaceEntry[];
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
  onRefresh: () => void;
  onSelectFile: (path: string) => void;
  onOpenReviewQueue: () => void;
  onRefreshEmbeddingSettings: () => void;
  onProviderChange: (provider: "auto" | "local" | "openai" | "gemini" | "voyage") => void;
  onFallbackChange: (fallback: "none" | "local" | "openai" | "gemini" | "voyage") => void;
  onLocalModelPathChange: (path: string) => void;
  onUseLocalPreset: () => void;
  onSaveEmbeddingSettings: () => void;
};

export function renderKnowledgeBase(props: KnowledgeBaseProps) {
  const preview = renderPreview(props);
  const embeddingDisabled =
    !props.connected || props.embeddingSettingsLoading || props.embeddingSettingsSaving;
  return html`
    <section class="card">
      <div class="kb-header">
        <div>
          <div class="card-title">Knowledge Base</div>
          <div class="card-sub">Browse allowlisted workspace content (read-only).</div>
        </div>
        <div class="kb-actions">
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
              <div class="kb-layout" style="margin-top: 12px;">
                <div class="kb-tree">
                  ${
                    props.loading
                      ? html`
                          <div class="muted">Loading…</div>
                        `
                      : html`
                          ${renderTreeSection("Notes", props.entries.notes, props)}
                          ${renderTreeSection("Links", props.entries.links, props)}
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

function renderTreeSection(label: string, entries: WorkspaceEntry[], props: KnowledgeBaseProps) {
  const rows = Array.isArray(entries) ? entries : [];
  return html`
    <div class="kb-section">
      <div class="kb-section-title">${label}</div>
      <div class="kb-section-items">
        ${
          rows.length === 0
            ? html`
                <div class="muted kb-empty">No entries.</div>
              `
            : rows.map((entry) => renderEntryRow(entry, props))
        }
      </div>
    </div>
  `;
}

function renderEntryRow(entry: WorkspaceEntry, props: KnowledgeBaseProps) {
  const path = String(entry?.path ?? "");
  const kind = entry?.kind === "dir" ? "dir" : "file";
  const segments = path.split("/").filter(Boolean);
  const depth = Math.max(0, segments.length - 2);
  const name = segments[segments.length - 1] ?? path;
  const isFile = kind === "file";
  const isSelected = props.activeView === "browse" && props.selectedPath === path;
  const indent = depth * 14;

  return html`
    <div class="kb-row ${isSelected ? "kb-row--active" : ""}" style="padding-left: ${indent}px;">
      ${
        isFile
          ? html`
              <button class="kb-item" @click=${() => props.onSelectFile(path)} title=${path}>
                <span class="kb-icon">${icons.fileText}</span>
                <span class="kb-name">${name}</span>
              </button>
            `
          : html`
              <div class="kb-item kb-item--dir" title=${path}>
                <span class="kb-icon">${icons.folder}</span>
                <span class="kb-name">${name}</span>
              </div>
            `
      }
    </div>
  `;
}

function renderPreview(props: KnowledgeBaseProps) {
  if (props.readLoading) {
    return html`
      <div class="muted">Loading…</div>
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
      <div class="muted">Select a file to preview.</div>
    `;
  }

  const file = props.readResult;
  const isMarkdown =
    file.contentType === "text/markdown" || file.path.toLowerCase().endsWith(".md");
  const isJson =
    file.contentType === "application/json" || file.path.toLowerCase().endsWith(".json");

  return html`
    <div class="kb-preview-header">
      <div class="kb-preview-title">${file.path}</div>
      <div class="kb-preview-sub">
        <span class="mono">${file.contentType}</span>
        ${
          file.truncated
            ? html`
                <span class="kb-truncated">(truncated)</span>
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
    <div class="kb-preview-body">
      ${
        isMarkdown
          ? html`<div class="kb-markdown">${unsafeHTML(toSanitizedMarkdownHtml(file.content))}</div>`
          : isJson
            ? html`<pre class="kb-pre">${file.content}</pre>`
            : html`<pre class="kb-pre">${file.content}</pre>`
      }
    </div>
  `;
}
