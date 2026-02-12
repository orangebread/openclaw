import { html, nothing, type TemplateResult } from "lit";
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

// ── Types ───────────────────────────────────────────────────────────────────

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

type HeroState = "ok" | "error" | "warn" | "idle";

type HeroParams = {
  state: HeroState;
  label: string;
  sub?: string;
};

// ── Public entry point ──────────────────────────────────────────────────────

export function renderChannelDrawer(params: ChannelDrawerParams) {
  const { channelId, label, props } = params;
  const headerAction = resolveHeaderAction(params);
  const dirty = props.configFormDirty;
  const saveBusy = props.configSaving || props.configSchemaLoading;

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
        <div class="channel-drawer-header-actions">
          ${headerAction}
          <button
            class="btn primary"
            style="font-size: 12px; padding: 4px 10px;"
            ?disabled=${!dirty || saveBusy}
            @click=${() => props.onConfigSave()}
          >${saveBusy ? "Saving\u2026" : "Save"}</button>
          ${
            dirty
              ? html`<button
                class="btn"
                style="font-size: 12px; padding: 4px 10px;"
                ?disabled=${saveBusy}
                @click=${() => props.onConfigReload()}
              >Discard</button>`
              : nothing
          }
          <button
            class="channel-drawer-close"
            @click=${() => props.onCloseChannelDrawer()}
          >
            Close
          </button>
        </div>
      </div>
      <div class="channel-drawer-body">
        ${renderDrawerBody(params)}
      </div>
    </div>
  `;
}

// ── Header action (Probe/Refresh moved here) ────────────────────────────────

function resolveHeaderAction(params: ChannelDrawerParams) {
  const { channelId, props } = params;
  if (channelId === "whatsapp") {
    return html`<button class="btn" style="font-size: 12px; padding: 4px 10px;" @click=${() => props.onRefresh(true)}>Refresh</button>`;
  }
  if (channelId === "nostr") {
    return html`<button class="btn" style="font-size: 12px; padding: 4px 10px;" @click=${() => props.onRefresh(false)}>Refresh</button>`;
  }
  return html`<button class="btn" style="font-size: 12px; padding: 4px 10px;" @click=${() => props.onRefresh(true)}>Probe</button>`;
}

// ── Shared hero block ───────────────────────────────────────────────────────

function renderHero(params: HeroParams) {
  return html`
    <div class="channel-hero">
      <div class="channel-hero-dot ${params.state}"></div>
      <div class="channel-hero-info">
        <div class="channel-hero-label">${params.label}</div>
        ${params.sub ? html`<div class="channel-hero-sub">${params.sub}</div>` : nothing}
      </div>
    </div>
  `;
}

// ── Shared collapsible section ──────────────────────────────────────────────

function renderCollapsibleSection(
  title: string,
  content: TemplateResult | typeof nothing,
  openByDefault: boolean,
) {
  return html`
    <details class="channel-drawer-section" ?open=${openByDefault}>
      <summary class="channel-section-toggle">
        <span class="channel-drawer-section-title" style="margin-bottom: 0;">${title}</span>
        <span class="channel-section-chevron">\u25B6</span>
      </summary>
      <div style="padding-top: 10px;">
        ${content}
      </div>
    </details>
  `;
}

// ── Shared probe callout ────────────────────────────────────────────────────

function renderProbeCallout(
  probe:
    | { ok?: boolean; status?: string | number | null; error?: string | null }
    | null
    | undefined,
) {
  if (!probe) {
    return nothing;
  }
  const statusStr = probe.status != null ? String(probe.status) : "";
  return html`<div class="callout${probe.ok ? "" : " danger"}" style="margin-bottom: 16px;">Probe ${probe.ok ? "ok" : "failed"} ${statusStr ? `\u00b7 ${statusStr}` : ""} ${probe.error ?? ""}</div>`;
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

function resolveWhatsAppHero(
  whatsapp: WhatsAppStatus | undefined,
  props: ChannelsProps,
): HeroParams {
  if (whatsapp?.lastError) {
    return { state: "error", label: "Error", sub: whatsapp.lastError };
  }
  if (props.whatsappQrDataUrl) {
    return { state: "warn", label: "Linking\u2026", sub: "Scan the QR code with your phone" };
  }
  if (whatsapp?.connected) {
    const sub = whatsapp.lastMessageAt
      ? `Last message ${formatRelativeTimestamp(whatsapp.lastMessageAt)}`
      : whatsapp.lastConnectedAt
        ? `Connected ${formatRelativeTimestamp(whatsapp.lastConnectedAt)}`
        : undefined;
    return { state: "ok", label: "Connected", sub };
  }
  if (whatsapp?.linked) {
    return {
      state: "warn",
      label: "Linked but not connected",
      sub: "Waiting for connection\u2026",
    };
  }
  if (whatsapp?.configured) {
    return { state: "warn", label: "Not linked", sub: "Link a device to get started" };
  }
  return { state: "idle", label: "Not configured" };
}

function renderWhatsAppDrawer(props: ChannelsProps, whatsapp?: WhatsAppStatus) {
  const hero = resolveWhatsAppHero(whatsapp, props);
  const isConfigured = !!whatsapp?.configured;

  return html`
    ${renderHero(hero)}

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
      <div class="channel-drawer-section-title">Linking</div>
      <div class="row" style="flex-wrap: wrap;">
        <button class="btn primary" ?disabled=${props.whatsappBusy} @click=${() => props.onWhatsAppStart(false)}>
          ${props.whatsappBusy ? "Working\u2026" : "Show QR"}
        </button>
        <button class="btn" ?disabled=${props.whatsappBusy} @click=${() => props.onWhatsAppStart(true)}>Relink</button>
        <button class="btn" ?disabled=${props.whatsappBusy} @click=${() => props.onWhatsAppWait()}>Wait for scan</button>
        <button class="btn danger" ?disabled=${props.whatsappBusy} @click=${() => props.onWhatsAppLogout()}>Logout</button>
      </div>
    </div>

    ${renderCollapsibleSection(
      "Configuration",
      renderChannelConfigSection({ channelId: "whatsapp", props, omitSaveButtons: true }),
      !isConfigured,
    )}

    ${renderCollapsibleSection(
      "Diagnostics",
      html`
        <div class="status-list">
          <div><span class="label">Configured</span><span>${whatsapp?.configured ? "Yes" : "No"}</span></div>
          <div><span class="label">Linked</span><span>${whatsapp?.linked ? "Yes" : "No"}</span></div>
          <div><span class="label">Running</span><span>${whatsapp?.running ? "Yes" : "No"}</span></div>
          <div><span class="label">Connected</span><span>${whatsapp?.connected ? "Yes" : "No"}</span></div>
          <div><span class="label">Last connect</span><span>${whatsapp?.lastConnectedAt ? formatRelativeTimestamp(whatsapp.lastConnectedAt) : "n/a"}</span></div>
          <div><span class="label">Last message</span><span>${whatsapp?.lastMessageAt ? formatRelativeTimestamp(whatsapp.lastMessageAt) : "n/a"}</span></div>
          <div><span class="label">Auth age</span><span>${whatsapp?.authAgeMs != null ? formatDurationHuman(whatsapp.authAgeMs) : "n/a"}</span></div>
        </div>
      `,
      false,
    )}
  `;
}

// ── Telegram ────────────────────────────────────────────────────────────────

function renderTelegramDrawer(
  props: ChannelsProps,
  telegram?: TelegramStatus,
  telegramAccounts: ChannelAccountSnapshot[] = [],
) {
  const hero = resolveStandardHero(
    !!telegram?.configured,
    !!telegram?.running,
    telegram?.lastError,
    telegram?.lastStartAt,
  );

  return html`
    ${renderHero(hero)}
    ${renderProbeCallout(telegram?.probe)}

    ${renderCollapsibleSection(
      "Configuration",
      renderChannelConfigSection({ channelId: "telegram", props, omitSaveButtons: true }),
      !telegram?.configured,
    )}

    ${
      telegramAccounts.length > 1
        ? renderCollapsibleSection(
            `Accounts (${telegramAccounts.length})`,
            html`<div class="account-card-list">${telegramAccounts.map((account) => renderAccountCard(account))}</div>`,
            false,
          )
        : nothing
    }

    ${renderCollapsibleSection(
      "Diagnostics",
      html`
        <div class="status-list">
          <div><span class="label">Configured</span><span>${telegram?.configured ? "Yes" : "No"}</span></div>
          <div><span class="label">Running</span><span>${telegram?.running ? "Yes" : "No"}</span></div>
          <div><span class="label">Mode</span><span>${telegram?.mode ?? "n/a"}</span></div>
          <div><span class="label">Last start</span><span>${telegram?.lastStartAt ? formatRelativeTimestamp(telegram.lastStartAt) : "n/a"}</span></div>
          <div><span class="label">Last probe</span><span>${telegram?.lastProbeAt ? formatRelativeTimestamp(telegram.lastProbeAt) : "n/a"}</span></div>
        </div>
      `,
      false,
    )}
  `;
}

// ── Discord ─────────────────────────────────────────────────────────────────

function renderDiscordDrawer(props: ChannelsProps, discord?: DiscordStatus | null) {
  const hero = resolveStandardHero(
    !!discord?.configured,
    !!discord?.running,
    discord?.lastError,
    discord?.lastStartAt,
  );

  return html`
    ${renderHero(hero)}
    ${renderProbeCallout(discord?.probe)}

    ${renderCollapsibleSection(
      "Configuration",
      renderChannelConfigSection({ channelId: "discord", props, omitSaveButtons: true }),
      !discord?.configured,
    )}

    ${renderCollapsibleSection(
      "Diagnostics",
      html`
        <div class="status-list">
          <div><span class="label">Configured</span><span>${discord?.configured ? "Yes" : "No"}</span></div>
          <div><span class="label">Running</span><span>${discord?.running ? "Yes" : "No"}</span></div>
          <div><span class="label">Last start</span><span>${discord?.lastStartAt ? formatRelativeTimestamp(discord.lastStartAt) : "n/a"}</span></div>
          <div><span class="label">Last probe</span><span>${discord?.lastProbeAt ? formatRelativeTimestamp(discord.lastProbeAt) : "n/a"}</span></div>
        </div>
      `,
      false,
    )}
  `;
}

// ── Slack ────────────────────────────────────────────────────────────────────

function renderSlackDrawer(props: ChannelsProps, slack?: SlackStatus | null) {
  const hero = resolveStandardHero(
    !!slack?.configured,
    !!slack?.running,
    slack?.lastError,
    slack?.lastStartAt,
  );

  return html`
    ${renderHero(hero)}
    ${renderProbeCallout(slack?.probe)}

    ${renderCollapsibleSection(
      "Configuration",
      renderChannelConfigSection({ channelId: "slack", props, omitSaveButtons: true }),
      !slack?.configured,
    )}

    ${renderCollapsibleSection(
      "Diagnostics",
      html`
        <div class="status-list">
          <div><span class="label">Configured</span><span>${slack?.configured ? "Yes" : "No"}</span></div>
          <div><span class="label">Running</span><span>${slack?.running ? "Yes" : "No"}</span></div>
          <div><span class="label">Last start</span><span>${slack?.lastStartAt ? formatRelativeTimestamp(slack.lastStartAt) : "n/a"}</span></div>
          <div><span class="label">Last probe</span><span>${slack?.lastProbeAt ? formatRelativeTimestamp(slack.lastProbeAt) : "n/a"}</span></div>
        </div>
      `,
      false,
    )}
  `;
}

// ── Signal ──────────────────────────────────────────────────────────────────

function renderSignalDrawer(props: ChannelsProps, signal?: SignalStatus | null) {
  const hero = resolveStandardHero(
    !!signal?.configured,
    !!signal?.running,
    signal?.lastError,
    signal?.lastStartAt,
  );

  return html`
    ${renderHero(hero)}
    ${renderProbeCallout(signal?.probe)}

    ${renderCollapsibleSection(
      "Configuration",
      renderChannelConfigSection({ channelId: "signal", props, omitSaveButtons: true }),
      !signal?.configured,
    )}

    ${renderCollapsibleSection(
      "Diagnostics",
      html`
        <div class="status-list">
          <div><span class="label">Configured</span><span>${signal?.configured ? "Yes" : "No"}</span></div>
          <div><span class="label">Running</span><span>${signal?.running ? "Yes" : "No"}</span></div>
          <div><span class="label">Base URL</span><span>${signal?.baseUrl ?? "n/a"}</span></div>
          <div><span class="label">Last start</span><span>${signal?.lastStartAt ? formatRelativeTimestamp(signal.lastStartAt) : "n/a"}</span></div>
          <div><span class="label">Last probe</span><span>${signal?.lastProbeAt ? formatRelativeTimestamp(signal.lastProbeAt) : "n/a"}</span></div>
        </div>
      `,
      false,
    )}
  `;
}

// ── iMessage ────────────────────────────────────────────────────────────────

function renderIMessageDrawer(props: ChannelsProps, imessage?: IMessageStatus | null) {
  const hero = resolveStandardHero(
    !!imessage?.configured,
    !!imessage?.running,
    imessage?.lastError,
    imessage?.lastStartAt,
  );

  return html`
    ${renderHero(hero)}
    ${renderProbeCallout(imessage?.probe)}

    ${renderCollapsibleSection(
      "Configuration",
      renderChannelConfigSection({ channelId: "imessage", props, omitSaveButtons: true }),
      !imessage?.configured,
    )}

    ${renderCollapsibleSection(
      "Diagnostics",
      html`
        <div class="status-list">
          <div><span class="label">Configured</span><span>${imessage?.configured ? "Yes" : "No"}</span></div>
          <div><span class="label">Running</span><span>${imessage?.running ? "Yes" : "No"}</span></div>
          <div><span class="label">Last start</span><span>${imessage?.lastStartAt ? formatRelativeTimestamp(imessage.lastStartAt) : "n/a"}</span></div>
          <div><span class="label">Last probe</span><span>${imessage?.lastProbeAt ? formatRelativeTimestamp(imessage.lastProbeAt) : "n/a"}</span></div>
        </div>
      `,
      false,
    )}
  `;
}

// ── Google Chat ─────────────────────────────────────────────────────────────

function renderGoogleChatDrawer(props: ChannelsProps, googleChat?: GoogleChatStatus | null) {
  const hero = resolveStandardHero(
    googleChat?.configured ?? false,
    googleChat?.running ?? false,
    googleChat?.lastError,
    googleChat?.lastStartAt,
  );

  return html`
    ${renderHero(hero)}
    ${renderProbeCallout(googleChat?.probe)}

    ${renderCollapsibleSection(
      "Configuration",
      renderChannelConfigSection({ channelId: "googlechat", props, omitSaveButtons: true }),
      !googleChat?.configured,
    )}

    ${renderCollapsibleSection(
      "Diagnostics",
      html`
        <div class="status-list">
          <div><span class="label">Configured</span><span>${googleChat ? (googleChat.configured ? "Yes" : "No") : "n/a"}</span></div>
          <div><span class="label">Running</span><span>${googleChat ? (googleChat.running ? "Yes" : "No") : "n/a"}</span></div>
          <div><span class="label">Credential</span><span>${googleChat?.credentialSource ?? "n/a"}</span></div>
          <div><span class="label">Audience</span><span>${googleChat?.audienceType ? `${googleChat.audienceType}${googleChat.audience ? ` \u00b7 ${googleChat.audience}` : ""}` : "n/a"}</span></div>
          <div><span class="label">Last start</span><span>${googleChat?.lastStartAt ? formatRelativeTimestamp(googleChat.lastStartAt) : "n/a"}</span></div>
          <div><span class="label">Last probe</span><span>${googleChat?.lastProbeAt ? formatRelativeTimestamp(googleChat.lastProbeAt) : "n/a"}</span></div>
        </div>
      `,
      false,
    )}
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

  const hero = resolveStandardHero(
    summaryConfigured,
    summaryRunning,
    summaryLastError,
    summaryLastStartAt,
  );

  return html`
    ${renderHero(hero)}

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

    ${renderCollapsibleSection(
      "Configuration",
      renderChannelConfigSection({ channelId: "nostr", props, omitSaveButtons: true }),
      !summaryConfigured,
    )}

    ${
      nostrAccounts.length > 1
        ? renderCollapsibleSection(
            `Accounts (${nostrAccounts.length})`,
            html`
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
            `,
            false,
          )
        : nothing
    }

    ${renderCollapsibleSection(
      "Diagnostics",
      html`
        <div class="status-list">
          <div><span class="label">Configured</span><span>${summaryConfigured ? "Yes" : "No"}</span></div>
          <div><span class="label">Running</span><span>${summaryRunning ? "Yes" : "No"}</span></div>
          <div><span class="label">Public Key</span><span class="monospace" title="${summaryPublicKey ?? ""}">${truncatePubkey(summaryPublicKey)}</span></div>
          <div><span class="label">Last start</span><span>${summaryLastStartAt ? formatRelativeTimestamp(summaryLastStartAt) : "n/a"}</span></div>
        </div>
      `,
      false,
    )}
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
  const configured = typeof status?.configured === "boolean" ? status.configured : false;
  const running = typeof status?.running === "boolean" ? status.running : false;
  const connected = typeof status?.connected === "boolean" ? status.connected : undefined;
  const lastError = typeof status?.lastError === "string" ? status.lastError : undefined;
  const lastStartAt = typeof status?.lastStartAt === "number" ? status.lastStartAt : null;
  const accounts = data.channelAccounts?.[channelId] ?? [];

  const hero = resolveStandardHero(configured, running, lastError, lastStartAt);

  return html`
    ${renderHero(hero)}

    ${renderCollapsibleSection(
      "Configuration",
      renderChannelConfigSection({ channelId, props, omitSaveButtons: true }),
      !configured,
    )}

    ${
      accounts.length > 0
        ? renderCollapsibleSection(
            `Accounts (${accounts.length})`,
            html`<div class="account-card-list">${accounts.map((account) => renderAccountCard(account))}</div>`,
            false,
          )
        : nothing
    }

    ${renderCollapsibleSection(
      "Diagnostics",
      html`
        <div class="status-list">
          <div><span class="label">Configured</span><span>${configured ? "Yes" : "No"}</span></div>
          <div><span class="label">Running</span><span>${running ? "Yes" : "No"}</span></div>
          ${connected != null ? html`<div><span class="label">Connected</span><span>${connected ? "Yes" : "No"}</span></div>` : nothing}
        </div>
      `,
      false,
    )}
  `;
}

// ── Shared helpers ──────────────────────────────────────────────────────────

function resolveStandardHero(
  configured: boolean,
  running: boolean,
  lastError?: string | null,
  lastStartAt?: number | null,
): HeroParams {
  if (lastError) {
    return { state: "error", label: "Error", sub: lastError };
  }
  if (running) {
    const sub = lastStartAt ? `Running since ${formatRelativeTimestamp(lastStartAt)}` : undefined;
    return { state: "ok", label: "Running", sub };
  }
  if (configured) {
    return { state: "warn", label: "Stopped", sub: "Channel is configured but not running" };
  }
  return { state: "idle", label: "Not configured" };
}

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
