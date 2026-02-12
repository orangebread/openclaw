import { loginAnthropic, loginOpenAICodex } from "@mariozechner/pi-ai";
import { randomUUID } from "node:crypto";
import type { OpenClawConfig } from "../../config/config.js";
import type {
  ProviderAuthMethod,
  ProviderAuthResult,
  ProviderPlugin,
} from "../../plugins/types.js";
import type { RuntimeEnv } from "../../runtime.js";
import type { GatewayRequestHandlers } from "./types.js";
import { resolveOpenClawAgentDir } from "../../agents/agent-paths.js";
import {
  resolveAgentDir,
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
} from "../../agents/agent-scope.js";
import { ensureAuthProfileStore, upsertAuthProfile } from "../../agents/auth-profiles.js";
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from "../../agents/defaults.js";
import { modelKey, normalizeProviderId } from "../../agents/model-selection.js";
import { SYNTHETIC_DEFAULT_MODEL_REF } from "../../agents/synthetic-models.js";
import { VENICE_DEFAULT_MODEL_REF } from "../../agents/venice-models.js";
import { resolveDefaultAgentWorkspaceDir } from "../../agents/workspace.js";
import { formatApiKeyPreview } from "../../commands/auth-choice.api-key.js";
import { normalizeApiKeyInput } from "../../commands/auth-choice.api-key.js";
import { validateAnthropicSetupToken } from "../../commands/auth-token.js";
import {
  applyAuthProfileConfig,
  applyOpenrouterConfig,
  applyXaiConfig,
  applyMoonshotConfig,
  applyKimiCodeConfig,
  applyZaiConfig,
  applyXiaomiConfig,
  applySyntheticConfig,
  applyVeniceConfig,
  applyTogetherConfig,
  applyVercelAiGatewayConfig,
  applyQianfanConfig,
  applyCloudflareAiGatewayConfig as applyCloudflareAiGatewayConfigPatch,
} from "../../commands/onboard-auth.config-core.js";
import { applyOpencodeZenConfig as applyOpencodeZenConfigFull } from "../../commands/onboard-auth.config-opencode.js";
import {
  setOpenrouterApiKey,
  setXaiApiKey,
  setMoonshotApiKey,
  setKimiCodingApiKey,
  setZaiApiKey,
  setXiaomiApiKey,
  setSyntheticApiKey,
  setVeniceApiKey,
  setTogetherApiKey,
  setOpencodeZenApiKey,
  setVercelAiGatewayApiKey,
  setQianfanApiKey,
  setCloudflareAiGatewayConfig,
  OPENROUTER_DEFAULT_MODEL_REF,
  XAI_DEFAULT_MODEL_REF,
  ZAI_DEFAULT_MODEL_REF,
  XIAOMI_DEFAULT_MODEL_REF,
  TOGETHER_DEFAULT_MODEL_REF,
  VERCEL_AI_GATEWAY_DEFAULT_MODEL_REF,
  CLOUDFLARE_AI_GATEWAY_DEFAULT_MODEL_REF,
} from "../../commands/onboard-auth.credentials.js";
import {
  MOONSHOT_DEFAULT_MODEL_REF,
  KIMI_CODING_MODEL_REF,
  QIANFAN_DEFAULT_MODEL_REF,
} from "../../commands/onboard-auth.models.js";
import { OPENAI_CODEX_DEFAULT_MODEL } from "../../commands/openai-codex-model-default.js";
import { OPENCODE_ZEN_DEFAULT_MODEL } from "../../commands/opencode-zen-model-default.js";
import { readConfigFileSnapshot } from "../../config/config.js";
import { enablePluginInConfig } from "../../plugins/enable.js";
import { loadOpenClawPlugins } from "../../plugins/loader.js";
import {
  AuthFlowSession,
  type AuthFlowCompletePayload,
  type AuthFlowCompleteProfile,
} from "../auth-flow-session.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  type AuthFlowListResult,
  validateAuthFlowCancelCurrentParams,
  validateAuthFlowCurrentParams,
  validateAuthFlowListParams,
  validateAuthFlowNextParams,
  validateAuthFlowStartParams,
} from "../protocol/index.js";
import { formatForLog } from "../ws-log.js";

// ---------------------------------------------------------------------------
// Built-in API-key provider registry
// ---------------------------------------------------------------------------
// Each entry describes a simple API-key provider that the terminal wizard
// supports but that has no ProviderPlugin.  The gateway uses this registry
// to (a) include the provider in `auth.flow.list` and (b) drive a built-in
// interactive flow via `auth.flow.start`.
// ---------------------------------------------------------------------------
type BuiltinApiKeyProviderEntry = {
  /** Canonical provider ID (used as profile prefix).  Must match CLI. */
  providerId: string;
  /** Human-readable label shown in the UI. */
  label: string;
  /** Hint / docs link shown next to the "Connect" button. */
  hint?: string;
  /** Label for the auth method row. */
  methodLabel: string;
  /** Intro note shown before asking for the key (optional). */
  introNote?: string;
  /** Prompt text for the API key text input. */
  keyPrompt: string;
  /** Persist the API key. */
  setApiKey: (key: string) => void | Promise<void>;
  /** Default model ref (e.g. "openrouter/auto"). */
  defaultModel: string;
  /** Apply the full config (provider config + set default model). */
  applyConfig: (cfg: OpenClawConfig) => OpenClawConfig;
};

type AuthFlowMethodUi = AuthFlowListResult["providers"][number]["methods"][number];
type AuthFlowProviderUi = AuthFlowListResult["providers"][number];

