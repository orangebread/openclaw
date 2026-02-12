import { html, nothing } from "lit";
import type { DiscordStatus } from "../types.ts";
import type { ChannelsProps } from "./channels.types.ts";
import {
  channelHealthClass,
  channelIcon,
  renderCardStatusSummary,
  renderChannelStatusPill,
  renderChannelToggle,
} from "./channels.shared.ts";

export function renderDiscordCard(params: {
  props: ChannelsProps;
  discord?: DiscordStatus | null;
  accountCountLabel: unknown;
}) {
  const { props, discord, accountCountLabel } = params;
  const configured = !!discord?.configured;
  const running = !!discord?.running;
  const hasError = !!discord?.lastError;

  return html`
    <div class="card ${channelHealthClass(configured, running, hasError)}">
      <div class="row" style="justify-content: space-between; align-items: center;">
        <div class="card-title">${channelIcon("discord")} Discord</div>
        ${renderChannelToggle({ channelId: "discord", props })}
      </div>
      <div class="card-sub">
        ${renderChannelStatusPill(configured, hasError)}
      </div>
      ${accountCountLabel}
      ${renderCardStatusSummary({ configured, running, hasError, lastStartAt: discord?.lastStartAt, lastProbeAt: discord?.lastProbeAt })}

      ${
        hasError
          ? html`<div class="callout danger" style="margin-top: 8px;">${discord.lastError}</div>`
          : nothing
      }

      <div class="channel-tile-actions">
        <button class="btn" @click=${() => props.onOpenChannelDrawer("discord")}>Configure</button>
        <button class="btn" @click=${() => props.onRefresh(true)}>Probe</button>
      </div>
    </div>
  `;
}
