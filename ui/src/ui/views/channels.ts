import { html, nothing } from "lit";
import type { ChannelCatalogEntry } from "../controllers/channels.types.ts";
import type {
  ChannelAccountSnapshot,
  ChannelUiMetaEntry,
  ChannelsStatusSnapshot,
  DiscordStatus,
  GoogleChatStatus,
  IMessageStatus,
  NostrProfile,
  NostrStatus,
  SignalStatus,
  SlackStatus,
  TelegramStatus,
  WhatsAppStatus,
} from "../types.ts";
import type { ChannelKey, ChannelsChannelData, ChannelsProps } from "./channels.types.ts";
import { formatRelativeTimestamp } from "../format.ts";
import { renderChannelConfigSection } from "./channels.config.ts";
import { renderDiscordCard } from "./channels.discord.ts";
import { renderGoogleChatCard } from "./channels.googlechat.ts";
import { renderIMessageCard } from "./channels.imessage.ts";
import { renderNostrCard } from "./channels.nostr.ts";
import {
  channelEnabled,
  channelIcon,
  renderChannelAccountCount,
  renderChannelToggle,
} from "./channels.shared.ts";
import { renderSignalCard } from "./channels.signal.ts";
import { renderSlackCard } from "./channels.slack.ts";
import { renderTelegramCard } from "./channels.telegram.ts";
import { renderWhatsAppCard } from "./channels.whatsapp.ts";

export function renderChannels(props: ChannelsProps) {
  const channels = props.snapshot?.channels as Record<string, unknown> | null;
  const whatsapp = (channels?.whatsapp ?? undefined) as WhatsAppStatus | undefined;
  const telegram = (channels?.telegram ?? undefined) as TelegramStatus | undefined;
  const discord = (channels?.discord ?? null) as DiscordStatus | null;
  const googlechat = (channels?.googlechat ?? null) as GoogleChatStatus | null;
  const slack = (channels?.slack ?? null) as SlackStatus | null;
  const signal = (channels?.signal ?? null) as SignalStatus | null;
  const imessage = (channels?.imessage ?? null) as IMessageStatus | null;
  const nostr = (channels?.nostr ?? null) as NostrStatus | null;
  const channelOrder = resolveChannelOrder(props.snapshot);
  const snapshotChannelIds = new Set(channelOrder);
  const catalogGhosts = (props.catalog ?? [])
    .filter((entry) => !snapshotChannelIds.has(entry.id) && !entry.configured)
    .map((entry) => entry.id);
  const catalogGhostSet = new Set(catalogGhosts);
  const fullOrder = [...channelOrder, ...catalogGhosts];
  const catalogMap = new Map((props.catalog ?? []).map((entry) => [entry.id, entry]));

  const orderedChannels = fullOrder
    .map((key, index) => ({
      key,
      enabled: channelEnabled(key, props),
      ghost: catalogGhostSet.has(key),
      order: index,
    }))
    .toSorted((a, b) => {
      if (a.ghost !== b.ghost) {
        return a.ghost ? 1 : -1;
      }
      if (a.enabled !== b.enabled) {
        return a.enabled ? -1 : 1;
      }
      return a.order - b.order;
    });

  const channelData: ChannelsChannelData = {
    whatsapp,
    telegram,
    discord,
    googlechat,
    slack,
    signal,
    imessage,
    nostr,
    channelAccounts: props.snapshot?.channelAccounts ?? null,
  };

  return html`
    ${
      props.catalogLoading
        ? html`
            <div class="muted" style="margin-bottom: 12px">Loading channel catalog\u2026</div>
          `
        : nothing
    }
    ${props.catalogError ? html`<div class="callout danger" style="margin-bottom: 12px;">Catalog error: ${props.catalogError}</div>` : nothing}
    ${props.installError ? html`<div class="callout danger" style="margin-bottom: 12px;">Install error: ${props.installError}</div>` : nothing}
    ${props.restartError ? html`<div class="callout danger" style="margin-bottom: 12px;">Restart error: ${props.restartError}</div>` : nothing}
    ${
      props.installSuccess
        ? html`
            <div class="callout" style="margin-bottom: 12px">
              Channel plugin updated. Restart gateway to activate.
            </div>
          `
        : nothing
    }
    <section class="grid grid-cols-2">
      ${orderedChannels.map((channel) => {
        if (channel.ghost) {
          const catalogEntry = catalogMap.get(channel.key);
          if (catalogEntry) {
            return renderGhostChannelCard(catalogEntry, props);
          }
        }
        return renderChannel(channel.key, props, channelData);
      })}
    </section>

    <section class="card" style="margin-top: 18px;">
      <div class="row" style="justify-content: space-between;">
        <div>
          <div class="card-title">Channel health</div>
          <div class="card-sub">Channel status snapshots from the gateway.</div>
        </div>
        <div class="muted">${props.lastSuccessAt ? formatRelativeTimestamp(props.lastSuccessAt) : "n/a"}</div>
      </div>
      ${
        props.lastError
          ? html`<div class="callout danger" style="margin-top: 12px;">
            ${props.lastError}
          </div>`
          : nothing
      }
      <pre class="code-block" style="margin-top: 12px;">
${props.snapshot ? JSON.stringify(props.snapshot, null, 2) : "No snapshot yet."}
      </pre>
    </section>
  `;
}

