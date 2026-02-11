import type { GatewayBrowserClient } from "../gateway";
import type {
  AuthProfileSummary,
  AuthProfilesGetResult,
  AuthFlowCurrentResult,
  AuthFlowCompletePayload,
  AuthFlowListResult,
  AuthFlowNextResult,
  AuthFlowStartResult,
  AuthFlowStep,
  ConfigSnapshot,
  WizardCurrentResult,
  WizardNextResult,
  WizardStartResult,
  WizardStep,
} from "../types";

export type CredentialsApiKeyFormState = {
  profileId: string;
  provider: string;
  email: string;
  apiKey: string;
};

export type CredentialsSuccessState = {
  message: string;
  profileId: string | null;
  expiresAtMs: number;
};

export type CredentialsDisconnectImpacts = {
  referencedByConfigAuthProfiles: boolean;
  lockedTextAgents: string[];
  lockedImageAgents: string[];
};

export type CredentialsDisconnectDialogState = {
  open: boolean;
  profileId: string;
  provider: string | null;
  providerCount: number | null;
  impactsLoading: boolean;
  impactsError: string | null;
  impacts: CredentialsDisconnectImpacts | null;
  requestId: number;
};

export type CredentialsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;

  credentialsLoading: boolean;
  credentialsError: string | null;
  credentialsBaseHash: string | null;
  credentialsProfiles: AuthProfileSummary[];

  credentialsSaving: boolean;
  credentialsSuccess: CredentialsSuccessState | null;
  credentialsDisconnectDialog: CredentialsDisconnectDialogState | null;

  credentialsApiKeyForm: CredentialsApiKeyFormState;

  credentialsAuthFlowLoading: boolean;
  credentialsAuthFlowError: string | null;
  credentialsAuthFlowList: AuthFlowListResult | null;
  credentialsAuthFlowBusy: boolean;
  credentialsAuthFlowRunning: boolean;
  credentialsAuthFlowOwned: boolean;
  credentialsAuthFlowSessionId: string | null;
  credentialsAuthFlowStep: AuthFlowStep | null;
  credentialsAuthFlowAnswer: unknown;
  credentialsAuthFlowResult: AuthFlowCompletePayload | null;
  credentialsAuthFlowApplyError: string | null;
  credentialsAuthFlowProviderId: string | null;
  credentialsAuthFlowMethodId: string | null;
  credentialsAuthFlowHadProviderProfilesBefore: boolean;
  credentialsAuthFlowPendingDefaultModel: string | null;

  credentialsWizardBusy: boolean;
  credentialsWizardError: string | null;
  credentialsWizardRunning: boolean;
  credentialsWizardOwned: boolean;
  credentialsWizardSessionId: string | null;
  credentialsWizardStep: WizardStep | null;
  credentialsWizardAnswer: unknown;
};

const credentialsLoadInFlight = new WeakMap<CredentialsState, Promise<void>>();
const credentialsLoadQueued = new WeakMap<CredentialsState, boolean>();

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeProviderId(provider?: string | null): string {
  if (!provider) {
    return "";
  }
  const normalized = provider.trim().toLowerCase();
  if (normalized === "z.ai" || normalized === "z-ai") {
    return "zai";
  }
  return normalized;
}

function stripDefaultModelPatch(patch: unknown): unknown {
  if (!isPlainRecord(patch)) {
    return patch;
  }
  // Config patch is transported over the wire as JSON; assume it's JSON-serializable.
  const clone = JSON.parse(JSON.stringify(patch)) as Record<string, unknown>;
  const agents = clone.agents;
  if (isPlainRecord(agents)) {
    const defaults = agents.defaults;
    if (isPlainRecord(defaults)) {
      delete defaults.model;
      delete defaults.models;
      if (Object.keys(defaults).length === 0) {
        delete agents.defaults;
      }
    }
    if (Object.keys(agents).length === 0) {
      delete clone.agents;
    }
  }
  return clone;
}

