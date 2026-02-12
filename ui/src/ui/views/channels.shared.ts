import { html, nothing } from "lit";
import type { ChannelCatalogEntry } from "../controllers/channels.types.ts";
import type { ChannelAccountSnapshot } from "../types.ts";
import type { ChannelKey, ChannelsProps } from "./channels.types.ts";
import { formatRelativeTimestamp } from "../format.ts";

export function channelConfigured(key: ChannelKey, props: ChannelsProps): boolean {
  const snapshot = props.snapshot;
  const channels = snapshot?.channels as Record<string, unknown> | null;
  if (!snapshot || !channels) {
    return false;
  }
  const channelStatus = channels[key] as Record<string, unknown> | undefined;
  if (typeof channelStatus?.configured === "boolean" && channelStatus.configured) {
    return true;
  }
  const accounts = snapshot.channelAccounts?.[key] ?? [];
  return accounts.some((account) => account.configured);
}

export function renderChannelStatusPill(configured: boolean, hasError: boolean) {
  if (hasError) {
    return html`
      <span class="channel-status-pill channel-status-error">error</span>
    `;
  }
  if (configured) {
    return html`
      <span class="channel-status-pill channel-status-ok">configured</span>
    `;
  }
  return html`
    <span class="channel-status-pill">not configured</span>
  `;
}

export function channelEnabled(key: ChannelKey, props: ChannelsProps) {
  const snapshot = props.snapshot;
  const channels = snapshot?.channels as Record<string, unknown> | null;
  if (!snapshot || !channels) {
    return false;
  }
  const channelStatus = channels[key] as Record<string, unknown> | undefined;
  const configured = typeof channelStatus?.configured === "boolean" && channelStatus.configured;
  const running = typeof channelStatus?.running === "boolean" && channelStatus.running;
  const connected = typeof channelStatus?.connected === "boolean" && channelStatus.connected;
  const accounts = snapshot.channelAccounts?.[key] ?? [];
  const accountActive = accounts.some(
    (account) => account.configured || account.running || account.connected,
  );
  return configured || running || connected || accountActive;
}

const CHANNEL_EMOJI: Record<string, string> = {
  whatsapp: "💬",
  telegram: "✈️",
  discord: "🎮",
  slack: "#️⃣",
  signal: "🔒",
  imessage: "📱",
  nostr: "🔑",
  googlechat: "💬",
};
const DEFAULT_CHANNEL_EMOJI = "📡";

export function channelIcon(channelId: string): string {
  return CHANNEL_EMOJI[channelId] ?? DEFAULT_CHANNEL_EMOJI;
}

export function channelHealthClass(
  configured: boolean,
  running: boolean,
  hasError: boolean,
): string {
  if (hasError) {
    return "channel-card health-error";
  }
  if (running) {
    return "channel-card health-ok";
  }
  if (configured) {
    return "channel-card health-warn";
  }
  return "channel-card";
}

/** Compact one-line status summary for channel cards. */
export function renderCardStatusSummary(params: {
  configured: boolean;
  running: boolean;
  hasError: boolean;
  lastStartAt?: number | null;
  lastProbeAt?: number | null;
}) {
  const { configured, running, hasError, lastStartAt, lastProbeAt } = params;

  if (hasError) {
    return nothing; // error callout shown separately
  }
  if (running) {
    const timeInfo = lastProbeAt
      ? `Last probe ${formatRelativeTimestamp(lastProbeAt)}`
      : lastStartAt
        ? `Started ${formatRelativeTimestamp(lastStartAt)}`
        : null;
    return html`<div class="channel-tile-summary">${timeInfo ?? "Active"}</div>`;
  }
  if (configured) {
    return html`
      <div class="channel-tile-summary muted">Stopped</div>
    `;
  }
  return nothing;
}

export function getChannelAccountCount(
  key: ChannelKey,
  channelAccounts?: Record<string, ChannelAccountSnapshot[]> | null,
): number {
  return channelAccounts?.[key]?.length ?? 0;
}

export function renderChannelAccountCount(
  key: ChannelKey,
  channelAccounts?: Record<string, ChannelAccountSnapshot[]> | null,
) {
  const count = getChannelAccountCount(key, channelAccounts);
  if (count < 2) {
    return nothing;
  }
  return html`<div class="account-count">Accounts (${count})</div>`;
}

function catalogEnabled(channelId: string, catalog: ChannelCatalogEntry[] | null): boolean | null {
  if (!catalog) {
    return null;
  }
  const entry = catalog.find((e) => e.id === channelId);
  if (!entry) {
    return null;
  }
  return entry.enabled;
}

export function renderChannelToggle(params: { channelId: string; props: ChannelsProps }) {
  const enabled = catalogEnabled(params.channelId, params.props.catalog);
  if (enabled === null) {
    return nothing;
  }

  return html`
    <button
      class="btn${enabled ? "" : " primary"}"
      ?disabled=${params.props.configSaving}
      style="font-size: 12px; padding: 4px 10px;"
      @click=${() => params.props.onChannelToggle(params.channelId, !enabled)}
    >
      ${enabled ? "Disable" : "Enable"}
    </button>
  `;
}