const BUILTIN_API_KEY_PROVIDERS: BuiltinApiKeyProviderEntry[] = [
  {
    providerId: "openrouter",
    label: "OpenRouter",
    hint: "Unified gateway to many models",
    methodLabel: "API key",
    keyPrompt: "Enter OpenRouter API key",
    setApiKey: (key) => setOpenrouterApiKey(key),
    defaultModel: OPENROUTER_DEFAULT_MODEL_REF,
    applyConfig: applyOpenrouterConfig,
  },
  {
    providerId: "xai",
    label: "xAI (Grok)",
    hint: "Grok models via xAI",
    methodLabel: "API key",
    keyPrompt: "Enter xAI API key",
    setApiKey: (key) => setXaiApiKey(key),
    defaultModel: XAI_DEFAULT_MODEL_REF,
    applyConfig: applyXaiConfig,
  },
  {
    providerId: "moonshot",
    label: "Moonshot AI (Kimi K2.5)",
    hint: "Kimi K2.5 via Moonshot",
    methodLabel: "API key",
    keyPrompt: "Enter Moonshot API key",
    setApiKey: (key) => setMoonshotApiKey(key),
    defaultModel: MOONSHOT_DEFAULT_MODEL_REF,
    applyConfig: applyMoonshotConfig,
  },
  {
    providerId: "kimi-coding",
    label: "Kimi Coding",
    hint: "Kimi Coding at kimi.com/code",
    methodLabel: "API key",
    introNote:
      "Kimi Coding uses a dedicated endpoint and API key.\nGet your API key at: https://www.kimi.com/code/en",
    keyPrompt: "Enter Kimi Coding API key",
    setApiKey: (key) => setKimiCodingApiKey(key),
    defaultModel: KIMI_CODING_MODEL_REF,
    applyConfig: applyKimiCodeConfig,
  },
  {
    providerId: "zai",
    label: "Z.AI (GLM 4.7)",
    hint: "GLM models via Z.AI",
    methodLabel: "API key",
    keyPrompt: "Enter Z.AI API key",
    setApiKey: (key) => setZaiApiKey(key),
    defaultModel: ZAI_DEFAULT_MODEL_REF,
    applyConfig: applyZaiConfig,
  },
  {
    providerId: "xiaomi",
    label: "Xiaomi",
    hint: "MiMo models via Xiaomi",
    methodLabel: "API key",
    keyPrompt: "Enter Xiaomi API key",
    setApiKey: (key) => setXiaomiApiKey(key),
    defaultModel: XIAOMI_DEFAULT_MODEL_REF,
    applyConfig: applyXiaomiConfig,
  },
  {
    providerId: "synthetic",
    label: "Synthetic",
    hint: "MiniMax M2.1 via Synthetic",
    methodLabel: "API key",
    keyPrompt: "Enter Synthetic API key",
    setApiKey: (key) => setSyntheticApiKey(key),
    defaultModel: SYNTHETIC_DEFAULT_MODEL_REF,
    applyConfig: applySyntheticConfig,
  },
  {
    providerId: "venice",
    label: "Venice AI",
    hint: "Privacy-focused inference",
    methodLabel: "API key",
    introNote:
      "Venice AI provides privacy-focused inference with uncensored models.\nGet your API key at: https://venice.ai/settings/api",
    keyPrompt: "Enter Venice AI API key",
    setApiKey: (key) => setVeniceApiKey(key),
    defaultModel: VENICE_DEFAULT_MODEL_REF,
    applyConfig: applyVeniceConfig,
  },
  {
    providerId: "together",
    label: "Together AI",
    hint: "Open-source models via Together",
    methodLabel: "API key",
    introNote:
      "Together AI provides access to leading open-source models.\nGet your API key at: https://api.together.xyz/settings/api-keys",
    keyPrompt: "Enter Together AI API key",
    setApiKey: (key) => setTogetherApiKey(key),
    defaultModel: TOGETHER_DEFAULT_MODEL_REF,
    applyConfig: applyTogetherConfig,
  },
  {
    providerId: "opencode",
    label: "OpenCode Zen",
    hint: "Multi-model gateway via OpenCode",
    methodLabel: "API key",
    introNote:
      "OpenCode Zen provides access to Claude, GPT, Gemini, and more.\nGet your API key at: https://opencode.ai/auth",
    keyPrompt: "Enter OpenCode Zen API key",
    setApiKey: (key) => setOpencodeZenApiKey(key),
    defaultModel: OPENCODE_ZEN_DEFAULT_MODEL,
    applyConfig: (cfg) => applyOpencodeZenConfigFull(cfg),
  },
  {
    providerId: "vercel-ai-gateway",
    label: "Vercel AI Gateway",
    hint: "AI gateway via Vercel",
    methodLabel: "API key",
    keyPrompt: "Enter Vercel AI Gateway API key",
    setApiKey: (key) => setVercelAiGatewayApiKey(key),
    defaultModel: VERCEL_AI_GATEWAY_DEFAULT_MODEL_REF,
    applyConfig: applyVercelAiGatewayConfig,
  },
  {
    providerId: "qianfan",
    label: "Qianfan",
    hint: "Baidu Qianfan models",
    methodLabel: "API key",
    introNote:
      "Get your API key at: https://console.bce.baidu.com/qianfan/ais/console/apiKey\nAPI key format: bce-v3/ALTAK-...",
    keyPrompt: "Enter Qianfan API key",
    setApiKey: (key) => setQianfanApiKey(key),
    defaultModel: QIANFAN_DEFAULT_MODEL_REF,
    applyConfig: applyQianfanConfig,
  },
];

const BUILTIN_API_KEY_PROVIDERS_BY_ID = new Map(
  BUILTIN_API_KEY_PROVIDERS.map((entry) => [entry.providerId, entry]),
);

