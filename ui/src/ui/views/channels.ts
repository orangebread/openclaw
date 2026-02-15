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
import { renderChannelDrawer } from "./channels.drawer.ts";
import { renderGoogleChatCard } from "./channels.googlechat.ts";
import { renderIMessageCard } from "./channels.imessage.ts";
import { renderNostrCard } from "./channels.nostr.ts";
import {
  channelConfigured,
  channelEnabled,
  channelHealthClass,
  channelIcon,
  renderCardStatusSummary,
  renderChannelAccountCount,
  renderChannelStatusPill,
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
  const doctorPlan = props.doctorPlan;
  const doctorIssues = doctorPlan?.issues ?? [];
  const doctorFixAvailable = doctorPlan?.fixAvailable === true;
  const doctorHasError = doctorIssues.some((issue) => issue.level === "error");
  const doctorCalloutClass = doctorHasError ? "danger" : "warning";
  const doctorTitle = doctorHasError ? "Gateway issues detected" : "Gateway maintenance available";
  const doctorSubtitle = doctorHasError
    ? "These can prevent channels from loading or installing."
    : "Safe config migrations are available.";

  const orderedChannels = fullOrder
    .map((key, index) => ({
      key,
      configured: channelConfigured(key, props),
      enabled: channelEnabled(key, props),
      ghost: catalogGhostSet.has(key),
      order: index,
    }))
    .toSorted((a, b) => {
      if (a.ghost !== b.ghost) {
        return a.ghost ? 1 : -1;
      }
      if (a.configured !== b.configured) {
        return a.configured ? -1 : 1;
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
    ${
      props.doctorPlanLoading
        ? html`
            <div class="muted" style="margin-bottom: 12px">Checking for common gateway issues...</div>
          `
        : nothing
    }
    ${props.doctorPlanError ? html`<div class="callout danger" style="margin-bottom: 12px;">Doctor error: ${props.doctorPlanError}</div>` : nothing}
    ${props.doctorFixError ? html`<div class="callout danger" style="margin-bottom: 12px;">Doctor fix error: ${props.doctorFixError}</div>` : nothing}
    ${
      doctorIssues.length
        ? html`
            <div class=${`callout ${doctorCalloutClass}`} style="margin-bottom: 12px;">
              <div class="row" style="justify-content: space-between; align-items: center;">
                <div>
                  <strong>${doctorTitle}</strong>
                  <div class="muted" style="margin-top: 4px;">${doctorSubtitle}</div>
                </div>
                <button
                  class="btn"
                  ?disabled=${props.doctorFixBusy || !doctorFixAvailable}
                  @click=${() => props.onDoctorFix()}
                >
                  ${props.doctorFixBusy ? "Fixing..." : "Fix"}
                </button>
              </div>
              <ul style="margin: 10px 0 0 18px;">
                ${doctorIssues.slice(0, 8).map((issue) => html`<li>${issue.message}</li>`)}
              </ul>
              ${
                doctorIssues.length > 8
                  ? html`<div class="muted" style="margin-top: 8px;">And ${doctorIssues.length - 8} more</div>`
                  : nothing
              }
            </div>
          `
        : nothing
    }
    ${props.catalogError ? html`<div class="callout danger" style="margin-bottom: 12px;">Catalog error: ${props.catalogError}</div>` : nothing}
    ${props.installError ? html`<div class="callout danger" style="margin-bottom: 12px;">Install error: ${props.installError}</div>` : nothing}
    ${props.restartError ? html`<div class="callout danger" style="margin-bottom: 12px;">Restart error: ${props.restartError}</div>` : nothing}
    ${
      props.installLog.trim()
        ? html`
            <details class="card" style="margin-bottom: 12px;">
              <summary style="cursor: pointer; list-style: none;">Install logs${props.installLogTruncated ? " (truncated)" : ""}</summary>
              <pre class="code-block" style="margin-top: 12px;">${props.installLog}</pre>
            </details>
          `
        : nothing
    }
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

    <details class="card" style="margin-top: 18px;">
      <summary style="cursor: pointer; list-style: none;">
        <div class="row" style="justify-content: space-between;">
          <div>
            <div class="card-title">Channel health</div>
            <div class="card-sub">Channel status snapshots from the gateway.</div>
          </div>
          <div class="muted">${props.lastSuccessAt ? formatRelativeTimestamp(props.lastSuccessAt) : "n/a"}</div>
        </div>
      </summary>
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
    </details>

    ${props.activeDrawerChannelId ? renderDrawerForChannel(props, channelData) : nothing}
  `;
}

function renderDrawerForChannel(props: ChannelsProps, channelData: ChannelsChannelData) {
  const channelId = props.activeDrawerChannelId!;
  const label = resolveChannelLabel(props.snapshot, channelId);

  // Compute nostr profile form state if the drawer is for nostr
  let nostrProfileFormState = null;
  let nostrProfileFormCallbacks = null;
  let onNostrEditProfile: (() => void) | undefined;
  if (channelId === "nostr") {
    const nostrAccounts = channelData.channelAccounts?.nostr ?? [];
    const primaryAccount = nostrAccounts[0];
    const accountId = primaryAccount?.accountId ?? "default";
    const profile =
      (primaryAccount as { profile?: NostrProfile | null } | undefined)?.profile ?? null;
    const showForm = props.nostrProfileAccountId === accountId ? props.nostrProfileFormState : null;
    nostrProfileFormState = showForm;
    nostrProfileFormCallbacks = showForm
      ? {
          onFieldChange: props.onNostrProfileFieldChange,
          onSave: props.onNostrProfileSave,
          onImport: props.onNostrProfileImport,
          onCancel: props.onNostrProfileCancel,
          onToggleAdvanced: props.onNostrProfileToggleAdvanced,
        }
      : null;
    onNostrEditProfile = () => props.onNostrProfileEdit(accountId, profile);
  }

  return renderChannelDrawer({
    channelId,
    label,
    props,
    channelData,
    nostrProfileFormState,
    nostrProfileFormCallbacks,
    onNostrEditProfile,
  });
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
  const configured = typeof status?.configured === "boolean" ? status.configured : false;
  const running = typeof status?.running === "boolean" ? status.running : false;
  const lastError = typeof status?.lastError === "string" ? status.lastError : undefined;
  const lastStartAt = typeof status?.lastStartAt === "number" ? status.lastStartAt : null;
  const lastProbeAt = typeof status?.lastProbeAt === "number" ? status.lastProbeAt : null;
  const hasError = !!lastError;
  const accountCountLabel = renderChannelAccountCount(key, channelAccounts);

  return html`
    <div class="card ${channelHealthClass(configured, running, hasError)}">
      <div class="row" style="justify-content: space-between; align-items: center;">
        <div class="card-title">${channelIcon(key)} ${label}</div>
        ${renderChannelToggle({ channelId: key, props })}
      </div>
      <div class="card-sub">
        ${renderChannelStatusPill(configured, hasError)}
      </div>
      ${accountCountLabel}
      ${renderCardStatusSummary({ configured, running, hasError, lastStartAt, lastProbeAt })}

      ${
        hasError
          ? html`<div class="callout danger" style="margin-top: 8px;">${lastError}</div>`
          : nothing
      }

      <div class="channel-tile-actions">
        <button class="btn" @click=${() => props.onOpenChannelDrawer(key)}>Configure</button>
      </div>
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

function renderGhostChannelCard(entry: ChannelCatalogEntry, props: ChannelsProps) {
  const isSetupActive = props.setupChannelId === entry.id;
  const pluginLoadError =
    entry.pluginStatus === "error" && typeof entry.pluginError === "string" && entry.pluginError
      ? entry.pluginError
      : null;

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
      ${pluginLoadError ? html`<div class="callout danger" style="margin-top: 12px;">${pluginLoadError}</div>` : nothing}
      <div class="row" style="margin-top: 12px;">
        ${
          !entry.installed
            ? html`<button
                class="btn"
                ?disabled=${props.installBusy === entry.id}
                @click=${() => props.onInstallChannel(entry.id)}
              >${props.installBusy === entry.id ? "Installing…" : "Install"}</button>`
            : pluginLoadError
              ? html`<button
                class="btn"
                ?disabled=${props.installBusy === entry.id}
                @click=${() => props.onInstallChannel(entry.id, "update")}
              >${props.installBusy === entry.id ? "Repairing…" : "Repair"}</button>`
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
