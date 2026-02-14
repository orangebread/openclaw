import { html, nothing } from "lit";
import { live } from "lit/directives/live.js";
import type {
  AgentFileEntry,
  AgentsFilesListResult,
  AgentsListResult,
  AgentIdentityResult,
  AuthProfileSummary,
  ChannelAccountSnapshot,
  ChannelsStatusSnapshot,
  CronJob,
  CronStatus,
  ModelChoice,
  SkillStatusEntry,
  SkillStatusReport,
} from "../types.ts";
import {
  expandToolGroups,
  normalizeToolName,
  resolveToolProfilePolicy,
} from "../../../../src/agents/tool-policy.js";
import { formatRelativeTimestamp } from "../format.ts";
import {
  formatCronPayload,
  formatCronSchedule,
  formatCronState,
  formatNextRun,
} from "../presenter.ts";

export type AgentsPanel = "overview" | "files" | "tools" | "skills" | "channels" | "cron";

export type AgentsProps = {
  loading: boolean;
  error: string | null;
  agentsList: AgentsListResult | null;
  selectedAgentId: string | null;
  activePanel: AgentsPanel;
  configForm: Record<string, unknown> | null;
  catalogModels: ModelChoice[];
  configLoading: boolean;
  configSaving: boolean;
  configDirty: boolean;
  channelsLoading: boolean;
  channelsError: string | null;
  channelsSnapshot: ChannelsStatusSnapshot | null;
  channelsLastSuccess: number | null;
  cronLoading: boolean;
  cronStatus: CronStatus | null;
  cronJobs: CronJob[];
  cronError: string | null;
  agentFilesLoading: boolean;
  agentFilesError: string | null;
  agentFilesList: AgentsFilesListResult | null;
  agentFileActive: string | null;
  agentFileContents: Record<string, string>;
  agentFileDrafts: Record<string, string>;
  agentFileSaving: boolean;
  agentIdentityLoading: boolean;
  agentIdentityError: string | null;
  agentIdentityById: Record<string, AgentIdentityResult>;
  agentSkillsLoading: boolean;
  agentSkillsReport: SkillStatusReport | null;
  agentSkillsError: string | null;
  agentSkillsAgentId: string | null;
  skillsFilter: string;
  onRefresh: () => void;
  onSelectAgent: (agentId: string) => void;
  onSelectPanel: (panel: AgentsPanel) => void;
  onLoadFiles: (agentId: string) => void;
  onSelectFile: (name: string) => void;
  onFileDraftChange: (name: string, content: string) => void;
  onFileReset: (name: string) => void;
  onFileSave: (name: string) => void;
  onToolsProfileChange: (agentId: string, profile: string | null, clearAllow: boolean) => void;
  onToolsOverridesChange: (agentId: string, alsoAllow: string[], deny: string[]) => void;
  onConfigReload: () => void;
  onConfigSave: () => void;
  onModelChange: (agentId: string, modelId: string | null) => void;
  onModelFallbacksChange: (agentId: string, fallbacks: string[]) => void;
  onAuthProfileChange: (agentId: string, profileId: string | null) => void;
  onImageModelChange: (agentId: string, modelId: string | null) => void;
  onImageModelFallbacksChange: (agentId: string, fallbacks: string[]) => void;
  onImageAuthProfileChange: (agentId: string, profileId: string | null) => void;
  onSubagentsAllowChange: (agentId: string, allowAgents: string[]) => void;
  onSubagentsModelChange: (agentId: string, modelId: string | null) => void;
  onSubagentsThinkingChange: (agentId: string, thinking: string | null) => void;
  authProfiles: AuthProfileSummary[];
  onChannelsRefresh: () => void;
  onCronRefresh: () => void;
  onSkillsFilterChange: (next: string) => void;
  onSkillsRefresh: () => void;
  onAgentSkillToggle: (agentId: string, skillName: string, enabled: boolean) => void;
  onAgentSkillsClear: (agentId: string) => void;
  onAgentSkillsDisableAll: (agentId: string) => void;
  onIdentityNameChange: (agentId: string, name: string) => void;
  onIdentityEmojiChange: (agentId: string, emoji: string) => void;
  showAddForm: boolean;
  creating: boolean;
  createError: string | null;
  deleting: boolean;
  deleteError: string | null;
  onShowAddForm: () => void;
  onHideAddForm: () => void;
  onCreateAgent: (params: { name: string; workspace: string; emoji?: string }) => void;
  onDeleteAgent: (agentId: string) => void;
};

const TOOL_SECTIONS = [
  {
    id: "fs",
    label: "Files",
    tools: [
      { id: "read", label: "read", description: "Read file contents" },
      { id: "write", label: "write", description: "Create or overwrite files" },
      { id: "edit", label: "edit", description: "Make precise edits" },
      { id: "apply_patch", label: "apply_patch", description: "Patch files (OpenAI)" },
    ],
  },
  {
    id: "runtime",
    label: "Runtime",
    tools: [
      { id: "exec", label: "exec", description: "Run shell commands" },
      { id: "process", label: "process", description: "Manage background processes" },
    ],
  },
  {
    id: "web",
    label: "Web",
    tools: [
      { id: "web_search", label: "web_search", description: "Search the web" },
      { id: "web_fetch", label: "web_fetch", description: "Fetch web content" },
    ],
  },
  {
    id: "memory",
    label: "Memory",
    tools: [
      { id: "memory_search", label: "memory_search", description: "Semantic search" },
      { id: "memory_get", label: "memory_get", description: "Read memory files" },
    ],
  },
  {
    id: "sessions",
    label: "Sessions",
    tools: [
      { id: "sessions_list", label: "sessions_list", description: "List sessions" },
      { id: "sessions_history", label: "sessions_history", description: "Session history" },
      { id: "sessions_send", label: "sessions_send", description: "Send to session" },
      { id: "sessions_spawn", label: "sessions_spawn", description: "Spawn sub-agent" },
      { id: "session_status", label: "session_status", description: "Session status" },
    ],
  },
  {
    id: "ui",
    label: "UI",
    tools: [
      { id: "browser", label: "browser", description: "Control web browser" },
      { id: "canvas", label: "canvas", description: "Control canvases" },
    ],
  },
  {
    id: "messaging",
    label: "Messaging",
    tools: [{ id: "message", label: "message", description: "Send messages" }],
  },
  {
    id: "automation",
    label: "Automation",
    tools: [
      { id: "cron", label: "cron", description: "Schedule tasks" },
      { id: "gateway", label: "gateway", description: "Gateway control" },
    ],
  },
  {
    id: "nodes",
    label: "Nodes",
    tools: [{ id: "nodes", label: "nodes", description: "Nodes + devices" }],
  },
  {
    id: "agents",
    label: "Agents",
    tools: [{ id: "agents_list", label: "agents_list", description: "List agents" }],
  },
  {
    id: "media",
    label: "Media",
    tools: [{ id: "image", label: "image", description: "Image understanding" }],
  },
];

const PROFILE_OPTIONS = [
  { id: "minimal", label: "Minimal" },
  { id: "coding", label: "Coding" },
  { id: "messaging", label: "Messaging" },
  { id: "full", label: "Full" },
] as const;

const EMOJI_PRESETS = [
  "🤖",
  "🧠",
  "🔬",
  "🛡️",
  "📊",
  "🎯",
  "🦊",
  "🐙",
  "🦉",
  "🐺",
  "🦅",
  "🐍",
  "🦎",
  "🐝",
  "🕷️",
  "🦇",
  "👻",
  "🧙",
  "🧛",
  "🥷",
  "🧑‍🚀",
  "🧑‍💻",
  "🕵️",
  "🤠",
  "💎",
  "⚡",
  "🔥",
  "🌊",
  "🌀",
  "☄️",
  "🌙",
  "🪐",
  "⚔️",
  "🗡️",
  "🏹",
  "🛸",
  "🧬",
  "🔮",
  "📡",
  "🎭",
];

type ToolPolicy = {
  allow?: string[];
  deny?: string[];
};

type AgentConfigEntry = {
  id: string;
  name?: string;
  workspace?: string;
  agentDir?: string;
  model?: unknown;
  authProfileId?: string;
  imageModel?: unknown;
  imageAuthProfileId?: string;
  skills?: string[];
  identity?: {
    name?: string;
    emoji?: string;
    avatar?: string;
    theme?: string;
  };
  tools?: {
    profile?: string;
    allow?: string[];
    alsoAllow?: string[];
    deny?: string[];
  };
  subagents?: {
    allowAgents?: string[];
    model?: unknown;
    thinking?: string;
  };
};

type ConfigSnapshot = {
  agents?: {
    defaults?: { workspace?: string; model?: unknown; models?: Record<string, { alias?: string }> };
    list?: AgentConfigEntry[];
  };
  tools?: {
    profile?: string;
    allow?: string[];
    alsoAllow?: string[];
    deny?: string[];
  };
};

function normalizeAgentLabel(agent: { id: string; name?: string; identity?: { name?: string } }) {
  return agent.name?.trim() || agent.identity?.name?.trim() || agent.id;
}

function isLikelyEmoji(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.length > 16) {
    return false;
  }
  let hasNonAscii = false;
  for (let i = 0; i < trimmed.length; i += 1) {
    if (trimmed.charCodeAt(i) > 127) {
      hasNonAscii = true;
      break;
    }
  }
  if (!hasNonAscii) {
    return false;
  }
  if (trimmed.includes("://") || trimmed.includes("/") || trimmed.includes(".")) {
    return false;
  }
  return true;
}

function resolveAgentEmoji(
  agent: { identity?: { emoji?: string; avatar?: string } },
  agentIdentity?: AgentIdentityResult | null,
) {
  const identityEmoji = agentIdentity?.emoji?.trim();
  if (identityEmoji && isLikelyEmoji(identityEmoji)) {
    return identityEmoji;
  }
  const agentEmoji = agent.identity?.emoji?.trim();
  if (agentEmoji && isLikelyEmoji(agentEmoji)) {
    return agentEmoji;
  }
  const identityAvatar = agentIdentity?.avatar?.trim();
  if (identityAvatar && isLikelyEmoji(identityAvatar)) {
    return identityAvatar;
  }
  const avatar = agent.identity?.avatar?.trim();
  if (avatar && isLikelyEmoji(avatar)) {
    return avatar;
  }
  return "";
}

function agentBadgeText(agentId: string, defaultId: string | null) {
  return defaultId && agentId === defaultId ? "default" : null;
}

