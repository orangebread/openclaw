import type { OpenClawConfig } from "../../config/config.js";
import type { AuthProfileStore } from "../auth-profiles/types.js";
import type { SkillEntry, SkillSnapshot } from "./types.js";
import { ensureAuthProfileStore, listProfilesForProvider } from "../auth-profiles.js";
import { resolveApiKeyForProvider, resolveProvidersForEnvVar } from "../model-auth.js";
import { resolveSkillConfig } from "./config.js";
import { resolveSkillKey } from "./frontmatter.js";

export function applySkillEnvOverrides(params: { skills: SkillEntry[]; config?: OpenClawConfig }) {
  const { skills, config } = params;
  const updates: Array<{ key: string; prev: string | undefined }> = [];

  for (const entry of skills) {
    const skillKey = resolveSkillKey(entry.skill, entry);
    const skillConfig = resolveSkillConfig(config, skillKey);
    if (!skillConfig) {
      continue;
    }

    if (skillConfig.env) {
      for (const [envKey, envValue] of Object.entries(skillConfig.env)) {
        if (!envValue || process.env[envKey]) {
          continue;
        }
        updates.push({ key: envKey, prev: process.env[envKey] });
        process.env[envKey] = envValue;
      }
    }

    const primaryEnv = entry.metadata?.primaryEnv;
    if (primaryEnv && skillConfig.apiKey && !process.env[primaryEnv]) {
      updates.push({ key: primaryEnv, prev: process.env[primaryEnv] });
      process.env[primaryEnv] = skillConfig.apiKey;
    }
  }

  return () => {
    for (const update of updates) {
      if (update.prev === undefined) {
        delete process.env[update.key];
      } else {
        process.env[update.key] = update.prev;
      }
    }
  };
}

async function resolveAuthProfileBackedEnvValue(params: {
  envName: string;
  config?: OpenClawConfig;
  authStore: AuthProfileStore;
  agentDir?: string;
}): Promise<string | undefined> {
  const providers = resolveProvidersForEnvVar(params.envName);
  if (providers.length === 0) {
    return undefined;
  }

  for (const provider of providers) {
    if (listProfilesForProvider(params.authStore, provider).length === 0) {
      continue;
    }
    try {
      const resolved = await resolveApiKeyForProvider({
        provider,
        cfg: params.config,
        store: params.authStore,
        agentDir: params.agentDir,
      });
      const value = resolved.apiKey?.trim();
      if (value) {
        return value;
      }
    } catch {
      // Try the next compatible provider for this env key.
    }
  }

  return undefined;
}

async function applyAuthProfileEnvFallbacks(params: {
  envNames: string[];
  config?: OpenClawConfig;
  authStore?: AuthProfileStore;
  agentDir?: string;
}) {
  const keys = Array.from(new Set(params.envNames.map((name) => name.trim()).filter(Boolean)));
  if (keys.length === 0) {
    return () => {};
  }

  const updates: Array<{ key: string; prev: string | undefined }> = [];
  const cache = new Map<string, string | null>();
  let authStore = params.authStore;

  for (const envName of keys) {
    if (process.env[envName]) {
      continue;
    }
    if (!cache.has(envName)) {
      authStore = authStore ?? ensureAuthProfileStore(params.agentDir);
      const value =
        (await resolveAuthProfileBackedEnvValue({
          envName,
          config: params.config,
          authStore,
          agentDir: params.agentDir,
        })) ?? null;
      cache.set(envName, value);
    }
    const value = cache.get(envName);
    if (!value) {
      continue;
    }
    updates.push({ key: envName, prev: process.env[envName] });
    process.env[envName] = value;
  }

  return () => {
    for (const update of updates) {
      if (update.prev === undefined) {
        delete process.env[update.key];
      } else {
        process.env[update.key] = update.prev;
      }
    }
  };
}

function collectRequiredEnvFromEntries(skills: SkillEntry[]): string[] {
  const env = new Set<string>();
  for (const entry of skills) {
    const required = entry.metadata?.requires?.env ?? [];
    for (const name of required) {
      const trimmed = name.trim();
      if (trimmed) {
        env.add(trimmed);
      }
    }
    const primary = entry.metadata?.primaryEnv?.trim();
    if (primary) {
      env.add(primary);
    }
  }
  return [...env];
}

function collectRequiredEnvFromSnapshot(snapshot?: SkillSnapshot): string[] {
  if (!snapshot) {
    return [];
  }
  const env = new Set<string>();
  for (const skill of snapshot.skills) {
    for (const name of skill.requiredEnv ?? []) {
      const trimmed = name.trim();
      if (trimmed) {
        env.add(trimmed);
      }
    }
    const primary = skill.primaryEnv?.trim();
    if (primary) {
      env.add(primary);
    }
  }
  return [...env];
}

export async function applySkillEnvOverridesWithAuth(params: {
  skills: SkillEntry[];
  config?: OpenClawConfig;
  authStore?: AuthProfileStore;
  agentDir?: string;
}) {
  const restoreConfig = applySkillEnvOverrides({
    skills: params.skills,
    config: params.config,
  });
  const restoreAuth = await applyAuthProfileEnvFallbacks({
    envNames: collectRequiredEnvFromEntries(params.skills),
    config: params.config,
    authStore: params.authStore,
    agentDir: params.agentDir,
  });
  return () => {
    restoreAuth();
    restoreConfig();
  };
}

export function applySkillEnvOverridesFromSnapshot(params: {
  snapshot?: SkillSnapshot;
  config?: OpenClawConfig;
}) {
  const { snapshot, config } = params;
  if (!snapshot) {
    return () => {};
  }
  const updates: Array<{ key: string; prev: string | undefined }> = [];

  for (const skill of snapshot.skills) {
    const skillConfig = resolveSkillConfig(config, skill.name);
    if (!skillConfig) {
      continue;
    }

    if (skillConfig.env) {
      for (const [envKey, envValue] of Object.entries(skillConfig.env)) {
        if (!envValue || process.env[envKey]) {
          continue;
        }
        updates.push({ key: envKey, prev: process.env[envKey] });
        process.env[envKey] = envValue;
      }
    }

    if (skill.primaryEnv && skillConfig.apiKey && !process.env[skill.primaryEnv]) {
      updates.push({
        key: skill.primaryEnv,
        prev: process.env[skill.primaryEnv],
      });
      process.env[skill.primaryEnv] = skillConfig.apiKey;
    }
  }

  return () => {
    for (const update of updates) {
      if (update.prev === undefined) {
        delete process.env[update.key];
      } else {
        process.env[update.key] = update.prev;
      }
    }
  };
}

export async function applySkillEnvOverridesFromSnapshotWithAuth(params: {
  snapshot?: SkillSnapshot;
  config?: OpenClawConfig;
  authStore?: AuthProfileStore;
  agentDir?: string;
}) {
  const restoreConfig = applySkillEnvOverridesFromSnapshot({
    snapshot: params.snapshot,
    config: params.config,
  });
  const restoreAuth = await applyAuthProfileEnvFallbacks({
    envNames: collectRequiredEnvFromSnapshot(params.snapshot),
    config: params.config,
    authStore: params.authStore,
    agentDir: params.agentDir,
  });
  return () => {
    restoreAuth();
    restoreConfig();
  };
}
