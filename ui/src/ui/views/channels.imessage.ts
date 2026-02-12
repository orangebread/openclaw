import { html, nothing } from "lit";
import type { IMessageStatus } from "../types.ts";
import type { ChannelsProps } from "./channels.types.ts";
import {
  channelHealthClass,
  channelIcon,
  renderCardStatusSummary,
  renderChannelStatusPill,
  renderChannelToggle,
} from "./channels.shared.ts";

export function renderIMessageCard(params: {
  props: ChannelsProps;
  imessage?: IMessageStatus | null;
  accountCountLabel: unknown;
}) {
  const { props, imessage, accountCountLabel } = params;
  const configured = !!imessage?.configured;
  const running = !!imessage?.running;
  const hasError = !!imessage?.lastError;

  return html`
    <div class="card ${channelHealthClass(configured, running, hasError)}">
      <div class="row" style="justify-content: space-between; align-items: center;">
        <div class="card-title">${channelIcon("imessage")} iMessage</div>
        ${renderChannelToggle({ channelId: "imessage", props })}
      </div>
      <div class="card-sub">
        ${renderChannelStatusPill(configured, hasError)}
      </div>
      ${accountCountLabel}
      ${renderCardStatusSummary({ configured, running, hasError, lastStartAt: imessage?.lastStartAt, lastProbeAt: imessage?.lastProbeAt })}

      ${
        hasError
          ? html`<div class="callout danger" style="margin-top: 8px;">${imessage.lastError}</div>`
          : nothing
      }

      <div class="channel-tile-actions">
        <button class="btn" @click=${() => props.onOpenChannelDrawer("imessage")}>Configure</button>
        <button class="btn" @click=${() => props.onRefresh(true)}>Probe</button>
      </div>
    </div>
  `;
}
