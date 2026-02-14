import type { GatewayBrowserClient } from "../gateway.js";
import type {
  AgentsListResult,
  ConfigSnapshot,
  WorkspaceEntry,
  WorkspaceListResult,
  WorkspaceReadResult,
  WorkspaceWriteResult,
  WorkspaceDeleteResult,
  WorkspaceUploadResult,
} from "../types.js";
import { parseAgentSessionKey } from "../../../../src/routing/session-key.js";
import { generateUUID } from "../uuid.js";

const KB_ROOTS = ["notes", "links", "review", "images"] as const;
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

export type KnowledgeBaseEditorMode =
  | "browse"
  | "create-note"
  | "edit-note"
  | "save-link"
  | "upload-image";

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
  // Editor state
  kbEditorMode: KnowledgeBaseEditorMode;
  kbEditorTitle: string;
  kbEditorContent: string;
  kbEditorSaving: boolean;
  kbEditorError: string | null;
  kbEditorNotice: string | null;
  kbEditorPreviewOpen: boolean;
  kbEditorTags: string;
  kbEditorDirty: boolean;
  kbEditorOriginalTitle: string;
  kbEditorOriginalContent: string;
  kbEditorOriginalTags: string;
  /** Frontmatter fields that are NOT title/tags — preserved on save. */
  kbEditorExtraFrontmatter: Record<string, string>;
  // Delete state
  kbDeleteConfirmPath: string | null;
  kbDeleting: boolean;
  kbDeleteError: string | null;
  // Link save state
  kbLinkUrl: string;
  kbLinkAnalyzing: boolean;
  kbLinkError: string | null;
  // Image upload state
  kbUploadError: string | null;
  kbUploading: boolean;
  // UI state
  kbCollapsedSections: Set<string>;
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
    images: [],
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

// ---- Slug generation ----

function toSlug(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  const suffix = Date.now().toString(16).slice(-6);
  return `${base || "untitled"}-${suffix}`;
}

function buildNoteFrontmatter(title: string, author: "human" | "bot", tags: string): string {
  const now = new Date().toISOString();
  const tagsValue = tags.trim() ? `[${tags.trim()}]` : "[]";
  return `---\ntitle: "${title.replace(/"/g, '\\"')}"\ncreated: "${now}"\nupdated: "${now}"\nauthor: "${author}"\ntags: ${tagsValue}\n---\n\n`;
}

function buildLinkStub(url: string): string {
  const now = new Date().toISOString();
  return `---\nurl: "${url.replace(/"/g, '\\"')}"\nstatus: "pending"\ncreated: "${now}"\ntags: []\n---\n\nAnalyzing...\n`;
}

// ---- Section toggle ----

export function toggleKnowledgeBaseSection(state: KnowledgeBaseState, section: string) {
  const next = new Set(state.kbCollapsedSections);
  if (next.has(section)) {
    next.delete(section);
  } else {
    next.add(section);
  }
  state.kbCollapsedSections = next;
}

// ---- Dirty tracking ----

export function updateKnowledgeBaseEditorDirty(state: KnowledgeBaseState) {
  state.kbEditorDirty =
    state.kbEditorTitle !== state.kbEditorOriginalTitle ||
    state.kbEditorContent !== state.kbEditorOriginalContent ||
    state.kbEditorTags !== state.kbEditorOriginalTags;
}

// ---- Editor mode transitions ----

export function startCreateNote(state: KnowledgeBaseState) {
  state.kbEditorMode = "create-note";
  state.kbEditorTitle = "";
  state.kbEditorContent = "";
  state.kbEditorTags = "";
  state.kbEditorSaving = false;
  state.kbEditorError = null;
  state.kbEditorNotice = null;
  state.kbEditorDirty = false;
  state.kbEditorOriginalTitle = "";
  state.kbEditorOriginalContent = "";
  state.kbEditorOriginalTags = "";
  state.kbEditorExtraFrontmatter = {};
}

export function startEditNote(state: KnowledgeBaseState, filePath: string) {
  if (!state.kbReadResult || state.kbReadResult.path !== filePath) {
    return;
  }
  const content = state.kbReadResult.content;
  // Parse frontmatter: extract title, tags, and preserve everything else
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
  let title = "";
  let tags = "";
  let body = content;
  const extraFrontmatter: Record<string, string> = {};
  if (frontmatterMatch) {
    const rawFm = frontmatterMatch[1];
    for (const line of rawFm.split("\n")) {
      const kvMatch = line.match(/^(\w[\w\s]*?):\s*(.*)$/);
      if (!kvMatch) {
        continue;
      }
      const key = kvMatch[1].trim();
      let value = kvMatch[2].trim();
      if (key === "title") {
        const quoted = value.match(/^"(.*)"$/);
        title = quoted ? quoted[1].replace(/\\"/g, '"') : value;
      } else if (key === "tags") {
        const bracketed = value.match(/^\[([^\]]*)\]$/);
        tags = bracketed ? bracketed[1].trim() : value;
      } else {
        // Preserve the raw value string (including quotes) for non-editable fields
        extraFrontmatter[key] = value;
      }
    }
    body = content.slice(frontmatterMatch[0].length);
  }
  state.kbEditorMode = "edit-note";
  state.kbEditorTitle = title;
  state.kbEditorContent = body;
  state.kbEditorTags = tags;
  state.kbEditorSaving = false;
  state.kbEditorError = null;
  state.kbEditorNotice = null;
  state.kbEditorDirty = false;
  state.kbEditorOriginalTitle = title;
  state.kbEditorOriginalContent = body;
  state.kbEditorOriginalTags = tags;
  state.kbEditorExtraFrontmatter = extraFrontmatter;
}

