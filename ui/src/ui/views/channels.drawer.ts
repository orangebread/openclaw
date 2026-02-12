import { html, nothing } from "lit";
import type {
  ChannelAccountSnapshot,
  DiscordStatus,
  GoogleChatStatus,
  IMessageStatus,
  NostrStatus,
  SignalStatus,
  SlackStatus,
  TelegramStatus,
  WhatsAppStatus,
} from "../types.ts";
import type { ChannelsChannelData, ChannelsProps } from "./channels.types.ts";
import { formatRelativeTimestamp, formatDurationHuman } from "../format.ts";
import { renderChannelConfigSection } from "./channels.config.ts";
import {
  renderNostrProfileForm,
  type NostrProfileFormState,
  type NostrProfileFormCallbacks,
} from "./channels.nostr-profile-form.ts";
import { channelIcon } from "./channels.shared.ts";

// ── Public entry point ──────────────────────────────────────────────────────

export type ChannelDrawerParams = {
  channelId: string;
  label: string;
  props: ChannelsProps;
  channelData: ChannelsChannelData;
  /** Nostr-specific: profile form state when editing */
  nostrProfileFormState?: NostrProfileFormState | null;
  nostrProfileFormCallbacks?: NostrProfileFormCallbacks | null;
  onNostrEditProfile?: () => void;
};

export function renderChannelDrawer(params: ChannelDrawerParams) {
  const { channelId, label, props } = params;

  return html`
    <div
      class="channel-drawer-backdrop"
      @click=${() => props.onCloseChannelDrawer()}
    ></div>
    <div class="channel-drawer">
      <div class="channel-drawer-header">
        <div class="channel-drawer-header-left">
          <span>${channelIcon(channelId)}</span>
          <span class="channel-drawer-title">${label}</span>
        </div>
        <button
          class="channel-drawer-close"
          @click=${() => props.onCloseChannelDrawer()}
        >
          Close
        </button>
      </div>
      <div class="channel-drawer-body">
        ${renderDrawerBody(params)}
      </div>
    </div>
  `;
}

// ── Dispatcher ──────────────────────────────────────────────────────────────

function renderDrawerBody(params: ChannelDrawerParams) {
  const { channelId, props, channelData } = params;
  switch (channelId) {
    case "whatsapp":
      return renderWhatsAppDrawer(props, channelData.whatsapp);
    case "telegram":
      return renderTelegramDrawer(
        props,
        channelData.telegram,
        channelData.channelAccounts?.telegram ?? [],
      );
    case "discord":
      return renderDiscordDrawer(props, channelData.discord);
    case "slack":
      return renderSlackDrawer(props, channelData.slack);
    case "signal":
      return renderSignalDrawer(props, channelData.signal);
    case "imessage":
      return renderIMessageDrawer(props, channelData.imessage);
    case "googlechat":
      return renderGoogleChatDrawer(props, channelData.googlechat);
    case "nostr":
      return renderNostrDrawer(params);
    default:
      return renderGenericDrawer(channelId, props, channelData);
  }
}

// ── WhatsApp ────────────────────────────────────────────────────────────────

