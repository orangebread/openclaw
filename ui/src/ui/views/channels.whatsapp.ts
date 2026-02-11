import { html, nothing } from "lit";
import type { WhatsAppStatus } from "../types.ts";
import type { ChannelsProps } from "./channels.types.ts";
import { channelIcon, renderChannelStatusPill, renderChannelToggle } from "./channels.shared.ts";

export function renderWhatsAppCard(params: {
  props: ChannelsProps;
  whatsapp?: WhatsAppStatus;
  accountCountLabel: unknown;
}) {
  const { props, whatsapp, accountCountLabel } = params;

  return html`
    <div class="card">
      <div class="row" style="justify-content: space-between; align-items: center;">
        <div class="card-title">${channelIcon("whatsapp")} WhatsApp</div>
        ${renderChannelToggle({ channelId: "whatsapp", props })}
      </div>
      <div class="card-sub">
        ${renderChannelStatusPill(!!whatsapp?.configured, !!whatsapp?.lastError)}
        Link WhatsApp Web and monitor connection health.
      </div>
      ${accountCountLabel}

      <div class="channel-tile-status">
        <div><span class="label">Linked</span> <span>${whatsapp?.linked ? "Yes" : "No"}</span></div>
        <div><span class="label">Running</span> <span>${whatsapp?.running ? "Yes" : "No"}</span></div>
        <div><span class="label">Connected</span> <span>${whatsapp?.connected ? "Yes" : "No"}</span></div>
      </div>

      ${
        whatsapp?.lastError
          ? html`<div class="callout danger" style="margin-top: 12px;">${whatsapp.lastError}</div>`
          : nothing
      }

      <div class="channel-tile-actions">
        <button class="btn" @click=${() => props.onOpenChannelDrawer("whatsapp")}>Configure</button>
      </div>
    </div>
  `;
}
