import { type Api, getEnvApiKey, type Model } from "@mariozechner/pi-ai";
import path from "node:path";
import type { OpenClawConfig } from "../config/config.js";
import type { ModelProviderAuthMode, ModelProviderConfig } from "../config/types.js";
import { formatCliCommand } from "../cli/command-format.js";
import { getShellEnvAppliedKeys } from "../infra/shell-env.js";
import {
  normalizeOptionalSecretInput,
  normalizeSecretInput,
} from "../utils/normalize-secret-input.js";
import {
  type AuthProfileStore,
  ensureAuthProfileStore,
  listProfilesForProvider,
  resolveApiKeyForProfile,
  resolveAuthProfileOrder,
  resolveAuthStorePathForDisplay,
} from "./auth-profiles.js";
import { normalizeProviderId } from "./model-selection.js";

export { ensureAuthProfileStore, resolveAuthProfileOrder } from "./auth-profiles.js";

const AWS_BEARER_ENV = "AWS_BEARER_TOKEN_BEDROCK";
const AWS_ACCESS_KEY_ENV = "AWS_ACCESS_KEY_ID";
const AWS_SECRET_KEY_ENV = "AWS_SECRET_ACCESS_KEY";
const AWS_PROFILE_ENV = "AWS_PROFILE";

function resolveProviderConfig(
  cfg: OpenClawConfig | undefined,
  provider: string,
): ModelProviderConfig | undefined {
  const providers = cfg?.models?.providers ?? {};
  const direct = providers[provider] as ModelProviderConfig | undefined;
  if (direct) {
    return direct;
  }
  const normalized = normalizeProviderId(provider);
  if (normalized === provider) {
    const matched = Object.entries(providers).find(
      ([key]) => normalizeProviderId(key) === normalized,
    );
    return matched?.[1];
  }
  return (
    (providers[normalized] as ModelProviderConfig | undefined) ??
    Object.entries(providers).find(([key]) => normalizeProviderId(key) === normalized)?.[1]
  );
}

export function getCustomProviderApiKey(
  cfg: OpenClawConfig | undefined,
  provider: string,
): string | undefined {
  const entry = resolveProviderConfig(cfg, provider);
  return normalizeOptionalSecretInput(entry?.apiKey);
}

function resolveProviderAuthOverride(
  cfg: OpenClawConfig | undefined,
  provider: string,
): ModelProviderAuthMode | undefined {
  const entry = resolveProviderConfig(cfg, provider);
  const auth = entry?.auth;
  if (auth === "api-key" || auth === "aws-sdk" || auth === "oauth" || auth === "token") {
    return auth;
  }
  return undefined;
}

function resolveEnvSourceLabel(params: {
  applied: Set<string>;
  envVars: string[];
  label: string;
}): string {
  const shellApplied = params.envVars.some((envVar) => params.applied.has(envVar));
  const prefix = shellApplied ? "shell env: " : "env: ";
  return `${prefix}${params.label}`;
}

export function resolveAwsSdkEnvVarName(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env[AWS_BEARER_ENV]?.trim()) {
    return AWS_BEARER_ENV;
  }
  if (env[AWS_ACCESS_KEY_ENV]?.trim() && env[AWS_SECRET_KEY_ENV]?.trim()) {
    return AWS_ACCESS_KEY_ENV;
  }
  if (env[AWS_PROFILE_ENV]?.trim()) {
    return AWS_PROFILE_ENV;
  }
  return undefined;
}

function resolveAwsSdkAuthInfo(): { mode: "aws-sdk"; source: string } {
  const applied = new Set(getShellEnvAppliedKeys());
  if (process.env[AWS_BEARER_ENV]?.trim()) {
    return {
      mode: "aws-sdk",
      source: resolveEnvSourceLabel({
        applied,
        envVars: [AWS_BEARER_ENV],
        label: AWS_BEARER_ENV,
      }),
    };
  }
  if (process.env[AWS_ACCESS_KEY_ENV]?.trim() && process.env[AWS_SECRET_KEY_ENV]?.trim()) {
    return {
      mode: "aws-sdk",
      source: resolveEnvSourceLabel({
        applied,
        envVars: [AWS_ACCESS_KEY_ENV, AWS_SECRET_KEY_ENV],
        label: `${AWS_ACCESS_KEY_ENV} + ${AWS_SECRET_KEY_ENV}`,
      }),
    };
  }
  if (process.env[AWS_PROFILE_ENV]?.trim()) {
    return {
      mode: "aws-sdk",
      source: resolveEnvSourceLabel({
        applied,
        envVars: [AWS_PROFILE_ENV],
        label: AWS_PROFILE_ENV,
      }),
    };
  }
  return { mode: "aws-sdk", source: "aws-sdk default chain" };
}

