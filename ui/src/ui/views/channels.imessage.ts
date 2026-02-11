import { html, nothing } from "lit";
import type { IMessageStatus } from "../types.ts";
import type { ChannelsProps } from "./channels.types.ts";
import { channelIcon, renderChannelStatusPill, renderChannelToggle } from "./channels.shared.ts";

export function renderIMessageCard(params: {
  props: ChannelsProps;
  imessage?: IMessageStatus | null;
  accountCountLabel: unknown;
}) {
  const { props, imessage, accountCountLabel } = params;

  return html`
    <div class="card">
      <div class="row" style="justify-content: space-between; align-items: center;">
        <div class="card-title">${channelIcon("imessage")} iMessage</div>
        ${renderChannelToggle({ channelId: "imessage", props })}
      </div>
      <div class="card-sub">
        ${renderChannelStatusPill(!!imessage?.configured, !!imessage?.lastError)}
        macOS bridge status and channel configuration.
      </div>
      ${accountCountLabel}

      <div class="channel-tile-status">
        <div><span class="label">Running</span> <span>${imessage?.running ? "Yes" : "No"}</span></div>
      </div>

      ${
        imessage?.lastError
          ? html`<div class="callout danger" style="margin-top: 12px;">${imessage.lastError}</div>`
          : nothing
      }

      <div class="channel-tile-actions">
        <button class="btn" @click=${() => props.onOpenChannelDrawer("imessage")}>Configure</button>
        <button class="btn" @click=${() => props.onRefresh(true)}>Probe</button>
      </div>
    </div>
  `;
}