function renderWhatsAppDrawer(props: ChannelsProps, whatsapp?: WhatsAppStatus) {
  return html`
    <div class="channel-drawer-section">
      <div class="channel-drawer-section-title">Status</div>
      <div class="status-list">
        <div><span class="label">Configured</span><span>${whatsapp?.configured ? "Yes" : "No"}</span></div>
        <div><span class="label">Linked</span><span>${whatsapp?.linked ? "Yes" : "No"}</span></div>
        <div><span class="label">Running</span><span>${whatsapp?.running ? "Yes" : "No"}</span></div>
        <div><span class="label">Connected</span><span>${whatsapp?.connected ? "Yes" : "No"}</span></div>
        <div><span class="label">Last connect</span><span>${whatsapp?.lastConnectedAt ? formatRelativeTimestamp(whatsapp.lastConnectedAt) : "n/a"}</span></div>
        <div><span class="label">Last message</span><span>${whatsapp?.lastMessageAt ? formatRelativeTimestamp(whatsapp.lastMessageAt) : "n/a"}</span></div>
        <div><span class="label">Auth age</span><span>${whatsapp?.authAgeMs != null ? formatDurationHuman(whatsapp.authAgeMs) : "n/a"}</span></div>
      </div>
    </div>

    ${
      whatsapp?.lastError
        ? html`<div class="callout danger" style="margin-bottom: 16px;">${whatsapp.lastError}</div>`
        : nothing
    }

    ${
      props.whatsappMessage
        ? html`<div class="callout" style="margin-bottom: 16px;">${props.whatsappMessage}</div>`
        : nothing
    }

    ${
      props.whatsappQrDataUrl
        ? html`<div class="qr-wrap" style="margin-bottom: 16px;"><img src=${props.whatsappQrDataUrl} alt="WhatsApp QR" /></div>`
        : nothing
    }

    <div class="channel-drawer-section">
      <div class="channel-drawer-section-title">Actions</div>
      <div class="row" style="flex-wrap: wrap;">
        <button class="btn primary" ?disabled=${props.whatsappBusy} @click=${() => props.onWhatsAppStart(false)}>
          ${props.whatsappBusy ? "Working\u2026" : "Show QR"}
        </button>
        <button class="btn" ?disabled=${props.whatsappBusy} @click=${() => props.onWhatsAppStart(true)}>Relink</button>
        <button class="btn" ?disabled=${props.whatsappBusy} @click=${() => props.onWhatsAppWait()}>Wait for scan</button>
        <button class="btn danger" ?disabled=${props.whatsappBusy} @click=${() => props.onWhatsAppLogout()}>Logout</button>
        <button class="btn" @click=${() => props.onRefresh(true)}>Refresh</button>
      </div>
    </div>

    <div class="channel-drawer-section">
      <div class="channel-drawer-section-title">Configuration</div>
      ${renderChannelConfigSection({ channelId: "whatsapp", props })}
    </div>
  `;
}

// ── Telegram ────────────────────────────────────────────────────────────────

function renderTelegramDrawer(
  props: ChannelsProps,
  telegram?: TelegramStatus,
  telegramAccounts: ChannelAccountSnapshot[] = [],
) {
  return html`
    <div class="channel-drawer-section">
      <div class="channel-drawer-section-title">Status</div>
      <div class="status-list">
        <div><span class="label">Configured</span><span>${telegram?.configured ? "Yes" : "No"}</span></div>
        <div><span class="label">Running</span><span>${telegram?.running ? "Yes" : "No"}</span></div>
        <div><span class="label">Mode</span><span>${telegram?.mode ?? "n/a"}</span></div>
        <div><span class="label">Last start</span><span>${telegram?.lastStartAt ? formatRelativeTimestamp(telegram.lastStartAt) : "n/a"}</span></div>
        <div><span class="label">Last probe</span><span>${telegram?.lastProbeAt ? formatRelativeTimestamp(telegram.lastProbeAt) : "n/a"}</span></div>
      </div>
    </div>

    ${
      telegram?.lastError
        ? html`<div class="callout danger" style="margin-bottom: 16px;">${telegram.lastError}</div>`
        : nothing
    }
    ${
      telegram?.probe
        ? html`<div class="callout" style="margin-bottom: 16px;">Probe ${telegram.probe.ok ? "ok" : "failed"} · ${telegram.probe.status ?? ""} ${telegram.probe.error ?? ""}</div>`
        : nothing
    }

    ${
      telegramAccounts.length > 1
        ? html`
          <div class="channel-drawer-section">
            <div class="channel-drawer-section-title">Accounts (${telegramAccounts.length})</div>
            <div class="account-card-list">
              ${telegramAccounts.map((account) => renderAccountCard(account))}
            </div>
          </div>
        `
        : nothing
    }

    <div class="channel-drawer-section">
      <div class="channel-drawer-section-title">Actions</div>
      <div class="row">
        <button class="btn" @click=${() => props.onRefresh(true)}>Probe</button>
      </div>
    </div>

    <div class="channel-drawer-section">
      <div class="channel-drawer-section-title">Configuration</div>
      ${renderChannelConfigSection({ channelId: "telegram", props })}
    </div>
  `;
}

// ── Discord ─────────────────────────────────────────────────────────────────