export type ResolvedProviderAuth = {
  apiKey?: string;
  profileId?: string;
  source: string;
  mode: "api-key" | "oauth" | "token" | "aws-sdk";
};

export async function resolveApiKeyForProvider(params: {
  provider: string;
  cfg?: OpenClawConfig;
  profileId?: string;
  preferredProfile?: string;
  store?: AuthProfileStore;
  agentDir?: string;
}): Promise<ResolvedProviderAuth> {
  const { provider, cfg, profileId, preferredProfile } = params;
  const store = params.store ?? ensureAuthProfileStore(params.agentDir);

  if (profileId) {
    const resolved = await resolveApiKeyForProfile({
      cfg,
      store,
      profileId,
      agentDir: params.agentDir,
    });
    if (!resolved) {
      throw new Error(`No credentials found for profile "${profileId}".`);
    }
    const mode = store.profiles[profileId]?.type;
    return {
      apiKey: resolved.apiKey,
      profileId,
      source: `profile:${profileId}`,
      mode: mode === "oauth" ? "oauth" : mode === "token" ? "token" : "api-key",
    };
  }

  const authOverride = resolveProviderAuthOverride(cfg, provider);
  if (authOverride === "aws-sdk") {
    return resolveAwsSdkAuthInfo();
  }

  const order = resolveAuthProfileOrder({
    cfg,
    store,
    provider,
    preferredProfile,
  });
  for (const candidate of order) {
    try {
      const resolved = await resolveApiKeyForProfile({
        cfg,
        store,
        profileId: candidate,
        agentDir: params.agentDir,
      });
      if (resolved) {
        const mode = store.profiles[candidate]?.type;
        return {
          apiKey: resolved.apiKey,
          profileId: candidate,
          source: `profile:${candidate}`,
          mode: mode === "oauth" ? "oauth" : mode === "token" ? "token" : "api-key",
        };
      }
    } catch {}
  }

  const envResolved = resolveEnvApiKey(provider);
  if (envResolved) {
    return {
      apiKey: envResolved.apiKey,
      source: envResolved.source,
      mode: envResolved.source.includes("OAUTH_TOKEN") ? "oauth" : "api-key",
    };
  }

  const customKey = getCustomProviderApiKey(cfg, provider);
  if (customKey) {
    return { apiKey: customKey, source: "models.json", mode: "api-key" };
  }

  const normalized = normalizeProviderId(provider);
  if (authOverride === undefined && normalized === "amazon-bedrock") {
    return resolveAwsSdkAuthInfo();
  }

  if (provider === "openai") {
    const hasCodex = listProfilesForProvider(store, "openai-codex").length > 0;
    if (hasCodex) {
      throw new Error(
        'No API key found for provider "openai". You are authenticated with OpenAI Codex OAuth. Use openai-codex/gpt-5.3-codex (OAuth) or set OPENAI_API_KEY to use openai/gpt-5.1-codex.',
      );
    }
  }

  const authStorePath = resolveAuthStorePathForDisplay(params.agentDir);
  const resolvedAgentDir = path.dirname(authStorePath);
  throw new Error(
    [
      `No API key found for provider "${provider}".`,
      `Auth store: ${authStorePath} (agentDir: ${resolvedAgentDir}).`,
      `Configure auth for this agent (${formatCliCommand("openclaw agents add <id>")}) or copy auth-profiles.json from the main agentDir.`,
    ].join(" "),
  );
}

export type EnvApiKeyResult = { apiKey: string; source: string };
export type ModelAuthMode = "api-key" | "oauth" | "token" | "mixed" | "aws-sdk" | "unknown";

/**
 * Standard provider → env variable mapping.
 * Shared by {@link resolveEnvApiKey} (forward lookup) and
 * {@link getEnvToProvidersMap} (reverse lookup).
 */
