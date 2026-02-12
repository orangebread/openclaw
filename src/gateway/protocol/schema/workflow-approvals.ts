import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

export const WorkflowApprovalRequestPayloadSchema = Type.Object(
  {
    kind: NonEmptyString,
    title: NonEmptyString,
    summary: Type.Optional(Type.String()),
    details: Type.Optional(Type.Record(Type.String(), Type.String())),
    agentId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    sessionKey: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  },
  { additionalProperties: false },
);

export const WorkflowApprovalRecordSchema = Type.Object(
  {
    id: NonEmptyString,
    idempotencyKey: Type.Optional(NonEmptyString),
    request: WorkflowApprovalRequestPayloadSchema,
    createdAtMs: Type.Integer({ minimum: 0 }),
    expiresAtMs: Type.Integer({ minimum: 0 }),
    resolvedAtMs: Type.Optional(Type.Integer({ minimum: 0 })),
    decision: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    resolvedBy: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  },
  { additionalProperties: false },
);

export const WorkflowApprovalsListParamsSchema = Type.Object({}, { additionalProperties: false });

export const WorkflowApprovalsListResultSchema = Type.Object(
  {
    pending: Type.Array(WorkflowApprovalRecordSchema),
  },
  { additionalProperties: false },
);

export const WorkflowApprovalRequestParamsSchema = Type.Object(
  {
    id: Type.Optional(NonEmptyString),
    idempotencyKey: Type.Optional(NonEmptyString),
    kind: NonEmptyString,
    title: NonEmptyString,
    summary: Type.Optional(Type.String()),
    details: Type.Optional(Type.Record(Type.String(), Type.String())),
    agentId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    sessionKey: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);

export const WorkflowApprovalCreateParamsSchema = WorkflowApprovalRequestParamsSchema;

export const WorkflowApprovalWaitParamsSchema = Type.Object(
  {
    id: NonEmptyString,
    timeoutMs: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);

export const WorkflowApprovalRequestResultSchema = Type.Object(
  {
    id: NonEmptyString,
    decision: Type.Union([Type.String(), Type.Null()]),
    createdAtMs: Type.Integer({ minimum: 0 }),
    expiresAtMs: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const WorkflowApprovalResolveParamsSchema = Type.Object(
  {
    id: NonEmptyString,
    decision: NonEmptyString,
  },
  { additionalProperties: false },
);
