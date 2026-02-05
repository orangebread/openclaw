import fs from "node:fs";
import path from "node:path";
import lockfile from "proper-lockfile";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";
import { resolveAgentDir, resolveAgentConfig } from "../../agents/agent-scope.js";
import { ensureAuthProfileStore } from "../../agents/auth-profiles.js";
import {
  normalizeProviderId,
  parseModelRef,
  resolveDefaultModelForAgent,
} from "../../agents/model-selection.js";
import { resolveImageModelConfigForTool } from "../../agents/tools/image-tool.js";
import {
  readConfigFileSnapshot,
  resolveConfigSnapshotHash,
  writeConfigFile,
  type OpenClawConfig,
} from "../../config/config.js";
import { validateConfigObjectWithPlugins } from "../../config/validation.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateAgentsProfileGetParams,
  validateAgentsProfileUpdateParams,
} from "../protocol/index.js";
import { listAgentsForGateway } from "../session-utils.js";

type AgentModelConfig =
  | string
  | {
      primary?: string;
      fallbacks?: string[];
    };

const CONFIG_WRITE_LOCK_OPTIONS = {
  retries: {
    retries: 10,
    factor: 2,
    minTimeout: 100,
    maxTimeout: 5_000,
    randomize: true,
  },
  stale: 30_000,
} as const;

type AgentProfileEntry = {
  id: string;
  name?: string;
  model?: AgentModelConfig;
  authProfileId?: string;
  imageModel?: AgentModelConfig;
  imageAuthProfileId?: string;
  effectiveTextProvider: string;
  effectiveTextModel: string;
  effectiveImageProvider?: string;
  effectiveImageModel?: string;
  effectiveImageAuthMode: "auto" | "locked" | "inherited";
};

function resolveBaseHash(params: unknown): string | null {
  const raw = (params as { baseHash?: unknown })?.baseHash;
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}

function requireConfigBaseHash(
  params: unknown,
  snapshot: Awaited<ReturnType<typeof readConfigFileSnapshot>>,
  respond: RespondFn,
): boolean {
  if (!snapshot.exists) {
    return true;
  }
  const snapshotHash = resolveConfigSnapshotHash(snapshot);
  if (!snapshotHash) {
    respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        "config base hash unavailable; re-run agents.profile.get and retry",
      ),
    );
    return false;
  }
  const baseHash = resolveBaseHash(params);
  if (!baseHash) {
    respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        "config base hash required; re-run agents.profile.get and retry",
      ),
    );
    return false;
  }
  if (baseHash !== snapshotHash) {
    respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        "config changed since last load; re-run agents.profile.get and retry",
      ),
    );
    return false;
  }
  return true;
}

function ensureConfigWriteLockFile(configPath: string): string {
  const dir = path.dirname(configPath);
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch {
    // best-effort
  }
  const lockTarget = path.join(dir, ".openclaw-config.write.lock");
  if (!fs.existsSync(lockTarget)) {
    try {
      fs.writeFileSync(lockTarget, "", { encoding: "utf8", mode: 0o600 });
    } catch {
      // best-effort
    }
  }
  return lockTarget;
}

function normalizeModelConfig(value: AgentModelConfig): AgentModelConfig {
  if (typeof value === "string") {
    return value.trim();
  }
  const primary = typeof value.primary === "string" ? value.primary.trim() : "";
  const fallbacks = Array.isArray(value.fallbacks)
    ? value.fallbacks.map((v) => String(v ?? "").trim()).filter(Boolean)
    : undefined;
  return {
    ...(primary ? { primary } : {}),
    ...(fallbacks && fallbacks.length > 0 ? { fallbacks } : {}),
  };
}

function ensureAgentsList(
  cfg: OpenClawConfig,
): NonNullable<NonNullable<OpenClawConfig["agents"]>["list"]> {
  const existing = cfg.agents?.list;
  if (Array.isArray(existing)) {
    return existing;
  }
  const nextAgents = {
    ...cfg.agents,
    list: [] as NonNullable<NonNullable<OpenClawConfig["agents"]>["list"]>,
  };
  cfg.agents = nextAgents;
  return nextAgents.list;
}

