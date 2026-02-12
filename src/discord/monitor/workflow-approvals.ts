import { Button, type ButtonInteraction, type ComponentData } from "@buape/carbon";
import { ButtonStyle, Routes } from "discord-api-types/v10";
import type { OpenClawConfig } from "../../config/config.js";
import type { DiscordWorkflowApprovalConfig } from "../../config/types.discord.js";
import type { EventFrame } from "../../gateway/protocol/index.js";
import type {
  WorkflowApprovalDecision,
  WorkflowApprovalRecord,
} from "../../infra/workflow-approvals.js";
import type { RuntimeEnv } from "../../runtime.js";
import { GatewayClient } from "../../gateway/client.js";
import { logDebug, logError } from "../../logger.js";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../../utils/message-channel.js";
import { createDiscordClient } from "../send.shared.js";

const WORKFLOW_APPROVAL_KEY = "workflowapproval";

export type WorkflowApprovalRequested = {
  id: string;
  idempotencyKey?: string | null;
  request: WorkflowApprovalRecord["request"];
  createdAtMs: number;
  expiresAtMs: number;
};

export type WorkflowApprovalResolved = {
  id: string;
  decision: WorkflowApprovalDecision;
  resolvedBy?: string | null;
  ts: number;
};

type PendingApproval = {
  discordMessageId: string;
  discordChannelId: string;
  timeoutId: NodeJS.Timeout;
};

function encodeCustomIdValue(value: string): string {
  return encodeURIComponent(value);
}

function decodeCustomIdValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function buildWorkflowApprovalCustomId(
  approvalId: string,
  action: "approve" | "deny",
): string {
  return [
    `${WORKFLOW_APPROVAL_KEY}:id=${encodeCustomIdValue(approvalId)}`,
    `action=${action}`,
  ].join(";");
}

export function parseWorkflowApprovalData(
  data: ComponentData,
): { approvalId: string; action: "approve" | "deny" } | null {
  if (!data || typeof data !== "object") {
    return null;
  }
  const coerce = (value: unknown) =>
    typeof value === "string" || typeof value === "number" ? String(value) : "";
  const rawId = coerce(data.id);
  const rawAction = coerce(data.action);
  if (!rawId || !rawAction) {
    return null;
  }
  const action = rawAction as "approve" | "deny";
  if (action !== "approve" && action !== "deny") {
    return null;
  }
  return {
    approvalId: decodeCustomIdValue(rawId),
    action,
  };
}

function formatWorkflowApprovalEmbed(request: WorkflowApprovalRequested) {
  const expiresIn = Math.max(0, Math.round((request.expiresAtMs - Date.now()) / 1000));
  const details = request.request.details ?? undefined;
  const fields: Array<{ name: string; value: string; inline: boolean }> = [
    { name: "Kind", value: request.request.kind, inline: true },
    { name: "Expires", value: `${expiresIn}s`, inline: true },
  ];
  if (request.request.summary) {
    const preview =
      request.request.summary.length > 1000
        ? `${request.request.summary.slice(0, 1000)}...`
        : request.request.summary;
    fields.push({ name: "Summary", value: preview, inline: false });
  }
  if (details && typeof details === "object") {
    const entries = Object.entries(details).slice(0, 10);
    if (entries.length) {
      fields.push({
        name: "Details",
        value: entries
          .map(([k, v]) => `- **${k}**: ${v}`)
          .join("\n")
          .slice(0, 1000),
        inline: false,
      });
    }
  }
  if (request.request.agentId) {
    fields.push({ name: "Agent", value: String(request.request.agentId), inline: true });
  }
  if (request.request.sessionKey) {
    fields.push({ name: "Session", value: String(request.request.sessionKey), inline: false });
  }

  return {
    title: request.request.title || "Workflow Approval Required",
    description: "An action needs your approval.",
    color: 0xffa500,
    fields,
    footer: { text: `ID: ${request.id}` },
    timestamp: new Date().toISOString(),
  };
}