function resolveOwnerDeviceId(params: {
  client: { connect?: { device?: { id?: string } } } | null;
}) {
  const client = params.client;
  if (!client) {
    return undefined;
  }
  const id = client.connect?.device?.id;
  return typeof id === "string" && id.trim() ? id.trim() : undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function mergeConfigPatch<T>(base: T, patch: unknown): T {
  if (!isPlainRecord(base) || !isPlainRecord(patch)) {
    return patch as T;
  }

  const next: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const existing = next[key];
    if (isPlainRecord(existing) && isPlainRecord(value)) {
      next[key] = mergeConfigPatch(existing, value);
    } else {
      next[key] = value;
    }
  }
  return next as T;
}

function methodKindForUi(
  kind: ProviderAuthMethod["kind"],
): "oauth" | "api_key_manual" | "token_paste" | "custom" {
  if (kind === "oauth" || kind === "device_code") {
    return "oauth";
  }
  if (kind === "token") {
    return "token_paste";
  }
  if (kind === "api_key") {
    return "api_key_manual";
  }
  return "custom";
}

function supportsRemote(_kind: ProviderAuthMethod["kind"]): boolean {
  return true;
}

const KNOWN_PROVIDER_PLUGIN_IDS: Record<string, string> = {
  "google-gemini-cli": "google-gemini-cli-auth",
  "google-antigravity": "google-antigravity-auth",
};

function resolveProviderAndMethod(params: {
  registry: ReturnType<typeof loadOpenClawPlugins>;
  providerId: string;
  methodId: string;
}): { provider: ProviderPlugin; method: ProviderAuthMethod } | null {
  const normalizedProviderId = normalizeProviderId(params.providerId);
  const provider =
    params.registry.providers
      .map((entry) => entry.provider)
      .find((p) => normalizeProviderId(p.id) === normalizedProviderId) ??
    params.registry.providers
      .map((entry) => entry.provider)
      .find((p) =>
        (p.aliases ?? []).some((alias) => normalizeProviderId(alias) === normalizedProviderId),
      ) ??
    null;

  if (!provider) {
    return null;
  }

  const methodIdNormalized = params.methodId.trim().toLowerCase();
  const method =
    provider.auth.find((m) => m.id.toLowerCase() === methodIdNormalized) ??
    provider.auth.find((m) => m.label.toLowerCase() === methodIdNormalized) ??
    null;
  if (!method) {
    return null;
  }
  return { provider, method };
}

function buildAuthProfileRefPatch(params: {
  profileId: string;
  provider: string;
  mode: string;
  email?: string;
}) {
  return {
    auth: {
      profiles: {
        [params.profileId]: {
          provider: params.provider,
          mode: params.mode,
          ...(params.email ? { email: params.email } : {}),
        },
      },
    },
  };
}

function buildDefaultModelPatch(model: string) {
  return {
    agents: {
      defaults: {
        models: {
          [model]: {},
        },
        model: {
          primary: model,
        },
      },
    },
  };
}

function toCompletionProfile(params: {
  profileId: string;
  credential: { type: string; provider: string } & Record<string, unknown>;
}): AuthFlowCompleteProfile {
  const { profileId, credential } = params;
  const provider = String(credential.provider ?? "").trim();
  const type = String(credential.type ?? "").trim();
  const email =
    typeof credential.email === "string" && credential.email.trim()
      ? credential.email.trim()
      : undefined;
  const expires =
    typeof credential.expires === "number" &&
    Number.isFinite(credential.expires) &&
    credential.expires > 0
      ? Math.floor(credential.expires)
      : undefined;

  if (type === "api_key") {
    const key = typeof credential.key === "string" ? credential.key : "";
    return {
      id: profileId,
      provider,
      type,
      preview: formatApiKeyPreview(key),
      ...(email ? { email } : {}),
      ...(expires ? { expires } : {}),
    };
  }
  if (type === "token") {
    const token = typeof credential.token === "string" ? credential.token : "";
    return {
      id: profileId,
      provider,
      type,
      preview: formatApiKeyPreview(token),
      ...(email ? { email } : {}),
      ...(expires ? { expires } : {}),
    };
  }
  return {
    id: profileId,
    provider,
    type,
    ...(email ? { email } : {}),
    ...(expires ? { expires } : {}),
  };
}

const gatewayRuntime: RuntimeEnv = {
  log: () => {},
  error: () => {},
  exit: (code: number) => {
    throw new Error(`auth.flow runner attempted to exit(${code})`);
  },
};

function suggestUniqueProfileId(params: { baseId: string; existing: string[] }): string {
  const base = params.baseId.trim();
  if (!base) {
    return params.baseId;
  }
  if (!params.existing.includes(base)) {
    return base;
  }

  for (let i = 2; i <= 50; i += 1) {
    const candidate = `${base}-${i}`;
    if (!params.existing.includes(candidate)) {
      return candidate;
    }
  }
  return `${base}-${randomUUID().slice(0, 8)}`;
}

async function runSetupTokenFlow(
  api: import("../auth-flow-session.js").AuthFlowSessionApi,
): Promise<AuthFlowCompletePayload> {
  await api.note(
    "Run `claude setup-token` in your terminal, then paste the token here.",
    "Anthropic setup-token",
  );
  const token = await api.text({
    message: "Paste setup-token (write-only)",
    sensitive: true,
    validate: (value) => validateAnthropicSetupToken(value),
  });
  const nameRaw = await api.text({
    message: "Token name (optional)",
    initialValue: "default",
    placeholder: "default",
  });
  const name = nameRaw.trim()
    ? nameRaw
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
    : "default";
  const profileId = `anthropic:setup-token-${name}`;
  const provider = "anthropic";

  upsertAuthProfile({
    profileId,
    credential: {
      type: "token",
      provider,
      token: token.trim(),
    },
    agentDir: resolveOpenClawAgentDir(),
  });

  const defaultModel = modelKey(DEFAULT_PROVIDER, DEFAULT_MODEL);

  let configPatch: unknown = buildAuthProfileRefPatch({
    profileId,
    provider,
    mode: "token",
  });
  configPatch = mergeConfigPatch(configPatch, buildDefaultModelPatch(defaultModel));

  return {
    profiles: [
      toCompletionProfile({
        profileId,
        credential: { type: "token", provider, token },
      }),
    ],
    configPatch,
    defaultModel,
    notes: ["Token stored as a write-only auth profile."],
  };
}