function buildDefaultModelPatch(model: string): Record<string, unknown> {
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

async function loadDisconnectImpacts(
  state: CredentialsState,
  profileId: string,
): Promise<CredentialsDisconnectImpacts> {
  if (!state.client || !state.connected) {
    return {
      referencedByConfigAuthProfiles: false,
      lockedTextAgents: [],
      lockedImageAgents: [],
    };
  }
  try {
    const snapshot = (await state.client.request("config.get", {})) as ConfigSnapshot | undefined;
    if (!snapshot?.valid || !isPlainRecord(snapshot.config)) {
      return {
        referencedByConfigAuthProfiles: false,
        lockedTextAgents: [],
        lockedImageAgents: [],
      };
    }
    const cfg = snapshot.config as Record<string, unknown>;

    const auth = cfg.auth;
    const referencedByConfigAuthProfiles = Boolean(
      isPlainRecord(auth) && isPlainRecord(auth.profiles) && profileId in auth.profiles,
    );

    const agents = cfg.agents;
    const agentsList = isPlainRecord(agents) && Array.isArray(agents.list) ? agents.list : [];
    const lockedTextAgents: string[] = [];
    const lockedImageAgents: string[] = [];
    for (const entry of agentsList) {
      if (!isPlainRecord(entry)) {
        continue;
      }
      const id = typeof entry.id === "string" && entry.id.trim() ? entry.id.trim() : "(unknown)";
      if (entry.authProfileId === profileId) {
        lockedTextAgents.push(id);
      }
      if (entry.imageAuthProfileId === profileId) {
        lockedImageAgents.push(id);
      }
    }

    return {
      referencedByConfigAuthProfiles,
      lockedTextAgents,
      lockedImageAgents,
    };
  } catch {
    return {
      referencedByConfigAuthProfiles: false,
      lockedTextAgents: [],
      lockedImageAgents: [],
    };
  }
}

function resetAuthFlowAnswerForStep(step: AuthFlowStep | null): unknown {
  if (!step) {
    return null;
  }
  if (step.type === "note") {
    return true;
  }
  if (step.type === "openUrl") {
    return true;
  }
  if (step.type === "confirm") {
    return typeof step.initialValue === "boolean" ? step.initialValue : false;
  }
  if (step.type === "text") {
    return typeof step.initialValue === "string" ? step.initialValue : "";
  }
  if (step.type === "select") {
    if (step.initialValue !== undefined) {
      return step.initialValue;
    }
    return step.options?.[0]?.value ?? null;
  }
  if (step.type === "multiselect") {
    return Array.isArray(step.initialValue) ? step.initialValue : [];
  }
  return null;
}

function resetWizardAnswerForStep(step: WizardStep | null): unknown {
  if (!step) {
    return null;
  }
  if (step.type === "note") {
    return true;
  }
  if (step.type === "confirm") {
    return typeof step.initialValue === "boolean" ? step.initialValue : false;
  }
  if (step.type === "text") {
    return typeof step.initialValue === "string" ? step.initialValue : "";
  }
  if (step.type === "select") {
    if (step.initialValue !== undefined) {
      return step.initialValue;
    }
    return step.options?.[0]?.value ?? null;
  }
  if (step.type === "multiselect") {
    return Array.isArray(step.initialValue) ? step.initialValue : [];
  }
  return null;
}

function clearWizardState(state: CredentialsState) {
  state.credentialsWizardRunning = false;
  state.credentialsWizardOwned = false;
  state.credentialsWizardSessionId = null;
  state.credentialsWizardStep = null;
  state.credentialsWizardAnswer = null;
}

function clearAuthFlowState(state: CredentialsState) {
  state.credentialsAuthFlowRunning = false;
  state.credentialsAuthFlowOwned = false;
  state.credentialsAuthFlowSessionId = null;
  state.credentialsAuthFlowStep = null;
  state.credentialsAuthFlowAnswer = null;
  state.credentialsAuthFlowProviderId = null;
  state.credentialsAuthFlowMethodId = null;
  state.credentialsAuthFlowHadProviderProfilesBefore = false;
}

async function refreshWizardOwnership(
  state: CredentialsState,
): Promise<WizardCurrentResult | null> {
  if (!state.client || !state.connected) {
    return null;
  }
  const res = (await state.client.request("wizard.current", {})) as WizardCurrentResult | undefined;
  if (!res?.running) {
    clearWizardState(state);
    return null;
  }

  state.credentialsWizardRunning = true;
  state.credentialsWizardOwned = Boolean(res.owned);
  state.credentialsWizardSessionId = res.owned && res.sessionId ? res.sessionId : null;
  if (!state.credentialsWizardOwned) {
    state.credentialsWizardStep = null;
    state.credentialsWizardAnswer = null;
  }
  return res;
}

async function refreshAuthFlowOwnership(
  state: CredentialsState,
): Promise<AuthFlowCurrentResult | null> {
  if (!state.client || !state.connected) {
    return null;
  }
  const res = (await state.client.request("auth.flow.current", {})) as
    | AuthFlowCurrentResult
    | undefined;
  if (!res?.running) {
    clearAuthFlowState(state);
    return null;
  }

  state.credentialsAuthFlowRunning = true;
  state.credentialsAuthFlowOwned = Boolean(res.owned);
  state.credentialsAuthFlowSessionId = res.owned && res.sessionId ? res.sessionId : null;
  if (!state.credentialsAuthFlowOwned) {
    state.credentialsAuthFlowStep = null;
    state.credentialsAuthFlowAnswer = null;
  }
  return res;
}

async function fetchWizardStep(
  state: CredentialsState,
  sessionId: string,
): Promise<WizardStep | null> {
  const res = (await state.client?.request("wizard.next", { sessionId })) as
    | WizardNextResult
    | undefined;
  if (!res) {
    return null;
  }
  if (res.done || (res.status && res.status !== "running")) {
    clearWizardState(state);
    return null;
  }
  const step = res.step ?? null;
  state.credentialsWizardStep = step;
  state.credentialsWizardAnswer = resetWizardAnswerForStep(step);
  return step;
}

async function fetchAuthFlowStep(
  state: CredentialsState,
  sessionId: string,
): Promise<AuthFlowStep | null> {
  const res = (await state.client?.request("auth.flow.next", { sessionId })) as
    | AuthFlowNextResult
    | undefined;
  if (!res) {
    return null;
  }
  if (res.done || (res.status && res.status !== "running")) {
    clearAuthFlowState(state);
    state.credentialsAuthFlowResult = res.result ?? null;
    return null;
  }
  const step = (res.step ?? null) as AuthFlowStep | null;
  state.credentialsAuthFlowStep = step;
  state.credentialsAuthFlowAnswer = resetAuthFlowAnswerForStep(step);
  return step;
}

export function updateCredentialsApiKeyForm(
  state: CredentialsState,
  patch: Partial<CredentialsApiKeyFormState>,
) {
  state.credentialsApiKeyForm = { ...state.credentialsApiKeyForm, ...patch };
}

export async function loadCredentials(state: CredentialsState) {
  if (!state.client || !state.connected) {
    return;
  }
  const inFlight = credentialsLoadInFlight.get(state);
  if (inFlight) {
    credentialsLoadQueued.set(state, true);
    return inFlight;
  }

  state.credentialsLoading = true;
  state.credentialsAuthFlowLoading = true;
  const p = (async () => {
    try {
      while (true) {
        credentialsLoadQueued.set(state, false);
        state.credentialsError = null;
        state.credentialsWizardError = null;
        state.credentialsAuthFlowError = null;
        try {
          const settled = await Promise.allSettled([
            state.client!.request("auth.profiles.get", {}),
            state.client!.request("auth.flow.list", {}),
            refreshWizardOwnership(state),
            refreshAuthFlowOwnership(state),
          ]);

          const authRes = settled[0];
          if (authRes.status === "fulfilled") {
            const auth = authRes.value as AuthProfilesGetResult | undefined;
            state.credentialsProfiles = auth?.profiles ?? [];
            state.credentialsBaseHash = auth?.baseHash ?? null;
          } else {
            state.credentialsError = String(authRes.reason);
          }

          const flowListRes = settled[1];
          if (flowListRes.status === "fulfilled") {
            state.credentialsAuthFlowList = flowListRes.value as AuthFlowListResult;
          } else {
            state.credentialsAuthFlowError = String(flowListRes.reason);
          }

          if (
            state.credentialsWizardRunning &&
            state.credentialsWizardOwned &&
            state.credentialsWizardSessionId
          ) {
            if (!state.credentialsWizardStep) {
              await fetchWizardStep(state, state.credentialsWizardSessionId);
            }
          }
          if (
            state.credentialsAuthFlowRunning &&
            state.credentialsAuthFlowOwned &&
            state.credentialsAuthFlowSessionId
          ) {
            if (!state.credentialsAuthFlowStep) {
              await fetchAuthFlowStep(state, state.credentialsAuthFlowSessionId);
            }
          }
        } catch (err) {
          state.credentialsError = String(err);
        }

        if (!credentialsLoadQueued.get(state)) {
          break;
        }
      }
    } finally {
      state.credentialsLoading = false;
      state.credentialsAuthFlowLoading = false;
      credentialsLoadInFlight.delete(state);
      credentialsLoadQueued.delete(state);
    }
  })();

  credentialsLoadInFlight.set(state, p);
  return p;
}

async function applyAuthFlowConfigPatch(state: CredentialsState, patch: unknown) {
  if (!state.client || !state.connected) {
    return;
  }
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return;
  }

  state.credentialsAuthFlowApplyError = null;

  const attempt = async () => {
    const snap = (await state.client!.request("config.get", {})) as ConfigSnapshot | undefined;
    if (!snap?.exists) {
      throw new Error("config does not exist; run onboarding or create config before patching");
    }
    const baseHash = snap.hash ?? null;
    if (!baseHash) {
      throw new Error("config base hash unavailable; re-run config.get and retry");
    }
    await state.client!.request("config.patch", {
      baseHash,
      raw: JSON.stringify(patch, null, 2),
    });
  };

  try {
    await attempt();
  } catch (err) {
    const msg = String(err);
    const shouldRetry =
      msg.includes("config changed since last load") || msg.includes("config base hash required");
    if (!shouldRetry) {
      state.credentialsAuthFlowApplyError = msg;
      return;
    }
    try {
      await attempt();
    } catch (err2) {
      state.credentialsAuthFlowApplyError = String(err2);
    }
  }
}

