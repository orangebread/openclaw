import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

export const DataImportApplyParamsSchema = Type.Object(
  { uploadId: NonEmptyString },
  { additionalProperties: false },
);

export const DataImportApplyResultSchema = Type.Object(
  {
    ok: Type.Boolean(),
    backupDir: Type.Optional(Type.String()),
    error: Type.Optional(Type.String()),
    restartRequired: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const DataImportCancelParamsSchema = Type.Object(
  { uploadId: NonEmptyString },
  { additionalProperties: false },
);

export const DataImportCancelResultSchema = Type.Object(
  { ok: Type.Boolean() },
  { additionalProperties: false },
);