function formatResolvedEmbed(
  request: WorkflowApprovalRequested,
  decision: WorkflowApprovalDecision,
  resolvedBy?: string | null,
) {
  const decisionLabel =
    decision === "approve" ? "Approved" : decision === "deny" ? "Denied" : "Expired";
  const color = decision === "deny" ? 0xed4245 : decision === "approve" ? 0x57f287 : 0x99aab5;
  return {
    title: `Workflow Approval: ${decisionLabel}`,
    description: resolvedBy ? `Resolved by ${resolvedBy}` : "Resolved",
    color,
    fields: [
      { name: "Kind", value: request.request.kind, inline: true },
      { name: "Title", value: request.request.title, inline: false },
    ],
    footer: { text: `ID: ${request.id}` },
    timestamp: new Date().toISOString(),
  };
}

function formatExpiredEmbed(request: WorkflowApprovalRequested) {
  return formatResolvedEmbed(request, "expired", null);
}

export type DiscordWorkflowApprovalHandlerOpts = {
  token: string;
  accountId: string;
  config: DiscordWorkflowApprovalConfig;
  gatewayUrl?: string;
  cfg: OpenClawConfig;
  runtime?: RuntimeEnv;
};

export class DiscordWorkflowApprovalHandler {
  private gatewayClient: GatewayClient | null = null;
  private pending = new Map<string, PendingApproval>();
  private requestCache = new Map<string, WorkflowApprovalRequested>();
  private opts: DiscordWorkflowApprovalHandlerOpts;
  private started = false;

  constructor(opts: DiscordWorkflowApprovalHandlerOpts) {
    this.opts = opts;
  }