export async function upsertCredentialsApiKeyProfile(state: CredentialsState) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.credentialsSaving) {
    return;
  }
  state.credentialsSaving = true;
  state.credentialsError = null;
  state.credentialsSuccess = null;
  const apiKey = state.credentialsApiKeyForm.apiKey;
  try {
    const profileId = state.credentialsApiKeyForm.profileId.trim();
    const provider = state.credentialsApiKeyForm.provider.trim();
    const emailRaw = state.credentialsApiKeyForm.email.trim();
    if (!profileId || !provider || !apiKey.trim()) {
      state.credentialsError = "profileId, provider, and apiKey are required.";
      return;
    }

    const attemptUpsert = async () => {
      const res = (await state.client!.request("auth.profiles.upsertApiKey", {
        baseHash: state.credentialsBaseHash ?? undefined,
        profileId,
        provider,
        apiKey,
        ...(emailRaw ? { email: emailRaw } : {}),
      })) as { baseHash?: string } | undefined;
      state.credentialsBaseHash = res?.baseHash ?? state.credentialsBaseHash;
    };

    try {
      await attemptUpsert();
    } catch (err) {
      const message = String(err);
      const shouldRetry =
        message.includes("auth base hash required") ||
        message.includes("auth store changed since last load");
      if (!shouldRetry) {
        throw err;
      }

      await loadCredentials(state);
      await attemptUpsert();
    }

    state.credentialsApiKeyForm = {
      ...state.credentialsApiKeyForm,
      apiKey: "",
    };
    await loadCredentials(state);

    const expiresAtMs = Date.now() + 5500;
    state.credentialsSuccess = { message: "Credential saved.", profileId, expiresAtMs };
    window.setTimeout(() => {
      if (!state.credentialsSuccess) {
        return;
      }
      if (state.credentialsSuccess.profileId !== profileId) {
        return;
      }
      if (state.credentialsSuccess.expiresAtMs !== expiresAtMs) {
        return;
      }
      state.credentialsSuccess = null;
    }, 5600);

    try {
      const encoded = encodeURIComponent(profileId);
      const rowId = `credentials-profile-${encoded}`;
      const el = document.getElementById(rowId);
      const target = el ?? document.getElementById("credentials-auth-profiles");
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch {
      // ignore
    }

    try {
      const panels = document.querySelectorAll('details[data-credentials-api-key-panel="1"]');
      for (const panel of Array.from(panels)) {
        (panel as HTMLDetailsElement).open = false;
      }
    } catch {
      // ignore
    }
  } catch (err) {
    state.credentialsError = String(err);
  } finally {
    // Always clear secrets (success or failure).
    if (state.credentialsApiKeyForm.apiKey) {
      state.credentialsApiKeyForm = { ...state.credentialsApiKeyForm, apiKey: "" };
    }
    state.credentialsSaving = false;
  }
}

