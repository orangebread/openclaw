import { html, nothing } from "lit";
import type { ChannelAccountSnapshot, NostrStatus } from "../types.ts";
import type {
  NostrProfileFormState,
  NostrProfileFormCallbacks,
} from "./channels.nostr-profile-form.ts";
import type { ChannelsProps } from "./channels.types.ts";
import {
  channelHealthClass,
  channelIcon,
  renderCardStatusSummary,
  renderChannelStatusPill,
  renderChannelToggle,
} from "./channels.shared.ts";

function truncatePubkey(pubkey: string | null | undefined): string {
  if (!pubkey) {
    return "n/a";
  }
  if (pubkey.length <= 20) {
    return pubkey;
  }
  return `${pubkey.slice(0, 8)}...${pubkey.slice(-8)}`;
}

export function renderNostrCard(params: {
  props: ChannelsProps;
  nostr?: NostrStatus | null;
  nostrAccounts: ChannelAccountSnapshot[];
  accountCountLabel: unknown;
  profileFormState?: NostrProfileFormState | null;
  profileFormCallbacks?: NostrProfileFormCallbacks | null;
  onEditProfile?: () => void;
}) {
  const { props, nostr, nostrAccounts, accountCountLabel } = params;
  const primaryAccount = nostrAccounts[0];
  const summaryConfigured = nostr?.configured ?? primaryAccount?.configured ?? false;
  const summaryRunning = nostr?.running ?? primaryAccount?.running ?? false;
  const summaryPublicKey =
    nostr?.publicKey ?? (primaryAccount as { publicKey?: string } | undefined)?.publicKey;
  const summaryLastError = nostr?.lastError ?? primaryAccount?.lastError ?? null;
  const summaryLastStartAt = nostr?.lastStartAt ?? primaryAccount?.lastStartAt ?? null;
  const hasError = !!summaryLastError;

  return html`
    <div class="card ${channelHealthClass(summaryConfigured, summaryRunning, hasError)}">
      <div class="row" style="justify-content: space-between; align-items: center;">
        <div class="card-title">${channelIcon("nostr")} Nostr</div>
        ${renderChannelToggle({ channelId: "nostr", props })}
      </div>
      <div class="card-sub">
        ${renderChannelStatusPill(summaryConfigured, hasError)}
        ${summaryPublicKey ? html`<span class="monospace" style="font-size: 11px; margin-left: 4px;" title="${summaryPublicKey}">${truncatePubkey(summaryPublicKey)}</span>` : nothing}
      </div>
      ${accountCountLabel}
      ${renderCardStatusSummary({ configured: summaryConfigured, running: summaryRunning, hasError, lastStartAt: summaryLastStartAt })}

      ${
        hasError
          ? html`<div class="callout danger" style="margin-top: 8px;">${summaryLastError}</div>`
          : nothing
      }

      <div class="channel-tile-actions">
        <button class="btn" @click=${() => props.onOpenChannelDrawer("nostr")}>Configure</button>
        <button class="btn" @click=${() => props.onRefresh(false)}>Refresh</button>
      </div>
    </div>
  `;
}
