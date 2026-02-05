import crypto from "node:crypto";
import fs from "node:fs";
import lockfile from "proper-lockfile";
import type { GatewayRequestHandlers } from "./types.js";
import { ensureAuthProfileStore, saveAuthProfileStore } from "../../agents/auth-profiles.js";
import {
  MINIMAX_CLI_PROFILE_ID,
  QWEN_CLI_PROFILE_ID,
} from "../../agents/auth-profiles/constants.js";
import { AUTH_STORE_LOCK_OPTIONS } from "../../agents/auth-profiles/constants.js";
import { resolveAuthStorePath, ensureAuthStoreFile } from "../../agents/auth-profiles/paths.js";
import { formatApiKeyPreview, normalizeApiKeyInput } from "../../commands/auth-choice.api-key.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateAuthProfilesDeleteParams,
  validateAuthProfilesGetParams,
  validateAuthProfilesUpsertApiKeyParams,
} from "../protocol/index.js";

function hashRaw(raw: string | null): string {
  return crypto
    .createHash("sha256")
    .update(raw ?? "")
    .digest("hex");
}

function readRaw(pathname: string): string | null {
  try {
    return fs.readFileSync(pathname, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return null;
    }
    return null;
  }
}

function resolveBaseHash(params: unknown): string | null {
  const raw = (params as { baseHash?: unknown })?.baseHash;
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}

function isExternalCliProfileId(profileId: string): boolean {
  return profileId === QWEN_CLI_PROFILE_ID || profileId === MINIMAX_CLI_PROFILE_ID;
}