export async function requestDeleteCredentialsProfile(state: CredentialsState, profileId: string) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.credentialsSaving) {
    return;
  }
  const trimmed = profileId.trim();
  if (!trimmed) {
    return;
  }

  const profile = state.credentialsProfiles.find((p) => p.id === trimmed) ?? null;
  const provider = profile?.provider ? normalizeProviderId(profile.provider) : null;
  const providerCount = provider
    ? state.credentialsProfiles.filter((p) => normalizeProviderId(p.provider) === provider).length
    : null;

  const requestId = (state.credentialsDisconnectDialog?.requestId ?? 0) + 1;
  state.credentialsDisconnectDialog = {
    open: true,
    profileId: trimmed,
    provider,
    providerCount,
    impactsLoading: true,
    impactsError: null,
    impacts: null,
    requestId,
  };

  try {
    const impacts = await loadDisconnectImpacts(state, trimmed);
    if (state.credentialsDisconnectDialog?.requestId !== requestId) {
      return;
    }
    state.credentialsDisconnectDialog = {
      ...state.credentialsDisconnectDialog,
      impactsLoading: false,
      impactsError: null,
      impacts,
    };
  } catch (err) {
    if (state.credentialsDisconnectDialog?.requestId !== requestId) {
      return;
    }
    state.credentialsDisconnectDialog = {
      ...state.credentialsDisconnectDialog,
      impactsLoading: false,
      impactsError: String(err),
      impacts: null,
    };
  }
}