function renderDiscordDrawer(props: ChannelsProps, discord?: DiscordStatus | null) {
  return html`
    <div class="channel-drawer-section">
      <div class="channel-drawer-section-title">Status</div>
      <div class="status-list">
        <div><span class="label">Configured</span><span>${discord?.configured ? "Yes" : "No"}</span></div>
        <div><span class="label">Running</span><span>${discord?.running ? "Yes" : "No"}</span></div>
        <div><span class="label">Last start</span><span>${discord?.lastStartAt ? formatRelativeTimestamp(discord.lastStartAt) : "n/a"}</span></div>
        <div><span class="label">Last probe</span><span>${discord?.lastProbeAt ? formatRelativeTimestamp(discord.lastProbeAt) : "n/a"}</span></div>
      </div>
    </div>

    ${
      discord?.lastError
        ? html`<div class="callout danger" style="margin-bottom: 16px;">${discord.lastError}</div>`
        : nothing
    }
    ${
      discord?.probe
        ? html`<div class="callout" style="margin-bottom: 16px;">Probe ${discord.probe.ok ? "ok" : "failed"} · ${discord.probe.status ?? ""} ${discord.probe.error ?? ""}</div>`
        : nothing
    }

    <div class="channel-drawer-section">
      <div class="channel-drawer-section-title">Actions</div>
      <div class="row">
        <button class="btn" @click=${() => props.onRefresh(true)}>Probe</button>
      </div>
    </div>

    <div class="channel-drawer-section">
      <div class="channel-drawer-section-title">Configuration</div>
      ${renderChannelConfigSection({ channelId: "discord", props })}
    </div>
  `;
}

// ── Slack ────────────────────────────────────────────────────────────────────

function renderSlackDrawer(props: ChannelsProps, slack?: SlackStatus | null) {
  return html`
    <div class="channel-drawer-section">
      <div class="channel-drawer-section-title">Status</div>
      <div class="status-list">
        <div><span class="label">Configured</span><span>${slack?.configured ? "Yes" : "No"}</span></div>
        <div><span class="label">Running</span><span>${slack?.running ? "Yes" : "No"}</span></div>
        <div><span class="label">Last start</span><span>${slack?.lastStartAt ? formatRelativeTimestamp(slack.lastStartAt) : "n/a"}</span></div>
        <div><span class="label">Last probe</span><span>${slack?.lastProbeAt ? formatRelativeTimestamp(slack.lastProbeAt) : "n/a"}</span></div>
      </div>
    </div>

    ${
      slack?.lastError
        ? html`<div class="callout danger" style="margin-bottom: 16px;">${slack.lastError}</div>`
        : nothing
    }
    ${
      slack?.probe
        ? html`<div class="callout" style="margin-bottom: 16px;">Probe ${slack.probe.ok ? "ok" : "failed"} · ${slack.probe.status ?? ""} ${slack.probe.error ?? ""}</div>`
        : nothing
    }

    <div class="channel-drawer-section">
      <div class="channel-drawer-section-title">Actions</div>
      <div class="row">
        <button class="btn" @click=${() => props.onRefresh(true)}>Probe</button>
      </div>
    </div>

    <div class="channel-drawer-section">
      <div class="channel-drawer-section-title">Configuration</div>
      ${renderChannelConfigSection({ channelId: "slack", props })}
    </div>
  `;
}

// ── Signal ──────────────────────────────────────────────────────────────────

function renderSignalDrawer(props: ChannelsProps, signal?: SignalStatus | null) {
  return html`
    <div class="channel-drawer-section">
      <div class="channel-drawer-section-title">Status</div>
      <div class="status-list">
        <div><span class="label">Configured</span><span>${signal?.configured ? "Yes" : "No"}</span></div>
        <div><span class="label">Running</span><span>${signal?.running ? "Yes" : "No"}</span></div>
        <div><span class="label">Base URL</span><span>${signal?.baseUrl ?? "n/a"}</span></div>
        <div><span class="label">Last start</span><span>${signal?.lastStartAt ? formatRelativeTimestamp(signal.lastStartAt) : "n/a"}</span></div>
        <div><span class="label">Last probe</span><span>${signal?.lastProbeAt ? formatRelativeTimestamp(signal.lastProbeAt) : "n/a"}</span></div>
      </div>
    </div>

    ${
      signal?.lastError
        ? html`<div class="callout danger" style="margin-bottom: 16px;">${signal.lastError}</div>`
        : nothing
    }
    ${
      signal?.probe
        ? html`<div class="callout" style="margin-bottom: 16px;">Probe ${signal.probe.ok ? "ok" : "failed"} · ${signal.probe.status ?? ""} ${signal.probe.error ?? ""}</div>`
        : nothing
    }

    <div class="channel-drawer-section">
      <div class="channel-drawer-section-title">Actions</div>
      <div class="row">
        <button class="btn" @click=${() => props.onRefresh(true)}>Probe</button>
      </div>
    </div>

    <div class="channel-drawer-section">
      <div class="channel-drawer-section-title">Configuration</div>
      ${renderChannelConfigSection({ channelId: "signal", props })}
    </div>
  `;
}

