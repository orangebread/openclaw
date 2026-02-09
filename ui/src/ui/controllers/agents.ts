import type { GatewayBrowserClient } from "../gateway.ts";
import type { AgentsListResult, ModelChoice } from "../types.ts";

export type AgentsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  agentsLoading: boolean;
  agentsError: string | null;
  agentsList: AgentsListResult | null;
  agentsSelectedId: string | null;
  agentsModelCatalog: ModelChoice[];
  agentsCreating: boolean;
  agentsCreateError: string | null;
  agentsShowAddForm: boolean;
  agentsDeleting: boolean;
  agentsDeleteError: string | null;
};

export async function loadAgents(state: AgentsState) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.agentsLoading) {
    return;
  }
  state.agentsLoading = true;
  state.agentsError = null;
  try {
    const res = await state.client.request<AgentsListResult>("agents.list", {});
    if (res) {
      state.agentsList = res;
      const selected = state.agentsSelectedId;
      const known = res.agents.some((entry) => entry.id === selected);
      if (!selected || !known) {
        state.agentsSelectedId = res.defaultId ?? res.agents[0]?.id ?? null;
      }
    }
  } catch (err) {
    state.agentsError = String(err);
  } finally {
    state.agentsLoading = false;
  }
}

export async function createAgent(
  state: AgentsState,
  params: { name: string; workspace: string; emoji?: string },
): Promise<boolean> {
  if (!state.client || !state.connected || state.agentsCreating) {
    return false;
  }
  state.agentsCreating = true;
  state.agentsCreateError = null;
  try {
    const res = await state.client.request<{ ok: true; agentId: string }>("agents.create", {
      name: params.name,
      workspace: params.workspace,
      ...(params.emoji ? { emoji: params.emoji } : {}),
    });
    if (res?.ok) {
      state.agentsShowAddForm = false;
      await loadAgents(state);
      state.agentsSelectedId = res.agentId;
      return true;
    }
    return false;
  } catch (err) {
    state.agentsCreateError = String(err);
    return false;
  } finally {
    state.agentsCreating = false;
  }
}

export async function deleteAgent(
  state: AgentsState,
  agentId: string,
  deleteFiles: boolean,
): Promise<boolean> {
  if (!state.client || !state.connected || state.agentsDeleting) {
    return false;
  }
  const displayName = state.agentsList?.agents?.find((a) => a.id === agentId)?.name ?? agentId;
  const confirmed = window.confirm(
    `Delete agent "${displayName}" (${agentId})?\n\nThis will remove the agent configuration and move its workspace files to trash.`,
  );
  if (!confirmed) {
    return false;
  }
  state.agentsDeleting = true;
  state.agentsDeleteError = null;
  try {
    const res = await state.client.request<{ ok: true; agentId: string }>("agents.delete", {
      agentId,
      deleteFiles,
    });
    if (res?.ok) {
      await loadAgents(state);
      return true;
    }
    return false;
  } catch (err) {
    state.agentsDeleteError = String(err);
    return false;
  } finally {
    state.agentsDeleting = false;
  }
}

export async function loadModelCatalog(state: AgentsState) {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    const res = await state.client.request<{ models?: ModelChoice[] }>("models.list", {});
    const models = res?.models;
    state.agentsModelCatalog = Array.isArray(models) ? models : [];
  } catch {
    // Non-fatal — dropdown falls back to config-only models.
  }
}