async function runAnthropicOAuthFlow(
  api: import("../auth-flow-session.js").AuthFlowSessionApi,
): Promise<AuthFlowCompletePayload> {
  await api.note(
    [
      "This flow opens a Claude sign-in URL and stores a refreshable OAuth profile on the gateway.",
      "After approving access, you will be shown an authorization code. Paste it here to finish.",
    ].join("\n"),
    "Anthropic OAuth",
  );

  const required = (value: string) => (value.trim().length > 0 ? undefined : "Required");
  let authUrl = "";
  const creds = await loginAnthropic(
    (url) => {
      authUrl = url;
    },
    async () => {
      if (!authUrl) {
        throw new Error("Anthropic OAuth did not provide an authorization URL");
      }
      await api.openUrl(authUrl, {
        title: "Open sign-in URL",
        message: "Open this URL in your browser to continue.",
      });
      return await api.text({
        // Treat as sensitive: contains short-lived codes.
        message: "Paste authorization code (code#state)",
        placeholder: "code#state",
        sensitive: true,
        validate: required,
      });
    },
  );

  const provider = "anthropic";
  const store = ensureAuthProfileStore(resolveOpenClawAgentDir());
  const providerKey = normalizeProviderId(provider);
  const existingIds = Object.keys(store.profiles).filter(
    (id) => normalizeProviderId(store.profiles[id]?.provider) === providerKey,
  );
  const suggestedProfileId = suggestUniqueProfileId({
    baseId: "anthropic:oauth-default",
    existing: existingIds,
  });

  const profileId = await api
    .text({
      message: "Credential ID (optional)",
      initialValue: suggestedProfileId,
      placeholder: "anthropic:oauth-default",
      validate: required,
    })
    .then((value) => value.trim());

  upsertAuthProfile({
    profileId,
    credential: {
      type: "oauth",
      provider,
      ...creds,
    },
    agentDir: resolveOpenClawAgentDir(),
  });

  const defaultModel = modelKey(DEFAULT_PROVIDER, DEFAULT_MODEL);

  let configPatch: unknown = buildAuthProfileRefPatch({
    profileId,
    provider,
    mode: "oauth",
  });
  configPatch = mergeConfigPatch(configPatch, buildDefaultModelPatch(defaultModel));

  return {
    profiles: [
      toCompletionProfile({
        profileId,
        credential: { type: "oauth", provider, expires: creds.expires },
      }),
    ],
    configPatch,
    defaultModel,
    notes: ["OAuth credentials stored in auth profiles."],
  };
}

async function runOpenAICodexOAuthFlow(params: {
  api: import("../auth-flow-session.js").AuthFlowSessionApi;
}): Promise<AuthFlowCompletePayload> {
  const api = params.api;
  await api.note(
    [
      "This flow opens a URL locally and stores an OAuth profile on the gateway.",
      "If the callback does not auto-complete, you will be prompted to paste the redirect URL.",
    ].join("\n"),
    "OpenAI Codex OAuth",
  );

  const required = (value: string) => (value.trim().length > 0 ? undefined : "Required");
  const creds = await loginOpenAICodex({
    onAuth: async ({ url }) => {
      await api.openUrl(url, {
        title: "Open sign-in URL",
        message: "Open this URL in your browser to continue.",
      });
    },
    onPrompt: async (prompt) => {
      // Treat as sensitive: redirect URL may contain auth codes.
      return await api.text({
        message: prompt.message,
        placeholder: prompt.placeholder,
        sensitive: true,
        validate: required,
      });
    },
    onProgress: (_msg) => {},
  });

  const email =
    typeof creds?.email === "string" && creds.email.trim() ? creds.email.trim() : "default";
  const profileId = `openai-codex:${email}`;
  const provider = "openai-codex";
  upsertAuthProfile({
    profileId,
    credential: {
      type: "oauth",
      provider,
      ...creds,
      email,
    },
    agentDir: resolveOpenClawAgentDir(),
  });

  // Keep patch minimal and merge-safe: add model definition + set primary + auth profile reference.
  let configPatch: unknown = buildAuthProfileRefPatch({
    profileId,
    provider,
    mode: "oauth",
    email,
  });
  configPatch = mergeConfigPatch(configPatch, buildDefaultModelPatch(OPENAI_CODEX_DEFAULT_MODEL));

  return {
    profiles: [
      toCompletionProfile({
        profileId,
        credential: { type: "oauth", provider, email, expires: creds.expires },
      }),
    ],
    configPatch,
    defaultModel: OPENAI_CODEX_DEFAULT_MODEL,
    notes: ["OAuth credentials stored in auth profiles."],
  };
}