function resolveChannelOrder(snapshot: ChannelsStatusSnapshot | null): ChannelKey[] {
  if (snapshot?.channelMeta?.length) {
    return snapshot.channelMeta.map((entry) => entry.id);
  }
  if (snapshot?.channelOrder?.length) {
    return snapshot.channelOrder;
  }
  return ["whatsapp", "telegram", "discord", "googlechat", "slack", "signal", "imessage", "nostr"];
}

function renderChannel(key: ChannelKey, props: ChannelsProps, data: ChannelsChannelData) {
  const accountCountLabel = renderChannelAccountCount(key, data.channelAccounts);
  switch (key) {
    case "whatsapp":
      return renderWhatsAppCard({
        props,
        whatsapp: data.whatsapp,
        accountCountLabel,
      });
    case "telegram":
      return renderTelegramCard({
        props,
        telegram: data.telegram,
        telegramAccounts: data.channelAccounts?.telegram ?? [],
        accountCountLabel,
      });
    case "discord":
      return renderDiscordCard({
        props,
        discord: data.discord,
        accountCountLabel,
      });
    case "googlechat":
      return renderGoogleChatCard({
        props,
        googleChat: data.googlechat,
        accountCountLabel,
      });
    case "slack":
      return renderSlackCard({
        props,
        slack: data.slack,
        accountCountLabel,
      });
    case "signal":
      return renderSignalCard({
        props,
        signal: data.signal,
        accountCountLabel,
      });
    case "imessage":
      return renderIMessageCard({
        props,
        imessage: data.imessage,
        accountCountLabel,
      });
    case "nostr": {
      const nostrAccounts = data.channelAccounts?.nostr ?? [];
      const primaryAccount = nostrAccounts[0];
      const accountId = primaryAccount?.accountId ?? "default";
      const profile =
        (primaryAccount as { profile?: NostrProfile | null } | undefined)?.profile ?? null;
      const showForm =
        props.nostrProfileAccountId === accountId ? props.nostrProfileFormState : null;
      const profileFormCallbacks = showForm
        ? {
            onFieldChange: props.onNostrProfileFieldChange,
            onSave: props.onNostrProfileSave,
            onImport: props.onNostrProfileImport,
            onCancel: props.onNostrProfileCancel,
            onToggleAdvanced: props.onNostrProfileToggleAdvanced,
          }
        : null;
      return renderNostrCard({
        props,
        nostr: data.nostr,
        nostrAccounts,
        accountCountLabel,
        profileFormState: showForm,
        profileFormCallbacks,
        onEditProfile: () => props.onNostrProfileEdit(accountId, profile),
      });
    }
    default:
      return renderGenericChannelCard(key, props, data.channelAccounts ?? {});
  }
}

function renderGenericChannelCard(
  key: ChannelKey,
  props: ChannelsProps,
  channelAccounts: Record<string, ChannelAccountSnapshot[]>,
) {
  const label = resolveChannelLabel(props.snapshot, key);
  const status = props.snapshot?.channels?.[key] as Record<string, unknown> | undefined;
  const configured = typeof status?.configured === "boolean" ? status.configured : undefined;
  const running = typeof status?.running === "boolean" ? status.running : undefined;
  const connected = typeof status?.connected === "boolean" ? status.connected : undefined;
  const lastError = typeof status?.lastError === "string" ? status.lastError : undefined;
  const accounts = channelAccounts[key] ?? [];
  const accountCountLabel = renderChannelAccountCount(key, channelAccounts);

  return html`
    <div class="card">
      <div class="row" style="justify-content: space-between; align-items: center;">
        <div class="card-title">${channelIcon(key)} ${label}</div>
        ${renderChannelToggle({ channelId: key, props })}
      </div>
      <div class="card-sub">Channel status and configuration.</div>
      ${accountCountLabel}

      ${
        accounts.length > 0
          ? html`
            <div class="account-card-list">
              ${accounts.map((account) => renderGenericAccount(account))}
            </div>
          `
          : html`
            <div class="status-list" style="margin-top: 16px;">
              <div>
                <span class="label">Configured</span>
                <span>${configured == null ? "n/a" : configured ? "Yes" : "No"}</span>
              </div>
              <div>
                <span class="label">Running</span>
                <span>${running == null ? "n/a" : running ? "Yes" : "No"}</span>
              </div>
              <div>
                <span class="label">Connected</span>
                <span>${connected == null ? "n/a" : connected ? "Yes" : "No"}</span>
              </div>
            </div>
          `
      }

      ${
        lastError
          ? html`<div class="callout danger" style="margin-top: 12px;">
            ${lastError}
          </div>`
          : nothing
      }

      ${renderChannelConfigSection({ channelId: key, props })}
    </div>
  `;
}