function formatBytes(bytes?: number) {
  if (bytes == null || !Number.isFinite(bytes)) {
    return "-";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let size = bytes / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size < 10 ? 1 : 0)} ${units[unitIndex]}`;
}

function resolveAgentConfig(config: Record<string, unknown> | null, agentId: string) {
  const cfg = config as ConfigSnapshot | null;
  const list = cfg?.agents?.list ?? [];
  const entry = list.find((agent) => agent?.id === agentId);
  return {
    entry,
    defaults: cfg?.agents?.defaults,
    globalTools: cfg?.tools,
  };
}

type AgentContext = {
  workspace: string;
  model: string;
  identityName: string;
  identityEmoji: string;
  skillsLabel: string;
  isDefault: boolean;
};

function buildAgentContext(
  agent: AgentsListResult["agents"][number],
  configForm: Record<string, unknown> | null,
  agentFilesList: AgentsFilesListResult | null,
  defaultId: string | null,
  agentIdentity?: AgentIdentityResult | null,
): AgentContext {
  const config = resolveAgentConfig(configForm, agent.id);
  const workspaceFromFiles =
    agentFilesList && agentFilesList.agentId === agent.id ? agentFilesList.workspace : null;
  const workspace =
    workspaceFromFiles || config.entry?.workspace || config.defaults?.workspace || "default";
  const modelLabel = config.entry?.model
    ? resolveModelLabel(config.entry?.model)
    : resolveModelLabel(config.defaults?.model);
  const identityName =
    agentIdentity?.name?.trim() ||
    agent.identity?.name?.trim() ||
    agent.name?.trim() ||
    config.entry?.name ||
    agent.id;
  const identityEmoji = resolveAgentEmoji(agent, agentIdentity) || "-";
  const skillFilter = Array.isArray(config.entry?.skills) ? config.entry?.skills : null;
  const skillCount = skillFilter?.length ?? null;
  return {
    workspace,
    model: modelLabel,
    identityName,
    identityEmoji,
    skillsLabel: skillFilter ? `${skillCount} selected` : "all skills",
    isDefault: Boolean(defaultId && agent.id === defaultId),
  };
}

function resolveModelLabel(model?: unknown): string {
  if (!model) {
    return "-";
  }
  if (typeof model === "string") {
    return model.trim() || "-";
  }
  if (typeof model === "object" && model) {
    const record = model as { primary?: string; fallbacks?: string[] };
    const primary = record.primary?.trim();
    if (primary) {
      const fallbackCount = Array.isArray(record.fallbacks) ? record.fallbacks.length : 0;
      return fallbackCount > 0 ? `${primary} (+${fallbackCount} fallback)` : primary;
    }
  }
  return "-";
}

function normalizeModelValue(label: string): string {
  const match = label.match(/^(.+) \(\+\d+ fallback\)$/);
  return match ? match[1] : label;
}

function resolveModelPrimary(model?: unknown): string | null {
  if (!model) {
    return null;
  }
  if (typeof model === "string") {
    const trimmed = model.trim();
    return trimmed || null;
  }
  if (typeof model === "object" && model) {
    const record = model as Record<string, unknown>;
    const candidate =
      typeof record.primary === "string"
        ? record.primary
        : typeof record.model === "string"
          ? record.model
          : typeof record.id === "string"
            ? record.id
            : typeof record.value === "string"
              ? record.value
              : null;
    const primary = candidate?.trim();
    return primary || null;
  }
  return null;
}

function resolveModelFallbacks(model?: unknown): string[] | null {
  if (!model || typeof model === "string") {
    return null;
  }
  if (typeof model === "object" && model) {
    const record = model as Record<string, unknown>;
    const fallbacks = Array.isArray(record.fallbacks)
      ? record.fallbacks
      : Array.isArray(record.fallback)
        ? record.fallback
        : null;
    return fallbacks
      ? fallbacks.filter((entry): entry is string => typeof entry === "string")
      : null;
  }
  return null;
}

function parseFallbackList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function extractProviderFromModel(modelRef: string | null): string | null {
  if (!modelRef) {
    return null;
  }
  const idx = modelRef.indexOf("/");
  if (idx > 0) {
    return modelRef.slice(0, idx).trim().toLowerCase() || null;
  }
  return null;
}

function profileStatusLabel(profile: AuthProfileSummary): string {
  const now = Date.now();
  if (typeof profile.disabledUntil === "number" && profile.disabledUntil > now) {
    return " [disabled]";
  }
  if (typeof profile.cooldownUntil === "number" && profile.cooldownUntil > now) {
    return " [cooldown]";
  }
  return "";
}

type ConfiguredModelOption = {
  value: string;
  label: string;
  group?: "configured" | "available";
};

function resolveConfiguredModels(
  configForm: Record<string, unknown> | null,
): ConfiguredModelOption[] {
  const cfg = configForm as ConfigSnapshot | null;
  const models = cfg?.agents?.defaults?.models;
  if (!models || typeof models !== "object") {
    return [];
  }
  const options: ConfiguredModelOption[] = [];
  for (const [modelId, modelRaw] of Object.entries(models)) {
    const trimmed = modelId.trim();
    if (!trimmed) {
      continue;
    }
    const alias =
      modelRaw && typeof modelRaw === "object" && "alias" in modelRaw
        ? typeof (modelRaw as { alias?: unknown }).alias === "string"
          ? (modelRaw as { alias?: string }).alias?.trim()
          : undefined
        : undefined;
    const label = alias && alias !== trimmed ? `${alias} (${trimmed})` : trimmed;
    options.push({ value: trimmed, label, group: "configured" });
  }
  return options;
}

function capitalizeProvider(provider: string): string {
  if (!provider) {
    return provider;
  }
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

function buildAvailableProviders(
  catalogModels: ModelChoice[],
  configForm: Record<string, unknown> | null,
  authProfiles: AuthProfileSummary[],
): string[] {
  // Start from providers that have configured credentials.
  const credentialProviders = new Set<string>();
  for (const profile of authProfiles) {
    if (profile.provider) {
      credentialProviders.add(profile.provider.toLowerCase());
    }
  }

  // If credentials exist, restrict to those providers (from catalog + config).
  // If no credentials exist at all, fall back to showing all catalog providers
  // so the UI isn't empty before any credentials are added.
  if (credentialProviders.size > 0) {
    const providerSet = new Set<string>();

    for (const entry of catalogModels) {
      const provider = entry.provider.toLowerCase();
      if (credentialProviders.has(provider)) {
        providerSet.add(provider);
      }
    }

    // Include providers from configured models only if they have credentials.
    const configured = resolveConfiguredModels(configForm);
    for (const option of configured) {
      const provider = extractProviderFromModel(option.value);
      if (provider && credentialProviders.has(provider.toLowerCase())) {
        providerSet.add(provider.toLowerCase());
      }
    }

    // Also include credential providers even if no catalog models exist for them
    // (user may have added a custom provider key).
    for (const cp of credentialProviders) {
      providerSet.add(cp);
    }

    return Array.from(providerSet).toSorted();
  }

  // Fallback: no credentials configured yet — show all catalog providers.
  const providerSet = new Set<string>();
  for (const entry of catalogModels) {
    providerSet.add(entry.provider.toLowerCase());
  }
  const configured = resolveConfiguredModels(configForm);
  for (const option of configured) {
    const provider = extractProviderFromModel(option.value);
    if (provider) {
      providerSet.add(provider.toLowerCase());
    }
  }
  return Array.from(providerSet).toSorted();
}

function buildModelsForProvider(
  provider: string,
  catalogModels: ModelChoice[],
  configForm: Record<string, unknown> | null,
): Array<{ value: string; label: string }> {
  const normalizedProvider = provider.toLowerCase();
  const options: Array<{ value: string; label: string }> = [];
  const seen = new Set<string>();

  // Configured models for this provider.
  const configured = resolveConfiguredModels(configForm);
  for (const option of configured) {
    const optProvider = extractProviderFromModel(option.value);
    if (optProvider?.toLowerCase() === normalizedProvider && !seen.has(option.value)) {
      seen.add(option.value);
      options.push(option);
    }
  }

  // Catalog models for this provider.
  for (const entry of catalogModels) {
    if (entry.provider.toLowerCase() !== normalizedProvider) {
      continue;
    }
    const value = `${entry.provider}/${entry.id}`;
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    options.push({ value, label: entry.name || entry.id });
  }

  return options;
}

type CompiledPattern =
  | { kind: "all" }
  | { kind: "exact"; value: string }
  | { kind: "regex"; value: RegExp };

function compilePattern(pattern: string): CompiledPattern {
  const normalized = normalizeToolName(pattern);
  if (!normalized) {
    return { kind: "exact", value: "" };
  }
  if (normalized === "*") {
    return { kind: "all" };
  }
  if (!normalized.includes("*")) {
    return { kind: "exact", value: normalized };
  }
  const escaped = normalized.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");
  return { kind: "regex", value: new RegExp(`^${escaped.replaceAll("\\*", ".*")}$`) };
}

function compilePatterns(patterns?: string[]): CompiledPattern[] {
  if (!Array.isArray(patterns)) {
    return [];
  }
  return expandToolGroups(patterns)
    .map(compilePattern)
    .filter((pattern) => {
      return pattern.kind !== "exact" || pattern.value.length > 0;
    });
}

function matchesAny(name: string, patterns: CompiledPattern[]) {
  for (const pattern of patterns) {
    if (pattern.kind === "all") {
      return true;
    }
    if (pattern.kind === "exact" && name === pattern.value) {
      return true;
    }
    if (pattern.kind === "regex" && pattern.value.test(name)) {
      return true;
    }
  }
  return false;
}

function isAllowedByPolicy(name: string, policy?: ToolPolicy) {
  if (!policy) {
    return true;
  }
  const normalized = normalizeToolName(name);
  const deny = compilePatterns(policy.deny);
  if (matchesAny(normalized, deny)) {
    return false;
  }
  const allow = compilePatterns(policy.allow);
  if (allow.length === 0) {
    return true;
  }
  if (matchesAny(normalized, allow)) {
    return true;
  }
  if (normalized === "apply_patch" && matchesAny("exec", allow)) {
    return true;
  }
  return false;
}

function matchesList(name: string, list?: string[]) {
  if (!Array.isArray(list) || list.length === 0) {
    return false;
  }
  const normalized = normalizeToolName(name);
  const patterns = compilePatterns(list);
  if (matchesAny(normalized, patterns)) {
    return true;
  }
  if (normalized === "apply_patch" && matchesAny("exec", patterns)) {
    return true;
  }
  return false;
}

export function renderAgents(props: AgentsProps) {
  const agents = props.agentsList?.agents ?? [];
  const defaultId = props.agentsList?.defaultId ?? null;
  const selectedId = props.selectedAgentId ?? defaultId ?? agents[0]?.id ?? null;
  const selectedAgent = selectedId
    ? (agents.find((agent) => agent.id === selectedId) ?? null)
    : null;

  return html`
    <div class="agents-layout">
      <section class="card agents-sidebar">
        <div class="row" style="justify-content: space-between;">
          <div>
            <div class="card-title">Agents</div>
            <div class="card-sub">${agents.length} configured.</div>
          </div>
          <div class="row" style="gap: 6px;">
            <button
              class="btn btn--sm"
              ?disabled=${props.loading || props.creating}
              @click=${props.onShowAddForm}
              title="Add agent"
            >+</button>
            <button class="btn btn--sm" ?disabled=${props.loading} @click=${props.onRefresh}>
              ${props.loading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>
        ${
          props.error
            ? html`<div class="callout danger" style="margin-top: 12px;">${props.error}</div>`
            : nothing
        }
        ${props.showAddForm ? renderAddAgentForm(props) : nothing}
        <div class="agent-list" style="margin-top: 12px;">
          ${
            agents.length === 0
              ? html`
                  <div class="muted">No agents found.</div>
                `
              : agents.map((agent) => {
                  const badge = agentBadgeText(agent.id, defaultId);
                  const emoji = resolveAgentEmoji(agent, props.agentIdentityById[agent.id] ?? null);
                  return html`
                    <button
                      type="button"
                      class="agent-row ${selectedId === agent.id ? "active" : ""}"
                      @click=${() => props.onSelectAgent(agent.id)}
                    >
                      <div class="agent-avatar">
                        ${emoji || normalizeAgentLabel(agent).slice(0, 1)}
                      </div>
                      <div class="agent-info">
                        <div class="agent-title">${normalizeAgentLabel(agent)}</div>
                        <div class="agent-sub mono">${agent.id}</div>
                      </div>
                      ${badge ? html`<span class="agent-pill">${badge}</span>` : nothing}
                    </button>
                  `;
                })
          }
        </div>
      </section>
      <section class="agents-main">
        ${
          !selectedAgent
            ? html`
                <div class="card">
                  <div class="card-title">Select an agent</div>
                  <div class="card-sub">Pick an agent to inspect its workspace and tools.</div>
                </div>
              `
            : html`
              ${renderAgentHeader(
                selectedAgent,
                defaultId,
                props.agentIdentityById[selectedAgent.id] ?? null,
                props.deleting,
                props.deleteError,
                props.onDeleteAgent,
              )}
              ${renderAgentTabs(props.activePanel, (panel) => props.onSelectPanel(panel))}
              ${
                props.activePanel === "overview"
                  ? renderAgentOverview({
                      agent: selectedAgent,
                      defaultId,
                      configForm: props.configForm,
                      catalogModels: props.catalogModels,
                      agentFilesList: props.agentFilesList,
                      agentIdentity: props.agentIdentityById[selectedAgent.id] ?? null,
                      agentIdentityError: props.agentIdentityError,
                      agentIdentityLoading: props.agentIdentityLoading,
                      configLoading: props.configLoading,
                      configSaving: props.configSaving,
                      configDirty: props.configDirty,
                      authProfiles: props.authProfiles,
                      onConfigReload: props.onConfigReload,
                      onConfigSave: props.onConfigSave,
                      onModelChange: props.onModelChange,
                      onModelFallbacksChange: props.onModelFallbacksChange,
                      onAuthProfileChange: props.onAuthProfileChange,
                      onImageModelChange: props.onImageModelChange,
                      onImageModelFallbacksChange: props.onImageModelFallbacksChange,
                      onImageAuthProfileChange: props.onImageAuthProfileChange,
                      onSubagentsAllowChange: props.onSubagentsAllowChange,
                      onSubagentsModelChange: props.onSubagentsModelChange,
                      onSubagentsThinkingChange: props.onSubagentsThinkingChange,
                      onIdentityNameChange: props.onIdentityNameChange,
                      onIdentityEmojiChange: props.onIdentityEmojiChange,
                      onSelectAgent: props.onSelectAgent,
                    })
                  : nothing
              }
              ${
                props.activePanel === "files"
                  ? renderAgentFiles({
                      agentId: selectedAgent.id,
                      agentFilesList: props.agentFilesList,
                      agentFilesLoading: props.agentFilesLoading,
                      agentFilesError: props.agentFilesError,
                      agentFileActive: props.agentFileActive,
                      agentFileContents: props.agentFileContents,
                      agentFileDrafts: props.agentFileDrafts,
                      agentFileSaving: props.agentFileSaving,
                      onLoadFiles: props.onLoadFiles,
                      onSelectFile: props.onSelectFile,
                      onFileDraftChange: props.onFileDraftChange,
                      onFileReset: props.onFileReset,
                      onFileSave: props.onFileSave,
                    })
                  : nothing
              }
              ${
                props.activePanel === "tools"
                  ? renderAgentTools({
                      agentId: selectedAgent.id,
                      configForm: props.configForm,
                      configLoading: props.configLoading,
                      configSaving: props.configSaving,
                      configDirty: props.configDirty,
                      onProfileChange: props.onToolsProfileChange,
                      onOverridesChange: props.onToolsOverridesChange,
                      onConfigReload: props.onConfigReload,
                      onConfigSave: props.onConfigSave,
                    })
                  : nothing
              }
              ${
                props.activePanel === "skills"
                  ? renderAgentSkills({
                      agentId: selectedAgent.id,
                      report: props.agentSkillsReport,
                      loading: props.agentSkillsLoading,
                      error: props.agentSkillsError,
                      activeAgentId: props.agentSkillsAgentId,
                      configForm: props.configForm,
                      configLoading: props.configLoading,
                      configSaving: props.configSaving,
                      configDirty: props.configDirty,
                      filter: props.skillsFilter,
                      onFilterChange: props.onSkillsFilterChange,
                      onRefresh: props.onSkillsRefresh,
                      onToggle: props.onAgentSkillToggle,
                      onClear: props.onAgentSkillsClear,
                      onDisableAll: props.onAgentSkillsDisableAll,
                      onConfigReload: props.onConfigReload,
                      onConfigSave: props.onConfigSave,
                    })
                  : nothing
              }
              ${
                props.activePanel === "channels"
                  ? renderAgentChannels({
                      agent: selectedAgent,
                      defaultId,
                      configForm: props.configForm,
                      agentFilesList: props.agentFilesList,
                      agentIdentity: props.agentIdentityById[selectedAgent.id] ?? null,
                      snapshot: props.channelsSnapshot,
                      loading: props.channelsLoading,
                      error: props.channelsError,
                      lastSuccess: props.channelsLastSuccess,
                      onRefresh: props.onChannelsRefresh,
                    })
                  : nothing
              }
              ${
                props.activePanel === "cron"
                  ? renderAgentCron({
                      agent: selectedAgent,
                      defaultId,
                      configForm: props.configForm,
                      agentFilesList: props.agentFilesList,
                      agentIdentity: props.agentIdentityById[selectedAgent.id] ?? null,
                      jobs: props.cronJobs,
                      status: props.cronStatus,
                      loading: props.cronLoading,
                      error: props.cronError,
                      onRefresh: props.onCronRefresh,
                    })
                  : nothing
              }
            `
        }
      </section>
    </div>
  `;
}

function renderAddAgentForm(props: AgentsProps) {
  const handleSubmit = (e: Event) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const formData = new FormData(form);
    const nameRaw = formData.get("name");
    const emojiRaw = formData.get("emoji");
    const name = (typeof nameRaw === "string" ? nameRaw : "").trim();
    const emoji = (typeof emojiRaw === "string" ? emojiRaw : "").trim();
    if (!name) {
      return;
    }
    // Derive workspace from the agent id (lowercase, hyphenated name)
    const agentId = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    if (!agentId) {
      return;
    }
    const workspace = `~/.openclaw/workspace-${agentId}`;
    props.onCreateAgent({ name, workspace, ...(emoji ? { emoji } : {}) });
  };

  return html`
    <div class="agent-add-form" style="margin-top: 12px;">
      <div class="card-sub" style="margin-bottom: 8px; font-weight: 600;">New Agent</div>
      ${
        props.createError
          ? html`<div class="callout danger" style="margin-bottom: 8px;">${props.createError}</div>`
          : nothing
      }
      <form @submit=${handleSubmit} style="display: grid; gap: 8px;">
        <label class="field">
          <span>Name</span>
          <input
            type="text"
            name="name"
            placeholder="e.g. Research Assistant"
            required
            ?disabled=${props.creating}
            autofocus
          />
        </label>
        <div class="agent-identity-emoji-wrap">
          <label class="field">
            <span>Emoji (optional)</span>
            <input
              type="text"
              name="emoji"
              id="add-agent-emoji"
              placeholder="e.g. \u{1F916}"
              ?disabled=${props.creating}
              style="max-width: 120px;"
            />
          </label>
          <details class="agent-emoji-details">
            <summary class="btn btn--sm" style="margin-top: 6px;">Pick emoji</summary>
            <div class="agent-emoji-picker-grid" style="margin-top: 8px;">
              ${EMOJI_PRESETS.map(
                (em) => html`
                  <button
                    type="button"
                    class="agent-emoji-option"
                    ?disabled=${props.creating}
                    title=${em}
                    @click=${() => {
                      const input = document.getElementById(
                        "add-agent-emoji",
                      ) as HTMLInputElement | null;
                      if (input) {
                        input.value = em;
                        input.dispatchEvent(new Event("input", { bubbles: true }));
                      }
                    }}
                  >${em}</button>
                `,
              )}
            </div>
          </details>
        </div>
        <div class="row" style="gap: 8px; margin-top: 4px;">
          <button class="btn btn--sm primary" type="submit" ?disabled=${props.creating}>
            ${props.creating ? "Creating…" : "Create"}
          </button>
          <button
            class="btn btn--sm"
            type="button"
            ?disabled=${props.creating}
            @click=${props.onHideAddForm}
          >Cancel</button>
        </div>
      </form>
    </div>
  `;
}

function renderAgentHeader(
  agent: AgentsListResult["agents"][number],
  defaultId: string | null,
  agentIdentity: AgentIdentityResult | null,
  deleting: boolean,
  deleteError: string | null,
  onDeleteAgent: (agentId: string) => void,
) {
  const badge = agentBadgeText(agent.id, defaultId);
  const displayName = normalizeAgentLabel(agent);
  const subtitle = agent.identity?.theme?.trim() || "Agent workspace and routing.";
  const emoji = resolveAgentEmoji(agent, agentIdentity);
  const isDefault = Boolean(defaultId && agent.id === defaultId);
  const isMain = agent.id === "main";
  const canDelete = !isDefault && !isMain;
  return html`
    <section class="card agent-header">
      <div class="agent-header-main">
        <div class="agent-avatar agent-avatar--lg">
          ${emoji || displayName.slice(0, 1)}
        </div>
        <div>
          <div class="card-title">${displayName}</div>
          <div class="card-sub">${subtitle}</div>
        </div>
      </div>
      <div class="agent-header-meta">
        <div class="mono">${agent.id}</div>
        <div class="row" style="gap: 8px;">
          ${badge ? html`<span class="agent-pill">${badge}</span>` : nothing}
          ${
            canDelete
              ? html`
                  <button
                    class="btn btn--sm danger"
                    ?disabled=${deleting}
                    @click=${() => onDeleteAgent(agent.id)}
                    title="Delete this agent"
                  >${deleting ? "Deleting…" : "Delete"}</button>
                `
              : nothing
          }
        </div>
      </div>
      ${
        deleteError
          ? html`<div class="callout danger" style="grid-column: 1 / -1; margin-top: 8px;">
              ${deleteError}
            </div>`
          : nothing
      }
    </section>
  `;
}

function renderAgentTabs(active: AgentsPanel, onSelect: (panel: AgentsPanel) => void) {
  const tabs: Array<{ id: AgentsPanel; label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "files", label: "Files" },
    { id: "tools", label: "Tools" },
    { id: "skills", label: "Skills" },
    { id: "channels", label: "Channels" },
    { id: "cron", label: "Cron Jobs" },
  ];
  return html`
    <div class="agent-tabs">
      ${tabs.map(
        (tab) => html`
          <button
            class="agent-tab ${active === tab.id ? "active" : ""}"
            type="button"
            @click=${() => onSelect(tab.id)}
          >
            ${tab.label}
          </button>
        `,
      )}
    </div>
  `;
}

function renderAgentOverview(params: {
  agent: AgentsListResult["agents"][number];
  defaultId: string | null;
  configForm: Record<string, unknown> | null;
  catalogModels: ModelChoice[];
  agentFilesList: AgentsFilesListResult | null;
  agentIdentity: AgentIdentityResult | null;
  agentIdentityLoading: boolean;
  agentIdentityError: string | null;
  configLoading: boolean;
  configSaving: boolean;
  configDirty: boolean;
  authProfiles: AuthProfileSummary[];
  onConfigReload: () => void;
  onConfigSave: () => void;
  onModelChange: (agentId: string, modelId: string | null) => void;
  onModelFallbacksChange: (agentId: string, fallbacks: string[]) => void;
  onAuthProfileChange: (agentId: string, profileId: string | null) => void;
  onImageModelChange: (agentId: string, modelId: string | null) => void;
  onImageModelFallbacksChange: (agentId: string, fallbacks: string[]) => void;
  onImageAuthProfileChange: (agentId: string, profileId: string | null) => void;
  onSubagentsAllowChange: (agentId: string, allowAgents: string[]) => void;
  onSubagentsModelChange: (agentId: string, modelId: string | null) => void;
  onSubagentsThinkingChange: (agentId: string, thinking: string | null) => void;
  onIdentityNameChange: (agentId: string, name: string) => void;
  onIdentityEmojiChange: (agentId: string, emoji: string) => void;
  onSelectAgent: (agentId: string) => void;
}) {
  const {
    agent,
    configForm,
    catalogModels,
    agentFilesList,
    agentIdentity,
    agentIdentityLoading,
    agentIdentityError,
    configLoading,
    configSaving,
    configDirty,
    authProfiles,
    onConfigReload,
    onConfigSave,
    onModelChange,
    onModelFallbacksChange,
    onAuthProfileChange,
    onImageModelChange,
    onImageModelFallbacksChange,
    onImageAuthProfileChange,
    onSubagentsAllowChange,
    onSubagentsModelChange,
    onSubagentsThinkingChange,
    onIdentityNameChange,
    onIdentityEmojiChange,
    onSelectAgent,
  } = params;
  const config = resolveAgentConfig(configForm, agent.id);
  const workspaceFromFiles =
    agentFilesList && agentFilesList.agentId === agent.id ? agentFilesList.workspace : null;
  const workspace =
    workspaceFromFiles || config.entry?.workspace || config.defaults?.workspace || "default";
  const model = config.entry?.model
    ? resolveModelLabel(config.entry?.model)
    : resolveModelLabel(config.defaults?.model);
  const defaultModel = resolveModelLabel(config.defaults?.model);
  const modelPrimary =
    resolveModelPrimary(config.entry?.model) || (model !== "-" ? normalizeModelValue(model) : null);
  const defaultPrimary =
    resolveModelPrimary(config.defaults?.model) ||
    (defaultModel !== "-" ? normalizeModelValue(defaultModel) : null);
  const effectivePrimary = modelPrimary ?? defaultPrimary ?? null;
  const modelFallbacks = resolveModelFallbacks(config.entry?.model);
  const fallbackText = modelFallbacks ? modelFallbacks.join(", ") : "";
  const identityName =
    agentIdentity?.name?.trim() ||
    agent.identity?.name?.trim() ||
    agent.name?.trim() ||
    config.entry?.name ||
    "-";
  const configIdentityName = config.entry?.identity?.name ?? config.entry?.name ?? "";
  const resolvedEmoji = resolveAgentEmoji(agent, agentIdentity);
  const identityEmoji = resolvedEmoji || "-";
  const configIdentityEmoji = config.entry?.identity?.emoji ?? "";
  const skillFilter = Array.isArray(config.entry?.skills) ? config.entry?.skills : null;
  const skillCount = skillFilter?.length ?? null;
  const identityStatus = agentIdentityLoading
    ? "Loading…"
    : agentIdentityError
      ? "Unavailable"
      : "";
  const isDefault = Boolean(params.defaultId && agent.id === params.defaultId);

  // Text credential locking
  const textAuthProfileId = config.entry?.authProfileId?.trim() || null;
  const textProvider = extractProviderFromModel(effectivePrimary);
  // For the provider selector: use the per-agent configured model (not inherited).
  // Non-default agents should show "Inherit default" when no per-agent model is set.
  const configuredModelPrimary = resolveModelPrimary(config.entry?.model);
  const selectorProvider = isDefault
    ? textProvider
    : extractProviderFromModel(configuredModelPrimary);
  const textProviderProfiles = textProvider
    ? authProfiles.filter((p) => p.provider.toLowerCase() === textProvider.toLowerCase())
    : [];

  // Available providers for provider-first selection.
  const availableProviders = buildAvailableProviders(catalogModels, configForm, authProfiles);
  // Ensure current provider is in the list (edge case: model from non-catalog provider).
  if (textProvider && !availableProviders.includes(textProvider.toLowerCase())) {
    availableProviders.unshift(textProvider.toLowerCase());
  }

  // Image model
  const imageModelPrimary = resolveModelPrimary(config.entry?.imageModel);
  const effectiveImagePrimary = imageModelPrimary ?? null;
  const imageModelFallbacks = resolveModelFallbacks(config.entry?.imageModel);
  const imageFallbackText = imageModelFallbacks ? imageModelFallbacks.join(", ") : "";

  // Image credential locking
  const imageAuthProfileId = config.entry?.imageAuthProfileId?.trim() || null;
  const imageProvider = extractProviderFromModel(effectiveImagePrimary) || textProvider;
  const imageProviderProfiles = imageProvider
    ? authProfiles.filter((p) => p.provider.toLowerCase() === imageProvider.toLowerCase())
    : [];
  const imageCredMode: "auto" | "locked" | "inherited" = imageAuthProfileId
    ? "locked"
    : textAuthProfileId &&
        imageProvider &&
        textProvider &&
        imageProvider.toLowerCase() === textProvider.toLowerCase()
      ? "inherited"
      : "auto";

  // Sub-agent configuration
  const subagents = config.entry?.subagents;
  const allowAgents = Array.isArray(subagents?.allowAgents) ? subagents.allowAgents : [];
  const allowAgentsText = allowAgents.join(", ");
  const subagentModel = resolveModelPrimary(subagents?.model) ?? "";
  const subagentThinking = subagents?.thinking?.trim() ?? "";

  // Resolve known agent IDs for datalist
  const cfg = configForm as ConfigSnapshot | null;
  const knownAgentIds = (cfg?.agents?.list ?? [])
    .map((a) => a?.id?.trim())
    .filter((id): id is string => Boolean(id));

  const inputDisabled = !configForm || configLoading || configSaving;

  return html`
    <section class="card">
      <div class="card-title">Overview</div>
      <div class="card-sub">Workspace paths and identity metadata.</div>

      <!-- Identity -->
      <div class="agent-identity-section">
        <div class="agent-identity-row">
          <div class="agent-identity-emoji-wrap">
            <button
              type="button"
              class="agent-identity-emoji-btn"
              ?disabled=${inputDisabled}
              @click=${(e: Event) => {
                const btn = e.currentTarget as HTMLElement;
                const wrap = btn.closest(".agent-identity-emoji-wrap");
                const picker = wrap?.querySelector(".agent-emoji-picker");
                if (!picker) {
                  return;
                }
                const isOpen = picker.classList.toggle("open");
                if (isOpen) {
                  const close = (ev: MouseEvent) => {
                    if (!wrap?.contains(ev.target as Node)) {
                      picker.classList.remove("open");
                      window.removeEventListener("click", close, true);
                    }
                  };
                  requestAnimationFrame(() => window.addEventListener("click", close, true));
                }
              }}
              title="Change emoji"
            >
              <span class="agent-identity-emoji-display">${identityEmoji === "-" ? "?" : identityEmoji}</span>
              <span class="agent-identity-emoji-hint">Edit</span>
            </button>
            <div class="agent-emoji-picker">
              <div class="agent-emoji-picker-header">
                <label class="field" style="flex: 1;">
                  <span>Custom emoji</span>
                  <input
                    type="text"
                    .value=${live(configIdentityEmoji)}
                    placeholder="Paste or type emoji"
                    ?disabled=${inputDisabled}
                    @input=${(e: Event) => {
                      const val = (e.target as HTMLInputElement).value;
                      onIdentityEmojiChange(agent.id, val);
                    }}
                  />
                </label>
              </div>
              <div class="agent-emoji-picker-grid">
                ${EMOJI_PRESETS.map(
                  (em) => html`
                    <button
                      type="button"
                      class="agent-emoji-option ${configIdentityEmoji === em ? "active" : ""}"
                      ?disabled=${inputDisabled}
                      title=${em}
                      @click=${(e: Event) => {
                        onIdentityEmojiChange(agent.id, em);
                        const picker = (e.currentTarget as HTMLElement).closest(
                          ".agent-emoji-picker",
                        );
                        picker?.classList.remove("open");
                      }}
                    >${em}</button>
                  `,
                )}
              </div>
            </div>
          </div>
          <div class="agent-identity-fields">
            <label class="field">
              <span>Identity Name</span>
              <input
                type="text"
                .value=${live(configIdentityName)}
                placeholder=${identityName === "-" ? "e.g. Research Assistant" : identityName}
                ?disabled=${inputDisabled}
                @input=${(e: Event) => {
                  const val = (e.target as HTMLInputElement).value;
                  onIdentityNameChange(agent.id, val);
                }}
              />
            </label>
            ${identityStatus ? html`<div class="agent-kv-sub muted">${identityStatus}</div>` : nothing}
          </div>
        </div>
      </div>

      <!-- Read-only metadata -->
      <div class="agents-overview-grid" style="margin-top: 16px;">
        <div class="agent-kv">
          <div class="label">Workspace</div>
          <div class="mono">${workspace}</div>
        </div>
        <div class="agent-kv">
          <div class="label">Primary Model</div>
          <div class="mono">${model}</div>
        </div>
        <div class="agent-kv">
          <div class="label">Skills Filter</div>
          <div>${skillFilter ? `${skillCount} selected` : "all skills"}</div>
        </div>
        <div class="agent-kv">
          <div class="label">Default</div>
          <div>${isDefault ? "yes" : "no"}</div>
        </div>
        ${
          allowAgents.length > 0
            ? html`
                <div class="agent-kv">
                  <div class="label">Can Spawn</div>
                  <div>
                    ${allowAgents.map((id, i) => {
                      const isWild = id === "*";
                      const isKnown = !isWild && knownAgentIds.includes(id);
                      return html`${i > 0 ? ", " : ""}${
                        isKnown
                          ? html`<a
                              href="#"
                              class="agent-link"
                              @click=${(e: Event) => {
                                e.preventDefault();
                                onSelectAgent(id);
                              }}
                              >${id}</a
                            >`
                          : isWild
                            ? html`
                                <span class="mono">* (any)</span>
                              `
                            : html`<span class="mono">${id}</span>`
                      }`;
                    })}
                  </div>
                </div>
              `
            : nothing
        }
      </div>

      <!-- Text Model Selection -->
      <div class="agent-model-select" style="margin-top: 20px;">
        <div class="label">Text Model</div>
        <div class="row" style="gap: 12px; flex-wrap: wrap;">
          <label class="field" style="min-width: 140px;">
            <span>Provider${isDefault ? " (default)" : ""}</span>
            <select
              .value=${live(selectorProvider?.toLowerCase() ?? "")}
              ?disabled=${inputDisabled}
              @change=${(e: Event) => {
                const newProvider = (e.target as HTMLSelectElement).value;
                if (!newProvider) {
                  onModelChange(agent.id, null);
                  return;
                }
                const providerModels = buildModelsForProvider(
                  newProvider,
                  catalogModels,
                  configForm,
                );
                onModelChange(agent.id, providerModels[0]?.value || null);
              }}
            >
              ${
                isDefault
                  ? nothing
                  : html`
                      <option value="">
                        ${
                          defaultPrimary ? `Inherit default (${defaultPrimary})` : "Inherit default"
                        }
                      </option>
                    `
              }
              ${availableProviders.map(
                (p) => html`<option value=${p}>${capitalizeProvider(p)}</option>`,
              )}
            </select>
          </label>
          ${
            selectorProvider
              ? html`
                  <label class="field" style="min-width: 260px; flex: 1;">
                    <span>Model</span>
                    <select
                      .value=${live(effectivePrimary ?? "")}
                      ?disabled=${inputDisabled}
                      @change=${(e: Event) =>
                        onModelChange(agent.id, (e.target as HTMLSelectElement).value || null)}
                    >
                      ${buildModelsForProvider(
                        selectorProvider.toLowerCase(),
                        catalogModels,
                        configForm,
                      ).map((m) => html`<option value=${m.value}>${m.label}</option>`)}
                      ${
                        effectivePrimary &&
                        !buildModelsForProvider(
                          selectorProvider.toLowerCase(),
                          catalogModels,
                          configForm,
                        ).some((m) => m.value === effectivePrimary)
                          ? html`<option value=${effectivePrimary}>
                              ${effectivePrimary} (current)
                            </option>`
                          : nothing
                      }
                    </select>
                  </label>
                `
              : nothing
          }
          <label class="field" style="min-width: 260px; flex: 1;">
            <span>Fallbacks (comma-separated)</span>
            <input
              .value=${fallbackText}
              ?disabled=${inputDisabled}
              placeholder="provider/model, provider/model"
              @input=${(e: Event) =>
                onModelFallbacksChange(
                  agent.id,
                  parseFallbackList((e.target as HTMLInputElement).value),
                )}
            />
          </label>
        </div>

        <!-- Text Credentials -->
        <div style="margin-top: 12px;">
          <div class="label">Text Credentials</div>
          <div class="row" style="gap: 12px; flex-wrap: wrap; align-items: flex-end;">
            <label class="field" style="min-width: 160px;">
              <span>Mode</span>
              <select
                .value=${textAuthProfileId ? "locked" : "auto"}
                ?disabled=${inputDisabled}
                @change=${(e: Event) => {
                  const mode = (e.target as HTMLSelectElement).value;
                  if (mode === "auto") {
                    onAuthProfileChange(agent.id, null);
                  }
                }}
              >
                <option value="auto">Auto</option>
                <option value="locked">Locked to profile</option>
              </select>
            </label>
            ${
              textAuthProfileId !== null || textProviderProfiles.length > 0
                ? html`
                    <label class="field" style="min-width: 260px; flex: 1;">
                      <span>Auth profile${textProvider ? ` (${textProvider})` : ""}</span>
                      <select
                        .value=${textAuthProfileId ?? ""}
                        ?disabled=${inputDisabled}
                        @change=${(e: Event) => {
                          const profileId = (e.target as HTMLSelectElement).value || null;
                          onAuthProfileChange(agent.id, profileId);
                        }}
                      >
                        <option value="">None (auto)</option>
                        ${textProviderProfiles.map(
                          (p) => html`
                            <option value=${p.id}>
                              ${p.id}${p.email ? ` (${p.email})` : ""}${profileStatusLabel(p)}
                            </option>
                          `,
                        )}
                        ${
                          textAuthProfileId &&
                          !textProviderProfiles.some((p) => p.id === textAuthProfileId)
                            ? html`<option value=${textAuthProfileId}>
                                ${textAuthProfileId} (not found)
                              </option>`
                            : nothing
                        }
                      </select>
                    </label>
                  `
                : nothing
            }
          </div>
        </div>
      </div>

      <!-- Image Model Selection -->
      <div class="agent-model-select" style="margin-top: 20px;">
        <div class="label">Image Model</div>
        <div class="row" style="gap: 8px; align-items: center; margin-bottom: 8px;">
          <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
            <input
              type="radio"
              name="image-mode-${agent.id}"
              value="primary"
              .checked=${!effectiveImagePrimary}
              ?disabled=${inputDisabled}
              @change=${() => {
                onImageModelChange(agent.id, null);
                onImageModelFallbacksChange(agent.id, []);
              }}
            />
            <span>Use primary${textProvider ? ` (${textProvider})` : ""}</span>
          </label>
          <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
            <input
              type="radio"
              name="image-mode-${agent.id}"
              value="override"
              .checked=${!!effectiveImagePrimary}
              ?disabled=${inputDisabled}
              @change=${() => {
                const prov = textProvider?.toLowerCase() || availableProviders[0] || "";
                const models = buildModelsForProvider(prov, catalogModels, configForm);
                onImageModelChange(agent.id, models[0]?.value || null);
              }}
            />
            <span>Override</span>
          </label>
        </div>
        ${
          effectiveImagePrimary
            ? html`
                <div class="row" style="gap: 12px; flex-wrap: wrap;">
                  <label class="field" style="min-width: 140px;">
                    <span>Provider</span>
                    <select
                      .value=${live(imageProvider?.toLowerCase() || "")}
                      ?disabled=${inputDisabled}
                      @change=${(e: Event) => {
                        const newProv = (e.target as HTMLSelectElement).value;
                        const models = buildModelsForProvider(newProv, catalogModels, configForm);
                        onImageModelChange(agent.id, models[0]?.value || null);
                      }}
                    >
                      ${availableProviders.map(
                        (p) => html`<option value=${p}>${capitalizeProvider(p)}</option>`,
                      )}
                    </select>
                  </label>
                  <label class="field" style="min-width: 260px; flex: 1;">
                    <span>Model</span>
                    <select
                      .value=${live(effectiveImagePrimary)}
                      ?disabled=${inputDisabled}
                      @change=${(e: Event) =>
                        onImageModelChange(agent.id, (e.target as HTMLSelectElement).value || null)}
                    >
                      ${buildModelsForProvider(
                        imageProvider?.toLowerCase() || "",
                        catalogModels,
                        configForm,
                      ).map((m) => html`<option value=${m.value}>${m.label}</option>`)}
                      ${
                        effectiveImagePrimary &&
                        !buildModelsForProvider(
                          imageProvider?.toLowerCase() || "",
                          catalogModels,
                          configForm,
                        ).some((m) => m.value === effectiveImagePrimary)
                          ? html`<option value=${effectiveImagePrimary}>
                              ${effectiveImagePrimary} (current)
                            </option>`
                          : nothing
                      }
                    </select>
                  </label>
                  <label class="field" style="min-width: 260px; flex: 1;">
                    <span>Image fallbacks (comma-separated)</span>
                    <input
                      .value=${imageFallbackText}
                      ?disabled=${inputDisabled}
                      placeholder="provider/model, provider/model"
                      @input=${(e: Event) =>
                        onImageModelFallbacksChange(
                          agent.id,
                          parseFallbackList((e.target as HTMLInputElement).value),
                        )}
                    />
                  </label>
                </div>

                <!-- Image Credentials -->
                <div style="margin-top: 12px;">
                  <div class="label">Image Credentials</div>
                  <div class="row" style="gap: 12px; flex-wrap: wrap; align-items: flex-end;">
                    <label class="field" style="min-width: 160px;">
                      <span>Mode</span>
                      <select
                        .value=${imageCredMode}
                        ?disabled=${inputDisabled}
                        @change=${(e: Event) => {
                          const mode = (e.target as HTMLSelectElement).value;
                          if (mode === "auto" || mode === "inherited") {
                            onImageAuthProfileChange(agent.id, null);
                          }
                        }}
                      >
                        <option value="auto">Auto</option>
                        ${
                          textAuthProfileId
                            ? html`
                                <option value="inherited">Inherited from text</option>
                              `
                            : nothing
                        }
                        <option value="locked">Locked to profile</option>
                      </select>
                    </label>
                    ${
                      imageCredMode === "locked" || imageProviderProfiles.length > 0
                        ? html`
                            <label class="field" style="min-width: 260px; flex: 1;">
                              <span
                                >Auth profile${imageProvider ? ` (${imageProvider})` : ""}</span
                              >
                              <select
                                .value=${imageAuthProfileId ?? ""}
                                ?disabled=${inputDisabled}
                                @change=${(e: Event) => {
                                  const profileId = (e.target as HTMLSelectElement).value || null;
                                  onImageAuthProfileChange(agent.id, profileId);
                                }}
                              >
                                <option value="">None (auto)</option>
                                ${imageProviderProfiles.map(
                                  (p) => html`
                                    <option value=${p.id}>
                                      ${p.id}${
                                        p.email ? ` (${p.email})` : ""
                                      }${profileStatusLabel(p)}
                                    </option>
                                  `,
                                )}
                                ${
                                  imageAuthProfileId &&
                                  !imageProviderProfiles.some((p) => p.id === imageAuthProfileId)
                                    ? html`<option value=${imageAuthProfileId}>
                                        ${imageAuthProfileId} (not found)
                                      </option>`
                                    : nothing
                                }
                              </select>
                            </label>
                          `
                        : nothing
                    }
                  </div>
                </div>
              `
            : html`
                <div class="muted" style="font-size: 13px;">
                  Images will use an image-capable model from your primary
                  provider${textProvider ? ` (${textProvider})` : ""}, with automatic fallback.
                </div>
              `
        }
      </div>

      <!-- Sub-Agent Configuration -->
      <div class="agent-model-select" style="margin-top: 20px;">
        <div class="label">Sub-Agent Defaults</div>
        ${
          isDefault
            ? html`
                <div class="callout info" style="margin-bottom: 8px">
                  This is the default agent. Configure sub-agents below to enable delegation via
                  <code>sessions_spawn</code>.
                </div>
              `
            : nothing
        }
        <div class="row" style="gap: 12px; flex-wrap: wrap;">
          <label class="field" style="min-width: 260px; flex: 1;">
            <span>Allowed sub-agents (comma-separated, * = any)</span>
            <input
              .value=${allowAgentsText}
              ?disabled=${inputDisabled}
              placeholder="agent-id, another-id, *"
              list="known-agents-${agent.id}"
              @input=${(e: Event) =>
                onSubagentsAllowChange(
                  agent.id,
                  parseFallbackList((e.target as HTMLInputElement).value),
                )}
            />
            ${
              knownAgentIds.length > 0
                ? html`
                    <datalist id="known-agents-${agent.id}">
                      <option value="*">Any agent</option>
                      ${knownAgentIds
                        .filter((id) => id !== agent.id)
                        .map((id) => html`<option value=${id}></option>`)}
                    </datalist>
                  `
                : nothing
            }
          </label>
        </div>
        <div style="margin-top: 8px;">
          <div class="label">Default model for sub-agents</div>
          <div class="row" style="gap: 8px; align-items: center; margin-bottom: 8px;">
            <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
              <input
                type="radio"
                name="subagent-mode-${agent.id}"
                value="inherit"
                .checked=${!subagentModel}
                ?disabled=${inputDisabled}
                @change=${() => onSubagentsModelChange(agent.id, null)}
              />
              <span>Inherit from primary${effectivePrimary ? ` (${effectivePrimary})` : ""}</span>
            </label>
            <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
              <input
                type="radio"
                name="subagent-mode-${agent.id}"
                value="override"
                .checked=${!!subagentModel}
                ?disabled=${inputDisabled}
                @change=${() => {
                  const prov = textProvider?.toLowerCase() || availableProviders[0] || "";
                  const models = buildModelsForProvider(prov, catalogModels, configForm);
                  onSubagentsModelChange(agent.id, models[0]?.value || null);
                }}
              />
              <span>Override</span>
            </label>
          </div>
          ${
            subagentModel
              ? (() => {
                  const subagentProvider = extractProviderFromModel(subagentModel);
                  return html`
                    <div class="row" style="gap: 12px; flex-wrap: wrap;">
                      <label class="field" style="min-width: 140px;">
                        <span>Provider</span>
                        <select
                          .value=${live(subagentProvider?.toLowerCase() || "")}
                          ?disabled=${inputDisabled}
                          @change=${(e: Event) => {
                            const newProv = (e.target as HTMLSelectElement).value;
                            const models = buildModelsForProvider(
                              newProv,
                              catalogModels,
                              configForm,
                            );
                            onSubagentsModelChange(agent.id, models[0]?.value || null);
                          }}
                        >
                          ${availableProviders.map(
                            (p) => html`<option value=${p}>${capitalizeProvider(p)}</option>`,
                          )}
                          ${
                            subagentProvider &&
                            !availableProviders.includes(subagentProvider.toLowerCase())
                              ? html`<option value=${subagentProvider.toLowerCase()}>
                                  ${capitalizeProvider(subagentProvider)}
                                </option>`
                              : nothing
                          }
                        </select>
                      </label>
                      <label class="field" style="min-width: 260px; flex: 1;">
                        <span>Model</span>
                        <select
                          .value=${live(subagentModel)}
                          ?disabled=${inputDisabled}
                          @change=${(e: Event) =>
                            onSubagentsModelChange(
                              agent.id,
                              (e.target as HTMLSelectElement).value || null,
                            )}
                        >
                          ${buildModelsForProvider(
                            subagentProvider?.toLowerCase() || "",
                            catalogModels,
                            configForm,
                          ).map((m) => html`<option value=${m.value}>${m.label}</option>`)}
                          ${
                            subagentModel &&
                            !buildModelsForProvider(
                              subagentProvider?.toLowerCase() || "",
                              catalogModels,
                              configForm,
                            ).some((m) => m.value === subagentModel)
                              ? html`<option value=${subagentModel}>
                                  ${subagentModel} (current)
                                </option>`
                              : nothing
                          }
                        </select>
                      </label>
                    </div>
                  `;
                })()
              : nothing
          }
        </div>
        <div class="row" style="gap: 12px; flex-wrap: wrap; margin-top: 8px;">
          <label class="field" style="min-width: 160px;">
            <span>Default thinking level</span>
            <select
              .value=${subagentThinking}
              ?disabled=${inputDisabled}
              @change=${(e: Event) =>
                onSubagentsThinkingChange(agent.id, (e.target as HTMLSelectElement).value || null)}
            >
              <option value="">Inherit (no override)</option>
              <option value="off">Off</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
        </div>
      </div>

      <div class="row" style="justify-content: flex-end; gap: 8px; margin-top: 16px;">
        <button
          class="btn btn--sm"
          ?disabled=${configLoading}
          @click=${onConfigReload}
        >
          Reload Config
        </button>
        <button
          class="btn btn--sm primary"
          ?disabled=${configSaving || !configDirty}
          @click=${onConfigSave}
        >
          ${configSaving ? "Saving…" : "Save"}
        </button>
      </div>
    </section>
  `;
}

function renderAgentContextCard(context: AgentContext, subtitle: string) {
  return html`
    <section class="card">
      <div class="card-title">Agent Context</div>
      <div class="card-sub">${subtitle}</div>
      <div class="agents-overview-grid" style="margin-top: 16px;">
        <div class="agent-kv">
          <div class="label">Workspace</div>
          <div class="mono">${context.workspace}</div>
        </div>
        <div class="agent-kv">
          <div class="label">Primary Model</div>
          <div class="mono">${context.model}</div>
        </div>
        <div class="agent-kv">
          <div class="label">Identity Name</div>
          <div>${context.identityName}</div>
        </div>
        <div class="agent-kv">
          <div class="label">Identity Emoji</div>
          <div>${context.identityEmoji}</div>
        </div>
        <div class="agent-kv">
          <div class="label">Skills Filter</div>
          <div>${context.skillsLabel}</div>
        </div>
        <div class="agent-kv">
          <div class="label">Default</div>
          <div>${context.isDefault ? "yes" : "no"}</div>
        </div>
      </div>
    </section>
  `;
}

type ChannelSummaryEntry = {
  id: string;
  label: string;
  accounts: ChannelAccountSnapshot[];
};

function resolveChannelLabel(snapshot: ChannelsStatusSnapshot, id: string) {
  const meta = snapshot.channelMeta?.find((entry) => entry.id === id);
  if (meta?.label) {
    return meta.label;
  }
  return snapshot.channelLabels?.[id] ?? id;
}

function resolveChannelEntries(snapshot: ChannelsStatusSnapshot | null): ChannelSummaryEntry[] {
  if (!snapshot) {
    return [];
  }
  const ids = new Set<string>();
  for (const id of snapshot.channelOrder ?? []) {
    ids.add(id);
  }
  for (const entry of snapshot.channelMeta ?? []) {
    ids.add(entry.id);
  }
  for (const id of Object.keys(snapshot.channelAccounts ?? {})) {
    ids.add(id);
  }
  const ordered: string[] = [];
  const seed = snapshot.channelOrder?.length ? snapshot.channelOrder : Array.from(ids);
  for (const id of seed) {
    if (!ids.has(id)) {
      continue;
    }
    ordered.push(id);
    ids.delete(id);
  }
  for (const id of ids) {
    ordered.push(id);
  }
  return ordered.map((id) => ({
    id,
    label: resolveChannelLabel(snapshot, id),
    accounts: snapshot.channelAccounts?.[id] ?? [],
  }));
}

const CHANNEL_EXTRA_FIELDS = ["groupPolicy", "streamMode", "dmPolicy"] as const;

function resolveChannelConfigValue(
  configForm: Record<string, unknown> | null,
  channelId: string,
): Record<string, unknown> | null {
  if (!configForm) {
    return null;
  }
  const channels = (configForm.channels ?? {}) as Record<string, unknown>;
  const fromChannels = channels[channelId];
  if (fromChannels && typeof fromChannels === "object") {
    return fromChannels as Record<string, unknown>;
  }
  const fallback = configForm[channelId];
  if (fallback && typeof fallback === "object") {
    return fallback as Record<string, unknown>;
  }
  return null;
}

function formatChannelExtraValue(raw: unknown): string {
  if (raw == null) {
    return "n/a";
  }
  if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
    return String(raw);
  }
  try {
    return JSON.stringify(raw);
  } catch {
    return "n/a";
  }
}

function resolveChannelExtras(
  configForm: Record<string, unknown> | null,
  channelId: string,
): Array<{ label: string; value: string }> {
  const value = resolveChannelConfigValue(configForm, channelId);
  if (!value) {
    return [];
  }
  return CHANNEL_EXTRA_FIELDS.flatMap((field) => {
    if (!(field in value)) {
      return [];
    }
    return [{ label: field, value: formatChannelExtraValue(value[field]) }];
  });
}

function summarizeChannelAccounts(accounts: ChannelAccountSnapshot[]) {
  let connected = 0;
  let configured = 0;
  let enabled = 0;
  for (const account of accounts) {
    const probeOk =
      account.probe && typeof account.probe === "object" && "ok" in account.probe
        ? Boolean((account.probe as { ok?: unknown }).ok)
        : false;
    const isConnected = account.connected === true || account.running === true || probeOk;
    if (isConnected) {
      connected += 1;
    }
    if (account.configured) {
      configured += 1;
    }
    if (account.enabled) {
      enabled += 1;
    }
  }
  return {
    total: accounts.length,
    connected,
    configured,
    enabled,
  };
}

function renderAgentChannels(params: {
  agent: AgentsListResult["agents"][number];
  defaultId: string | null;
  configForm: Record<string, unknown> | null;
  agentFilesList: AgentsFilesListResult | null;
  agentIdentity: AgentIdentityResult | null;
  snapshot: ChannelsStatusSnapshot | null;
  loading: boolean;
  error: string | null;
  lastSuccess: number | null;
  onRefresh: () => void;
}) {
  const context = buildAgentContext(
    params.agent,
    params.configForm,
    params.agentFilesList,
    params.defaultId,
    params.agentIdentity,
  );
  const entries = resolveChannelEntries(params.snapshot);
  const lastSuccessLabel = params.lastSuccess
    ? formatRelativeTimestamp(params.lastSuccess)
    : "never";
  return html`
    <section class="grid grid-cols-2">
      ${renderAgentContextCard(context, "Workspace, identity, and model configuration.")}
      <section class="card">
        <div class="row" style="justify-content: space-between;">
          <div>
            <div class="card-title">Channels</div>
            <div class="card-sub">Gateway-wide channel status snapshot.</div>
          </div>
          <button class="btn btn--sm" ?disabled=${params.loading} @click=${params.onRefresh}>
            ${params.loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <div class="muted" style="margin-top: 8px;">
          Last refresh: ${lastSuccessLabel}
        </div>
        ${
          params.error
            ? html`<div class="callout danger" style="margin-top: 12px;">${params.error}</div>`
            : nothing
        }
        ${
          !params.snapshot
            ? html`
                <div class="callout info" style="margin-top: 12px">Load channels to see live status.</div>
              `
            : nothing
        }
        ${
          entries.length === 0
            ? html`
                <div class="muted" style="margin-top: 16px">No channels found.</div>
              `
            : html`
              <div class="list" style="margin-top: 16px;">
                ${entries.map((entry) => {
                  const summary = summarizeChannelAccounts(entry.accounts);
                  const status = summary.total
                    ? `${summary.connected}/${summary.total} connected`
                    : "no accounts";
                  const config = summary.configured
                    ? `${summary.configured} configured`
                    : "not configured";
                  const enabled = summary.total ? `${summary.enabled} enabled` : "disabled";
                  const extras = resolveChannelExtras(params.configForm, entry.id);
                  return html`
                    <div class="list-item">
                      <div class="list-main">
                        <div class="list-title">${entry.label}</div>
                        <div class="list-sub mono">${entry.id}</div>
                      </div>
                      <div class="list-meta">
                        <div>${status}</div>
                        <div>${config}</div>
                        <div>${enabled}</div>
                        ${
                          extras.length > 0
                            ? extras.map((extra) => html`<div>${extra.label}: ${extra.value}</div>`)
                            : nothing
                        }
                      </div>
                    </div>
                  `;
                })}
              </div>
            `
        }
      </section>
    </section>
  `;
}

function renderAgentCron(params: {
  agent: AgentsListResult["agents"][number];
  defaultId: string | null;
  configForm: Record<string, unknown> | null;
  agentFilesList: AgentsFilesListResult | null;
  agentIdentity: AgentIdentityResult | null;
  jobs: CronJob[];
  status: CronStatus | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  const context = buildAgentContext(
    params.agent,
    params.configForm,
    params.agentFilesList,
    params.defaultId,
    params.agentIdentity,
  );
  const jobs = params.jobs.filter((job) => job.agentId === params.agent.id);
  return html`
    <section class="grid grid-cols-2">
      ${renderAgentContextCard(context, "Workspace and scheduling targets.")}
      <section class="card">
        <div class="row" style="justify-content: space-between;">
          <div>
            <div class="card-title">Scheduler</div>
            <div class="card-sub">Gateway cron status.</div>
          </div>
          <button class="btn btn--sm" ?disabled=${params.loading} @click=${params.onRefresh}>
            ${params.loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <div class="stat-grid" style="margin-top: 16px;">
          <div class="stat">
            <div class="stat-label">Enabled</div>
            <div class="stat-value">
              ${params.status ? (params.status.enabled ? "Yes" : "No") : "n/a"}
            </div>
          </div>
          <div class="stat">
            <div class="stat-label">Jobs</div>
            <div class="stat-value">${params.status?.jobs ?? "n/a"}</div>
          </div>
          <div class="stat">
            <div class="stat-label">Next wake</div>
            <div class="stat-value">${formatNextRun(params.status?.nextWakeAtMs ?? null)}</div>
          </div>
        </div>
        ${
          params.error
            ? html`<div class="callout danger" style="margin-top: 12px;">${params.error}</div>`
            : nothing
        }
      </section>
    </section>
    <section class="card">
      <div class="card-title">Agent Cron Jobs</div>
      <div class="card-sub">Scheduled jobs targeting this agent.</div>
      ${
        jobs.length === 0
          ? html`
              <div class="muted" style="margin-top: 16px">No jobs assigned.</div>
            `
          : html`
              <div class="list" style="margin-top: 16px;">
                ${jobs.map(
                  (job) => html`
                  <div class="list-item">
                    <div class="list-main">
                      <div class="list-title">${job.name}</div>
                      ${job.description ? html`<div class="list-sub">${job.description}</div>` : nothing}
                      <div class="chip-row" style="margin-top: 6px;">
                        <span class="chip">${formatCronSchedule(job)}</span>
                        <span class="chip ${job.enabled ? "chip-ok" : "chip-warn"}">
                          ${job.enabled ? "enabled" : "disabled"}
                        </span>
                        <span class="chip">${job.sessionTarget}</span>
                      </div>
                    </div>
                    <div class="list-meta">
                      <div class="mono">${formatCronState(job)}</div>
                      <div class="muted">${formatCronPayload(job)}</div>
                    </div>
                  </div>
                `,
                )}
              </div>
            `
      }
    </section>
  `;
}

function renderAgentFiles(params: {
  agentId: string;
  agentFilesList: AgentsFilesListResult | null;
  agentFilesLoading: boolean;
  agentFilesError: string | null;
  agentFileActive: string | null;
  agentFileContents: Record<string, string>;
  agentFileDrafts: Record<string, string>;
  agentFileSaving: boolean;
  onLoadFiles: (agentId: string) => void;
  onSelectFile: (name: string) => void;
  onFileDraftChange: (name: string, content: string) => void;
  onFileReset: (name: string) => void;
  onFileSave: (name: string) => void;
}) {
  const list = params.agentFilesList?.agentId === params.agentId ? params.agentFilesList : null;
  const files = list?.files ?? [];
  const active = params.agentFileActive ?? null;
  const activeEntry = active ? (files.find((file) => file.name === active) ?? null) : null;
  const baseContent = active ? (params.agentFileContents[active] ?? "") : "";
  const draft = active ? (params.agentFileDrafts[active] ?? baseContent) : "";
  const isDirty = active ? draft !== baseContent : false;

  return html`
    <section class="card">
      <div class="row" style="justify-content: space-between;">
        <div>
          <div class="card-title">Core Files</div>
          <div class="card-sub">Bootstrap persona, identity, and tool guidance.</div>
        </div>
        <button
          class="btn btn--sm"
          ?disabled=${params.agentFilesLoading}
          @click=${() => params.onLoadFiles(params.agentId)}
        >
          ${params.agentFilesLoading ? "Loading…" : "Refresh"}
        </button>
      </div>
      ${list ? html`<div class="muted mono" style="margin-top: 8px;">Workspace: ${list.workspace}</div>` : nothing}
      ${
        params.agentFilesError
          ? html`<div class="callout danger" style="margin-top: 12px;">${
              params.agentFilesError
            }</div>`
          : nothing
      }
      ${
        !list
          ? html`
              <div class="callout info" style="margin-top: 12px">
                Load the agent workspace files to edit core instructions.
              </div>
            `
          : html`
              <div class="agent-files-grid" style="margin-top: 16px;">
                <div class="agent-files-list">
                  ${
                    files.length === 0
                      ? html`
                          <div class="muted">No files found.</div>
                        `
                      : files.map((file) =>
                          renderAgentFileRow(file, active, () => params.onSelectFile(file.name)),
                        )
                  }
                </div>
                <div class="agent-files-editor">
                  ${
                    !activeEntry
                      ? html`
                          <div class="muted">Select a file to edit.</div>
                        `
                      : html`
                          <div class="agent-file-header">
                            <div>
                              <div class="agent-file-title mono">${activeEntry.name}</div>
                              <div class="agent-file-sub mono">${activeEntry.path}</div>
                            </div>
                            <div class="agent-file-actions">
                              <button
                                class="btn btn--sm"
                                ?disabled=${!isDirty}
                                @click=${() => params.onFileReset(activeEntry.name)}
                              >
                                Reset
                              </button>
                              <button
                                class="btn btn--sm primary"
                                ?disabled=${params.agentFileSaving || !isDirty}
                                @click=${() => params.onFileSave(activeEntry.name)}
                              >
                                ${params.agentFileSaving ? "Saving…" : "Save"}
                              </button>
                            </div>
                          </div>
                          ${
                            activeEntry.missing
                              ? html`
                                  <div class="callout info" style="margin-top: 10px">
                                    This file is missing. Saving will create it in the agent workspace.
                                  </div>
                                `
                              : nothing
                          }
                          <label class="field" style="margin-top: 12px;">
                            <span>Content</span>
                            <textarea
                              .value=${draft}
                              @input=${(e: Event) =>
                                params.onFileDraftChange(
                                  activeEntry.name,
                                  (e.target as HTMLTextAreaElement).value,
                                )}
                            ></textarea>
                          </label>
                        `
                  }
                </div>
              </div>
            `
      }
    </section>
  `;
}

const FILE_DESCRIPTIONS: Record<string, string> = {
  "AGENTS.md": "Primary behavioral instructions",
  "SOUL.md": "Personality and communication style",
  "TOOLS.md": "Tool usage guidelines and environment notes",
  "IDENTITY.md": "Name, avatar, and public-facing identity",
  "USER.md": "Information about the operator",
  "HEARTBEAT.md": "Prompt for periodic heartbeat check-ins",
  "BOOTSTRAP.md": "Additional bootstrap context",
};

function renderAgentFileRow(file: AgentFileEntry, active: string | null, onSelect: () => void) {
  const status = file.missing
    ? "Missing"
    : `${formatBytes(file.size)} · ${formatRelativeTimestamp(file.updatedAtMs ?? null)}`;
  const description = FILE_DESCRIPTIONS[file.name] ?? null;
  return html`
    <button
      type="button"
      class="agent-file-row ${active === file.name ? "active" : ""}"
      @click=${onSelect}
    >
      <div>
        <div class="agent-file-name mono">${file.name}</div>
        ${description ? html`<div class="agent-file-desc">${description}</div>` : nothing}
        <div class="agent-file-meta">${status}</div>
      </div>
      ${
        file.missing
          ? html`
              <span class="agent-pill warn">missing</span>
            `
          : nothing
      }
    </button>
  `;
}

function renderAgentTools(params: {
  agentId: string;
  configForm: Record<string, unknown> | null;
  configLoading: boolean;
  configSaving: boolean;
  configDirty: boolean;
  onProfileChange: (agentId: string, profile: string | null, clearAllow: boolean) => void;
  onOverridesChange: (agentId: string, alsoAllow: string[], deny: string[]) => void;
  onConfigReload: () => void;
  onConfigSave: () => void;
}) {
  const config = resolveAgentConfig(params.configForm, params.agentId);
  const agentTools = config.entry?.tools ?? {};
  const globalTools = config.globalTools ?? {};
  const profile = agentTools.profile ?? globalTools.profile ?? "full";
  const profileSource = agentTools.profile
    ? "agent override"
    : globalTools.profile
      ? "global default"
      : "default";
  const hasAgentAllow = Array.isArray(agentTools.allow) && agentTools.allow.length > 0;
  const hasGlobalAllow = Array.isArray(globalTools.allow) && globalTools.allow.length > 0;
  const editable =
    Boolean(params.configForm) && !params.configLoading && !params.configSaving && !hasAgentAllow;
  const alsoAllow = hasAgentAllow
    ? []
    : Array.isArray(agentTools.alsoAllow)
      ? agentTools.alsoAllow
      : [];
  const deny = hasAgentAllow ? [] : Array.isArray(agentTools.deny) ? agentTools.deny : [];
  const basePolicy = hasAgentAllow
    ? { allow: agentTools.allow ?? [], deny: agentTools.deny ?? [] }
    : (resolveToolProfilePolicy(profile) ?? undefined);
  const toolIds = TOOL_SECTIONS.flatMap((section) => section.tools.map((tool) => tool.id));

  const resolveAllowed = (toolId: string) => {
    const baseAllowed = isAllowedByPolicy(toolId, basePolicy);
    const extraAllowed = matchesList(toolId, alsoAllow);
    const denied = matchesList(toolId, deny);
    const allowed = (baseAllowed || extraAllowed) && !denied;
    return {
      allowed,
      baseAllowed,
      denied,
    };
  };
  const enabledCount = toolIds.filter((toolId) => resolveAllowed(toolId).allowed).length;

  const updateTool = (toolId: string, nextEnabled: boolean) => {
    const nextAllow = new Set(
      alsoAllow.map((entry) => normalizeToolName(entry)).filter((entry) => entry.length > 0),
    );
    const nextDeny = new Set(
      deny.map((entry) => normalizeToolName(entry)).filter((entry) => entry.length > 0),
    );
    const baseAllowed = resolveAllowed(toolId).baseAllowed;
    const normalized = normalizeToolName(toolId);
    if (nextEnabled) {
      nextDeny.delete(normalized);
      if (!baseAllowed) {
        nextAllow.add(normalized);
      }
    } else {
      nextAllow.delete(normalized);
      nextDeny.add(normalized);
    }
    params.onOverridesChange(params.agentId, [...nextAllow], [...nextDeny]);
  };

  const updateAll = (nextEnabled: boolean) => {
    const nextAllow = new Set(
      alsoAllow.map((entry) => normalizeToolName(entry)).filter((entry) => entry.length > 0),
    );
    const nextDeny = new Set(
      deny.map((entry) => normalizeToolName(entry)).filter((entry) => entry.length > 0),
    );
    for (const toolId of toolIds) {
      const baseAllowed = resolveAllowed(toolId).baseAllowed;
      const normalized = normalizeToolName(toolId);
      if (nextEnabled) {
        nextDeny.delete(normalized);
        if (!baseAllowed) {
          nextAllow.add(normalized);
        }
      } else {
        nextAllow.delete(normalized);
        nextDeny.add(normalized);
      }
    }
    params.onOverridesChange(params.agentId, [...nextAllow], [...nextDeny]);
  };

  return html`
    <section class="card">
      <div class="row" style="justify-content: space-between;">
        <div>
          <div class="card-title">Tool Access</div>
          <div class="card-sub">
            Profile + per-tool overrides for this agent.
            <span class="mono">${enabledCount}/${toolIds.length}</span> enabled.
          </div>
        </div>
        <div class="row" style="gap: 8px;">
          <button
            class="btn btn--sm"
            ?disabled=${!editable}
            @click=${() => updateAll(true)}
          >
            Enable All
          </button>
          <button
            class="btn btn--sm"
            ?disabled=${!editable}
            @click=${() => updateAll(false)}
          >
            Disable All
          </button>
          <button
            class="btn btn--sm"
            ?disabled=${params.configLoading}
            @click=${params.onConfigReload}
          >
            Reload Config
          </button>
          <button
            class="btn btn--sm primary"
            ?disabled=${params.configSaving || !params.configDirty}
            @click=${params.onConfigSave}
          >
            ${params.configSaving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      ${
        !params.configForm
          ? html`
              <div class="callout info" style="margin-top: 12px">
                Load the gateway config to adjust tool profiles.
              </div>
            `
          : nothing
      }
      ${
        hasAgentAllow
          ? html`
              <div class="callout info" style="margin-top: 12px">
                This agent is using an explicit allowlist in config. Tool overrides are managed in the Config tab.
              </div>
            `
          : nothing
      }
      ${
        hasGlobalAllow
          ? html`
              <div class="callout info" style="margin-top: 12px">
                Global tools.allow is set. Agent overrides cannot enable tools that are globally blocked.
              </div>
            `
          : nothing
      }

      <div class="agent-tools-meta" style="margin-top: 16px;">
        <div class="agent-kv">
          <div class="label">Profile</div>
          <div class="mono">${profile}</div>
        </div>
        <div class="agent-kv">
          <div class="label">Source</div>
          <div>${profileSource}</div>
        </div>
        ${
          params.configDirty
            ? html`
                <div class="agent-kv">
                  <div class="label">Status</div>
                  <div class="mono">unsaved</div>
                </div>
              `
            : nothing
        }
      </div>

      <div class="agent-tools-presets" style="margin-top: 16px;">
        <div class="label">Quick Presets</div>
        <div class="agent-tools-buttons">
          ${PROFILE_OPTIONS.map(
            (option) => html`
              <button
                class="btn btn--sm ${profile === option.id ? "active" : ""}"
                ?disabled=${!editable}
                @click=${() => params.onProfileChange(params.agentId, option.id, true)}
              >
                ${option.label}
              </button>
            `,
          )}
          <button
            class="btn btn--sm"
            ?disabled=${!editable}
            @click=${() => params.onProfileChange(params.agentId, null, false)}
          >
            Inherit
          </button>
        </div>
      </div>

      <div class="agent-tools-grid" style="margin-top: 20px;">
        ${TOOL_SECTIONS.map(
          (section) =>
            html`
            <div class="agent-tools-section">
              <div class="agent-tools-header">${section.label}</div>
              <div class="agent-tools-list">
                ${section.tools.map((tool) => {
                  const { allowed } = resolveAllowed(tool.id);
                  return html`
                    <div class="agent-tool-row">
                      <div>
                        <div class="agent-tool-title mono">${tool.label}</div>
                        <div class="agent-tool-sub">${tool.description}</div>
                      </div>
                      <label class="cfg-toggle">
                        <input
                          type="checkbox"
                          .checked=${allowed}
                          ?disabled=${!editable}
                          @change=${(e: Event) =>
                            updateTool(tool.id, (e.target as HTMLInputElement).checked)}
                        />
                        <span class="cfg-toggle__track"></span>
                      </label>
                    </div>
                  `;
                })}
              </div>
            </div>
          `,
        )}
      </div>
    </section>
  `;
}

type SkillGroup = {
  id: string;
  label: string;
  skills: SkillStatusEntry[];
};

const SKILL_SOURCE_GROUPS: Array<{ id: string; label: string; sources: string[] }> = [
  { id: "workspace", label: "Workspace Skills", sources: ["openclaw-workspace"] },
  { id: "built-in", label: "Built-in Skills", sources: ["openclaw-bundled"] },
  { id: "installed", label: "Installed Skills", sources: ["openclaw-managed"] },
  { id: "extra", label: "Extra Skills", sources: ["openclaw-extra"] },
];

function groupSkills(skills: SkillStatusEntry[]): SkillGroup[] {
  const groups = new Map<string, SkillGroup>();
  for (const def of SKILL_SOURCE_GROUPS) {
    groups.set(def.id, { id: def.id, label: def.label, skills: [] });
  }
  const builtInGroup = SKILL_SOURCE_GROUPS.find((group) => group.id === "built-in");
  const other: SkillGroup = { id: "other", label: "Other Skills", skills: [] };
  for (const skill of skills) {
    const match = skill.bundled
      ? builtInGroup
      : SKILL_SOURCE_GROUPS.find((group) => group.sources.includes(skill.source));
    if (match) {
      groups.get(match.id)?.skills.push(skill);
    } else {
      other.skills.push(skill);
    }
  }
  const ordered = SKILL_SOURCE_GROUPS.map((group) => groups.get(group.id)).filter(
    (group): group is SkillGroup => Boolean(group && group.skills.length > 0),
  );
  if (other.skills.length > 0) {
    ordered.push(other);
  }
  return ordered;
}

function renderAgentSkills(params: {
  agentId: string;
  report: SkillStatusReport | null;
  loading: boolean;
  error: string | null;
  activeAgentId: string | null;
  configForm: Record<string, unknown> | null;
  configLoading: boolean;
  configSaving: boolean;
  configDirty: boolean;
  filter: string;
  onFilterChange: (next: string) => void;
  onRefresh: () => void;
  onToggle: (agentId: string, skillName: string, enabled: boolean) => void;
  onClear: (agentId: string) => void;
  onDisableAll: (agentId: string) => void;
  onConfigReload: () => void;
  onConfigSave: () => void;
}) {
  const editable = Boolean(params.configForm) && !params.configLoading && !params.configSaving;
  const config = resolveAgentConfig(params.configForm, params.agentId);
  const allowlist = Array.isArray(config.entry?.skills) ? config.entry?.skills : undefined;
  const allowSet = new Set((allowlist ?? []).map((name) => name.trim()).filter(Boolean));
  const usingAllowlist = allowlist !== undefined;
  const reportReady = Boolean(params.report && params.activeAgentId === params.agentId);
  const rawSkills = reportReady ? (params.report?.skills ?? []) : [];
  const filter = params.filter.trim().toLowerCase();
  const filtered = filter
    ? rawSkills.filter((skill) =>
        [skill.name, skill.description, skill.source].join(" ").toLowerCase().includes(filter),
      )
    : rawSkills;
  const groups = groupSkills(filtered);
  const activeSkills = rawSkills.filter((skill) => {
    const enabled = usingAllowlist ? allowSet.has(skill.name) : true;
    return enabled && skill.eligible;
  });
  const enabledCount = usingAllowlist
    ? rawSkills.filter((skill) => allowSet.has(skill.name)).length
    : rawSkills.length;
  const totalCount = rawSkills.length;

  return html`
    <section class="card">
      <div class="row" style="justify-content: space-between;">
        <div>
          <div class="card-title">Skills</div>
          <div class="card-sub">
            Per-agent skill allowlist and workspace skills.
            ${totalCount > 0 ? html`<span class="mono">${enabledCount}/${totalCount}</span>` : nothing}
          </div>
        </div>
        <div class="row" style="gap: 8px;">
          <button class="btn btn--sm" ?disabled=${!editable} @click=${() => params.onClear(params.agentId)}>
            Use All
          </button>
          <button class="btn btn--sm" ?disabled=${!editable} @click=${() => params.onDisableAll(params.agentId)}>
            Disable All
          </button>
          <button
            class="btn btn--sm"
            ?disabled=${params.configLoading}
            @click=${params.onConfigReload}
          >
            Reload Config
          </button>
          <button class="btn btn--sm" ?disabled=${params.loading} @click=${params.onRefresh}>
            ${params.loading ? "Loading…" : "Refresh"}
          </button>
          <button
            class="btn btn--sm primary"
            ?disabled=${params.configSaving || !params.configDirty}
            @click=${params.onConfigSave}
          >
            ${params.configSaving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      ${
        activeSkills.length > 0
          ? html`
              <div class="chip-row" style="margin-top: 12px;">
                ${activeSkills.map(
                  (skill) => html`
                    <span class="chip chip-ok">${skill.emoji ? `${skill.emoji} ` : ""}${skill.name}</span>
                  `,
                )}
              </div>
            `
          : nothing
      }

      ${
        !params.configForm
          ? html`
              <div class="callout info" style="margin-top: 12px">
                Load the gateway config to set per-agent skills.
              </div>
            `
          : nothing
      }
      ${
        usingAllowlist
          ? html`
              <div class="callout info" style="margin-top: 12px">This agent uses a custom skill allowlist.</div>
            `
          : html`
              <div class="callout info" style="margin-top: 12px">
                All skills are enabled. Disabling any skill will create a per-agent allowlist.
              </div>
            `
      }
      ${
        !reportReady && !params.loading
          ? html`
              <div class="callout info" style="margin-top: 12px">
                Load skills for this agent to view workspace-specific entries.
              </div>
            `
          : nothing
      }
      ${
        params.error
          ? html`<div class="callout danger" style="margin-top: 12px;">${params.error}</div>`
          : nothing
      }

      <div class="filters" style="margin-top: 14px;">
        <label class="field" style="flex: 1;">
          <span>Filter</span>
          <input
            .value=${params.filter}
            @input=${(e: Event) => params.onFilterChange((e.target as HTMLInputElement).value)}
            placeholder="Search skills"
          />
        </label>
        <div class="muted">${filtered.length} shown</div>
      </div>

      ${
        filtered.length === 0
          ? html`
              <div class="muted" style="margin-top: 16px">No skills found.</div>
            `
          : html`
              <div class="agent-skills-groups" style="margin-top: 16px;">
                ${groups.map((group) =>
                  renderAgentSkillGroup(group, {
                    agentId: params.agentId,
                    allowSet,
                    usingAllowlist,
                    editable,
                    onToggle: params.onToggle,
                  }),
                )}
              </div>
            `
      }
    </section>
  `;
}

function renderAgentSkillGroup(
  group: SkillGroup,
  params: {
    agentId: string;
    allowSet: Set<string>;
    usingAllowlist: boolean;
    editable: boolean;
    onToggle: (agentId: string, skillName: string, enabled: boolean) => void;
  },
) {
  return html`
    <details class="agent-skills-group" open>
      <summary class="agent-skills-header">
        <span>${group.label}</span>
        <span class="muted">${group.skills.length}</span>
      </summary>
      <div class="list skills-grid">
        ${group.skills.map((skill) =>
          renderAgentSkillRow(skill, {
            agentId: params.agentId,
            allowSet: params.allowSet,
            usingAllowlist: params.usingAllowlist,
            editable: params.editable,
            onToggle: params.onToggle,
          }),
        )}
      </div>
    </details>
  `;
}

function renderAgentSkillRow(
  skill: SkillStatusEntry,
  params: {
    agentId: string;
    allowSet: Set<string>;
    usingAllowlist: boolean;
    editable: boolean;
    onToggle: (agentId: string, skillName: string, enabled: boolean) => void;
  },
) {
  const enabled = params.usingAllowlist ? params.allowSet.has(skill.name) : true;
  const missing = [
    ...skill.missing.bins.map((b) => `bin:${b}`),
    ...skill.missing.env.map((e) => `env:${e}`),
    ...skill.missing.config.map((c) => `config:${c}`),
    ...skill.missing.os.map((o) => `os:${o}`),
  ];
  const reasons: string[] = [];
  if (skill.disabled) {
    reasons.push("disabled");
  }
  if (skill.blockedByAllowlist) {
    reasons.push("blocked by allowlist");
  }
  return html`
    <div class="list-item agent-skill-row">
      <div class="list-main">
        <div class="list-title">
          ${skill.emoji ? `${skill.emoji} ` : ""}${skill.name}
        </div>
        <div class="list-sub">${skill.description}</div>
        <div class="chip-row" style="margin-top: 6px;">
          <span class="chip">${skill.source}</span>
          <span class="chip ${skill.eligible ? "chip-ok" : "chip-warn"}">
            ${skill.eligible ? "eligible" : "blocked"}
          </span>
          ${
            skill.disabled
              ? html`
                  <span class="chip chip-warn">disabled</span>
                `
              : nothing
          }
        </div>
        ${
          missing.length > 0
            ? html`<div class="muted" style="margin-top: 6px;">Missing: ${missing.join(", ")}</div>`
            : nothing
        }
        ${
          reasons.length > 0
            ? html`<div class="muted" style="margin-top: 6px;">Reason: ${reasons.join(", ")}</div>`
            : nothing
        }
      </div>
      <div class="list-meta">
        <label class="cfg-toggle">
          <input
            type="checkbox"
            .checked=${enabled}
            ?disabled=${!params.editable}
            @change=${(e: Event) =>
              params.onToggle(params.agentId, skill.name, (e.target as HTMLInputElement).checked)}
          />
          <span class="cfg-toggle__track"></span>
        </label>
      </div>
    </div>
  `;
}