  private shouldHandle(request: WorkflowApprovalRequested): boolean {
    const config = this.opts.config;
    if (!config.enabled) {
      return false;
    }
    if (!config.approvers || config.approvers.length === 0) {
      return false;
    }
    if (config.kindFilter?.length) {
      const kind = request.request.kind;
      const matches = config.kindFilter.some((p) => {
        try {
          return kind.includes(p) || new RegExp(p).test(kind);
        } catch {
          return kind.includes(p);
        }
      });
      if (!matches) {
        return false;
      }
    }
    return true;
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;

    const config = this.opts.config;
    if (!config.enabled) {
      logDebug("discord workflow approvals: disabled");
      return;
    }
    if (!config.approvers || config.approvers.length === 0) {
      logDebug("discord workflow approvals: no approvers configured");
      return;
    }

    logDebug("discord workflow approvals: starting handler");

    this.gatewayClient = new GatewayClient({
      url: this.opts.gatewayUrl ?? "ws://127.0.0.1:18789",
      clientName: GATEWAY_CLIENT_NAMES.GATEWAY_CLIENT,
      clientDisplayName: "Discord Workflow Approvals",
      mode: GATEWAY_CLIENT_MODES.BACKEND,
      scopes: ["operator.approvals"],
      onEvent: (evt) => this.handleGatewayEvent(evt),
      onHelloOk: async () => {
        logDebug("discord workflow approvals: connected to gateway");
        try {
          const snapshot = await this.gatewayClient?.request<{ pending: WorkflowApprovalRecord[] }>(
            "workflow.approvals.list",
            {},
          );
          const pending = Array.isArray(snapshot?.pending) ? snapshot.pending : [];
          for (const record of pending) {
            const req: WorkflowApprovalRequested = {
              id: record.id,
              idempotencyKey: record.idempotencyKey ?? null,
              request: record.request,
              createdAtMs: record.createdAtMs,
              expiresAtMs: record.expiresAtMs,
            };
            void this.handleApprovalRequested(req);
          }
        } catch (err) {
          logError(`discord workflow approvals: failed to list pending approvals: ${String(err)}`);
        }
      },
      onConnectError: (err) => {
        logError(`discord workflow approvals: connect error: ${err.message}`);
      },
      onClose: (code, reason) => {
        logDebug(`discord workflow approvals: gateway closed: ${code} ${reason}`);
      },
    });

    this.gatewayClient.start();
  }

  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }
    this.started = false;

    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeoutId);
    }
    this.pending.clear();
    this.requestCache.clear();
    this.gatewayClient?.stop();
    this.gatewayClient = null;
    logDebug("discord workflow approvals: stopped");
  }

  private handleGatewayEvent(evt: EventFrame): void {
    if (evt.event === "workflow.approval.requested") {
      void this.handleApprovalRequested(evt.payload as WorkflowApprovalRequested);
    } else if (evt.event === "workflow.approval.resolved") {
      void this.handleApprovalResolved(evt.payload as WorkflowApprovalResolved);
    }
  }

  private async handleApprovalRequested(request: WorkflowApprovalRequested): Promise<void> {
    if (!this.shouldHandle(request)) {
      return;
    }
    if (this.pending.has(request.id)) {
      return;
    }

    logDebug(`discord workflow approvals: received request ${request.id}`);
    this.requestCache.set(request.id, request);

    const { rest, request: discordRequest } = createDiscordClient(
      { token: this.opts.token, accountId: this.opts.accountId },
      this.opts.cfg,
    );

    const embed = formatWorkflowApprovalEmbed(request);
    const components = [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: ButtonStyle.Success,
            label: "Approve",
            custom_id: buildWorkflowApprovalCustomId(request.id, "approve"),
          },
          {
            type: 2,
            style: ButtonStyle.Danger,
            label: "Deny",
            custom_id: buildWorkflowApprovalCustomId(request.id, "deny"),
          },
        ],
      },
    ];

    const approvers = this.opts.config.approvers ?? [];
    for (const approver of approvers) {
      const userId = String(approver);
      try {
        const dmChannel = (await discordRequest(
          () =>
            rest.post(Routes.userChannels(), {
              body: { recipient_id: userId },
            }) as Promise<{ id: string }>,
          "dm-channel",
        )) as { id: string };
        if (!dmChannel?.id) {
          logError(`discord workflow approvals: failed to create DM for user ${userId}`);
          continue;
        }

        const message = (await discordRequest(
          () =>
            rest.post(Routes.channelMessages(dmChannel.id), {
              body: {
                embeds: [embed],
                components,
              },
            }) as Promise<{ id: string; channel_id: string }>,
          "send-approval",
        )) as { id: string; channel_id: string };

        if (!message?.id) {
          logError(`discord workflow approvals: failed to send message to user ${userId}`);
          continue;
        }

        const timeoutMs = Math.max(0, request.expiresAtMs - Date.now());
        const timeoutId = setTimeout(() => {
          void this.handleApprovalTimeout(request.id);
        }, timeoutMs);

        this.pending.set(request.id, {
          discordMessageId: message.id,
          discordChannelId: dmChannel.id,
          timeoutId,
        });

        logDebug(`discord workflow approvals: sent approval ${request.id} to user ${userId}`);
      } catch (err) {
        logError(`discord workflow approvals: failed to notify user ${userId}: ${String(err)}`);
      }
    }
  }

  private async handleApprovalResolved(resolved: WorkflowApprovalResolved): Promise<void> {
    const pending = this.pending.get(resolved.id);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timeoutId);
    this.pending.delete(resolved.id);

    const request = this.requestCache.get(resolved.id);
    this.requestCache.delete(resolved.id);
    if (!request) {
      return;
    }

    logDebug(`discord workflow approvals: resolved ${resolved.id} with ${resolved.decision}`);
    await this.finalizeMessage(
      pending.discordChannelId,
      pending.discordMessageId,
      formatResolvedEmbed(request, resolved.decision, resolved.resolvedBy),
    );
  }

  private async handleApprovalTimeout(approvalId: string): Promise<void> {
    const pending = this.pending.get(approvalId);
    if (!pending) {
      return;
    }
    this.pending.delete(approvalId);

    const request = this.requestCache.get(approvalId);
    this.requestCache.delete(approvalId);
    if (!request) {
      return;
    }

    await this.finalizeMessage(
      pending.discordChannelId,
      pending.discordMessageId,
      formatExpiredEmbed(request),
    );
  }

  private async finalizeMessage(
    channelId: string,
    messageId: string,
    embed: ReturnType<typeof formatExpiredEmbed>,
  ): Promise<void> {
    if (!this.opts.config.cleanupAfterResolve) {
      await this.updateMessage(channelId, messageId, embed);
      return;
    }
    try {
      const { rest, request: discordRequest } = createDiscordClient(
        { token: this.opts.token, accountId: this.opts.accountId },
        this.opts.cfg,
      );
      await discordRequest(
        () => rest.delete(Routes.channelMessage(channelId, messageId)) as Promise<void>,
        "delete-approval",
      );
    } catch (err) {
      logError(`discord workflow approvals: failed to delete message: ${String(err)}`);
      await this.updateMessage(channelId, messageId, embed);
    }
  }

  private async updateMessage(
    channelId: string,
    messageId: string,
    embed: ReturnType<typeof formatExpiredEmbed>,
  ): Promise<void> {
    try {
      const { rest, request: discordRequest } = createDiscordClient(
        { token: this.opts.token, accountId: this.opts.accountId },
        this.opts.cfg,
      );
      await discordRequest(
        () =>
          rest.patch(Routes.channelMessage(channelId, messageId), {
            body: {
              embeds: [embed],
              components: [],
            },
          }),
        "update-approval",
      );
    } catch (err) {
      logError(`discord workflow approvals: failed to update message: ${String(err)}`);
    }
  }

  async resolveApproval(approvalId: string, decision: "approve" | "deny"): Promise<boolean> {
    if (!this.gatewayClient) {
      logError("discord workflow approvals: gateway client not connected");
      return false;
    }
    try {
      await this.gatewayClient.request("workflow.approval.resolve", {
        id: approvalId,
        decision,
      });
      return true;
    } catch (err) {
      logError(`discord workflow approvals: resolve failed: ${String(err)}`);
      return false;
    }
  }
}

