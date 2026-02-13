import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

export const DoctorPlanParamsSchema = Type.Object({}, { additionalProperties: false });

export const DoctorIssueSchema = Type.Object(
  {
    code: NonEmptyString,
    level: Type.Union([Type.Literal("error"), Type.Literal("warn")]),
    message: NonEmptyString,
    source: Type.Optional(Type.String()),
    fixable: Type.Boolean(),
    fixHint: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const DoctorPlanResultSchema = Type.Object(
  {
    ok: Type.Boolean(),
    issues: Type.Array(DoctorIssueSchema),
    fixAvailable: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const DoctorFixParamsSchema = Type.Object({}, { additionalProperties: false });

export const DoctorFixResultSchema = Type.Object(
  {
    ok: Type.Boolean(),
    changed: Type.Boolean(),
    fixed: Type.Array(DoctorIssueSchema),
    restartRequired: Type.Optional(Type.Boolean()),
    backupDir: Type.Optional(Type.String()),
    error: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);