export function cancelDeleteCredentialsProfile(state: CredentialsState) {
  if (!state.credentialsDisconnectDialog?.open) {
    return;
  }
  state.credentialsDisconnectDialog = null;
}

export async function confirmDeleteCredentialsProfile(state: CredentialsState, profileId: string) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.credentialsSaving) {
    return;
  }
  const trimmed = profileId.trim();
  if (!trimmed) {
    return;
  }

  state.credentialsSaving = true;
  state.credentialsError = null;
  try {
    const attemptDelete = async () => {
      const res = (await state.client!.request("auth.profiles.delete", {
        baseHash: state.credentialsBaseHash ?? undefined,
        profileId: trimmed,
      })) as { baseHash?: string } | undefined;
      state.credentialsBaseHash = res?.baseHash ?? state.credentialsBaseHash;
    };

    try {
      await attemptDelete();
    } catch (err) {
      const message = String(err);
      const shouldRetry =
        message.includes("auth base hash required") ||
        message.includes("auth store changed since last load");
      if (!shouldRetry) {
        throw err;
      }

      await loadCredentials(state);
      await attemptDelete();
    }
    await loadCredentials(state);
    state.credentialsDisconnectDialog = null;
  } catch (err) {
    state.credentialsError = String(err);
  } finally {
    state.credentialsSaving = false;
  }
}

