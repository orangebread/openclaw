import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

export const AgentModelConfigSchema = Type.Union(
  [
    NonEmptyString,
    Type.Object(
      {
        primary: Type.Optional(NonEmptyString),
        fallbacks: Type.Optional(Type.Array(NonEmptyString)),
      },
      { additionalProperties: false },
    ),
  ],
  { additionalProperties: false },
);

export const AgentsProfileGetParamsSchema = Type.Object({}, { additionalProperties: false });

export const AgentProfileEntrySchema = Type.Object(
  {
    id: NonEmptyString,
    name: Type.Optional(Type.String()),
    model: Type.Optional(AgentModelConfigSchema),
    authProfileId: Type.Optional(NonEmptyString),
    imageModel: Type.Optional(AgentModelConfigSchema),
    imageAuthProfileId: Type.Optional(NonEmptyString),
    effectiveTextProvider: NonEmptyString,
    effectiveTextModel: NonEmptyString,
    effectiveImageProvider: Type.Optional(NonEmptyString),
    effectiveImageModel: Type.Optional(NonEmptyString),
    effectiveImageAuthMode: Type.Union(
      [Type.Literal("auto"), Type.Literal("locked"), Type.Literal("inherited")],
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const AgentsProfileGetResultSchema = Type.Object(
  {
    baseHash: Type.Optional(NonEmptyString),
    agents: Type.Array(AgentProfileEntrySchema),
  },
  { additionalProperties: false },
);

export const AgentProfileUpdateUnsetKeySchema = Type.Union(
  [
    Type.Literal("model"),
    Type.Literal("authProfileId"),
    Type.Literal("imageModel"),
    Type.Literal("imageAuthProfileId"),
  ],
  { additionalProperties: false },
);

export const AgentsProfileUpdateSetSchema = Type.Object(
  {
    model: Type.Optional(AgentModelConfigSchema),
    authProfileId: Type.Optional(NonEmptyString),
    imageModel: Type.Optional(AgentModelConfigSchema),
    imageAuthProfileId: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export const AgentsProfileUpdateParamsSchema = Type.Object(
  {
    baseHash: Type.Optional(NonEmptyString),
    agentId: NonEmptyString,
    set: Type.Optional(AgentsProfileUpdateSetSchema),
    unset: Type.Optional(Type.Array(AgentProfileUpdateUnsetKeySchema)),
  },
  { additionalProperties: false },
);

export const AgentsProfileUpdateResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    baseHash: NonEmptyString,
    agent: AgentProfileEntrySchema,
  },
  { additionalProperties: false },
);