export function cancelEditor(state: KnowledgeBaseState) {
  state.kbEditorMode = "browse";
  state.kbEditorTitle = "";
  state.kbEditorContent = "";
  state.kbEditorTags = "";
  state.kbEditorSaving = false;
  state.kbEditorError = null;
  state.kbEditorNotice = null;
  state.kbEditorPreviewOpen = false;
  state.kbEditorDirty = false;
  state.kbEditorOriginalTitle = "";
  state.kbEditorOriginalContent = "";
  state.kbEditorOriginalTags = "";
  state.kbEditorExtraFrontmatter = {};
}

export function startSaveLink(state: KnowledgeBaseState) {
  state.kbEditorMode = "save-link";
  state.kbLinkUrl = "";
  state.kbLinkAnalyzing = false;
  state.kbLinkError = null;
  state.kbEditorError = null;
}

/**
 * Called when a URL is pasted via Ctrl/Cmd+V on the Knowledge Base tab.
 * Pre-fills the URL and immediately kicks off the save & analyze workflow.
 */
export function pasteLink(state: KnowledgeBaseState, url: string) {
  if (state.kbLinkAnalyzing) {
    return;
  }
  state.kbEditorMode = "save-link";
  state.kbLinkUrl = url;
  state.kbLinkAnalyzing = false;
  state.kbLinkError = null;
  state.kbEditorError = null;
  void saveLink(state);
}

export function startUploadImage(state: KnowledgeBaseState) {
  state.kbEditorMode = "upload-image";
  state.kbUploadError = null;
  state.kbUploading = false;
}

// ---- CRUD operations ----

export async function saveNote(state: KnowledgeBaseState) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.kbEditorSaving) {
    return;
  }

  const title = state.kbEditorTitle.trim();
  if (!title) {
    state.kbEditorError = "Title is required.";
    return;
  }

  state.kbEditorSaving = true;
  state.kbEditorError = null;
  state.kbEditorNotice = null;

  const agentId = resolveKnowledgeBaseAgentId(state);

  try {
    const tags = state.kbEditorTags.trim();

    if (state.kbEditorMode === "create-note") {
      const slug = toSlug(title);
      const filePath = `notes/${slug}.md`;
      const frontmatter = buildNoteFrontmatter(title, "human", tags);
      const fullContent = frontmatter + state.kbEditorContent;

      await state.client.request<WorkspaceWriteResult>("workspace.write", {
        agentId,
        path: filePath,
        content: fullContent,
        createDirs: true,
      });

      state.kbEditorNotice = "Note created.";
      state.kbEditorMode = "browse";
      state.kbEditorDirty = false;
      state.kbSelectedPath = filePath;
      void loadKnowledgeBase(state);
      void selectKnowledgeBaseFile(state, filePath);
    } else if (state.kbEditorMode === "edit-note" && state.kbSelectedPath) {
      const filePath = state.kbSelectedPath;
      const now = new Date().toISOString();
      const tagsValue = tags ? `[${tags}]` : "[]";
      // Rebuild frontmatter preserving extra fields (url, status, created, etc.)
      const extra = state.kbEditorExtraFrontmatter;
      const fmLines: string[] = [];
      // Preserved fields first (url, status, created, analyzed, etc.)
      for (const [key, rawValue] of Object.entries(extra)) {
        fmLines.push(`${key}: ${rawValue}`);
      }
      // Then editable fields (updated last since we're changing it)
      fmLines.push(`title: "${title.replace(/"/g, '\\"')}"`);
      fmLines.push(`updated: "${now}"`);
      fmLines.push(`author: "human"`);
      fmLines.push(`tags: ${tagsValue}`);
      const frontmatter = `---\n${fmLines.join("\n")}\n---\n\n`;
      const fullContent = frontmatter + state.kbEditorContent;

      await state.client.request<WorkspaceWriteResult>("workspace.write", {
        agentId,
        path: filePath,
        content: fullContent,
      });

      state.kbEditorNotice = "Saved.";
      state.kbEditorMode = "browse";
      state.kbEditorDirty = false;
      void loadKnowledgeBase(state);
      void selectKnowledgeBaseFile(state, filePath);
    }
  } catch (err) {
    state.kbEditorError = toErrorMessage(err);
  } finally {
    state.kbEditorSaving = false;
  }
}