function buildAgentProfileEntry(cfg: OpenClawConfig, agentId: string): AgentProfileEntry {
  const resolvedCfg = resolveAgentConfig(cfg, agentId);
  const textRef = resolveDefaultModelForAgent({ cfg, agentId });
  const effectiveTextProvider = textRef.provider;
  const effectiveTextModel = `${textRef.provider}/${textRef.model}`;

  const agentDir = resolveAgentDir(cfg, agentId);
  const imageConfig = resolveImageModelConfigForTool({ cfg, agentId, agentDir });
  const imagePrimary = imageConfig?.primary?.trim() || "";
  const parsedImage = imagePrimary ? parseModelRef(imagePrimary, effectiveTextProvider) : null;
  const effectiveImageProvider = parsedImage?.provider;
  const effectiveImageModel = parsedImage
    ? `${parsedImage.provider}/${parsedImage.model}`
    : undefined;

  const authProfileId =
    typeof resolvedCfg?.authProfileId === "string" && resolvedCfg.authProfileId.trim()
      ? resolvedCfg.authProfileId.trim()
      : undefined;
  const imageAuthProfileId =
    typeof resolvedCfg?.imageAuthProfileId === "string" && resolvedCfg.imageAuthProfileId.trim()
      ? resolvedCfg.imageAuthProfileId.trim()
      : undefined;

  const effectiveImageAuthMode: AgentProfileEntry["effectiveImageAuthMode"] = (() => {
    if (imageAuthProfileId) {
      return "locked";
    }
    if (!authProfileId) {
      return "auto";
    }
    if (
      effectiveImageProvider &&
      normalizeProviderId(effectiveImageProvider) === normalizeProviderId(effectiveTextProvider)
    ) {
      return "inherited";
    }
    return "auto";
  })();

  const model = resolvedCfg?.model as AgentModelConfig | undefined;
  const imageModel = resolvedCfg?.imageModel as AgentModelConfig | undefined;

  return {
    id: agentId,
    ...(resolvedCfg?.name ? { name: resolvedCfg.name } : {}),
    ...(model ? { model } : {}),
    ...(authProfileId ? { authProfileId } : {}),
    ...(imageModel ? { imageModel } : {}),
    ...(imageAuthProfileId ? { imageAuthProfileId } : {}),
    effectiveTextProvider,
    effectiveTextModel,
    ...(effectiveImageProvider ? { effectiveImageProvider } : {}),
    ...(effectiveImageModel ? { effectiveImageModel } : {}),
    effectiveImageAuthMode,
  };
}

function resolveUnusableStatus(
  store: ReturnType<typeof ensureAuthProfileStore>,
  profileId: string,
): {
  unavailable: boolean;
  cooldownUntil?: number;
  disabledUntil?: number;
  disabledReason?: string;
} {
  const stats = store.usageStats?.[profileId] ?? {};
  const cooldownUntilRaw = stats.cooldownUntil;
  const disabledUntilRaw = stats.disabledUntil;
  const now = Date.now();
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
    typeof stats.disabledReason === "string" && stats.disabledReason.trim()
      ? stats.disabledReason.trim()
      : undefined;
  const maxUntil = Math.max(cooldownUntil ?? 0, disabledUntil ?? 0);
  return {
    unavailable: maxUntil > 0 ? now < maxUntil : false,
    ...(cooldownUntil ? { cooldownUntil } : {}),
    ...(disabledUntil ? { disabledUntil } : {}),
    ...(disabledReason ? { disabledReason } : {}),
  };
}

function resolveModelPrimaryProvider(params: { cfg: OpenClawConfig; agentId: string }): string {
  const resolved = resolveDefaultModelForAgent({ cfg: params.cfg, agentId: params.agentId });
  return resolved.provider;
}

