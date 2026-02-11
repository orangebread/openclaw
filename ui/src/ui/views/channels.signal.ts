import { html, nothing } from "lit";
import type { SignalStatus } from "../types.ts";
import type { ChannelsProps } from "./channels.types.ts";
import { channelIcon, renderChannelStatusPill, renderChannelToggle } from "./channels.shared.ts";

export function renderSignalCard(params: {
  props: ChannelsProps;
  signal?: SignalStatus | null;
  accountCountLabel: unknown;
}) {
  const { props, signal, accountCountLabel } = params;

  return html`
    <div class="card">
      <div class="row" style="justify-content: space-between; align-items: center;">
        <div class="card-title">${channelIcon("signal")} Signal</div>
        ${renderChannelToggle({ channelId: "signal", props })}
      </div>
      <div class="card-sub">
        ${renderChannelStatusPill(!!signal?.configured, !!signal?.lastError)}
        signal-cli status and channel configuration.
      </div>
      ${accountCountLabel}

      <div class="channel-tile-status">
        <div><span class="label">Running</span> <span>${signal?.running ? "Yes" : "No"}</span></div>
      </div>

      ${
        signal?.lastError
          ? html`<div class="callout danger" style="margin-top: 12px;">${signal.lastError}</div>`
          : nothing
      }

      <div class="channel-tile-actions">
        <button class="btn" @click=${() => props.onOpenChannelDrawer("signal")}>Configure</button>
        <button class="btn" @click=${() => props.onRefresh(true)}>Probe</button>
      </div>
    </div>
  `;
}