export async function startCredentialsAuthFlow(
  state: CredentialsState,
  params: { providerId: string; methodId: string; mode: "local" | "remote" },
) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.credentialsAuthFlowBusy) {
    return;
  }
  state.credentialsAuthFlowBusy = true;
  state.credentialsAuthFlowError = null;
  state.credentialsAuthFlowApplyError = null;
  state.credentialsAuthFlowResult = null;
  state.credentialsAuthFlowPendingDefaultModel = null;
  state.credentialsAuthFlowProviderId = params.providerId;
  state.credentialsAuthFlowMethodId = params.methodId;
  state.credentialsAuthFlowHadProviderProfilesBefore = state.credentialsProfiles.some(
    (p) => normalizeProviderId(p.provider) === normalizeProviderId(params.providerId),
  );
  try {
    const res = (await state.client.request("auth.flow.start", {
      providerId: params.providerId,
      methodId: params.methodId,
      mode: params.mode,
    })) as AuthFlowStartResult | undefined;
    if (!res?.sessionId) {
      state.credentialsAuthFlowError = "auth flow start failed";
      return;
    }
    if (res.done || (res.status && res.status !== "running")) {
      const hadProviderProfilesBefore = state.credentialsAuthFlowHadProviderProfilesBefore;
      clearAuthFlowState(state);
      if (res.status === "error") {
        state.credentialsAuthFlowError = res.error || "auth flow failed";
        await loadCredentials(state);
        return;
      }
      state.credentialsAuthFlowResult = res.result ?? null;
      if (res.result?.configPatch) {
        const patch = hadProviderProfilesBefore
          ? stripDefaultModelPatch(res.result.configPatch)
          : res.result.configPatch;
        await applyAuthFlowConfigPatch(state, patch);
      }
      if (hadProviderProfilesBefore && res.result?.defaultModel) {
        state.credentialsAuthFlowPendingDefaultModel = res.result.defaultModel;
      }
      await loadCredentials(state);
      return;
    }
    state.credentialsAuthFlowRunning = true;
    state.credentialsAuthFlowOwned = true;
    state.credentialsAuthFlowSessionId = res.sessionId;
    state.credentialsAuthFlowStep = (res.step ?? null) as AuthFlowStep | null;
    state.credentialsAuthFlowAnswer = resetAuthFlowAnswerForStep(state.credentialsAuthFlowStep);
  } catch (err) {
    state.credentialsAuthFlowError = String(err);
    await refreshAuthFlowOwnership(state);
  } finally {
    state.credentialsAuthFlowBusy = false;
  }
}

export async function resumeCredentialsAuthFlow(state: CredentialsState) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.credentialsAuthFlowBusy) {
    return;
  }
  state.credentialsAuthFlowBusy = true;
  state.credentialsAuthFlowError = null;
  try {
    const current = await refreshAuthFlowOwnership(state);
    if (!current?.running || !current.owned || !current.sessionId) {
      state.credentialsAuthFlowError = current?.running ? "auth flow not owned by client" : null;
      return;
    }
    await fetchAuthFlowStep(state, current.sessionId);
  } catch (err) {
    state.credentialsAuthFlowError = String(err);
  } finally {
    state.credentialsAuthFlowBusy = false;
  }
}

export async function cancelCurrentCredentialsAuthFlow(state: CredentialsState) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.credentialsAuthFlowBusy) {
    return;
  }
  state.credentialsAuthFlowBusy = true;
  state.credentialsAuthFlowError = null;
  try {
    await state.client.request("auth.flow.cancelCurrent", {});
    clearAuthFlowState(state);
    await loadCredentials(state);
  } catch (err) {
    state.credentialsAuthFlowError = String(err);
    await refreshAuthFlowOwnership(state);
  } finally {
    state.credentialsAuthFlowBusy = false;
  }
}