function validateLockedAuthProfile(params: {
  store: ReturnType<typeof ensureAuthProfileStore>;
  profileId: string;
  expectedProvider: string;
  respond: RespondFn;
}): boolean {
  const profile = params.store.profiles[params.profileId];
  if (!profile) {
    params.respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        `Auth profile "${params.profileId}" not found. Unlock/change the profile or select a valid profile.`,
      ),
    );
    return false;
  }
  const actualProvider = normalizeProviderId(profile.provider);
  const expectedProvider = normalizeProviderId(params.expectedProvider);
  if (actualProvider !== expectedProvider) {
    params.respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        `Auth profile "${params.profileId}" is for provider "${actualProvider}", not "${expectedProvider}".`,
      ),
    );
    return false;
  }
  const status = resolveUnusableStatus(params.store, params.profileId);
  if (status.unavailable) {
    params.respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        `Auth profile "${params.profileId}" is currently unavailable (cooldown/disabled). Unlock/change the profile or wait until the cooldown expires.`,
        { details: status },
      ),
    );
    return false;
  }
  return true;
}

function validateLockedFallbackProviders(params: {
  model: AgentModelConfig | undefined;
  lockedProvider: string;
  respond: RespondFn;
}): boolean {
  if (!params.model || typeof params.model === "string") {
    return true;
  }
  const primaryProvider = normalizeProviderId(params.lockedProvider);
  const fallbacks = Array.isArray(params.model.fallbacks) ? params.model.fallbacks : [];
  for (const raw of fallbacks) {
    const parsed = parseModelRef(raw, primaryProvider);
    if (!parsed) {
      continue;
    }
    const fallbackProvider = normalizeProviderId(parsed.provider);
    if (fallbackProvider !== primaryProvider) {
      params.respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `Agent is locked to provider "${primaryProvider}" via authProfileId; fallback to "${fallbackProvider}" is not allowed (unlock/change the profile or wait for cooldown to expire).`,
        ),
      );
      return false;
    }
  }
  return true;
}

