import { html, nothing } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import type { WorkspaceEntry, WorkspaceReadResult } from "../types";
import { icons } from "../icons";
import { toSanitizedMarkdownHtml } from "../markdown";

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
  onRefresh: () => void;
  onSelectFile: (path: string) => void;
  onOpenReviewQueue: () => void;
};

export function renderKnowledgeBase(props: KnowledgeBaseProps) {
  const preview = renderPreview(props);
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
          ? html`<div class="callout danger" style="margin-top: 12px;">Disconnected from gateway.</div>`
          : nothing
      }

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
                      ? html`<div class="muted">Loading…</div>`
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

function renderTreeSection(
  label: string,
  entries: WorkspaceEntry[],
  props: KnowledgeBaseProps,
) {
  const rows = Array.isArray(entries) ? entries : [];
  return html`
    <div class="kb-section">
      <div class="kb-section-title">${label}</div>
      <div class="kb-section-items">
        ${
          rows.length === 0
            ? html`<div class="muted kb-empty">No entries.</div>`
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
    return html`<div class="muted">Loading…</div>`;
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
          ? html`<div class="muted">No markdown files found.</div>`
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
    return html`<div class="muted">Select a file to preview.</div>`;
  }

  const file = props.readResult;
  const isMarkdown = file.contentType === "text/markdown" || file.path.toLowerCase().endsWith(".md");
  const isJson = file.contentType === "application/json" || file.path.toLowerCase().endsWith(".json");

  return html`
    <div class="kb-preview-header">
      <div class="kb-preview-title">${file.path}</div>
      <div class="kb-preview-sub">
        <span class="mono">${file.contentType}</span>
        ${file.truncated ? html`<span class="kb-truncated">(truncated)</span>` : nothing}
      </div>
    </div>
    ${
      file.truncated
        ? html`<div class="callout warn" style="margin-top: 12px;">Content truncated for safety.</div>`
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
