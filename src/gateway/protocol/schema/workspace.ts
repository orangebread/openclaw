import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

export const WorkspaceListParamsSchema = Type.Object(
  {
    agentId: NonEmptyString,
    dir: NonEmptyString,
    maxDepth: Type.Optional(Type.Integer({ minimum: 0, maximum: 32 })),
    includeHidden: Type.Optional(Type.Boolean()),
    maxEntries: Type.Optional(Type.Integer({ minimum: 1, maximum: 100_000 })),
    cursor: Type.Optional(Type.Union([Type.Null(), NonEmptyString])),
  },
  { additionalProperties: false },
);

export const WorkspaceEntrySchema = Type.Object(
  {
    path: NonEmptyString,
    kind: Type.Union([Type.Literal("file"), Type.Literal("dir")]),
    sizeBytes: Type.Optional(Type.Integer({ minimum: 0 })),
    modifiedAtMs: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const WorkspaceListResultSchema = Type.Object(
  {
    dir: NonEmptyString,
    cursor: Type.Optional(Type.Union([Type.Null(), NonEmptyString])),
    entries: Type.Array(WorkspaceEntrySchema),
  },
  { additionalProperties: false },
);

export const WorkspaceReadParamsSchema = Type.Object(
  {
    agentId: NonEmptyString,
    path: NonEmptyString,
    maxBytes: Type.Optional(Type.Integer({ minimum: 1, maximum: 100_000_000 })),
  },
  { additionalProperties: false },
);

export const WorkspaceReadResultSchema = Type.Object(
  {
    path: NonEmptyString,
    contentType: NonEmptyString,
    truncated: Type.Boolean(),
    content: Type.String(),
  },
  { additionalProperties: false },
);

export const WorkspaceWriteParamsSchema = Type.Object(
  {
    agentId: NonEmptyString,
    path: NonEmptyString,
    content: Type.String({ maxLength: 500_000 }),
    createDirs: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const WorkspaceWriteResultSchema = Type.Object(
  {
    path: NonEmptyString,
    sizeBytes: Type.Integer({ minimum: 0 }),
    created: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const WorkspaceDeleteParamsSchema = Type.Object(
  {
    agentId: NonEmptyString,
    path: NonEmptyString,
  },
  { additionalProperties: false },
);

export const WorkspaceDeleteResultSchema = Type.Object(
  {
    path: NonEmptyString,
    deleted: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const WorkspaceUploadParamsSchema = Type.Object(
  {
    agentId: NonEmptyString,
    dir: NonEmptyString,
    fileName: NonEmptyString,
    content: Type.String(),
    mimeType: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export const WorkspaceUploadResultSchema = Type.Object(
  {
    path: NonEmptyString,
    sizeBytes: Type.Integer({ minimum: 0 }),
    mimeType: NonEmptyString,
  },
  { additionalProperties: false },
);