async function runPluginProviderFlow(params: {
  providerId: string;
  methodId: string;
  mode: "local" | "remote";
  api: import("../auth-flow-session.js").AuthFlowSessionApi;
}): Promise<AuthFlowCompletePayload> {
  const snapshot = await readConfigFileSnapshot();
  if (!snapshot.valid) {
    throw new Error("invalid config; fix before connecting");
  }

  let config: OpenClawConfig = snapshot.config ?? {};
  const pluginIdHint = KNOWN_PROVIDER_PLUGIN_IDS[normalizeProviderId(params.providerId)];
  let pluginEnablePatch: Record<string, unknown> | null = null;

  if (pluginIdHint) {
    const enabled = enablePluginInConfig(config, pluginIdHint);
    if (!enabled.enabled) {
      throw new Error(`${pluginIdHint} plugin is disabled (${enabled.reason ?? "blocked"})`);
    }
    config = enabled.config;
    pluginEnablePatch = { plugins: { entries: { [pluginIdHint]: { enabled: true } } } };
  }

  const defaultAgentId = resolveDefaultAgentId(config);
  const agentDir = resolveAgentDir(config, defaultAgentId) ?? resolveOpenClawAgentDir();
  const workspaceDir =
    resolveAgentWorkspaceDir(config, defaultAgentId) ?? resolveDefaultAgentWorkspaceDir();

  const registry = loadOpenClawPlugins({
    config,
    workspaceDir,
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
  });

  const resolved = resolveProviderAndMethod({
    registry,
    providerId: params.providerId,
    methodId: params.methodId,
  });
  if (!resolved) {
    throw new Error(`unknown provider/method: ${params.providerId}/${params.methodId}`);
  }

  const api = params.api;
  const prompter = {
    intro: async (title: string) => {
      await api.note("", title);
    },
    outro: async (message: string) => {
      await api.note(message, "Done");
    },
    note: async (message: string, title?: string) => {
      await api.note(message, title);
    },
    select: async <T>(p: {
      message: string;
      options: Array<{ value: T; label: string; hint?: string }>;
      initialValue?: T;
    }) => {
      return await api.select(p);
    },
    multiselect: async <T>(p: {
      message: string;
      options: Array<{ value: T; label: string; hint?: string }>;
      initialValues?: T[];
    }) => {
      return await api.multiselect(p);
    },
    text: async (p: {
      message: string;
      initialValue?: string;
      placeholder?: string;
      validate?: (value: string) => string | undefined;
      sensitive?: boolean;
    }) => {
      return await api.text(p);
    },
    confirm: async (p: { message: string; initialValue?: boolean }) => {
      return await api.confirm(p);
    },
    progress: (_label: string) => api.progress(_label),
  } satisfies import("../../wizard/prompts.js").WizardPrompter;

  const uiOAuthHandlers: typeof import("../../commands/oauth-flow.js").createVpsAwareOAuthHandlers =
    (opts) => {
      const validateRequiredInput = (value: string) =>
        value.trim().length > 0 ? undefined : "Required";
      const manualPromptMessage =
        opts.manualPromptMessage ?? "Paste the redirect URL (or authorization code)";
      let manualCodePromise: Promise<string> | undefined;

      return {
        onAuth: async ({ url }) => {
          await api.openUrl(url, {
            title: "Open sign-in URL",
            message: "Open this URL in your browser to continue.",
          });
          if (opts.isRemote) {
            manualCodePromise = opts.prompter
              .text({
                message: manualPromptMessage,
                validate: validateRequiredInput,
                sensitive: true,
              })
              .then((value) => String(value));
          }
        },
        onPrompt: async (prompt) => {
          if (manualCodePromise) {
            return manualCodePromise;
          }
          const code = await opts.prompter.text({
            message: prompt.message,
            placeholder: prompt.placeholder,
            validate: validateRequiredInput,
            sensitive: true,
          });
          return String(code);
        },
      };
    };

  const result: ProviderAuthResult = await resolved.method.run({
    config,
    agentDir,
    workspaceDir,
    prompter,
    runtime: gatewayRuntime,
    isRemote: params.mode === "remote",
    openUrl: async (url: string) => {
      await api.openUrl(url, { title: "Open sign-in URL" });
    },
    oauth: {
      createVpsAwareHandlers: uiOAuthHandlers,
    },
  });

  const profiles: AuthFlowCompleteProfile[] = [];
  for (const entry of result.profiles) {
    upsertAuthProfile({
      profileId: entry.profileId,
      credential: entry.credential,
      agentDir: resolveOpenClawAgentDir(),
    });
    profiles.push(
      toCompletionProfile({
        profileId: entry.profileId,
        credential: entry.credential as unknown as { type: string; provider: string } & Record<
          string,
          unknown
        >,
      }),
    );
  }

  let configPatch: unknown = {};
  if (pluginEnablePatch) {
    configPatch = mergeConfigPatch(configPatch, pluginEnablePatch);
  }
  if (result.configPatch) {
    configPatch = mergeConfigPatch(configPatch, result.configPatch);
  }

  for (const entry of result.profiles) {
    const cred = entry.credential;
    const mode = cred.type === "token" ? "token" : cred.type;
    const email = "email" in cred && typeof cred.email === "string" ? cred.email : undefined;
    configPatch = mergeConfigPatch(
      configPatch,
      buildAuthProfileRefPatch({
        profileId: entry.profileId,
        provider: String(cred.provider),
        mode,
        ...(email ? { email: String(email) } : {}),
      }),
    );
  }

  if (result.defaultModel) {
    configPatch = mergeConfigPatch(configPatch, buildDefaultModelPatch(result.defaultModel));
  }

  return {
    profiles,
    ...(isPlainRecord(configPatch) && Object.keys(configPatch).length === 0 ? {} : { configPatch }),
    ...(result.defaultModel ? { defaultModel: result.defaultModel } : {}),
    ...(result.notes ? { notes: result.notes } : {}),
  };
}