export async function advanceCredentialsAuthFlow(state: CredentialsState) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.credentialsAuthFlowBusy) {
    return;
  }
  if (!state.credentialsAuthFlowStep) {
    return;
  }
  state.credentialsAuthFlowBusy = true;
  state.credentialsAuthFlowError = null;
  const submittedStep = state.credentialsAuthFlowStep;
  const shouldClearSensitive =
    submittedStep.type === "text" &&
    submittedStep.sensitive &&
    typeof state.credentialsAuthFlowAnswer === "string";
  try {
    const hadProviderProfilesBefore = state.credentialsAuthFlowHadProviderProfilesBefore;
    const sessionId =
      state.credentialsAuthFlowSessionId ??
      ((await state.client.request("auth.flow.current", {})) as AuthFlowCurrentResult | undefined)
        ?.sessionId ??
      null;
    if (!sessionId) {
      state.credentialsAuthFlowError = "auth flow session id unavailable; reload and retry";
      return;
    }

    const step = submittedStep;
    const value = state.credentialsAuthFlowAnswer;
    const res = (await state.client.request("auth.flow.next", {
      sessionId,
      answer: { stepId: step.id, value },
    })) as AuthFlowNextResult | undefined;

    if (!res) {
      state.credentialsAuthFlowError = "auth flow step failed";
      return;
    }
    if (res.done || (res.status && res.status !== "running")) {
      clearAuthFlowState(state);
      if (res.status === "error") {
        state.credentialsAuthFlowError = res.error || "auth flow failed";
        await loadCredentials(state);
        return;
      }
      state.credentialsAuthFlowResult = res.result ?? null;
      if (res.result?.configPatch) {
        const patch = hadProviderProfilesBefore
          ? stripDefaultModelPatch(res.result.configPatch)
          : res.result.configPatch;
        await applyAuthFlowConfigPatch(state, patch);
      }
      if (hadProviderProfilesBefore && res.result?.defaultModel) {
        state.credentialsAuthFlowPendingDefaultModel = res.result.defaultModel;
      }
      await loadCredentials(state);
      return;
    }
    state.credentialsAuthFlowRunning = true;
    state.credentialsAuthFlowOwned = true;
    state.credentialsAuthFlowSessionId = sessionId;
    state.credentialsAuthFlowStep = (res.step ?? null) as AuthFlowStep | null;
    state.credentialsAuthFlowAnswer = resetAuthFlowAnswerForStep(state.credentialsAuthFlowStep);
  } catch (err) {
    state.credentialsAuthFlowError = String(err);
    await refreshAuthFlowOwnership(state);
  } finally {
    if (
      shouldClearSensitive &&
      state.credentialsAuthFlowRunning &&
      state.credentialsAuthFlowOwned &&
      state.credentialsAuthFlowStep?.id === submittedStep.id
    ) {
      state.credentialsAuthFlowAnswer = "";
    }
    state.credentialsAuthFlowBusy = false;
  }
}

export function updateCredentialsAuthFlowAnswer(state: CredentialsState, next: unknown) {
  state.credentialsAuthFlowAnswer = next;
}

export async function applyPendingCredentialsAuthFlowDefaults(state: CredentialsState) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.credentialsAuthFlowBusy) {
    return;
  }
  const model = state.credentialsAuthFlowPendingDefaultModel?.trim() ?? "";
  if (!model) {
    return;
  }
  state.credentialsAuthFlowBusy = true;
  state.credentialsAuthFlowApplyError = null;
  try {
    await applyAuthFlowConfigPatch(state, buildDefaultModelPatch(model));
    state.credentialsAuthFlowPendingDefaultModel = null;
    await loadCredentials(state);
  } catch (err) {
    state.credentialsAuthFlowApplyError = String(err);
  } finally {
    state.credentialsAuthFlowBusy = false;
  }
}

