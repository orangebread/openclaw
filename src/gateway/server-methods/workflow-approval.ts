import type { WorkflowApprovalDecision } from "../../infra/workflow-approvals.js";
import type { WorkflowApprovalManager } from "../workflow-approval-manager.js";
import type { GatewayRequestHandlers } from "./types.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateWorkflowApprovalCreateParams,
  validateWorkflowApprovalRequestParams,
  validateWorkflowApprovalResolveParams,
  validateWorkflowApprovalWaitParams,
  validateWorkflowApprovalsListParams,
} from "../protocol/index.js";

function normalizeDecision(value: string): WorkflowApprovalDecision | null {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "approve" || trimmed === "deny") {
    return trimmed;
  }
  return null;
}

export function createWorkflowApprovalHandlers(
  manager: WorkflowApprovalManager,
): GatewayRequestHandlers {
  return {
    "workflow.approvals.list": async ({ params, respond }) => {
      if (!validateWorkflowApprovalsListParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid workflow.approvals.list params: ${formatValidationErrors(
              validateWorkflowApprovalsListParams.errors,
            )}`,
          ),
        );
        return;
      }
      const pending = await manager.listPending();
      respond(true, { pending }, undefined);
    },
    "workflow.approval.create": async ({ params, respond, context }) => {
      if (!validateWorkflowApprovalCreateParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid workflow.approval.create params: ${formatValidationErrors(
              validateWorkflowApprovalCreateParams.errors,
            )}`,
          ),
        );
        return;
      }

      const p = params as {
        id?: string;
        idempotencyKey?: string;
        kind: string;
        title: string;
        summary?: string;
        details?: Record<string, string>;
        agentId?: string | null;
        sessionKey?: string | null;
        timeoutMs?: number;
      };

      const record = await manager.request({
        id: typeof p.id === "string" ? p.id : null,
        idempotencyKey: typeof p.idempotencyKey === "string" ? p.idempotencyKey : null,
        timeoutMs: typeof p.timeoutMs === "number" ? p.timeoutMs : undefined,
        request: {
          kind: p.kind,
          title: p.title,
          summary: typeof p.summary === "string" ? p.summary : null,
          details: p.details ?? null,
          agentId: p.agentId ?? null,
          sessionKey: p.sessionKey ?? null,
        },
      });

      context.broadcast(
        "workflow.approval.requested",
        {
          id: record.id,
          idempotencyKey: record.idempotencyKey ?? null,
          request: record.request,
          createdAtMs: record.createdAtMs,
          expiresAtMs: record.expiresAtMs,
        },
        { dropIfSlow: true },
      );

      respond(
        true,
        {
          id: record.id,
          decision: null,
          createdAtMs: record.createdAtMs,
          expiresAtMs: record.expiresAtMs,
        },
        undefined,
      );
    },
    "workflow.approval.wait": async ({ params, respond }) => {
      if (!validateWorkflowApprovalWaitParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid workflow.approval.wait params: ${formatValidationErrors(
              validateWorkflowApprovalWaitParams.errors,
            )}`,
          ),
        );
        return;
      }
      const p = params as { id: string; timeoutMs?: number };
      const record = await manager.getPending(p.id);
      if (!record) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown approval id"));
        return;
      }
      const decision = await manager.waitForDecision(record);
      respond(
        true,
        {
          id: record.id,
          decision,
          createdAtMs: record.createdAtMs,
          expiresAtMs: record.expiresAtMs,
        },
        undefined,
      );
    },
    "workflow.approval.request": async ({ params, respond, context }) => {
      if (!validateWorkflowApprovalRequestParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid workflow.approval.request params: ${formatValidationErrors(
              validateWorkflowApprovalRequestParams.errors,
            )}`,
          ),
        );
        return;
      }

      const p = params as {
        id?: string;
        idempotencyKey?: string;
        kind: string;
        title: string;
        summary?: string;
        details?: Record<string, string>;
        agentId?: string | null;
        sessionKey?: string | null;
        timeoutMs?: number;
      };

      const record = await manager.request({
        id: typeof p.id === "string" ? p.id : null,
        idempotencyKey: typeof p.idempotencyKey === "string" ? p.idempotencyKey : null,
        timeoutMs: typeof p.timeoutMs === "number" ? p.timeoutMs : undefined,
        request: {
          kind: p.kind,
          title: p.title,
          summary: typeof p.summary === "string" ? p.summary : null,
          details: p.details ?? null,
          agentId: p.agentId ?? null,
          sessionKey: p.sessionKey ?? null,
        },
      });

      context.broadcast(
        "workflow.approval.requested",
        {
          id: record.id,
          idempotencyKey: record.idempotencyKey ?? null,
          request: record.request,
          createdAtMs: record.createdAtMs,
          expiresAtMs: record.expiresAtMs,
        },
        { dropIfSlow: true },
      );

      const decision = await manager.waitForDecision(record);
      respond(
        true,
        {
          id: record.id,
          decision,
          createdAtMs: record.createdAtMs,
          expiresAtMs: record.expiresAtMs,
        },
        undefined,
      );
    },
    "workflow.approval.resolve": async ({ params, respond, client, context }) => {
      if (!validateWorkflowApprovalResolveParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid workflow.approval.resolve params: ${formatValidationErrors(
              validateWorkflowApprovalResolveParams.errors,
            )}`,
          ),
        );
        return;
      }

      const p = params as { id: string; decision: string };
      const decision = normalizeDecision(p.decision);
      if (!decision) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid decision"));
        return;
      }

      const resolvedBy = client?.connect?.client?.displayName ?? client?.connect?.client?.id;
      const ok = await manager.resolve(p.id, decision, resolvedBy ?? null);
      if (!ok) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown approval id"));
        return;
      }

      context.broadcast(
        "workflow.approval.resolved",
        { id: p.id, decision, resolvedBy, ts: Date.now() },
        { dropIfSlow: true },
      );

      respond(true, { ok: true }, undefined);
    },
  };
}