export async function deleteKnowledgeBaseEntry(state: KnowledgeBaseState) {
  if (!state.client || !state.connected) {
    return;
  }
  if (!state.kbDeleteConfirmPath) {
    return;
  }
  if (state.kbDeleting) {
    return;
  }

  state.kbDeleting = true;
  state.kbDeleteError = null;

  const agentId = resolveKnowledgeBaseAgentId(state);
  const filePath = state.kbDeleteConfirmPath;

  try {
    await state.client.request<WorkspaceDeleteResult>("workspace.delete", {
      agentId,
      path: filePath,
    });

    state.kbDeleteConfirmPath = null;
    if (state.kbSelectedPath === filePath) {
      state.kbSelectedPath = null;
      state.kbReadResult = null;
    }
    void loadKnowledgeBase(state);
  } catch (err) {
    state.kbDeleteError = toErrorMessage(err);
  } finally {
    state.kbDeleting = false;
  }
}

export function requestDelete(state: KnowledgeBaseState, filePath: string) {
  state.kbDeleteConfirmPath = filePath;
  state.kbDeleteError = null;
}

export function cancelDelete(state: KnowledgeBaseState) {
  state.kbDeleteConfirmPath = null;
  state.kbDeleteError = null;
}

// ---- Link save ----

export async function saveLink(state: KnowledgeBaseState) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.kbLinkAnalyzing) {
    return;
  }

  const url = state.kbLinkUrl.trim();
  if (!url) {
    state.kbLinkError = "URL is required.";
    return;
  }

  state.kbLinkAnalyzing = true;
  state.kbLinkError = null;

  const agentId = resolveKnowledgeBaseAgentId(state);
  const slug = toSlug(url.replace(/^https?:\/\//, "").replace(/[^a-z0-9]/gi, " "));
  const filePath = `links/${slug}.md`;

  try {
    // Create stub file
    const stub = buildLinkStub(url);
    await state.client.request<WorkspaceWriteResult>("workspace.write", {
      agentId,
      path: filePath,
      content: stub,
      createDirs: true,
    });

    // Send chat message to bot for analysis
    const message = `[KB-LINK-ANALYZE] Fetch and analyze this URL, then update the link file with your analysis.\nURL: ${url}\nFile: ${filePath}\nInclude: title, summary, key points, and suggested tags in the YAML frontmatter. Set status to "analyzed".`;

    await state.client.request("chat.send", {
      sessionKey: state.sessionKey,
      message,
      deliver: false,
      idempotencyKey: generateUUID(),
    });

    // Poll for completion
    let attempts = 0;
    const maxAttempts = 20; // 20 * 3s = 60s
    const pollInterval = 3000;

    const poll = async () => {
      if (attempts >= maxAttempts) {
        state.kbLinkAnalyzing = false;
        state.kbEditorMode = "browse";
        state.kbSelectedPath = filePath;
        void loadKnowledgeBase(state);
        void selectKnowledgeBaseFile(state, filePath);
        return;
      }
      attempts++;
      try {
        const res = await state.client!.request<WorkspaceReadResult>("workspace.read", {
          agentId,
          path: filePath,
          maxBytes: 200_000,
        });
        if (res.content.includes('status: "analyzed"')) {
          state.kbLinkAnalyzing = false;
          state.kbEditorMode = "browse";
          state.kbSelectedPath = filePath;
          state.kbReadResult = res;
          void loadKnowledgeBase(state);
          return;
        }
      } catch {
        // File may not exist yet, continue polling
      }
      setTimeout(poll, pollInterval);
    };

    // Start polling after a brief delay
    setTimeout(poll, pollInterval);

    // Switch to browse mode to show the pending file
    state.kbEditorMode = "browse";
    state.kbSelectedPath = filePath;
    void loadKnowledgeBase(state);
    void selectKnowledgeBaseFile(state, filePath);
  } catch (err) {
    state.kbLinkError = toErrorMessage(err);
    state.kbLinkAnalyzing = false;
  }
}

// ---- Image upload ----

export async function uploadImage(state: KnowledgeBaseState, file: File) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.kbUploading) {
    return;
  }

  state.kbUploading = true;
  state.kbUploadError = null;

  const agentId = resolveKnowledgeBaseAgentId(state);

  try {
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    // Convert to base64
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);

    const suffix = Date.now().toString(16).slice(-6);
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const ext = safeName.includes(".") ? "" : ".png";
    const fileName = `${suffix}-${safeName}${ext}`;

    await state.client.request<WorkspaceUploadResult>("workspace.upload", {
      agentId,
      dir: "images",
      fileName,
      content: base64,
      mimeType: file.type || undefined,
    });

    state.kbEditorMode = "browse";
    void loadKnowledgeBase(state);
  } catch (err) {
    state.kbUploadError = toErrorMessage(err);
  } finally {
    state.kbUploading = false;
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