export const agentProfilesHandlers: GatewayRequestHandlers = {
  "agents.profile.get": async ({ params, respond }) => {
    if (!validateAgentsProfileGetParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid agents.profile.get params: ${formatValidationErrors(validateAgentsProfileGetParams.errors)}`,
        ),
      );
      return;
    }

    const snapshot = await readConfigFileSnapshot();
    if (!snapshot.valid) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid config; fix before editing agent profiles"),
      );
      return;
    }

    const baseHash = resolveConfigSnapshotHash(snapshot) ?? undefined;
    const listed = listAgentsForGateway(snapshot.config).agents;
    const agents = listed.map((agent) => buildAgentProfileEntry(snapshot.config, agent.id));

    respond(true, { ...(baseHash ? { baseHash } : {}), agents }, undefined);
  },

  "agents.profile.update": async ({ params, respond }) => {
    if (!validateAgentsProfileUpdateParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid agents.profile.update params: ${formatValidationErrors(validateAgentsProfileUpdateParams.errors)}`,
        ),
      );
      return;
    }

    const initialSnapshot = await readConfigFileSnapshot();
    const lockTarget = ensureConfigWriteLockFile(initialSnapshot.path);
    let release: (() => Promise<void>) | undefined;
    try {
      release = await lockfile.lock(lockTarget, CONFIG_WRITE_LOCK_OPTIONS);
      const snapshot = await readConfigFileSnapshot();
      if (!requireConfigBaseHash(params, snapshot, respond)) {
        return;
      }
      if (!snapshot.valid) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            "invalid config; fix before editing agent profiles",
          ),
        );
        return;
      }

      const agentIdValue = (params as { agentId?: unknown }).agentId;
      if (typeof agentIdValue !== "string" || !agentIdValue.trim()) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "agentId required"));
        return;
      }
      const agentId = normalizeAgentId(agentIdValue);

      const cfg = snapshot.config;
      const list = ensureAgentsList(cfg);
      let entry = list.find((a) => a?.id && normalizeAgentId(String(a.id)) === agentId);
      if (!entry) {
        entry = { id: agentId };
        list.push(entry);
      }

      const unsetRaw = (params as { unset?: unknown }).unset;
      const unsetKeys = Array.isArray(unsetRaw)
        ? new Set(unsetRaw.map((v) => String(v ?? "").trim()).filter(Boolean))
        : new Set<string>();
      const set = (params as { set?: unknown }).set as
        | {
            model?: AgentModelConfig;
            authProfileId?: string;
            imageModel?: AgentModelConfig;
            imageAuthProfileId?: string;
          }
        | undefined;

      if (unsetKeys.has("model")) {
        delete (entry as { model?: unknown }).model;
      }
      if (unsetKeys.has("authProfileId")) {
        delete (entry as { authProfileId?: unknown }).authProfileId;
      }
      if (unsetKeys.has("imageModel")) {
        delete (entry as { imageModel?: unknown }).imageModel;
      }
      if (unsetKeys.has("imageAuthProfileId")) {
        delete (entry as { imageAuthProfileId?: unknown }).imageAuthProfileId;
      }

      if (set && "model" in set && set.model !== undefined) {
        const normalized = normalizeModelConfig(set.model);
        const hasValue =
          typeof normalized === "string"
            ? Boolean(normalized.trim())
            : Boolean(normalized.primary?.trim() || (normalized.fallbacks?.length ?? 0) > 0);
        if (!hasValue) {
          respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "model is empty"));
          return;
        }
        (entry as { model?: unknown }).model = normalized;
      }
      if (set && "imageModel" in set && set.imageModel !== undefined) {
        const normalized = normalizeModelConfig(set.imageModel);
        const hasValue =
          typeof normalized === "string"
            ? Boolean(normalized.trim())
            : Boolean(normalized.primary?.trim() || (normalized.fallbacks?.length ?? 0) > 0);
        if (!hasValue) {
          respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "imageModel is empty"));
          return;
        }
        (entry as { imageModel?: unknown }).imageModel = normalized;
      }
      if (set && "authProfileId" in set && typeof set.authProfileId === "string") {
        (entry as { authProfileId?: unknown }).authProfileId = set.authProfileId.trim();
      }
      if (set && "imageAuthProfileId" in set && typeof set.imageAuthProfileId === "string") {
        (entry as { imageAuthProfileId?: unknown }).imageAuthProfileId =
          set.imageAuthProfileId.trim();
      }

      const store = ensureAuthProfileStore(undefined, { allowKeychainPrompt: false });
      const expectedTextProvider = resolveModelPrimaryProvider({ cfg, agentId });
      const authProfileId =
        typeof (entry as { authProfileId?: unknown }).authProfileId === "string"
          ? String((entry as { authProfileId?: unknown }).authProfileId).trim()
          : "";
      if (authProfileId) {
        if (
          !validateLockedAuthProfile({
            store,
            profileId: authProfileId,
            expectedProvider: expectedTextProvider,
            respond,
          })
        ) {
          return;
        }
        if (
          !validateLockedFallbackProviders({
            model: (entry as { model?: AgentModelConfig }).model,
            lockedProvider: expectedTextProvider,
            respond,
          })
        ) {
          return;
        }
      }

      const imageAuthProfileId =
        typeof (entry as { imageAuthProfileId?: unknown }).imageAuthProfileId === "string"
          ? String((entry as { imageAuthProfileId?: unknown }).imageAuthProfileId).trim()
          : "";
      if (imageAuthProfileId) {
        const agentDir = resolveAgentDir(cfg, agentId);
        const imageCfg = resolveImageModelConfigForTool({ cfg, agentId, agentDir });
        const imagePrimary = imageCfg?.primary?.trim() || "";
        const parsed = imagePrimary ? parseModelRef(imagePrimary, expectedTextProvider) : null;
        if (!parsed) {
          respond(
            false,
            undefined,
            errorShape(
              ErrorCodes.INVALID_REQUEST,
              "image model provider unknown; set imageModel or unlock/change the profile",
            ),
          );
          return;
        }
        if (
          !validateLockedAuthProfile({
            store,
            profileId: imageAuthProfileId,
            expectedProvider: parsed.provider,
            respond,
          })
        ) {
          return;
        }
      }

      const validated = validateConfigObjectWithPlugins(cfg);
      if (!validated.ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "invalid config", {
            details: { issues: validated.issues },
          }),
        );
        return;
      }
      await writeConfigFile(validated.config);

      const nextSnapshot = await readConfigFileSnapshot();
      const nextHash = resolveConfigSnapshotHash(nextSnapshot);
      if (!nextHash) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, "config updated but base hash unavailable; refresh"),
        );
        return;
      }
      const agent = buildAgentProfileEntry(validated.config, agentId);
      respond(true, { ok: true, baseHash: nextHash, agent }, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `agent profile update failed: ${err instanceof Error ? err.message : String(err)}`,
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