// ── iMessage ────────────────────────────────────────────────────────────────

function renderIMessageDrawer(props: ChannelsProps, imessage?: IMessageStatus | null) {
  return html`
    <div class="channel-drawer-section">
      <div class="channel-drawer-section-title">Status</div>
      <div class="status-list">
        <div><span class="label">Configured</span><span>${imessage?.configured ? "Yes" : "No"}</span></div>
        <div><span class="label">Running</span><span>${imessage?.running ? "Yes" : "No"}</span></div>
        <div><span class="label">Last start</span><span>${imessage?.lastStartAt ? formatRelativeTimestamp(imessage.lastStartAt) : "n/a"}</span></div>
        <div><span class="label">Last probe</span><span>${imessage?.lastProbeAt ? formatRelativeTimestamp(imessage.lastProbeAt) : "n/a"}</span></div>
      </div>
    </div>

    ${
      imessage?.lastError
        ? html`<div class="callout danger" style="margin-bottom: 16px;">${imessage.lastError}</div>`
        : nothing
    }
    ${
      imessage?.probe
        ? html`<div class="callout" style="margin-bottom: 16px;">Probe ${imessage.probe.ok ? "ok" : "failed"} · ${imessage.probe.error ?? ""}</div>`
        : nothing
    }

    <div class="channel-drawer-section">
      <div class="channel-drawer-section-title">Actions</div>
      <div class="row">
        <button class="btn" @click=${() => props.onRefresh(true)}>Probe</button>
      </div>
    </div>

    <div class="channel-drawer-section">
      <div class="channel-drawer-section-title">Configuration</div>
      ${renderChannelConfigSection({ channelId: "imessage", props })}
    </div>
  `;
}

// ── Google Chat ─────────────────────────────────────────────────────────────

function renderGoogleChatDrawer(props: ChannelsProps, googleChat?: GoogleChatStatus | null) {
  return html`
    <div class="channel-drawer-section">
      <div class="channel-drawer-section-title">Status</div>
      <div class="status-list">
        <div><span class="label">Configured</span><span>${googleChat ? (googleChat.configured ? "Yes" : "No") : "n/a"}</span></div>
        <div><span class="label">Running</span><span>${googleChat ? (googleChat.running ? "Yes" : "No") : "n/a"}</span></div>
        <div><span class="label">Credential</span><span>${googleChat?.credentialSource ?? "n/a"}</span></div>
        <div><span class="label">Audience</span><span>${googleChat?.audienceType ? `${googleChat.audienceType}${googleChat.audience ? ` \u00b7 ${googleChat.audience}` : ""}` : "n/a"}</span></div>
        <div><span class="label">Last start</span><span>${googleChat?.lastStartAt ? formatRelativeTimestamp(googleChat.lastStartAt) : "n/a"}</span></div>
        <div><span class="label">Last probe</span><span>${googleChat?.lastProbeAt ? formatRelativeTimestamp(googleChat.lastProbeAt) : "n/a"}</span></div>
      </div>
    </div>

    ${
      googleChat?.lastError
        ? html`<div class="callout danger" style="margin-bottom: 16px;">${googleChat.lastError}</div>`
        : nothing
    }
    ${
      googleChat?.probe
        ? html`<div class="callout" style="margin-bottom: 16px;">Probe ${googleChat.probe.ok ? "ok" : "failed"} · ${googleChat.probe.status ?? ""} ${googleChat.probe.error ?? ""}</div>`
        : nothing
    }

    <div class="channel-drawer-section">
      <div class="channel-drawer-section-title">Actions</div>
      <div class="row">
        <button class="btn" @click=${() => props.onRefresh(true)}>Probe</button>
      </div>
    </div>

    <div class="channel-drawer-section">
      <div class="channel-drawer-section-title">Configuration</div>
      ${renderChannelConfigSection({ channelId: "googlechat", props })}
    </div>
  `;
}

// ── Nostr ────────────────────────────────────────────────────────────────────

function truncatePubkey(pubkey: string | null | undefined): string {
  if (!pubkey) {
    return "n/a";
  }
  if (pubkey.length <= 20) {
    return pubkey;
  }
  return `${pubkey.slice(0, 8)}...${pubkey.slice(-8)}`;
}

