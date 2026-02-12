import type { GatewayBrowserClient } from "../gateway.js";
import type {
  AgentsListResult,
  ConfigSnapshot,
  WorkspaceEntry,
  WorkspaceListResult,
  WorkspaceReadResult,
} from "../types.js";
import { parseAgentSessionKey } from "../../../../src/routing/session-key.js";

const KB_ROOTS = ["notes", "links", "review"] as const;
type KnowledgeBaseRoot = (typeof KB_ROOTS)[number];
const EMBEDDING_PROVIDER_VALUES = ["auto", "local", "openai", "gemini", "voyage"] as const;
const EMBEDDING_FALLBACK_VALUES = ["none", "local", "openai", "gemini", "voyage"] as const;

export type KnowledgeBaseEmbeddingProvider = (typeof EMBEDDING_PROVIDER_VALUES)[number];
export type KnowledgeBaseEmbeddingFallback = (typeof EMBEDDING_FALLBACK_VALUES)[number];

export type KnowledgeBaseEmbeddingSettings = {
  provider: KnowledgeBaseEmbeddingProvider;
  fallback: KnowledgeBaseEmbeddingFallback;
  localModelPath: string;
};

const DEFAULT_EMBEDDING_SETTINGS: KnowledgeBaseEmbeddingSettings = {
  provider: "auto",
  fallback: "none",
  localModelPath: "",
};

export type KnowledgeBaseState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  sessionKey: string;
  agentsList: AgentsListResult | null;
  kbLoading: boolean;
  kbError: string | null;
  kbEntries: Record<KnowledgeBaseRoot, WorkspaceEntry[]>;
  kbReadLoading: boolean;
  kbReadError: string | null;
  kbReadResult: WorkspaceReadResult | null;
  kbSelectedPath: string | null;
  kbActiveView: "browse" | "review-queue";
  kbReviewQueueList: string[];
  kbEmbeddingSettingsLoading: boolean;
  kbEmbeddingSettingsSaving: boolean;
  kbEmbeddingSettingsError: string | null;
  kbEmbeddingSettingsNotice: string | null;
  kbEmbeddingSettings: KnowledgeBaseEmbeddingSettings;
};

function resolveKnowledgeBaseAgentId(state: Pick<KnowledgeBaseState, "sessionKey" | "agentsList">) {
  const parsed = parseAgentSessionKey(state.sessionKey);
  return parsed?.agentId ?? state.agentsList?.defaultId ?? "main";
}

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message || "Request failed.";
  }
  if (typeof err === "string") {
    return err || "Request failed.";
  }
  try {
    const serialized = JSON.stringify(err);
    return serialized && serialized !== "{}" ? serialized : "Request failed.";
  } catch {
    return "Request failed.";
  }
}