// ---------------------------------------------------------------------------
// Built-in API-key flow runner
// ---------------------------------------------------------------------------
// Drives an interactive flow for simple API-key providers that have no plugin.
// Steps: (optional) intro note → text input for API key → store + return.
// ---------------------------------------------------------------------------
async function runBuiltinApiKeyFlow(params: {
  providerId: string;
  methodId: string;
  api: import("../auth-flow-session.js").AuthFlowSessionApi;
}): Promise<AuthFlowCompletePayload> {
  const entry = BUILTIN_API_KEY_PROVIDERS_BY_ID.get(normalizeProviderId(params.providerId));
  if (!entry) {
    throw new Error(`unknown built-in API-key provider: ${params.providerId}`);
  }

  const { api } = params;

  if (entry.introNote) {
    await api.note(entry.introNote, entry.label);
  }

  const rawKey = await api.text({
    message: entry.keyPrompt,
    sensitive: true,
    validate: (value) => (value.trim() ? undefined : "API key is required"),
  });

  const apiKey = normalizeApiKeyInput(rawKey);
  await entry.setApiKey(apiKey);

  const profileId = `${entry.providerId}:default`;
  upsertAuthProfile({
    profileId,
    credential: { type: "api_key", provider: entry.providerId, key: apiKey },
    agentDir: resolveOpenClawAgentDir(),
  });

  const snapshot = await readConfigFileSnapshot();
  const baseConfig: OpenClawConfig = snapshot.valid ? (snapshot.config ?? {}) : {};

  // Apply auth profile reference + provider-specific config + default model.
  const withAuthProfile = applyAuthProfileConfig(baseConfig, {
    profileId,
    provider: entry.providerId,
    mode: "api_key",
  });
  const fullyApplied = entry.applyConfig(withAuthProfile);

  // Compute a diff-style config patch for the UI to apply.
  let configPatch: unknown = {};
  configPatch = mergeConfigPatch(
    configPatch,
    buildAuthProfileRefPatch({
      profileId,
      provider: entry.providerId,
      mode: "api_key",
    }),
  );
  // Diff the provider-specific changes.
  configPatch = mergeConfigPatch(configPatch, diffConfigPatch(baseConfig, fullyApplied));

  return {
    profiles: [
      toCompletionProfile({
        profileId,
        credential: { type: "api_key", provider: entry.providerId, key: apiKey },
      }),
    ],
    configPatch,
    defaultModel: entry.defaultModel,
    notes: [`${entry.label} API key stored.`],
  };
}

// ---------------------------------------------------------------------------
// Cloudflare AI Gateway flow runner (multi-field)
// ---------------------------------------------------------------------------
async function runCloudflareAiGatewayFlow(params: {
  api: import("../auth-flow-session.js").AuthFlowSessionApi;
}): Promise<AuthFlowCompletePayload> {
  const { api } = params;

  await api.note(
    "Cloudflare AI Gateway requires an Account ID, Gateway ID, and API key.",
    "Cloudflare AI Gateway",
  );

  const accountId = await api.text({
    message: "Enter Cloudflare Account ID",
    validate: (value) => (value.trim() ? undefined : "Account ID is required"),
  });

  const gatewayId = await api.text({
    message: "Enter Cloudflare AI Gateway ID",
    validate: (value) => (value.trim() ? undefined : "Gateway ID is required"),
  });

  const rawKey = await api.text({
    message: "Enter Cloudflare AI Gateway API key",
    sensitive: true,
    validate: (value) => (value.trim() ? undefined : "API key is required"),
  });

  const apiKey = normalizeApiKeyInput(rawKey);
  await setCloudflareAiGatewayConfig(accountId.trim(), gatewayId.trim(), apiKey);

  const profileId = "cloudflare-ai-gateway:default";
  const provider = "cloudflare-ai-gateway";

  const snapshot = await readConfigFileSnapshot();
  const baseConfig: OpenClawConfig = snapshot.valid ? (snapshot.config ?? {}) : {};

  const withAuthProfile = applyAuthProfileConfig(baseConfig, {
    profileId,
    provider,
    mode: "api_key",
  });
  const fullyApplied = applyCloudflareAiGatewayConfigPatch(withAuthProfile, {
    accountId: accountId.trim(),
    gatewayId: gatewayId.trim(),
  });

  let configPatch: unknown = {};
  configPatch = mergeConfigPatch(
    configPatch,
    buildAuthProfileRefPatch({ profileId, provider, mode: "api_key" }),
  );
  configPatch = mergeConfigPatch(configPatch, diffConfigPatch(baseConfig, fullyApplied));

  return {
    profiles: [
      toCompletionProfile({
        profileId,
        credential: { type: "api_key", provider, key: apiKey },
      }),
    ],
    configPatch,
    defaultModel: CLOUDFLARE_AI_GATEWAY_DEFAULT_MODEL_REF,
    notes: ["Cloudflare AI Gateway configured."],
  };
}

// ---------------------------------------------------------------------------
// Config diff helper
// ---------------------------------------------------------------------------
// Produces a shallow "patch" object containing only the top-level keys that
// changed between `before` and `after`.  Used to compute the configPatch
// payload for built-in API-key flows.
//
// IMPORTANT: The result is sanitised via `stripSecretsFromPatch` to avoid
// leaking any `apiKey` values that config appliers may have preserved from
// the existing config.
// ---------------------------------------------------------------------------
function diffConfigPatch(before: OpenClawConfig, after: OpenClawConfig): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(after) as Array<keyof OpenClawConfig>) {
    if (after[key] !== before[key]) {
      patch[key] = after[key];
    }
  }
  return stripSecretsFromPatch(patch) as Record<string, unknown>;
}

/**
 * Recursively remove `apiKey` properties from a config patch so that
 * credentials stored on disk are never sent back to the UI.  The UI
 * credential model is write-only; the patch should only carry structural
 * config (base URLs, model definitions, auth profile references, etc.).
 */
