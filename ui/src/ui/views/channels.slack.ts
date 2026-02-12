import { html, nothing } from "lit";
import type { SlackStatus } from "../types.ts";
import type { ChannelsProps } from "./channels.types.ts";
import {
  channelHealthClass,
  channelIcon,
  renderCardStatusSummary,
  renderChannelStatusPill,
  renderChannelToggle,
} from "./channels.shared.ts";

export function renderSlackCard(params: {
  props: ChannelsProps;
  slack?: SlackStatus | null;
  accountCountLabel: unknown;
}) {
  const { props, slack, accountCountLabel } = params;
  const configured = !!slack?.configured;
  const running = !!slack?.running;
  const hasError = !!slack?.lastError;

  return html`
    <div class="card ${channelHealthClass(configured, running, hasError)}">
      <div class="row" style="justify-content: space-between; align-items: center;">
        <div class="card-title">${channelIcon("slack")} Slack</div>
        ${renderChannelToggle({ channelId: "slack", props })}
      </div>
      <div class="card-sub">
        ${renderChannelStatusPill(configured, hasError)}
      </div>
      ${accountCountLabel}
      ${renderCardStatusSummary({ configured, running, hasError, lastStartAt: slack?.lastStartAt, lastProbeAt: slack?.lastProbeAt })}

      ${
        hasError
          ? html`<div class="callout danger" style="margin-top: 8px;">${slack.lastError}</div>`
          : nothing
      }

      <div class="channel-tile-actions">
        <button class="btn" @click=${() => props.onOpenChannelDrawer("slack")}>Configure</button>
        <button class="btn" @click=${() => props.onRefresh(true)}>Probe</button>
      </div>
    </div>
  `;
}
