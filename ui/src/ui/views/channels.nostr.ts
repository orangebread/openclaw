import { html, nothing } from "lit";
import type { ChannelAccountSnapshot, NostrStatus } from "../types.ts";
import type {
  NostrProfileFormState,
  NostrProfileFormCallbacks,
} from "./channels.nostr-profile-form.ts";
import type { ChannelsProps } from "./channels.types.ts";
import { channelIcon, renderChannelStatusPill, renderChannelToggle } from "./channels.shared.ts";

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

  return html`
    <div class="card">
      <div class="row" style="justify-content: space-between; align-items: center;">
        <div class="card-title">${channelIcon("nostr")} Nostr</div>
        ${renderChannelToggle({ channelId: "nostr", props })}
      </div>
      <div class="card-sub">
        ${renderChannelStatusPill(summaryConfigured, !!summaryLastError)}
        Decentralized DMs via Nostr relays (NIP-04).
      </div>
      ${accountCountLabel}

      <div class="channel-tile-status">
        <div><span class="label">Running</span> <span>${summaryRunning ? "Yes" : "No"}</span></div>
        <div><span class="label">Public Key</span> <span class="monospace" title="${summaryPublicKey ?? ""}">${truncatePubkey(summaryPublicKey)}</span></div>
      </div>

      ${
        summaryLastError
          ? html`<div class="callout danger" style="margin-top: 12px;">${summaryLastError}</div>`
          : nothing
      }

      <div class="channel-tile-actions">
        <button class="btn" @click=${() => props.onOpenChannelDrawer("nostr")}>Configure</button>
        <button class="btn" @click=${() => props.onRefresh(false)}>Refresh</button>
      </div>
    </div>
  `;
}