function stripSecretsFromPatch(value: unknown): unknown {
  if (!isPlainRecord(value)) {
    return value;
  }
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === "apiKey") {
      continue;
    }
    result[k] = isPlainRecord(v) || Array.isArray(v) ? stripSecretsDeep(v) : v;
  }
  return result;
}

function stripSecretsDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripSecretsDeep);
  }
  if (isPlainRecord(value)) {
    return stripSecretsFromPatch(value);
  }
  return value;
}

export const authFlowHandlers: GatewayRequestHandlers = {
  "auth.flow.list": async ({ params, respond }) => {
    if (!validateAuthFlowListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid auth.flow.list params: ${formatValidationErrors(validateAuthFlowListParams.errors)}`,
        ),
      );
      return;
    }

    const snapshot = await readConfigFileSnapshot();
    const cfg = snapshot.valid ? snapshot.config : {};
    const defaultAgentId = resolveDefaultAgentId(cfg);
    const workspaceDir =
      resolveAgentWorkspaceDir(cfg, defaultAgentId) ?? resolveDefaultAgentWorkspaceDir();

    const registry = loadOpenClawPlugins({
      config: cfg,
      workspaceDir,
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
      },
    });

    const providersById = new Map<
      string,
      { providerId: string; label: string; methods: AuthFlowMethodUi[] }
    >();
    for (const entry of registry.providers) {
      const provider = entry.provider;
      const providerId = provider.id;
      const existing = providersById.get(providerId) ?? {
        providerId,
        label: provider.label ?? providerId,
        methods: [],
      };
      existing.methods.push(
        ...provider.auth.map((method) => ({
          providerId,
          providerLabel: provider.label ?? providerId,
          methodId: method.id,
          label: method.label,
          ...(method.hint ? { hint: method.hint } : {}),
          kind: methodKindForUi(method.kind),
          supportsRemote: supportsRemote(method.kind),
          supportsRevoke: false,
        })),
      );
      providersById.set(providerId, existing);
    }

    // Built-in surfaces (manual routes + curated quick-connect helpers).
    const builtinProviders = [
      {
        providerId: "openai-codex",
        label: "OpenAI Codex",
        methods: [
          {
            providerId: "openai-codex",
            providerLabel: "OpenAI Codex",
            methodId: "oauth",
            label: "OAuth (Codex)",
            hint: "Opens browser; may require pasting redirect URL",
            kind: "oauth" as const,
            supportsRemote: true,
            supportsRevoke: false,
          },
        ],
      },
      {
        providerId: "anthropic",
        label: "Anthropic",
        methods: [
          {
            providerId: "anthropic",
            providerLabel: "Anthropic",
            methodId: "oauth",
            label: "OAuth (Claude Pro/Max)",
            hint: "Opens browser; paste authorization code",
            kind: "oauth" as const,
            supportsRemote: true,
            supportsRevoke: false,
          },
          {
            providerId: "anthropic",
            providerLabel: "Anthropic",
            methodId: "api_key",
            label: "API key (manual)",
            hint: "Use the manual API key form",
            kind: "api_key_manual" as const,
            supportsRemote: true,
            supportsRevoke: false,
          },
          {
            providerId: "anthropic",
            providerLabel: "Anthropic",
            methodId: "setup-token",
            label: "setup-token (paste)",
            hint: "Run `claude setup-token`, then paste here",
            kind: "token_paste" as const,
            supportsRemote: true,
            supportsRevoke: false,
          },
        ],
      },
      {
        providerId: "google",
        label: "Google (Gemini API)",
        methods: [
          {
            providerId: "google",
            providerLabel: "Google (Gemini API)",
            methodId: "api_key",
            label: "API key (manual)",
            hint: "Use the manual API key form",
            kind: "api_key_manual" as const,
            supportsRemote: true,
            supportsRevoke: false,
          },
        ],
      },
      // Built-in API-key providers (generated from registry).
      ...BUILTIN_API_KEY_PROVIDERS.map((entry) => ({
        providerId: entry.providerId,
        label: entry.label,
        methods: [
          {
            providerId: entry.providerId,
            providerLabel: entry.label,
            methodId: "api_key",
            label: entry.methodLabel,
            hint: entry.hint,
            kind: "custom" as const,
            supportsRemote: true,
            supportsRevoke: false,
          },
        ],
      })),
      // Cloudflare AI Gateway (multi-field, custom flow).
      {
        providerId: "cloudflare-ai-gateway",
        label: "Cloudflare AI Gateway",
        methods: [
          {
            providerId: "cloudflare-ai-gateway",
            providerLabel: "Cloudflare AI Gateway",
            methodId: "api_key",
            label: "API key + Account/Gateway IDs",
            hint: "Requires Account ID, Gateway ID, and API key",
            kind: "custom" as const,
            supportsRemote: true,
            supportsRevoke: false,
          },
        ],
      },
    ];

    for (const provider of builtinProviders) {
      const existing = providersById.get(provider.providerId);
      if (!existing) {
        providersById.set(provider.providerId, { ...provider, methods: [...provider.methods] });
        continue;
      }
      const combined = [...existing.methods, ...provider.methods];
      providersById.set(provider.providerId, { ...existing, methods: combined });
    }

    const quickConnect = [
      builtinProviders[0].methods[0],
      builtinProviders[1].methods[0],
      builtinProviders[1].methods[2],
      builtinProviders[1].methods[1],
      builtinProviders[2].methods[0],
      // Prefer showing Google OAuth variants as quick connect when available (plugins are workspace-enabled by default).
      ...Array.from(providersById.values())
        .filter(
          (p) =>
            normalizeProviderId(p.providerId) === "google-gemini-cli" ||
            normalizeProviderId(p.providerId) === "google-antigravity",
        )
        .flatMap((p) => p.methods)
        .filter((m) => m.kind === "oauth"),
    ];

    const providers: AuthFlowProviderUi[] = Array.from(providersById.values())
      .map((p) => ({ providerId: p.providerId, label: p.label, methods: p.methods }))
      .toSorted((a, b) => a.label.localeCompare(b.label))
      .map((p) => ({
        ...p,
        methods: p.methods.toSorted((a, b) => a.label.localeCompare(b.label)),
      }));

    respond(true, { quickConnect, providers }, undefined);
  },

  "auth.flow.start": async ({ params, respond, context, client }) => {
    if (!validateAuthFlowStartParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid auth.flow.start params: ${formatValidationErrors(validateAuthFlowStartParams.errors)}`,
        ),
      );
      return;
    }

    const running = context.findRunningAuthFlow();
    if (running) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "auth flow already running"));
      return;
    }

    const sessionId = randomUUID();
    const providerId = params.providerId;
    const methodId = params.methodId;
    const mode = params.mode;

    const runnerOverride = await context.authFlowResolver?.({ providerId, methodId, mode });

    const session = new AuthFlowSession(async (api) => {
      if (runnerOverride) {
        return await runnerOverride(api);
      }
      if (
        normalizeProviderId(providerId) === "anthropic" &&
        methodId.trim().toLowerCase() === "setup-token"
      ) {
        return await runSetupTokenFlow(api);
      }
      if (
        normalizeProviderId(providerId) === "anthropic" &&
        methodId.trim().toLowerCase() === "oauth"
      ) {
        return await runAnthropicOAuthFlow(api);
      }
      if (
        normalizeProviderId(providerId) === "openai-codex" &&
        methodId.trim().toLowerCase() === "oauth"
      ) {
        return await runOpenAICodexOAuthFlow({ api });
      }
      // Built-in API-key providers (no plugin required).
      if (BUILTIN_API_KEY_PROVIDERS_BY_ID.has(normalizeProviderId(providerId))) {
        return await runBuiltinApiKeyFlow({ providerId, methodId, api });
      }
      // Cloudflare AI Gateway (multi-field custom flow).
      if (normalizeProviderId(providerId) === "cloudflare-ai-gateway") {
        return await runCloudflareAiGatewayFlow({ api });
      }
      return await runPluginProviderFlow({ providerId, methodId, mode, api });
    });

    const ownerDeviceId = resolveOwnerDeviceId({ client });
    context.authFlowSessions.set(sessionId, {
      session,
      owner: ownerDeviceId ? { deviceId: ownerDeviceId } : undefined,
      startedAtMs: Date.now(),
      providerId,
      methodId,
    });

    const result = await session.next();
    if (result.done) {
      context.purgeAuthFlowSession(sessionId);
    }
    respond(true, { sessionId, ...result }, undefined);
  },

  "auth.flow.current": ({ params, respond, client, context }) => {
    if (!validateAuthFlowCurrentParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid auth.flow.current params: ${formatValidationErrors(validateAuthFlowCurrentParams.errors)}`,
        ),
      );
      return;
    }
    const runningId = context.findRunningAuthFlow();
    if (!runningId) {
      respond(true, { running: false }, undefined);
      return;
    }
    const entry = context.authFlowSessions.get(runningId);
    if (!entry) {
      respond(true, { running: false }, undefined);
      return;
    }
    const ownerDeviceId = resolveOwnerDeviceId({ client: client ?? { connect: undefined } });
    const owned = Boolean(ownerDeviceId && entry.owner?.deviceId === ownerDeviceId);
    respond(
      true,
      {
        running: true,
        ...(owned ? { sessionId: runningId, owned: true } : { owned: false }),
      },
      undefined,
    );
  },

  "auth.flow.cancelCurrent": ({ params, respond, client, context }) => {
    if (!validateAuthFlowCancelCurrentParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid auth.flow.cancelCurrent params: ${formatValidationErrors(validateAuthFlowCancelCurrentParams.errors)}`,
        ),
      );
      return;
    }
    const runningId = context.findRunningAuthFlow();
    if (!runningId) {
      respond(true, { cancelled: false }, undefined);
      return;
    }
    const entry = context.authFlowSessions.get(runningId);
    if (!entry) {
      respond(true, { cancelled: false }, undefined);
      return;
    }
    const ownerDeviceId = resolveOwnerDeviceId({ client: client ?? { connect: undefined } });
    if (!ownerDeviceId || entry.owner?.deviceId !== ownerDeviceId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "auth flow not owned by client"),
      );
      return;
    }
    entry.session.cancel();
    context.authFlowSessions.delete(runningId);
    respond(true, { cancelled: true }, undefined);
  },

  "auth.flow.next": async ({ params, respond, context, client }) => {
    if (!validateAuthFlowNextParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid auth.flow.next params: ${formatValidationErrors(validateAuthFlowNextParams.errors)}`,
        ),
      );
      return;
    }
    const sessionId = params.sessionId;
    const entry = context.authFlowSessions.get(sessionId);
    if (!entry) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "auth flow not found"));
      return;
    }
    const ownerDeviceId = resolveOwnerDeviceId({ client });
    if (entry.owner?.deviceId && entry.owner.deviceId !== ownerDeviceId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "auth flow not owned by client"),
      );
      return;
    }
    const session = entry.session;
    const answer = params.answer as { stepId?: string; value?: unknown } | undefined;
    if (answer) {
      if (session.getStatus() !== "running") {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "auth flow not running"));
        return;
      }
      try {
        await session.answer(String(answer.stepId ?? ""), answer.value);
      } catch (err) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, formatForLog(err)));
        return;
      }
    }
    const result = await session.next();
    if (result.done) {
      context.purgeAuthFlowSession(sessionId);
    }
    respond(true, result, undefined);
  },
};
