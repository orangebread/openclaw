import { html, nothing } from "lit";
import type { GoogleChatStatus } from "../types.ts";
import type { ChannelsProps } from "./channels.types.ts";
import { channelIcon, renderChannelStatusPill, renderChannelToggle } from "./channels.shared.ts";

export function renderGoogleChatCard(params: {
  props: ChannelsProps;
  googleChat?: GoogleChatStatus | null;
  accountCountLabel: unknown;
}) {
  const { props, googleChat, accountCountLabel } = params;

  return html`
    <div class="card">
      <div class="row" style="justify-content: space-between; align-items: center;">
        <div class="card-title">${channelIcon("googlechat")} Google Chat</div>
        ${renderChannelToggle({ channelId: "googlechat", props })}
      </div>
      <div class="card-sub">
        ${renderChannelStatusPill(!!googleChat?.configured, !!googleChat?.lastError)}
        Chat API webhook status and channel configuration.
      </div>
      ${accountCountLabel}

      <div class="channel-tile-status">
        <div><span class="label">Running</span> <span>${googleChat ? (googleChat.running ? "Yes" : "No") : "n/a"}</span></div>
      </div>

      ${
        googleChat?.lastError
          ? html`<div class="callout danger" style="margin-top: 12px;">${googleChat.lastError}</div>`
          : nothing
      }

      <div class="channel-tile-actions">
        <button class="btn" @click=${() => props.onOpenChannelDrawer("googlechat")}>Configure</button>
        <button class="btn" @click=${() => props.onRefresh(true)}>Probe</button>
      </div>
    </div>
  `;
}