const PROVIDER_ENV_MAP: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  google: "GEMINI_API_KEY",
  voyage: "VOYAGE_API_KEY",
  groq: "GROQ_API_KEY",
  deepgram: "DEEPGRAM_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  xai: "XAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  litellm: "LITELLM_API_KEY",
  "vercel-ai-gateway": "AI_GATEWAY_API_KEY",
  "cloudflare-ai-gateway": "CLOUDFLARE_AI_GATEWAY_API_KEY",
  moonshot: "MOONSHOT_API_KEY",
  minimax: "MINIMAX_API_KEY",
  xiaomi: "XIAOMI_API_KEY",
  synthetic: "SYNTHETIC_API_KEY",
  venice: "VENICE_API_KEY",
  mistral: "MISTRAL_API_KEY",
  opencode: "OPENCODE_API_KEY",
  together: "TOGETHER_API_KEY",
  qianfan: "QIANFAN_API_KEY",
  ollama: "OLLAMA_API_KEY",
  vllm: "VLLM_API_KEY",
  nvidia: "NVIDIA_API_KEY",
  huggingface: "HUGGINGFACE_API_KEY",
};

/**
 * Providers with multiple env vars or non-standard mappings.
 * Each entry is [envVar, provider]. Order within a provider matches
 * the priority used by {@link resolveEnvApiKey}.
 */
const SPECIAL_PROVIDER_ENV_ENTRIES: ReadonlyArray<readonly [string, string]> = [
  ["ANTHROPIC_OAUTH_TOKEN", "anthropic"],
  ["ANTHROPIC_API_KEY", "anthropic"],
  ["COPILOT_GITHUB_TOKEN", "github-copilot"],
  ["GH_TOKEN", "github-copilot"],
  ["GITHUB_TOKEN", "github-copilot"],
  ["DIGITALOCEAN_ACCESS_TOKEN", "digitalocean"],
  ["CHUTES_OAUTH_TOKEN", "chutes"],
  ["CHUTES_API_KEY", "chutes"],
  ["ZAI_API_KEY", "zai"],
  ["Z_AI_API_KEY", "zai"],
  ["OPENCODE_API_KEY", "opencode"],
  ["OPENCODE_ZEN_API_KEY", "opencode"],
  ["QWEN_OAUTH_TOKEN", "qwen-portal"],
  ["QWEN_PORTAL_API_KEY", "qwen-portal"],
  ["MINIMAX_OAUTH_TOKEN", "minimax-portal"],
  ["MINIMAX_API_KEY", "minimax-portal"],
  ["KIMI_API_KEY", "kimi-coding"],
  ["KIMICODE_API_KEY", "kimi-coding"],
];

/**
 * Extra env -> provider compatibility used only for skill eligibility reverse lookup.
 * This lets skills requiring canonical env keys accept equivalent OAuth-backed providers.
 */
const ELIGIBILITY_ENV_PROVIDER_COMPAT_ENTRIES: ReadonlyArray<readonly [string, string]> = [
  ["OPENAI_API_KEY", "openai-codex"],
  ["GEMINI_API_KEY", "google-gemini-cli"],
  ["GEMINI_API_KEY", "google-antigravity"],
];

export function resolveEnvApiKey(provider: string): EnvApiKeyResult | null {
  const normalized = normalizeProviderId(provider);
  const applied = new Set(getShellEnvAppliedKeys());
  const pick = (envVar: string): EnvApiKeyResult | null => {
    const value = normalizeOptionalSecretInput(process.env[envVar]);
    if (!value) {
      return null;
    }
    const source = applied.has(envVar) ? `shell env: ${envVar}` : `env: ${envVar}`;
    return { apiKey: value, source };
  };

  // google-vertex uses gcloud ADC, not a standard env var.
  if (normalized === "google-vertex") {
    const envKey = getEnvApiKey(normalized);
    if (!envKey) {
      return null;
    }
    return { apiKey: envKey, source: "gcloud adc" };
  }

  // Special-case providers with multiple env vars: try in priority order.
  const specialVars = SPECIAL_PROVIDER_ENV_ENTRIES.filter(([, p]) => p === normalized);
  if (specialVars.length > 0) {
    for (const [envVar] of specialVars) {
      const result = pick(envVar);
      if (result) {
        return result;
      }
    }
    return null;
  }

  const envVar = PROVIDER_ENV_MAP[normalized];
  if (!envVar) {
    return null;
  }
  return pick(envVar);
}