export const authProfilesHandlers: GatewayRequestHandlers = {
  "auth.profiles.get": ({ params, respond }) => {
    if (!validateAuthProfilesGetParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid auth.profiles.get params: ${formatValidationErrors(validateAuthProfilesGetParams.errors)}`,
        ),
      );
      return;
    }

    const authPath = resolveAuthStorePath();
    const store = ensureAuthProfileStore(undefined, {
      allowKeychainPrompt: false,
    });

    // ensureAuthProfileStore may migrate legacy auth.json into auth-profiles.json under lock.
    // Compute exists/baseHash after loading so the response is consistent with on-disk state.
    const raw = readRaw(authPath);
    const exists = raw !== null;
    const baseHash = exists ? hashRaw(raw) : undefined;

    const profiles = Object.entries(store.profiles)
      .map(([id, cred]) => {
        const usage = store.usageStats?.[id] ?? {};
        const cooldownUntilRaw = usage.cooldownUntil;
        const disabledUntilRaw = usage.disabledUntil;
        const cooldownUntil =
          typeof cooldownUntilRaw === "number" &&
          Number.isFinite(cooldownUntilRaw) &&
          cooldownUntilRaw > 0
            ? Math.floor(cooldownUntilRaw)
            : undefined;
        const disabledUntil =
          typeof disabledUntilRaw === "number" &&
          Number.isFinite(disabledUntilRaw) &&
          disabledUntilRaw > 0
            ? Math.floor(disabledUntilRaw)
            : undefined;
        const disabledReason =
          typeof usage.disabledReason === "string" && usage.disabledReason.trim()
            ? usage.disabledReason.trim()
            : undefined;

        const provider = String(cred.provider ?? "").trim();
        const email =
          typeof cred.email === "string" && cred.email.trim() ? cred.email.trim() : undefined;
        if (cred.type === "api_key") {
          return {
            id,
            provider,
            type: cred.type,
            preview: formatApiKeyPreview(cred.key),
            ...(email ? { email } : {}),
            ...(cooldownUntil ? { cooldownUntil } : {}),
            ...(disabledUntil ? { disabledUntil } : {}),
            ...(disabledReason ? { disabledReason } : {}),
          };
        }
        if (cred.type === "token") {
          return {
            id,
            provider,
            type: cred.type,
            preview: formatApiKeyPreview(cred.token),
            ...(typeof cred.expires === "number" ? { expires: cred.expires } : {}),
            ...(email ? { email } : {}),
            ...(cooldownUntil ? { cooldownUntil } : {}),
            ...(disabledUntil ? { disabledUntil } : {}),
            ...(disabledReason ? { disabledReason } : {}),
          };
        }
        return {
          id,
          provider,
          type: cred.type,
          ...(typeof cred.expires === "number" ? { expires: cred.expires } : {}),
          ...(email ? { email } : {}),
          ...(cooldownUntil ? { cooldownUntil } : {}),
          ...(disabledUntil ? { disabledUntil } : {}),
          ...(disabledReason ? { disabledReason } : {}),
        };
      })
      .toSorted((a, b) =>
        a.provider === b.provider ? a.id.localeCompare(b.id) : a.provider.localeCompare(b.provider),
      );

    respond(
      true,
      {
        exists,
        ...(baseHash ? { baseHash } : {}),
        profiles,
        ...(store.order ? { order: store.order } : {}),
        ...(store.lastGood ? { lastGood: store.lastGood } : {}),
      },
      undefined,
    );
  },

  "auth.profiles.upsertApiKey": async ({ params, respond }) => {
    if (!validateAuthProfilesUpsertApiKeyParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid auth.profiles.upsertApiKey params: ${formatValidationErrors(validateAuthProfilesUpsertApiKeyParams.errors)}`,
        ),
      );
      return;
    }

    const authPath = resolveAuthStorePath();
    const existedBefore = fs.existsSync(authPath);
    ensureAuthStoreFile(authPath);

    const baseHash = resolveBaseHash(params);
    if (!baseHash && existedBefore) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "auth base hash required; re-run auth.profiles.get and retry",
        ),
      );
      return;
    }

    let release: (() => Promise<void>) | undefined;
    try {
      release = await lockfile.lock(authPath, AUTH_STORE_LOCK_OPTIONS);
      const raw = readRaw(authPath);
      if (!raw) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "auth store unreadable"));
        return;
      }
      const currentHash = hashRaw(raw);
      if (baseHash && currentHash !== baseHash) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            "auth store changed since last load; re-run auth.profiles.get and retry",
          ),
        );
        return;
      }

      const profileId = params.profileId.trim();
      const provider = params.provider.trim();
      const apiKey = normalizeApiKeyInput(params.apiKey);
      const email =
        typeof params.email === "string" && params.email.trim() ? params.email.trim() : undefined;
      if (!profileId || !provider || !apiKey) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "profileId, provider, and apiKey are required"),
        );
        return;
      }

      const store = ensureAuthProfileStore(undefined, { allowKeychainPrompt: false });
      store.profiles[profileId] = {
        type: "api_key",
        provider,
        key: apiKey,
        ...(email ? { email } : {}),
      };
      saveAuthProfileStore(store);

      const nextRaw = readRaw(authPath);
      const nextHash = hashRaw(nextRaw);
      respond(true, { baseHash: nextHash }, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `auth store update failed: ${err instanceof Error ? err.message : String(err)}`,
          {
            retryable: true,
          },
        ),
      );
    } finally {
      if (release) {
        try {
          await release();
        } catch {
          // ignore unlock errors
        }
      }
    }
  },

  "auth.profiles.delete": async ({ params, respond }) => {
    if (!validateAuthProfilesDeleteParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid auth.profiles.delete params: ${formatValidationErrors(validateAuthProfilesDeleteParams.errors)}`,
        ),
      );
      return;
    }

    const authPath = resolveAuthStorePath();
    const existedBefore = fs.existsSync(authPath);
    ensureAuthStoreFile(authPath);

    const baseHash = resolveBaseHash(params);
    if (!baseHash && existedBefore) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "auth base hash required; re-run auth.profiles.get and retry",
        ),
      );
      return;
    }

    let release: (() => Promise<void>) | undefined;
    try {
      release = await lockfile.lock(authPath, AUTH_STORE_LOCK_OPTIONS);
      const raw = readRaw(authPath);
      if (!raw) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "auth store unreadable"));
        return;
      }
      const currentHash = hashRaw(raw);
      if (baseHash && currentHash !== baseHash) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            "auth store changed since last load; re-run auth.profiles.get and retry",
          ),
        );
        return;
      }

      const profileId = String(params.profileId ?? "").trim();
      if (!profileId) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "profileId required"));
        return;
      }

      const store = ensureAuthProfileStore(undefined, { allowKeychainPrompt: false });
      let mutated = false;
      const externalCliProfile = isExternalCliProfileId(profileId);

      if (externalCliProfile) {
        store.usageStats ??= {};
        const existingUsage = store.usageStats[profileId] ?? {};
        store.usageStats[profileId] = {
          ...existingUsage,
          externalSyncDisabled: true,
          externalSyncDisabledAt: Date.now(),
        };
        mutated = true;
      }

      if (store.profiles[profileId]) {
        delete store.profiles[profileId];
        mutated = true;
      }
      if (!externalCliProfile && store.usageStats?.[profileId]) {
        delete store.usageStats[profileId];
        mutated = true;
      }
      if (store.lastGood) {
        for (const [provider, lastProfileId] of Object.entries(store.lastGood)) {
          if (lastProfileId === profileId) {
            delete store.lastGood[provider];
            mutated = true;
          }
        }
      }
      if (store.order) {
        for (const [provider, order] of Object.entries(store.order)) {
          const filtered = order.filter((id) => id !== profileId);
          if (filtered.length !== order.length) {
            mutated = true;
            if (filtered.length > 0) {
              store.order[provider] = filtered;
            } else {
              delete store.order[provider];
            }
          }
        }
      }

      if (mutated) {
        saveAuthProfileStore(store);
      }

      const nextRaw = readRaw(authPath);
      const nextHash = hashRaw(nextRaw);
      respond(true, { baseHash: nextHash }, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `auth store update failed: ${err instanceof Error ? err.message : String(err)}`,
          { retryable: true },
        ),
      );
    } finally {
      if (release) {
        try {
          await release();
        } catch {
          // ignore unlock errors
        }
      }
    }
  },
};
