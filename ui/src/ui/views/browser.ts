import { html, nothing } from "lit";
import type {
  BrowserProfileStatus,
  BrowserStatus,
  BrowserTabsResult,
  ChromeExtensionStatus,
} from "../controllers/browser.ts";
import { clampText } from "../format.ts";

export type BrowserProps = {
  loading: boolean;
  error: string | null;

  profiles: BrowserProfileStatus[] | null;
  selectedProfile: string | null;
  status: BrowserStatus | null;
  tabs: BrowserTabsResult | null;

  chromeExtensionStatus: ChromeExtensionStatus | null;
  chromeExtensionInstalling: boolean;

  newTabUrl: string;
  tabActionBusy: boolean;

  onRefresh: () => void;
  onSelectProfile: (profile: string) => void;
  onStart: () => void;
  onStop: () => void;
  onResetProfile: () => void;
  onInstallChromeExtension: () => void;
  onNewTabUrlChange: (next: string) => void;
  onOpenTab: () => void;
  onFocusTab: (targetId: string) => void;
  onCloseTab: (targetId: string) => void;
};

export function renderBrowser(props: BrowserProps) {
  const profiles = props.profiles ?? [];
  const selected = resolveSelectedProfile(profiles, props.selectedProfile);
  const driver = selected?.driver ?? null;

  return html`
    <section class="card">
      <div class="row" style="justify-content: space-between; gap: 12px;">
        <div>
          <div class="card-title">Browser</div>
          <div class="card-sub">Chrome relay + CDP profiles used by the Browser tool.</div>
        </div>
        <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
          ${props.loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      ${
        props.error
          ? html`<div class="callout danger" style="margin-top: 12px;">${props.error}</div>`
          : nothing
      }

      <div class="row" style="margin-top: 14px; gap: 10px; flex-wrap: wrap;">
        <div class="muted">Profile</div>
        <select
          ?disabled=${props.loading || profiles.length === 0}
          @change=${(e: Event) => props.onSelectProfile((e.target as HTMLSelectElement).value)}
        >
          ${profiles.map(
            (p) =>
              html`<option value=${p.name} ?selected=${p.name === selected?.name}>
                ${p.name}${p.isDefault ? " (default)" : ""}
              </option>`,
          )}
        </select>
        ${
          selected
            ? html`<div class="pill"><span class="mono">driver</span> <span>${selected.driver}</span></div>`
            : nothing
        }
        ${
          selected?.isRemote
            ? html`
                <div class="pill"><span class="mono">remote</span> <span>yes</span></div>
              `
            : nothing
        }
        ${
          selected?.running
            ? html`
                <div class="pill"><span class="statusDot ok"></span><span>Running</span></div>
              `
            : html`
                <div class="pill"><span class="statusDot"></span><span>Not running</span></div>
              `
        }
      </div>
    </section>

    ${renderProfileStatus(props, selected)}
    ${renderChromeExtension(props, driver)}
    ${renderTabs(props, selected)}
  `;
}

function renderProfileStatus(props: BrowserProps, selected: BrowserProfileStatus | null) {
  const status = props.status;
  if (!selected || !status) {
    return html`
      <section class="card">
        <div class="card-title">Status</div>
        <div class="muted" style="margin-top: 8px">Select a profile to view status.</div>
      </section>
    `;
  }

  const cdp = status.cdpReady ? "OK" : status.cdpHttp ? "HTTP only" : "Offline";
  const cdpDot = status.cdpReady ? "ok" : "";
  const isExtension = selected.driver === "extension";
  const relayHint =
    isExtension && status.cdpHttp && !status.cdpReady
      ? html`
          <div class="callout" style="margin-top: 12px">
            Relay server is reachable, but the Browser Relay extension is not connected yet. Open Chrome and
            click the OpenClaw Browser Relay toolbar icon to attach the current tab (badge ON).
          </div>
        `
      : nothing;

  return html`
    <section class="card">
      <div class="row" style="justify-content: space-between; gap: 12px;">
        <div>
          <div class="card-title">Status</div>
          <div class="card-sub">CDP reachability + runtime config.</div>
        </div>
        <div class="row" style="gap: 8px; flex-wrap: wrap; justify-content: flex-end;">
          <button class="btn" ?disabled=${props.loading} @click=${props.onStart}>Start</button>
          <button class="btn" ?disabled=${props.loading} @click=${props.onStop}>Stop</button>
          <button class="btn danger" ?disabled=${props.loading} @click=${props.onResetProfile}>
            Reset profile
          </button>
        </div>
      </div>

      <div class="row" style="margin-top: 14px; gap: 10px; flex-wrap: wrap;">
        <div class="pill"><span class="statusDot ${cdpDot}"></span><span>CDP</span><span class="mono">${cdp}</span></div>
        <div class="pill"><span class="mono">cdpUrl</span><span class="mono">${status.cdpUrl}</span></div>
        <div class="pill"><span class="mono">pid</span><span class="mono">${status.pid ?? "-"}</span></div>
        <div class="pill"><span class="mono">headless</span><span class="mono">${status.headless ? "yes" : "no"}</span></div>
        <div class="pill"><span class="mono">attachOnly</span><span class="mono">${status.attachOnly ? "yes" : "no"}</span></div>
      </div>

      ${relayHint}
    </section>
  `;
}

