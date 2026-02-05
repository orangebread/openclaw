import type { GatewayBrowserClient } from "../gateway";
import type {
  AgentModelConfig,
  AgentProfileEntry,
  AgentsProfileGetResult,
  AuthProfilesGetResult,
  AuthProfileSummary,
  ModelChoice,
} from "../types";
import { parseList } from "../format";

export type AgentProfileFormState = {
  agentId: string;

  textModelMode: "inherit" | "override";
  textModelPrimary: string;
  textModelFallbacks: string;
  textCredMode: "auto" | "locked";
  textAuthProfileId: string;

  imageModelMode: "inherit" | "override";
  imageModelPrimary: string;
  imageModelFallbacks: string;
  imageCredMode: "auto" | "locked";
  imageAuthProfileId: string;
};

export type AgentProfileState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  agentProfileLoading: boolean;
  agentProfileSaving: boolean;
  agentProfileError: string | null;
  agentProfileBaseHash: string | null;
  agentProfileAgents: AgentProfileEntry[];
  agentProfileSelectedAgentId: string | null;
  agentProfileForm: AgentProfileFormState | null;
  agentProfileDirty: boolean;
  agentProfileModels: ModelChoice[];
  agentProfileAuthProfiles: AuthProfileSummary[];
};

function normalizeModelConfig(value: AgentModelConfig | undefined): AgentModelConfig | null {
  if (!value) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  const primary = typeof value.primary === "string" ? value.primary.trim() : "";
  const fallbacks = Array.isArray(value.fallbacks)
    ? value.fallbacks.map((v) => String(v ?? "").trim()).filter(Boolean)
    : [];
  if (!primary && fallbacks.length === 0) return null;
  return {
    ...(primary ? { primary } : {}),
    ...(fallbacks.length > 0 ? { fallbacks } : {}),
  };
}

function asFallbacksText(value: AgentModelConfig | null): string {
  if (!value || typeof value === "string") return "";
  return (value.fallbacks ?? []).join("\n");
}

function asPrimaryText(value: AgentModelConfig | null): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  return value.primary ?? "";
}

export function deriveAgentProfileForm(entry: AgentProfileEntry): AgentProfileFormState {
  const model = normalizeModelConfig(entry.model);
  const imageModel = normalizeModelConfig(entry.imageModel);
  return {
    agentId: entry.id,
    textModelMode: model ? "override" : "inherit",
    textModelPrimary: asPrimaryText(model),
    textModelFallbacks: asFallbacksText(model),
    textCredMode: entry.authProfileId ? "locked" : "auto",
    textAuthProfileId: entry.authProfileId ?? "",
    imageModelMode: imageModel ? "override" : "inherit",
    imageModelPrimary: asPrimaryText(imageModel),
    imageModelFallbacks: asFallbacksText(imageModel),
    imageCredMode: entry.imageAuthProfileId ? "locked" : "auto",
    imageAuthProfileId: entry.imageAuthProfileId ?? "",
  };
}

function normalizeModelFromForm(params: {
  primary: string;
  fallbacksRaw: string;
  preferObject: boolean;
}): AgentModelConfig {
  const primary = params.primary.trim();
  const fallbacks = parseList(params.fallbacksRaw);
  if (fallbacks.length === 0 && !params.preferObject) {
    return primary;
  }
  return {
    primary,
    ...(fallbacks.length > 0 ? { fallbacks } : {}),
  };
}

function eqModelConfig(a: AgentModelConfig | undefined, b: AgentModelConfig | undefined): boolean {
  const na = normalizeModelConfig(a);
  const nb = normalizeModelConfig(b);
  if (!na && !nb) return true;
  if (!na || !nb) return false;
  if (typeof na === "string" && typeof nb === "string") return na === nb;
  if (typeof na === "string" || typeof nb === "string") return false;
  const primaryA = na.primary ?? "";
  const primaryB = nb.primary ?? "";
  if (primaryA !== primaryB) return false;
  const fallbacksA = na.fallbacks ?? [];
  const fallbacksB = nb.fallbacks ?? [];
  if (fallbacksA.length !== fallbacksB.length) return false;
  for (let i = 0; i < fallbacksA.length; i += 1) {
    if (fallbacksA[i] !== fallbacksB[i]) return false;
  }
  return true;
}

export function buildAgentProfileUpdate(params: {
  original: AgentProfileEntry;
  form: AgentProfileFormState;
}): { set: Record<string, unknown>; unset: string[] } {
  const unset = new Set<string>();
  const set: Record<string, unknown> = {};

  // Text model
  if (params.form.textModelMode === "inherit") {
    if (params.original.model !== undefined) unset.add("model");
  } else {
    const nextModel = normalizeModelFromForm({
      primary: params.form.textModelPrimary,
      fallbacksRaw: params.form.textModelFallbacks,
      preferObject: typeof params.original.model === "object",
    });
    if (!eqModelConfig(params.original.model, nextModel)) {
      set.model = nextModel;
    }
  }

  // Text creds
  if (params.form.textCredMode === "auto") {
    if (params.original.authProfileId !== undefined) unset.add("authProfileId");
  } else {
    const next = params.form.textAuthProfileId.trim();
    if (params.original.authProfileId !== next) set.authProfileId = next;
  }

  // Image model
  if (params.form.imageModelMode === "inherit") {
    if (params.original.imageModel !== undefined) unset.add("imageModel");
  } else {
    const nextModel = normalizeModelFromForm({
      primary: params.form.imageModelPrimary,
      fallbacksRaw: params.form.imageModelFallbacks,
      preferObject: typeof params.original.imageModel === "object",
    });
    if (!eqModelConfig(params.original.imageModel, nextModel)) {
      set.imageModel = nextModel;
    }
  }

  // Image creds
  if (params.form.imageCredMode === "auto") {
    if (params.original.imageAuthProfileId !== undefined) unset.add("imageAuthProfileId");
  } else {
    const next = params.form.imageAuthProfileId.trim();
    if (params.original.imageAuthProfileId !== next) set.imageAuthProfileId = next;
  }

  return { set, unset: Array.from(unset) };
}

