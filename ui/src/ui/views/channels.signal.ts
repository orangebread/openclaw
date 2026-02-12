import { html, nothing } from "lit";
import type { SignalStatus } from "../types.ts";
import type { ChannelsProps } from "./channels.types.ts";
import {
  channelHealthClass,
  channelIcon,
  renderCardStatusSummary,
  renderChannelStatusPill,
  renderChannelToggle,
} from "./channels.shared.ts";

export function renderSignalCard(params: {
  props: ChannelsProps;
  signal?: SignalStatus | null;
  accountCountLabel: unknown;
}) {
  const { props, signal, accountCountLabel } = params;
  const configured = !!signal?.configured;
  const running = !!signal?.running;
  const hasError = !!signal?.lastError;

  return html`
    <div class="card ${channelHealthClass(configured, running, hasError)}">
      <div class="row" style="justify-content: space-between; align-items: center;">
        <div class="card-title">${channelIcon("signal")} Signal</div>
        ${renderChannelToggle({ channelId: "signal", props })}
      </div>
      <div class="card-sub">
        ${renderChannelStatusPill(configured, hasError)}
      </div>
      ${accountCountLabel}
      ${renderCardStatusSummary({ configured, running, hasError, lastStartAt: signal?.lastStartAt, lastProbeAt: signal?.lastProbeAt })}

      ${
        hasError
          ? html`<div class="callout danger" style="margin-top: 8px;">${signal.lastError}</div>`
          : nothing
      }

      <div class="channel-tile-actions">
        <button class="btn" @click=${() => props.onOpenChannelDrawer("signal")}>Configure</button>
        <button class="btn" @click=${() => props.onRefresh(true)}>Probe</button>
      </div>
    </div>
  `;
}
