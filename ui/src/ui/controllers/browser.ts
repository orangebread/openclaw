import type { GatewayBrowserClient } from "../gateway.ts";

export type BrowserProfileStatus = {
  name: string;
  driver: "openclaw" | "extension";
  cdpPort: number;
  cdpUrl: string;
  color: string;
  running: boolean;
  tabCount: number;
  isDefault: boolean;
  isRemote: boolean;
};

export type BrowserStatus = {
  enabled: boolean;
  profile: string;
  running: boolean;
  cdpReady: boolean;
  cdpHttp: boolean;
  pid: number | null;
  cdpPort: number;
  cdpUrl: string;
  chosenBrowser: string | null;
  detectedBrowser: string | null;
  detectedExecutablePath: string | null;
  detectError: string | null;
  userDataDir: string | null;
  color: string;
  headless: boolean;
  noSandbox: boolean;
  executablePath: string | null;
  attachOnly: boolean;
};

export type BrowserTab = {
  targetId: string;
  title: string;
  url: string;
  wsUrl?: string;
  type?: string;
};

export type BrowserTabsResult = {
  running: boolean;
  tabs: BrowserTab[];
};

export type ChromeExtensionStatus = {
  ok: true;
  installed: boolean;
  path: string;
};

export type BrowserState = {
  client: GatewayBrowserClient | null;
  connected: boolean;

  browserLoading: boolean;
  browserError: string | null;

  browserProfiles: BrowserProfileStatus[] | null;
  browserSelectedProfile: string | null;
  browserStatus: BrowserStatus | null;
  browserTabs: BrowserTabsResult | null;

  browserChromeExtensionStatus: ChromeExtensionStatus | null;
  browserChromeExtensionInstalling: boolean;
  browserNewTabUrl: string;
  browserTabActionBusy: boolean;
};

async function browserRequest<T>(
  state: Pick<BrowserState, "client" | "connected">,
  params: {
    method: "GET" | "POST" | "DELETE";
    path: string;
    query?: Record<string, unknown>;
    body?: unknown;
    timeoutMs?: number;
  },
): Promise<T> {
  if (!state.client || !state.connected) {
    throw new Error("gateway not connected");
  }
  return await state.client.request<T>("browser.request", params);
}

export async function loadBrowser(state: BrowserState, opts?: { profile?: string | null }) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.browserLoading) {
    return;
  }
  state.browserLoading = true;
  state.browserError = null;
  try {
    const profilesRes = await browserRequest<{ profiles?: BrowserProfileStatus[] }>(state, {
      method: "GET",
      path: "/profiles",
    });
    state.browserProfiles = Array.isArray(profilesRes.profiles) ? profilesRes.profiles : [];

    const requested = opts?.profile?.trim() || state.browserSelectedProfile?.trim() || "";
    const resolved =
      (requested && state.browserProfiles.find((p) => p.name === requested)?.name) ||
      state.browserProfiles.find((p) => p.isDefault)?.name ||
      state.browserProfiles[0]?.name ||
      null;
    state.browserSelectedProfile = resolved;

    if (resolved) {
      await Promise.all([loadBrowserStatus(state, resolved), loadBrowserTabs(state, resolved)]);
    } else {
      state.browserStatus = null;
      state.browserTabs = null;
    }

    state.browserChromeExtensionStatus = await browserRequest<ChromeExtensionStatus>(state, {
      method: "GET",
      path: "/chrome-extension",
    });
  } catch (err) {
    state.browserError = String(err);
  } finally {
    state.browserLoading = false;
  }
}

export async function loadBrowserStatus(state: BrowserState, profile: string) {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    state.browserStatus = await browserRequest<BrowserStatus>(state, {
      method: "GET",
      path: "/",
      query: { profile },
      timeoutMs: 3000,
    });
  } catch (err) {
    state.browserError = String(err);
  }
}

export async function loadBrowserTabs(state: BrowserState, profile: string) {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    state.browserTabs = await browserRequest<BrowserTabsResult>(state, {
      method: "GET",
      path: "/tabs",
      query: { profile },
      timeoutMs: 3000,
    });
  } catch (err) {
    state.browserError = String(err);
  }
}

