import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

export const AuthProfilesGetParamsSchema = Type.Object({}, { additionalProperties: false });

export const AuthProfilesProfileSummarySchema = Type.Object(
  {
    id: NonEmptyString,
    provider: NonEmptyString,
    type: NonEmptyString,
    preview: Type.Optional(Type.String()),
    email: Type.Optional(Type.String()),
    expires: Type.Optional(Type.Integer({ minimum: 0 })),
    cooldownUntil: Type.Optional(Type.Integer({ minimum: 0 })),
    disabledUntil: Type.Optional(Type.Integer({ minimum: 0 })),
    disabledReason: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const AuthProfilesGetResultSchema = Type.Object(
  {
    exists: Type.Boolean(),
    baseHash: Type.Optional(NonEmptyString),
    profiles: Type.Array(AuthProfilesProfileSummarySchema),
    order: Type.Optional(Type.Record(NonEmptyString, Type.Array(NonEmptyString))),
    lastGood: Type.Optional(Type.Record(NonEmptyString, NonEmptyString)),
  },
  { additionalProperties: false },
);

export const AuthProfilesUpsertApiKeyParamsSchema = Type.Object(
  {
    baseHash: Type.Optional(NonEmptyString),
    profileId: NonEmptyString,
    provider: NonEmptyString,
    apiKey: NonEmptyString,
    email: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const AuthProfilesDeleteParamsSchema = Type.Object(
  {
    baseHash: Type.Optional(NonEmptyString),
    profileId: NonEmptyString,
  },
  { additionalProperties: false },
);

export const AuthProfilesMutationResultSchema = Type.Object(
  {
    baseHash: NonEmptyString,
  },
  { additionalProperties: false },
);