function isMissingError(message: string): boolean {
  const lowered = message.toLowerCase();
  return lowered.includes("not found") || lowered.includes("enoent");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function asEmbeddingProvider(value: unknown): KnowledgeBaseEmbeddingProvider {
  if (typeof value !== "string") {
    return DEFAULT_EMBEDDING_SETTINGS.provider;
  }
  const normalized = value.trim().toLowerCase();
  return EMBEDDING_PROVIDER_VALUES.includes(normalized as KnowledgeBaseEmbeddingProvider)
    ? (normalized as KnowledgeBaseEmbeddingProvider)
    : DEFAULT_EMBEDDING_SETTINGS.provider;
}

function asEmbeddingFallback(value: unknown): KnowledgeBaseEmbeddingFallback {
  if (typeof value !== "string") {
    return DEFAULT_EMBEDDING_SETTINGS.fallback;
  }
  const normalized = value.trim().toLowerCase();
  return EMBEDDING_FALLBACK_VALUES.includes(normalized as KnowledgeBaseEmbeddingFallback)
    ? (normalized as KnowledgeBaseEmbeddingFallback)
    : DEFAULT_EMBEDDING_SETTINGS.fallback;
}

function readMemorySearchConfig(snapshot: ConfigSnapshot): Record<string, unknown> | null {
  const cfg = snapshot.config;
  if (!isPlainRecord(cfg)) {
    return null;
  }
  const agents = cfg.agents;
  if (!isPlainRecord(agents)) {
    return null;
  }
  const defaults = agents.defaults;
  if (!isPlainRecord(defaults)) {
    return null;
  }
  const memorySearch = defaults.memorySearch;
  if (!isPlainRecord(memorySearch)) {
    return null;
  }
  return memorySearch;
}

export async function loadKnowledgeBase(state: KnowledgeBaseState) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.kbLoading) {
    return;
  }
  state.kbLoading = true;
  state.kbError = null;

  const agentId = resolveKnowledgeBaseAgentId(state);
  const nextEntries: Record<KnowledgeBaseRoot, WorkspaceEntry[]> = {
    notes: [],
    links: [],
    review: [],
  };
  const warnings: string[] = [];

  try {
    for (const root of KB_ROOTS) {
      try {
        const res = await state.client.request<WorkspaceListResult>("workspace.list", {
          agentId,
          dir: root,
          maxDepth: 4,
          includeHidden: false,
          maxEntries: 500,
          cursor: null,
        });
        nextEntries[root] = Array.isArray(res.entries) ? res.entries : [];
      } catch (err) {
        const message = toErrorMessage(err);
        if (!isMissingError(message)) {
          warnings.push(`${root}: ${message}`);
        }
        nextEntries[root] = [];
      }
    }

    state.kbEntries = nextEntries;
    state.kbError = warnings.length
      ? `Some folders could not be loaded: ${warnings.join("; ")}`
      : null;
  } finally {
    state.kbLoading = false;
  }
}

export async function loadKnowledgeBaseEmbeddingSettings(state: KnowledgeBaseState) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.kbEmbeddingSettingsLoading) {
    return;
  }
  state.kbEmbeddingSettingsLoading = true;
  state.kbEmbeddingSettingsError = null;
  state.kbEmbeddingSettingsNotice = null;
  try {
    const snapshot = await state.client.request<ConfigSnapshot>("config.get", {});
    const memorySearch = readMemorySearchConfig(snapshot);
    if (!memorySearch) {
      state.kbEmbeddingSettings = { ...DEFAULT_EMBEDDING_SETTINGS };
      return;
    }
    const local = isPlainRecord(memorySearch.local) ? memorySearch.local : null;
    state.kbEmbeddingSettings = {
      provider: asEmbeddingProvider(memorySearch.provider),
      fallback: asEmbeddingFallback(memorySearch.fallback),
      localModelPath:
        typeof local?.modelPath === "string"
          ? local.modelPath
          : DEFAULT_EMBEDDING_SETTINGS.localModelPath,
    };
  } catch (err) {
    state.kbEmbeddingSettingsError = toErrorMessage(err);
  } finally {
    state.kbEmbeddingSettingsLoading = false;
  }
}

export function updateKnowledgeBaseEmbeddingSettings(
  state: KnowledgeBaseState,
  patch: Partial<KnowledgeBaseEmbeddingSettings>,
) {
  state.kbEmbeddingSettings = {
    ...state.kbEmbeddingSettings,
    ...patch,
  };
  state.kbEmbeddingSettingsError = null;
  state.kbEmbeddingSettingsNotice = null;
}

export function applyKnowledgeBaseLocalEmbeddingPreset(state: KnowledgeBaseState) {
  updateKnowledgeBaseEmbeddingSettings(state, { provider: "local", fallback: "none" });
}