function renderChromeExtension(props: BrowserProps, driver: BrowserProfileStatus["driver"] | null) {
  const status = props.chromeExtensionStatus;
  const installPath = status?.path ?? null;
  const installed = status?.installed ?? null;
  const needsExtension = driver === "extension";

  return html`
    <section class="card">
      <div class="row" style="justify-content: space-between; gap: 12px;">
        <div>
          <div class="card-title">Browser Relay Extension</div>
          <div class="card-sub">
            ${needsExtension ? "Required for driver=extension profiles." : "Optional (needed only for driver=extension profiles)."}
          </div>
        </div>
        <button
          class="btn"
          ?disabled=${props.chromeExtensionInstalling}
          @click=${props.onInstallChromeExtension}
        >
          ${props.chromeExtensionInstalling ? "Installing…" : "Install / Update"}
        </button>
      </div>

      <div class="row" style="margin-top: 14px; gap: 10px; flex-wrap: wrap;">
        <div class="pill">
          <span class="statusDot ${installed ? "ok" : ""}"></span>
          <span>Installed</span>
          <span class="mono">${installed === null ? "-" : installed ? "yes" : "no"}</span>
        </div>
        ${
          installPath
            ? html`
                <div class="pill" style="max-width: 100%;">
                  <span class="mono">path</span>
                  <span class="mono" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${installPath}</span>
                </div>
                <button
                  class="btn btn--sm"
                  @click=${async () => {
                    try {
                      await navigator.clipboard.writeText(installPath);
                    } catch {
                      // ignore
                    }
                  }}
                >
                  Copy path
                </button>
              `
            : nothing
        }
      </div>

      <div class="muted" style="margin-top: 12px; line-height: 1.4;">
        Next: Chrome → <span class="mono">chrome://extensions</span> → enable “Developer mode” →
        “Load unpacked” → select the path above → pin “OpenClaw Browser Relay” → click it on the
        tab you want to control (badge ON).
      </div>
    </section>
  `;
}

function renderTabs(props: BrowserProps, selected: BrowserProfileStatus | null) {
  if (!selected) {
    return nothing;
  }
  const res = props.tabs;
  const tabs = res?.tabs ?? [];
  const running = res?.running ?? false;

  return html`
    <section class="card">
      <div class="row" style="justify-content: space-between; gap: 12px;">
        <div>
          <div class="card-title">Tabs</div>
          <div class="card-sub">Open, focus, and close tabs for the selected profile.</div>
        </div>
        <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>Refresh</button>
      </div>

      <div class="row" style="margin-top: 14px; gap: 8px; flex-wrap: wrap;">
        <input
          style="flex: 1; min-width: 240px;"
          placeholder="https://example.com"
          .value=${props.newTabUrl}
          ?disabled=${props.tabActionBusy}
          @input=${(e: Event) => props.onNewTabUrlChange((e.target as HTMLInputElement).value)}
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === "Enter") {
              props.onOpenTab();
            }
          }}
        />
        <button class="btn" ?disabled=${props.tabActionBusy} @click=${props.onOpenTab}>
          ${props.tabActionBusy ? "Working…" : "Open tab"}
        </button>
      </div>

      ${
        running
          ? nothing
          : html`
              <div class="callout" style="margin-top: 12px">
                Browser is not running/connected for this profile.
              </div>
            `
      }

      <div class="list" style="margin-top: 16px;">
        ${
          tabs.length === 0
            ? html`
                <div class="muted">No tabs.</div>
              `
            : tabs.map((t) => renderTabRow(t, props))
        }
      </div>
    </section>
  `;
}

function renderTabRow(tab: BrowserTabsResult["tabs"][number], props: BrowserProps) {
  const title = tab.title?.trim() || "(untitled)";
  const url = tab.url?.trim() || "";
  const subtitle = url ? clampText(url, 120) : "";
  return html`
    <div class="list-item">
      <div class="list-main">
        <div class="list-title">${clampText(title, 80)}</div>
        ${subtitle ? html`<div class="list-sub">${subtitle}</div>` : nothing}
        <div class="muted" style="margin-top: 6px;">targetId: <span class="mono">${tab.targetId}</span></div>
      </div>
      <div class="list-meta">
        <div class="row" style="justify-content: flex-end; gap: 8px; flex-wrap: wrap;">
          <button class="btn btn--sm" ?disabled=${props.tabActionBusy} @click=${() => props.onFocusTab(tab.targetId)}>
            Focus
          </button>
          <button class="btn btn--sm danger" ?disabled=${props.tabActionBusy} @click=${() => props.onCloseTab(tab.targetId)}>
            Close
          </button>
        </div>
      </div>
    </div>
  `;
}

function resolveSelectedProfile(profiles: BrowserProfileStatus[], selected: string | null) {
  const name = selected?.trim() || "";
  return profiles.find((p) => p.name === name) ?? null;
}
