import { html, nothing } from "lit";
import type { WhatsAppStatus } from "../types.ts";
import type { ChannelsProps } from "./channels.types.ts";
import { formatRelativeTimestamp } from "../format.ts";
import {
  channelHealthClass,
  channelIcon,
  renderChannelStatusPill,
  renderChannelToggle,
} from "./channels.shared.ts";

export function renderWhatsAppCard(params: {
  props: ChannelsProps;
  whatsapp?: WhatsAppStatus;
  accountCountLabel: unknown;
}) {
  const { props, whatsapp, accountCountLabel } = params;
  const configured = !!whatsapp?.configured;
  const running = !!whatsapp?.running;
  const hasError = !!whatsapp?.lastError;

  // WhatsApp-specific summary: prioritize connection & last message
  const summaryText = hasError
    ? null
    : whatsapp?.connected && whatsapp.lastMessageAt
      ? `Last message ${formatRelativeTimestamp(whatsapp.lastMessageAt)}`
      : whatsapp?.connected
        ? "Connected"
        : whatsapp?.linked
          ? "Linked, not connected"
          : configured
            ? "Not linked"
            : null;

  return html`
    <div class="card ${channelHealthClass(configured, running, hasError)}">
      <div class="row" style="justify-content: space-between; align-items: center;">
        <div class="card-title">${channelIcon("whatsapp")} WhatsApp</div>
        ${renderChannelToggle({ channelId: "whatsapp", props })}
      </div>
      <div class="card-sub">
        ${renderChannelStatusPill(configured, hasError)}
      </div>
      ${accountCountLabel}
      ${summaryText ? html`<div class="channel-tile-summary">${summaryText}</div>` : nothing}

      ${
        hasError
          ? html`<div class="callout danger" style="margin-top: 8px;">${whatsapp.lastError}</div>`
          : nothing
      }

      <div class="channel-tile-actions">
        <button class="btn" @click=${() => props.onOpenChannelDrawer("whatsapp")}>Configure</button>
      </div>
    </div>
  `;
}
