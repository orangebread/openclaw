import type { ChannelCatalogEntry, ChannelsState } from "./channels.types.ts";
import { ChannelsStatusSnapshot } from "../types.ts";

export type { ChannelCatalogEntry, ChannelsState };

function collectSnapshotChannelIds(snapshot: ChannelsStatusSnapshot | null): Set<string> {
  const ids = new Set<string>();
  for (const entry of snapshot?.channelMeta ?? []) {
    ids.add(entry.id);
  }
  for (const id of snapshot?.channelOrder ?? []) {
    ids.add(id);
  }
  for (const id of Object.keys(snapshot?.channels ?? {})) {
    ids.add(id);
  }
  return ids;
}

function reconcileSetupSelection(state: ChannelsState) {
  const setupId = state.channelsSetupId;
  if (!setupId) {
    return;
  }
  const catalog = state.channelsCatalog;
  if (!catalog) {
    return;
  }
  const entry = catalog.find((candidate) => candidate.id === setupId);
  if (!entry) {
    state.channelsSetupId = null;
    return;
  }
  const snapshotIds = collectSnapshotChannelIds(state.channelsSnapshot);
  const stillGhost = entry.installed && !entry.configured && !snapshotIds.has(entry.id);
  if (!stillGhost) {
    state.channelsSetupId = null;
  }
}

export async function loadChannelsAndCatalog(state: ChannelsState, probe: boolean) {
  await Promise.all([loadChannels(state, probe), loadChannelsCatalog(state)]);
  reconcileSetupSelection(state);
}

export async function loadChannels(state: ChannelsState, probe: boolean) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.channelsLoading) {
    return;
  }
  state.channelsLoading = true;
  state.channelsError = null;
  try {
    const res = await state.client.request<ChannelsStatusSnapshot | null>("channels.status", {
      probe,
      timeoutMs: 8000,
    });
    state.channelsSnapshot = res;
    state.channelsLastSuccess = Date.now();
  } catch (err) {
    state.channelsError = String(err);
  } finally {
    state.channelsLoading = false;
  }
}

export async function startWhatsAppLogin(state: ChannelsState, force: boolean) {
  if (!state.client || !state.connected || state.whatsappBusy) {
    return;
  }
  state.whatsappBusy = true;
  try {
    const res = await state.client.request<{ message?: string; qrDataUrl?: string }>(
      "web.login.start",
      {
        force,
        timeoutMs: 30000,
      },
    );
    state.whatsappLoginMessage = res.message ?? null;
    state.whatsappLoginQrDataUrl = res.qrDataUrl ?? null;
    state.whatsappLoginConnected = null;
  } catch (err) {
    state.whatsappLoginMessage = String(err);
    state.whatsappLoginQrDataUrl = null;
    state.whatsappLoginConnected = null;
  } finally {
    state.whatsappBusy = false;
  }
}

export async function waitWhatsAppLogin(state: ChannelsState) {
  if (!state.client || !state.connected || state.whatsappBusy) {
    return;
  }
  state.whatsappBusy = true;
  try {
    const res = await state.client.request<{ message?: string; connected?: boolean }>(
      "web.login.wait",
      {
        timeoutMs: 120000,
      },
    );
    state.whatsappLoginMessage = res.message ?? null;
    state.whatsappLoginConnected = res.connected ?? null;
    if (res.connected) {
      state.whatsappLoginQrDataUrl = null;
    }
  } catch (err) {
    state.whatsappLoginMessage = String(err);
    state.whatsappLoginConnected = null;
  } finally {
    state.whatsappBusy = false;
  }
}

export async function loadChannelsCatalog(state: ChannelsState) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.channelsCatalogLoading) {
    return;
  }
  state.channelsCatalogLoading = true;
  state.channelsCatalogError = null;
  try {
    const res = await state.client.request<{ entries: ChannelCatalogEntry[] }>(
      "channels.catalog",
      {},
    );
    state.channelsCatalog = res.entries;
  } catch (err) {
    state.channelsCatalogError = String(err);
  } finally {
    state.channelsCatalogLoading = false;
  }
}

export async function installChannel(
  state: ChannelsState,
  channelId: string,
): Promise<{
  ok: boolean;
  pluginId?: string;
  version?: string;
  error?: string;
  restartRequired?: boolean;
}> {
  if (!state.client || !state.connected) {
    return { ok: false, error: "Not connected" };
  }
  try {
    const res = await state.client.request<{
      ok: boolean;
      pluginId?: string;
      version?: string;
      error?: string;
      restartRequired?: boolean;
    }>("channels.install", {
      channelId,
      timeoutMs: 300_000,
    });
    return res;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function enableChannel(
  state: ChannelsState,
  channelId: string,
): Promise<{
  ok: boolean;
  channelId?: string;
  error?: string;
  restartRequired?: boolean;
}> {
  if (!state.client || !state.connected) {
    return { ok: false, error: "Not connected" };
  }
  try {
    const res = await state.client.request<{
      ok: boolean;
      channelId?: string;
      error?: string;
      restartRequired?: boolean;
    }>("channels.enable", {
      channelId,
    });
    return res;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function restartGateway(
  state: ChannelsState,
): Promise<{ ok: boolean; error?: string }> {
  if (!state.client || !state.connected) {
    return { ok: false, error: "Not connected" };
  }
  try {
    await state.client.request("gateway.restart", {
      reason: "channels.install",
      restartDelayMs: 500,
    });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Restart can drop the websocket before response arrives.
    if (!state.connected && /gateway closed/.test(message)) {
      return { ok: true };
    }
    return { ok: false, error: message };
  }
}

export async function logoutWhatsApp(state: ChannelsState) {
  if (!state.client || !state.connected || state.whatsappBusy) {
    return;
  }
  state.whatsappBusy = true;
  try {
    await state.client.request("channels.logout", { channel: "whatsapp" });
    state.whatsappLoginMessage = "Logged out.";
    state.whatsappLoginQrDataUrl = null;
    state.whatsappLoginConnected = null;
  } catch (err) {
    state.whatsappLoginMessage = String(err);
  } finally {
    state.whatsappBusy = false;
  }
}