function resolveChannelMetaMap(
  snapshot: ChannelsStatusSnapshot | null,
): Record<string, ChannelUiMetaEntry> {
  if (!snapshot?.channelMeta?.length) {
    return {};
  }
  return Object.fromEntries(snapshot.channelMeta.map((entry) => [entry.id, entry]));
}

function resolveChannelLabel(snapshot: ChannelsStatusSnapshot | null, key: string): string {
  const meta = resolveChannelMetaMap(snapshot)[key];
  return meta?.label ?? snapshot?.channelLabels?.[key] ?? key;
}

const RECENT_ACTIVITY_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

function hasRecentActivity(account: ChannelAccountSnapshot): boolean {
  if (!account.lastInboundAt) {
    return false;
  }
  return Date.now() - account.lastInboundAt < RECENT_ACTIVITY_THRESHOLD_MS;
}

function deriveRunningStatus(account: ChannelAccountSnapshot): "Yes" | "No" | "Active" {
  if (account.running) {
    return "Yes";
  }
  // If we have recent inbound activity, the channel is effectively running
  if (hasRecentActivity(account)) {
    return "Active";
  }
  return "No";
}

function deriveConnectedStatus(account: ChannelAccountSnapshot): "Yes" | "No" | "Active" | "n/a" {
  if (account.connected === true) {
    return "Yes";
  }
  if (account.connected === false) {
    return "No";
  }
  // If connected is null/undefined but we have recent activity, show as active
  if (hasRecentActivity(account)) {
    return "Active";
  }
  return "n/a";
}

function renderGhostChannelCard(entry: ChannelCatalogEntry, props: ChannelsProps) {
  const isSetupActive = props.setupChannelId === entry.id;

  if (isSetupActive) {
    return html`
      <div class="card">
        <div class="card-title">${channelIcon(entry.id)} ${entry.label}</div>
        <div class="card-sub">${entry.blurb || "Available channel."}</div>
        ${renderChannelConfigSection({ channelId: entry.id, props })}
        <div class="row" style="margin-top: 8px;">
          <button class="btn" @click=${() => props.onSetupChannel(null)}>Cancel</button>
        </div>
      </div>
    `;
  }

  return html`
    <div class="card" style="opacity: 0.6;">
      <div class="card-title">${channelIcon(entry.id)} ${entry.label}</div>
      <div class="card-sub">${entry.blurb || "Available channel."}</div>
      <div class="status-list" style="margin-top: 16px;">
        <div>
          <span class="label">Installed</span>
          <span>${entry.installed ? "Yes" : "No"}</span>
        </div>
        <div>
          <span class="label">Configured</span>
          <span>No</span>
        </div>
        <div>
          <span class="label">Enabled</span>
          <span>${entry.enabled ? "Yes" : "No"}</span>
        </div>
      </div>
      <div class="row" style="margin-top: 12px;">
        ${
          !entry.installed
            ? html`<button
                class="btn"
                ?disabled=${props.installBusy === entry.id}
                @click=${() => props.onInstallChannel(entry.id)}
              >${props.installBusy === entry.id ? "Installing…" : "Install"}</button>`
            : !entry.enabled
              ? html`<button
                class="btn"
                ?disabled=${props.installBusy === entry.id}
                @click=${() => props.onEnableChannel(entry.id)}
              >${props.installBusy === entry.id ? "Enabling…" : "Enable"}</button>`
              : entry.hasSchema
                ? html`<button
                  class="btn"
                  @click=${() => props.onSetupChannel(entry.id)}
                >Set up</button>`
                : html`
                  <div class="muted">Installed. Restart gateway to finish loading this channel.</div>
                  <button
                    class="btn"
                    ?disabled=${props.restartBusy}
                    @click=${() => props.onRestartGateway()}
                  >${props.restartBusy ? "Restarting…" : "Restart gateway"}</button>
                `
        }
      </div>
    </div>
  `;
}

function renderGenericAccount(account: ChannelAccountSnapshot) {
  const runningStatus = deriveRunningStatus(account);
  const connectedStatus = deriveConnectedStatus(account);

  return html`
    <div class="account-card">
      <div class="account-card-header">
        <div class="account-card-title">${account.name || account.accountId}</div>
        <div class="account-card-id">${account.accountId}</div>
      </div>
      <div class="status-list account-card-status">
        <div>
          <span class="label">Running</span>
          <span>${runningStatus}</span>
        </div>
        <div>
          <span class="label">Configured</span>
          <span>${account.configured ? "Yes" : "No"}</span>
        </div>
        <div>
          <span class="label">Connected</span>
          <span>${connectedStatus}</span>
        </div>
        <div>
          <span class="label">Last inbound</span>
          <span>${account.lastInboundAt ? formatRelativeTimestamp(account.lastInboundAt) : "n/a"}</span>
        </div>
        ${
          account.lastError
            ? html`
              <div class="account-card-error">
                ${account.lastError}
              </div>
            `
            : nothing
        }
      </div>
    </div>
  `;
}