export async function startCredentialsWizard(state: CredentialsState) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.credentialsWizardBusy) {
    return;
  }
  state.credentialsWizardBusy = true;
  state.credentialsWizardError = null;
  try {
    const res = (await state.client.request("wizard.start", { mode: "local" })) as
      | WizardStartResult
      | undefined;
    if (!res?.sessionId) {
      state.credentialsWizardError = "wizard start failed";
      return;
    }
    if (res.done || (res.status && res.status !== "running")) {
      clearWizardState(state);
      await loadCredentials(state);
      return;
    }
    state.credentialsWizardRunning = true;
    state.credentialsWizardOwned = true;
    state.credentialsWizardSessionId = res.sessionId;
    state.credentialsWizardStep = res.step ?? null;
    state.credentialsWizardAnswer = resetWizardAnswerForStep(state.credentialsWizardStep);
  } catch (err) {
    state.credentialsWizardError = String(err);
    await refreshWizardOwnership(state);
  } finally {
    state.credentialsWizardBusy = false;
  }
}

export async function resumeCredentialsWizard(state: CredentialsState) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.credentialsWizardBusy) {
    return;
  }
  state.credentialsWizardBusy = true;
  state.credentialsWizardError = null;
  try {
    const current = await refreshWizardOwnership(state);
    if (!current?.running || !current.owned || !current.sessionId) {
      state.credentialsWizardError = current?.running ? "wizard not owned by client" : null;
      return;
    }
    await fetchWizardStep(state, current.sessionId);
  } catch (err) {
    state.credentialsWizardError = String(err);
  } finally {
    state.credentialsWizardBusy = false;
  }
}

export async function cancelCurrentCredentialsWizard(state: CredentialsState) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.credentialsWizardBusy) {
    return;
  }
  state.credentialsWizardBusy = true;
  state.credentialsWizardError = null;
  try {
    await state.client.request("wizard.cancelCurrent", {});
    clearWizardState(state);
    await loadCredentials(state);
  } catch (err) {
    state.credentialsWizardError = String(err);
    await refreshWizardOwnership(state);
  } finally {
    state.credentialsWizardBusy = false;
  }
}

export async function advanceCredentialsWizard(state: CredentialsState) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.credentialsWizardBusy) {
    return;
  }
  if (!state.credentialsWizardStep) {
    return;
  }
  state.credentialsWizardBusy = true;
  state.credentialsWizardError = null;
  const submittedStep = state.credentialsWizardStep;
  const shouldClearSensitive =
    submittedStep.type === "text" &&
    submittedStep.sensitive &&
    typeof state.credentialsWizardAnswer === "string";
  try {
    const sessionId =
      state.credentialsWizardSessionId ??
      ((await state.client.request("wizard.current", {})) as WizardCurrentResult | undefined)
        ?.sessionId ??
      null;
    if (!sessionId) {
      state.credentialsWizardError = "wizard session id unavailable; reload and retry";
      return;
    }

    const step = submittedStep;
    const value = state.credentialsWizardAnswer;
    const res = (await state.client.request("wizard.next", {
      sessionId,
      answer: { stepId: step.id, value },
    })) as WizardNextResult | undefined;

    if (!res) {
      state.credentialsWizardError = "wizard step failed";
      return;
    }
    if (res.done || (res.status && res.status !== "running")) {
      clearWizardState(state);
      await loadCredentials(state);
      return;
    }
    state.credentialsWizardRunning = true;
    state.credentialsWizardOwned = true;
    state.credentialsWizardSessionId = sessionId;
    state.credentialsWizardStep = res.step ?? null;
    state.credentialsWizardAnswer = resetWizardAnswerForStep(state.credentialsWizardStep);
  } catch (err) {
    state.credentialsWizardError = String(err);
    await refreshWizardOwnership(state);
  } finally {
    if (
      shouldClearSensitive &&
      state.credentialsWizardRunning &&
      state.credentialsWizardOwned &&
      state.credentialsWizardStep?.id === submittedStep.id
    ) {
      state.credentialsWizardAnswer = "";
    }
    state.credentialsWizardBusy = false;
  }
}

export function updateCredentialsWizardAnswer(state: CredentialsState, next: unknown) {
  state.credentialsWizardAnswer = next;
}
