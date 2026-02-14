import { html, nothing } from "lit";

export type DataManifest = {
  version: number;
  exportedAt: string;
  openclawVersion: string;
  platform: string;
  contents: {
    config: boolean;
    workspaces: string[];
    agents: string[];
    credentials: boolean;
    sessions: boolean;
    approvals: boolean;
    cron: boolean;
    identity: boolean;
  };
};

export type DataProps = {
  connected: boolean;
  exporting: boolean;
  importing: boolean;
  applying: boolean;
  manifest: DataManifest | null;
  uploadId: string | null;
  error: string | null;
  success: string | null;
  onExport: () => void;
  onImportFile: (file: File) => void;
  onApply: () => void;
  onCancel: () => void;
};

export function renderData(props: DataProps) {
  const busy = props.exporting || props.importing || props.applying;

  return html`
    <div class="data-section">
      <div class="data-section__header">
        <h3 class="data-section__title">Export & Import</h3>
        <p class="data-section__desc">
          Transfer your complete OpenClaw environment between machines.
        </p>
      </div>

      <div class="data-grid">
        <!-- Export -->
        <div class="data-card">
          <div class="data-card__body">
            <svg class="data-card__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            <div class="data-card__title">Export</div>
            <div class="data-card__subtitle">Download a portable archive of all OpenClaw state</div>
          </div>
          <button
            class="btn primary data-card__action"
            ?disabled=${!props.connected || busy}
            @click=${props.onExport}
          >
            ${props.exporting ? "Exporting..." : "Export Archive"}
          </button>
        </div>

        <!-- Import -->
        <div class="data-card">
          <div class="data-card__body">
            <svg class="data-card__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="17 8 12 3 7 8"></polyline>
              <line x1="12" y1="3" x2="12" y2="15"></line>
            </svg>
            <div class="data-card__title">Import</div>
            <div class="data-card__subtitle">Restore from an archive with automatic backup</div>
          </div>
          ${
            props.manifest && props.uploadId
              ? nothing
              : html`
                <label class="data-upload-label data-card__action">
                  <input
                    type="file"
                    accept=".tar.gz,.tgz,.zip"
                    class="data-upload-input"
                    ?disabled=${!props.connected || busy}
                    @change=${(e: Event) => {
                      const input = e.target as HTMLInputElement;
                      const file = input.files?.[0];
                      if (file) {
                        props.onImportFile(file);
                        input.value = "";
                      }
                    }}
                  />
                  <span class="btn ${!props.connected || busy ? "disabled" : ""}">
                    ${props.importing ? "Uploading..." : "Choose File"}
                  </span>
                </label>
              `
          }
        </div>
      </div>

      ${props.manifest && props.uploadId ? renderManifestPreview(props) : nothing}

      <!-- Messages -->
      ${props.error ? html`<div class="callout danger">${props.error}</div>` : nothing}
      ${props.success ? html`<div class="callout success">${props.success}</div>` : nothing}
    </div>
  `;
}

function renderManifestPreview(props: DataProps) {
  const m = props.manifest!;
  const c = m.contents;
  return html`
    <div class="data-manifest">
      <div class="data-manifest__title">Archive Preview</div>
      <div class="data-manifest__grid">
        <div class="data-manifest__label">Exported</div>
        <div class="data-manifest__value">${new Date(m.exportedAt).toLocaleString()}</div>
        <div class="data-manifest__label">Version</div>
        <div class="data-manifest__value">${m.openclawVersion}</div>
        <div class="data-manifest__label">Platform</div>
        <div class="data-manifest__value">${m.platform}</div>
        <div class="data-manifest__label">Config</div>
        <div class="data-manifest__value">${c.config ? "Yes" : "No"}</div>
        <div class="data-manifest__label">Agents</div>
        <div class="data-manifest__value">${c.agents.length > 0 ? c.agents.join(", ") : "None"}</div>
        <div class="data-manifest__label">Workspaces</div>
        <div class="data-manifest__value">${c.workspaces.length > 0 ? c.workspaces.join(", ") : "None"}</div>
        <div class="data-manifest__label">Sessions</div>
        <div class="data-manifest__value">${c.sessions ? "Yes" : "No"}</div>
        <div class="data-manifest__label">Credentials</div>
        <div class="data-manifest__value">${c.credentials ? "Yes" : "No"}</div>
        <div class="data-manifest__label">Cron Jobs</div>
        <div class="data-manifest__value">${c.cron ? "Yes" : "No"}</div>
      </div>

      <div class="callout warning" style="margin-top: 12px">
        This will replace your current OpenClaw state. Your existing data will be backed up automatically.
      </div>

      <div class="data-manifest__actions">
        <button
          class="btn primary"
          ?disabled=${props.applying}
          @click=${props.onApply}
        >
          ${props.applying ? "Applying..." : "Apply Import"}
        </button>
        <button
          class="btn"
          ?disabled=${props.applying}
          @click=${props.onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  `;
}