function pickSelectedAgentId(params: {
  desired: string | null;
  agents: AgentProfileEntry[];
}): string | null {
  const desired = params.desired?.trim() || "";
  if (desired && params.agents.some((a) => a.id === desired)) return desired;
  return params.agents[0]?.id ?? null;
}

export async function loadAgentProfileEditor(state: AgentProfileState) {
  if (!state.client || !state.connected) return;
  if (state.agentProfileLoading) return;
  state.agentProfileLoading = true;
  state.agentProfileError = null;
  try {
    const [agentsRes, authRes, modelsRes] = await Promise.all([
      state.client.request("agents.profile.get", {}),
      state.client.request("auth.profiles.get", {}),
      state.client.request("models.list", {}),
    ]);
    const agentsPayload = agentsRes as AgentsProfileGetResult | undefined;
    const authPayload = authRes as AuthProfilesGetResult | undefined;
    const modelsPayload = modelsRes as { models?: ModelChoice[] } | undefined;

    const agents = agentsPayload?.agents ?? [];
    state.agentProfileAgents = agents;
    state.agentProfileBaseHash = agentsPayload?.baseHash ?? null;
    state.agentProfileAuthProfiles = authPayload?.profiles ?? [];
    state.agentProfileModels = modelsPayload?.models ?? [];

    const selected = pickSelectedAgentId({
      desired: state.agentProfileSelectedAgentId,
      agents,
    });
    state.agentProfileSelectedAgentId = selected;
    const entry = selected ? agents.find((a) => a.id === selected) ?? null : null;
    state.agentProfileForm = entry ? deriveAgentProfileForm(entry) : null;
    state.agentProfileDirty = false;
  } catch (err) {
    state.agentProfileError = String(err);
  } finally {
    state.agentProfileLoading = false;
  }
}

export function selectAgentProfileAgent(state: AgentProfileState, agentId: string) {
  const trimmed = agentId.trim();
  if (!trimmed) return;
  state.agentProfileSelectedAgentId = trimmed;
  const entry = state.agentProfileAgents.find((a) => a.id === trimmed) ?? null;
  state.agentProfileForm = entry ? deriveAgentProfileForm(entry) : null;
  state.agentProfileDirty = false;
  state.agentProfileError = null;
}

export function updateAgentProfileForm(
  state: AgentProfileState,
  patch: Partial<AgentProfileFormState>,
) {
  if (!state.agentProfileForm) return;
  state.agentProfileForm = { ...state.agentProfileForm, ...patch };
  const original =
    state.agentProfileAgents.find((a) => a.id === state.agentProfileForm?.agentId) ?? null;
  if (!original) {
    state.agentProfileDirty = true;
    return;
  }
  const update = buildAgentProfileUpdate({ original, form: state.agentProfileForm });
  state.agentProfileDirty = update.unset.length > 0 || Object.keys(update.set).length > 0;
}

export async function saveAgentProfile(state: AgentProfileState) {
  if (!state.client || !state.connected) return;
  if (!state.agentProfileForm) return;
  if (state.agentProfileSaving) return;

  const original =
    state.agentProfileAgents.find((a) => a.id === state.agentProfileForm?.agentId) ?? null;
  if (!original) return;

  const update = buildAgentProfileUpdate({ original, form: state.agentProfileForm });
  if (update.unset.length === 0 && Object.keys(update.set).length === 0) {
    state.agentProfileDirty = false;
    return;
  }

  state.agentProfileSaving = true;
  state.agentProfileError = null;
  try {
    const res = (await state.client.request("agents.profile.update", {
      baseHash: state.agentProfileBaseHash ?? undefined,
      agentId: state.agentProfileForm.agentId,
      ...(Object.keys(update.set).length > 0 ? { set: update.set } : {}),
      ...(update.unset.length > 0 ? { unset: update.unset } : {}),
    })) as { ok?: boolean; baseHash?: string; agent?: AgentProfileEntry } | undefined;

    if (!res?.ok || !res.agent) {
      throw new Error("agent update failed");
    }

    state.agentProfileBaseHash = res.baseHash ?? null;
    state.agentProfileAgents = state.agentProfileAgents.map((entry) =>
      entry.id === res.agent?.id ? res.agent : entry,
    );
    state.agentProfileForm = deriveAgentProfileForm(res.agent);
    state.agentProfileDirty = false;
  } catch (err) {
    state.agentProfileError = String(err);
  } finally {
    state.agentProfileSaving = false;
  }
}