export async function startBrowserProfile(state: BrowserState, profile: string) {
  if (!state.client || !state.connected || state.browserLoading) {
    return;
  }
  state.browserLoading = true;
  state.browserError = null;
  try {
    await browserRequest(state, {
      method: "POST",
      path: "/start",
      body: { profile },
      timeoutMs: 10_000,
    });
    await Promise.all([loadBrowserStatus(state, profile), loadBrowserTabs(state, profile)]);
  } catch (err) {
    state.browserError = String(err);
  } finally {
    state.browserLoading = false;
  }
}

export async function stopBrowserProfile(state: BrowserState, profile: string) {
  if (!state.client || !state.connected || state.browserLoading) {
    return;
  }
  state.browserLoading = true;
  state.browserError = null;
  try {
    await browserRequest(state, {
      method: "POST",
      path: "/stop",
      body: { profile },
      timeoutMs: 10_000,
    });
    await Promise.all([loadBrowserStatus(state, profile), loadBrowserTabs(state, profile)]);
  } catch (err) {
    state.browserError = String(err);
  } finally {
    state.browserLoading = false;
  }
}

export async function resetBrowserProfile(state: BrowserState, profile: string) {
  if (!state.client || !state.connected || state.browserLoading) {
    return;
  }
  state.browserLoading = true;
  state.browserError = null;
  try {
    await browserRequest(state, {
      method: "POST",
      path: "/reset-profile",
      body: { profile },
      timeoutMs: 15_000,
    });
    await Promise.all([loadBrowserStatus(state, profile), loadBrowserTabs(state, profile)]);
  } catch (err) {
    state.browserError = String(err);
  } finally {
    state.browserLoading = false;
  }
}

export async function installBrowserChromeExtension(state: BrowserState) {
  if (!state.client || !state.connected || state.browserChromeExtensionInstalling) {
    return;
  }
  state.browserChromeExtensionInstalling = true;
  state.browserError = null;
  try {
    const res = await browserRequest<{ ok: true; path: string }>(state, {
      method: "POST",
      path: "/chrome-extension/install",
      timeoutMs: 15_000,
    });
    state.browserChromeExtensionStatus = { ok: true, installed: true, path: res.path };
  } catch (err) {
    state.browserError = String(err);
  } finally {
    state.browserChromeExtensionInstalling = false;
  }
}

export async function openBrowserTab(state: BrowserState, profile: string, url: string) {
  if (!state.client || !state.connected || state.browserTabActionBusy) {
    return;
  }
  const trimmed = url.trim();
  if (!trimmed) {
    return;
  }
  state.browserTabActionBusy = true;
  state.browserError = null;
  try {
    await browserRequest(state, {
      method: "POST",
      path: "/tabs/open",
      body: { profile, url: trimmed },
      timeoutMs: 10_000,
    });
    state.browserNewTabUrl = "";
    await loadBrowserTabs(state, profile);
  } catch (err) {
    state.browserError = String(err);
  } finally {
    state.browserTabActionBusy = false;
  }
}

export async function focusBrowserTab(state: BrowserState, profile: string, targetId: string) {
  if (!state.client || !state.connected || state.browserTabActionBusy) {
    return;
  }
  state.browserTabActionBusy = true;
  state.browserError = null;
  try {
    await browserRequest(state, {
      method: "POST",
      path: "/tabs/focus",
      body: { profile, targetId },
      timeoutMs: 10_000,
    });
    await loadBrowserTabs(state, profile);
  } catch (err) {
    state.browserError = String(err);
  } finally {
    state.browserTabActionBusy = false;
  }
}

export async function closeBrowserTab(state: BrowserState, profile: string, targetId: string) {
  if (!state.client || !state.connected || state.browserTabActionBusy) {
    return;
  }
  state.browserTabActionBusy = true;
  state.browserError = null;
  try {
    await browserRequest(state, {
      method: "DELETE",
      path: `/tabs/${encodeURIComponent(targetId)}`,
      query: { profile },
      timeoutMs: 10_000,
    });
    await loadBrowserTabs(state, profile);
  } catch (err) {
    state.browserError = String(err);
  } finally {
    state.browserTabActionBusy = false;
  }
}