/**
 * Reverse mapping from environment variable names to provider identifiers.
 * Built lazily from {@link PROVIDER_ENV_MAP} and {@link SPECIAL_PROVIDER_ENV_ENTRIES}.
 */
let _envToProviders: Map<string, string[]> | undefined;

function getEnvToProvidersMap(): Map<string, string[]> {
  if (_envToProviders) {
    return _envToProviders;
  }
  const map = new Map<string, string[]>();
  const add = (envVar: string, provider: string) => {
    const list = map.get(envVar);
    if (list) {
      if (!list.includes(provider)) {
        list.push(provider);
      }
    } else {
      map.set(envVar, [provider]);
    }
  };

  for (const [provider, envVar] of Object.entries(PROVIDER_ENV_MAP)) {
    add(envVar, provider);
  }
  for (const [envVar, provider] of SPECIAL_PROVIDER_ENV_ENTRIES) {
    add(envVar, provider);
  }
  for (const [envVar, provider] of ELIGIBILITY_ENV_PROVIDER_COMPAT_ENTRIES) {
    add(envVar, provider);
  }

  _envToProviders = map;
  return map;
}

/**
 * Returns the provider identifiers that map to a given environment variable
 * name (e.g., `"GEMINI_API_KEY"` → `["google"]`).
 */
export function resolveProvidersForEnvVar(envName: string): string[] {
  return getEnvToProvidersMap().get(envName) ?? [];
}

/**
 * Check whether a required environment variable is satisfied by credentials
 * in the auth profile store (Credentials page).
 */
export function isEnvSatisfiedByAuthStore(envName: string, store: AuthProfileStore): boolean {
  const providers = resolveProvidersForEnvVar(envName);
  return providers.some((p) => listProfilesForProvider(store, p).length > 0);
}

export function resolveModelAuthMode(
  provider?: string,
  cfg?: OpenClawConfig,
  store?: AuthProfileStore,
): ModelAuthMode | undefined {
  const resolved = provider?.trim();
  if (!resolved) {
    return undefined;
  }

  const authOverride = resolveProviderAuthOverride(cfg, resolved);
  if (authOverride === "aws-sdk") {
    return "aws-sdk";
  }

  const authStore = store ?? ensureAuthProfileStore();
  const profiles = listProfilesForProvider(authStore, resolved);
  if (profiles.length > 0) {
    const modes = new Set(
      profiles
        .map((id) => authStore.profiles[id]?.type)
        .filter((mode): mode is "api_key" | "oauth" | "token" => Boolean(mode)),
    );
    const distinct = ["oauth", "token", "api_key"].filter((k) =>
      modes.has(k as "oauth" | "token" | "api_key"),
    );
    if (distinct.length >= 2) {
      return "mixed";
    }
    if (modes.has("oauth")) {
      return "oauth";
    }
    if (modes.has("token")) {
      return "token";
    }
    if (modes.has("api_key")) {
      return "api-key";
    }
  }

  if (authOverride === undefined && normalizeProviderId(resolved) === "amazon-bedrock") {
    return "aws-sdk";
  }

  const envKey = resolveEnvApiKey(resolved);
  if (envKey?.apiKey) {
    return envKey.source.includes("OAUTH_TOKEN") ? "oauth" : "api-key";
  }

  if (getCustomProviderApiKey(cfg, resolved)) {
    return "api-key";
  }

  return "unknown";
}

export async function getApiKeyForModel(params: {
  model: Model<Api>;
  cfg?: OpenClawConfig;
  profileId?: string;
  preferredProfile?: string;
  store?: AuthProfileStore;
  agentDir?: string;
}): Promise<ResolvedProviderAuth> {
  return resolveApiKeyForProvider({
    provider: params.model.provider,
    cfg: params.cfg,
    profileId: params.profileId,
    preferredProfile: params.preferredProfile,
    store: params.store,
    agentDir: params.agentDir,
  });
}

export function requireApiKey(auth: ResolvedProviderAuth, provider: string): string {
  const key = normalizeSecretInput(auth.apiKey);
  if (key) {
    return key;
  }
  throw new Error(`No API key resolved for provider "${provider}" (auth mode: ${auth.mode}).`);
}