function renderNostrDrawer(params: ChannelDrawerParams) {
  const {
    props,
    channelData,
    nostrProfileFormState,
    nostrProfileFormCallbacks,
    onNostrEditProfile,
  } = params;
  const nostr = channelData.nostr;
  const nostrAccounts = channelData.channelAccounts?.nostr ?? [];
  const primaryAccount = nostrAccounts[0];
  const summaryConfigured = nostr?.configured ?? primaryAccount?.configured ?? false;
  const summaryRunning = nostr?.running ?? primaryAccount?.running ?? false;
  const summaryPublicKey =
    nostr?.publicKey ?? (primaryAccount as { publicKey?: string } | undefined)?.publicKey;
  const summaryLastStartAt = nostr?.lastStartAt ?? primaryAccount?.lastStartAt ?? null;
  const summaryLastError = nostr?.lastError ?? primaryAccount?.lastError ?? null;
  const showingForm = nostrProfileFormState !== null && nostrProfileFormState !== undefined;

  return html`
    <div class="channel-drawer-section">
      <div class="channel-drawer-section-title">Status</div>
      <div class="status-list">
        <div><span class="label">Configured</span><span>${summaryConfigured ? "Yes" : "No"}</span></div>
        <div><span class="label">Running</span><span>${summaryRunning ? "Yes" : "No"}</span></div>
        <div><span class="label">Public Key</span><span class="monospace" title="${summaryPublicKey ?? ""}">${truncatePubkey(summaryPublicKey)}</span></div>
        <div><span class="label">Last start</span><span>${summaryLastStartAt ? formatRelativeTimestamp(summaryLastStartAt) : "n/a"}</span></div>
      </div>
    </div>

    ${
      summaryLastError
        ? html`<div class="callout danger" style="margin-bottom: 16px;">${summaryLastError}</div>`
        : nothing
    }

    ${
      nostrAccounts.length > 1
        ? html`
          <div class="channel-drawer-section">
            <div class="channel-drawer-section-title">Accounts (${nostrAccounts.length})</div>
            <div class="account-card-list">
              ${nostrAccounts.map((account) => {
                const publicKey = (account as { publicKey?: string }).publicKey;
                const profile = (account as { profile?: { name?: string; displayName?: string } })
                  .profile;
                const displayName =
                  profile?.displayName ?? profile?.name ?? account.name ?? account.accountId;
                return html`
                  <div class="account-card">
                    <div class="account-card-header">
                      <div class="account-card-title">${displayName}</div>
                      <div class="account-card-id">${account.accountId}</div>
                    </div>
                    <div class="status-list account-card-status">
                      <div><span class="label">Running</span><span>${account.running ? "Yes" : "No"}</span></div>
                      <div><span class="label">Configured</span><span>${account.configured ? "Yes" : "No"}</span></div>
                      <div><span class="label">Public Key</span><span class="monospace" title="${publicKey ?? ""}">${truncatePubkey(publicKey)}</span></div>
                      <div><span class="label">Last inbound</span><span>${account.lastInboundAt ? formatRelativeTimestamp(account.lastInboundAt) : "n/a"}</span></div>
                      ${account.lastError ? html`<div class="account-card-error">${account.lastError}</div>` : nothing}
                    </div>
                  </div>
                `;
              })}
            </div>
          </div>
        `
        : nothing
    }

    <div class="channel-drawer-section">
      <div class="channel-drawer-section-title">Profile</div>
      ${
        showingForm && nostrProfileFormCallbacks
          ? renderNostrProfileForm({
              state: nostrProfileFormState,
              callbacks: nostrProfileFormCallbacks,
              accountId: nostrAccounts[0]?.accountId ?? "default",
            })
          : renderNostrProfileReadOnly(primaryAccount, nostr, summaryConfigured, onNostrEditProfile)
      }
    </div>

    <div class="channel-drawer-section">
      <div class="channel-drawer-section-title">Actions</div>
      <div class="row">
        <button class="btn" @click=${() => props.onRefresh(false)}>Refresh</button>
      </div>
    </div>

    <div class="channel-drawer-section">
      <div class="channel-drawer-section-title">Configuration</div>
      ${renderChannelConfigSection({ channelId: "nostr", props })}
    </div>
  `;
}

