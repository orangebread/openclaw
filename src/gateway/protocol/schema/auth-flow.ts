import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

export const AuthFlowModeSchema = Type.Union([Type.Literal("local"), Type.Literal("remote")]);

export const AuthFlowMethodKindSchema = Type.Union([
  Type.Literal("oauth"),
  Type.Literal("api_key_manual"),
  Type.Literal("token_paste"),
  Type.Literal("custom"),
]);

export const AuthFlowMethodSchema = Type.Object(
  {
    providerId: NonEmptyString,
    providerLabel: Type.Optional(Type.String()),
    methodId: NonEmptyString,
    label: NonEmptyString,
    hint: Type.Optional(Type.String()),
    kind: AuthFlowMethodKindSchema,
    supportsRemote: Type.Boolean(),
    supportsRevoke: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const AuthFlowProviderSchema = Type.Object(
  {
    providerId: NonEmptyString,
    label: NonEmptyString,
    methods: Type.Array(AuthFlowMethodSchema),
  },
  { additionalProperties: false },
);

export const AuthFlowListParamsSchema = Type.Object({}, { additionalProperties: false });

export const AuthFlowListResultSchema = Type.Object(
  {
    quickConnect: Type.Array(AuthFlowMethodSchema),
    providers: Type.Array(AuthFlowProviderSchema),
  },
  { additionalProperties: false },
);

export const AuthFlowStartParamsSchema = Type.Object(
  {
    providerId: NonEmptyString,
    methodId: NonEmptyString,
    mode: AuthFlowModeSchema,
  },
  { additionalProperties: false },
);

export const AuthFlowStepOptionSchema = Type.Object(
  {
    value: Type.Unknown(),
    label: NonEmptyString,
    hint: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const AuthFlowStepSchema = Type.Union([
  Type.Object(
    {
      id: NonEmptyString,
      type: Type.Literal("note"),
      title: Type.Optional(Type.String()),
      message: Type.Optional(Type.String()),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      id: NonEmptyString,
      type: Type.Literal("openUrl"),
      title: Type.Optional(Type.String()),
      url: NonEmptyString,
      message: Type.Optional(Type.String()),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      id: NonEmptyString,
      type: Type.Literal("text"),
      title: Type.Optional(Type.String()),
      message: NonEmptyString,
      initialValue: Type.Optional(Type.String()),
      placeholder: Type.Optional(Type.String()),
      sensitive: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      id: NonEmptyString,
      type: Type.Literal("confirm"),
      title: Type.Optional(Type.String()),
      message: NonEmptyString,
      initialValue: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      id: NonEmptyString,
      type: Type.Literal("select"),
      title: Type.Optional(Type.String()),
      message: NonEmptyString,
      options: Type.Array(AuthFlowStepOptionSchema),
      initialValue: Type.Optional(Type.Unknown()),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      id: NonEmptyString,
      type: Type.Literal("multiselect"),
      title: Type.Optional(Type.String()),
      message: NonEmptyString,
      options: Type.Array(AuthFlowStepOptionSchema),
      initialValue: Type.Optional(Type.Array(Type.Unknown())),
    },
    { additionalProperties: false },
  ),
]);

export const AuthFlowSessionStatusSchema = Type.Union([
  Type.Literal("running"),
  Type.Literal("done"),
  Type.Literal("cancelled"),
  Type.Literal("error"),
]);

export const AuthFlowCompleteProfileSchema = Type.Object(
  {
    id: NonEmptyString,
    provider: NonEmptyString,
    type: NonEmptyString,
    preview: Type.Optional(Type.String()),
    email: Type.Optional(Type.String()),
    expires: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export const AuthFlowCompletePayloadSchema = Type.Object(
  {
    profiles: Type.Array(AuthFlowCompleteProfileSchema),
    configPatch: Type.Optional(Type.Unknown()),
    defaultModel: Type.Optional(Type.String()),
    notes: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false },
);

export const AuthFlowStartResultSchema = Type.Object(
  {
    sessionId: NonEmptyString,
    done: Type.Boolean(),
    step: Type.Optional(AuthFlowStepSchema),
    status: AuthFlowSessionStatusSchema,
    error: Type.Optional(Type.String()),
    result: Type.Optional(AuthFlowCompletePayloadSchema),
  },
  { additionalProperties: false },
);

export const AuthFlowAnswerSchema = Type.Object(
  {
    stepId: NonEmptyString,
    value: Type.Unknown(),
  },
  { additionalProperties: false },
);

export const AuthFlowNextParamsSchema = Type.Object(
  {
    sessionId: NonEmptyString,
    answer: Type.Optional(AuthFlowAnswerSchema),
  },
  { additionalProperties: false },
);

export const AuthFlowNextResultSchema = Type.Object(
  {
    done: Type.Boolean(),
    step: Type.Optional(AuthFlowStepSchema),
    status: AuthFlowSessionStatusSchema,
    error: Type.Optional(Type.String()),
    result: Type.Optional(AuthFlowCompletePayloadSchema),
  },
  { additionalProperties: false },
);

export const AuthFlowCurrentParamsSchema = Type.Object({}, { additionalProperties: false });

export const AuthFlowCurrentResultSchema = Type.Object(
  {
    running: Type.Boolean(),
    owned: Type.Optional(Type.Boolean()),
    sessionId: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const AuthFlowCancelCurrentParamsSchema = Type.Object({}, { additionalProperties: false });

export const AuthFlowCancelCurrentResultSchema = Type.Object(
  {
    cancelled: Type.Boolean(),
  },
  { additionalProperties: false },
);