export async function saveKnowledgeBaseEmbeddingSettings(state: KnowledgeBaseState) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.kbEmbeddingSettingsSaving) {
    return;
  }
  state.kbEmbeddingSettingsSaving = true;
  state.kbEmbeddingSettingsError = null;
  state.kbEmbeddingSettingsNotice = null;

  const provider = asEmbeddingProvider(state.kbEmbeddingSettings.provider);
  const fallback = asEmbeddingFallback(state.kbEmbeddingSettings.fallback);
  const localModelPath = state.kbEmbeddingSettings.localModelPath.trim();

  const attempt = async () => {
    const snap = await state.client!.request<ConfigSnapshot>("config.get", {});
    if (!snap?.exists) {
      throw new Error("config does not exist; run onboarding or create config before patching");
    }
    const baseHash = snap.hash ?? null;
    if (!baseHash) {
      throw new Error("config base hash unavailable; re-run config.get and retry");
    }
    const patch = {
      agents: {
        defaults: {
          memorySearch: {
            provider,
            fallback,
            local: {
              modelPath: localModelPath || null,
            },
          },
        },
      },
    };
    await state.client!.request("config.patch", {
      baseHash,
      raw: JSON.stringify(patch, null, 2),
      note: "Updated memory embedding settings from Knowledge Base",
    });
  };

  try {
    await attempt();
    state.kbEmbeddingSettings = {
      provider,
      fallback,
      localModelPath,
    };
    state.kbEmbeddingSettingsNotice = "Saved. Gateway restart scheduled; reconnecting.";
  } catch (err) {
    const message = toErrorMessage(err);
    const shouldRetry =
      message.includes("config changed since last load") ||
      message.includes("config base hash required");
    if (!shouldRetry) {
      state.kbEmbeddingSettingsError = message;
      state.kbEmbeddingSettingsSaving = false;
      return;
    }
    try {
      await attempt();
      state.kbEmbeddingSettings = {
        provider,
        fallback,
        localModelPath,
      };
      state.kbEmbeddingSettingsNotice = "Saved. Gateway restart scheduled; reconnecting.";
    } catch (retryErr) {
      state.kbEmbeddingSettingsError = toErrorMessage(retryErr);
    }
  } finally {
    state.kbEmbeddingSettingsSaving = false;
  }
}

export async function selectKnowledgeBaseFile(state: KnowledgeBaseState, filePath: string) {
  if (!state.client || !state.connected) {
    return;
  }
  const path = filePath.trim();
  if (!path) {
    return;
  }
  state.kbActiveView = "browse";
  state.kbSelectedPath = path;
  state.kbReadLoading = true;
  state.kbReadError = null;
  state.kbReadResult = null;

  const agentId = resolveKnowledgeBaseAgentId(state);
  try {
    const res = await state.client.request<WorkspaceReadResult>("workspace.read", {
      agentId,
      path,
      maxBytes: 200_000,
    });
    state.kbReadResult = res;
  } catch (err) {
    state.kbReadError = toErrorMessage(err);
  } finally {
    state.kbReadLoading = false;
  }
}

export async function openReviewQueue(state: KnowledgeBaseState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.kbActiveView = "review-queue";
  state.kbSelectedPath = null;
  state.kbReviewQueueList = [];
  state.kbReadLoading = true;
  state.kbReadError = null;
  state.kbReadResult = null;

  const agentId = resolveKnowledgeBaseAgentId(state);

  try {
    const res = await state.client.request<WorkspaceReadResult>("workspace.read", {
      agentId,
      path: "review/QUEUE.md",
      maxBytes: 200_000,
    });
    state.kbReadResult = res;
    return;
  } catch (err) {
    const message = toErrorMessage(err);
    if (!isMissingError(message)) {
      state.kbReadError = message;
      return;
    }
  } finally {
    state.kbReadLoading = false;
  }

  state.kbReadLoading = true;
  try {
    const list = await state.client.request<WorkspaceListResult>("workspace.list", {
      agentId,
      dir: "review",
      maxDepth: 0,
      includeHidden: false,
      maxEntries: 500,
      cursor: null,
    });
    const files = Array.isArray(list.entries) ? list.entries : [];
    state.kbReviewQueueList = files
      .filter(
        (entry): entry is WorkspaceEntry =>
          Boolean(entry) &&
          entry.kind === "file" &&
          typeof entry.path === "string" &&
          entry.path.startsWith("review/"),
      )
      .map((entry) => entry.path)
      .filter((filePath) => filePath.toLowerCase().endsWith(".md"))
      .toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  } catch (err) {
    state.kbReadError = toErrorMessage(err);
  } finally {
    state.kbReadLoading = false;
  }
}