export type WorkflowApprovalButtonContext = {
  handler: DiscordWorkflowApprovalHandler;
};

export class WorkflowApprovalButton extends Button {
  label = WORKFLOW_APPROVAL_KEY;
  customId = `${WORKFLOW_APPROVAL_KEY}:seed=1`;
  style = ButtonStyle.Primary;
  private ctx: WorkflowApprovalButtonContext;

  constructor(ctx: WorkflowApprovalButtonContext) {
    super();
    this.ctx = ctx;
  }

  async run(interaction: ButtonInteraction, data: ComponentData): Promise<void> {
    const parsed = parseWorkflowApprovalData(data);
    if (!parsed) {
      try {
        await interaction.update({
          content: "This approval is no longer valid.",
          components: [],
        });
      } catch {
        // ignore
      }
      return;
    }

    const decisionLabel = parsed.action === "approve" ? "Approved" : "Denied";
    try {
      await interaction.update({
        content: `Submitting decision: **${decisionLabel}**...`,
        components: [],
      });
    } catch {
      // ignore
    }

    const ok = await this.ctx.handler.resolveApproval(parsed.approvalId, parsed.action);
    if (!ok) {
      try {
        await interaction.followUp({
          content:
            "Failed to submit workflow approval decision. The request may have expired or already been resolved.",
          ephemeral: true,
        });
      } catch {
        // ignore
      }
    }
  }
}

export function createWorkflowApprovalButton(ctx: WorkflowApprovalButtonContext): Button {
  return new WorkflowApprovalButton(ctx);
}
