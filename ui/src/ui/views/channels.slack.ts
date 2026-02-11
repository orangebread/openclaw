import { html, nothing } from "lit";
import type { SlackStatus } from "../types.ts";
import type { ChannelsProps } from "./channels.types.ts";
import { channelIcon, renderChannelStatusPill, renderChannelToggle } from "./channels.shared.ts";

export function renderSlackCard(params: {
  props: ChannelsProps;
  slack?: SlackStatus | null;
  accountCountLabel: unknown;
}) {
  const { props, slack, accountCountLabel } = params;

  return html`
    <div class="card">
      <div class="row" style="justify-content: space-between; align-items: center;">
        <div class="card-title">${channelIcon("slack")} Slack</div>
        ${renderChannelToggle({ channelId: "slack", props })}
      </div>
      <div class="card-sub">
        ${renderChannelStatusPill(!!slack?.configured, !!slack?.lastError)}
        Socket mode status and channel configuration.
      </div>
      ${accountCountLabel}

      <div class="channel-tile-status">
        <div><span class="label">Running</span> <span>${slack?.running ? "Yes" : "No"}</span></div>
      </div>

      ${
        slack?.lastError
          ? html`<div class="callout danger" style="margin-top: 12px;">${slack.lastError}</div>`
          : nothing
      }

      <div class="channel-tile-actions">
        <button class="btn" @click=${() => props.onOpenChannelDrawer("slack")}>Configure</button>
        <button class="btn" @click=${() => props.onRefresh(true)}>Probe</button>
      </div>
    </div>
  `;
}