function renderNostrProfileReadOnly(
  primaryAccount: ChannelAccountSnapshot | undefined,
  nostr: NostrStatus | null | undefined,
  summaryConfigured: boolean,
  onEditProfile?: () => void,
) {
  const profile =
    (
      primaryAccount as
        | {
            profile?: {
              name?: string;
              displayName?: string;
              about?: string;
              picture?: string;
              nip05?: string;
            };
          }
        | undefined
    )?.profile ?? nostr?.profile;
  const { name, displayName, about, picture, nip05 } = profile ?? {};
  const hasAnyProfileData = name || displayName || about || picture || nip05;

  return html`
    <div style="padding: 12px; background: var(--bg-secondary); border-radius: 8px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <div style="font-weight: 500;">Profile</div>
        ${
          summaryConfigured
            ? html`<button class="btn btn-sm" @click=${onEditProfile} style="font-size: 12px; padding: 4px 8px;">Edit Profile</button>`
            : nothing
        }
      </div>
      ${
        hasAnyProfileData
          ? html`
            <div class="status-list">
              ${
                picture
                  ? html`<div style="margin-bottom: 8px;"><img src=${picture} alt="Profile picture" style="width: 48px; height: 48px; border-radius: 50%; object-fit: cover; border: 2px solid var(--border-color);" @error=${(
                      e: Event,
                    ) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }} /></div>`
                  : nothing
              }
              ${name ? html`<div><span class="label">Name</span><span>${name}</span></div>` : nothing}
              ${displayName ? html`<div><span class="label">Display Name</span><span>${displayName}</span></div>` : nothing}
              ${about ? html`<div><span class="label">About</span><span style="max-width: 300px; overflow: hidden; text-overflow: ellipsis;">${about}</span></div>` : nothing}
              ${nip05 ? html`<div><span class="label">NIP-05</span><span>${nip05}</span></div>` : nothing}
            </div>
          `
          : html`
              <div style="color: var(--text-muted); font-size: 13px">
                No profile set. Click "Edit Profile" to add your name, bio, and avatar.
              </div>
            `
      }
    </div>
  `;
}

// ── Generic fallback ────────────────────────────────────────────────────────

function renderGenericDrawer(channelId: string, props: ChannelsProps, data: ChannelsChannelData) {
  const status = props.snapshot?.channels?.[channelId] as Record<string, unknown> | undefined;
  const configured = typeof status?.configured === "boolean" ? status.configured : undefined;
  const running = typeof status?.running === "boolean" ? status.running : undefined;
  const connected = typeof status?.connected === "boolean" ? status.connected : undefined;
  const lastError = typeof status?.lastError === "string" ? status.lastError : undefined;
  const accounts = data.channelAccounts?.[channelId] ?? [];

  return html`
    <div class="channel-drawer-section">
      <div class="channel-drawer-section-title">Status</div>
      <div class="status-list">
        <div><span class="label">Configured</span><span>${configured == null ? "n/a" : configured ? "Yes" : "No"}</span></div>
        <div><span class="label">Running</span><span>${running == null ? "n/a" : running ? "Yes" : "No"}</span></div>
        <div><span class="label">Connected</span><span>${connected == null ? "n/a" : connected ? "Yes" : "No"}</span></div>
      </div>
    </div>

    ${lastError ? html`<div class="callout danger" style="margin-bottom: 16px;">${lastError}</div>` : nothing}

    ${
      accounts.length > 0
        ? html`
          <div class="channel-drawer-section">
            <div class="channel-drawer-section-title">Accounts (${accounts.length})</div>
            <div class="account-card-list">
              ${accounts.map((account) => renderAccountCard(account))}
            </div>
          </div>
        `
        : nothing
    }

    <div class="channel-drawer-section">
      <div class="channel-drawer-section-title">Configuration</div>
      ${renderChannelConfigSection({ channelId, props })}
    </div>
  `;
}

// ── Shared account card ─────────────────────────────────────────────────────

function renderAccountCard(account: ChannelAccountSnapshot) {
  const probe = account.probe as { bot?: { username?: string } } | undefined;
  const botUsername = probe?.bot?.username;
  const label = account.name || account.accountId;

  return html`
    <div class="account-card">
      <div class="account-card-header">
        <div class="account-card-title">${botUsername ? `@${botUsername}` : label}</div>
        <div class="account-card-id">${account.accountId}</div>
      </div>
      <div class="status-list account-card-status">
        <div><span class="label">Running</span><span>${account.running ? "Yes" : "No"}</span></div>
        <div><span class="label">Configured</span><span>${account.configured ? "Yes" : "No"}</span></div>
        <div><span class="label">Last inbound</span><span>${account.lastInboundAt ? formatRelativeTimestamp(account.lastInboundAt) : "n/a"}</span></div>
        ${account.lastError ? html`<div class="account-card-error">${account.lastError}</div>` : nothing}
      </div>
    </div>
  `;
}
