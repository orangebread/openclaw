import { describe, expect, it, vi } from "vitest";
import {
  enableChannel,
  installChannel,
  loadChannelsAndCatalog,
  restartGateway,
  type ChannelsState,
} from "./channels.ts";

function createState(): ChannelsState {
  return {
    client: null,
    connected: false,
    channelsLoading: false,
    channelsSnapshot: null,
    channelsError: null,
    channelsLastSuccess: null,
    channelsCatalog: null,
    channelsCatalogLoading: false,
    channelsCatalogError: null,
    channelsSetupId: null,
    channelInstallBusy: null,
    channelInstallError: null,
    channelInstallSuccess: null,
    channelInstallRunId: null,
    channelInstallLog: "",
    channelInstallLogTruncated: false,
    channelRestartBusy: false,
    channelRestartError: null,
    doctorPlanLoading: false,
    doctorPlanError: null,
    doctorPlan: null,
    doctorFixBusy: false,
    doctorFixError: null,
    whatsappLoginMessage: null,
    whatsappLoginQrDataUrl: null,
    whatsappLoginConnected: null,
    whatsappBusy: false,
  };
}

describe("loadChannelsAndCatalog", () => {
  it("refreshes status and catalog in one call", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "channels.status") {
        return {
          ts: Date.now(),
          channelOrder: ["telegram"],
          channelLabels: { telegram: "Telegram" },
          channels: { telegram: { configured: false } },
          channelAccounts: { telegram: [] },
          channelDefaultAccountId: { telegram: "default" },
        };
      }
      if (method === "channels.catalog") {
        return { entries: [] };
      }
      if (method === "doctor.plan") {
        return { ok: true, issues: [], fixAvailable: false };
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const state = createState();
    state.connected = true;
    state.client = { request } as unknown as ChannelsState["client"];

    await loadChannelsAndCatalog(state, true);

    expect(request).toHaveBeenCalledWith("channels.status", { probe: true, timeoutMs: 8000 });
    expect(request).toHaveBeenCalledWith("channels.catalog", {});
    expect(state.channelsSnapshot?.channelOrder).toEqual(["telegram"]);
    expect(state.channelsCatalog).toEqual([]);
  });

  it("clears setup selection when channel is no longer a ghost", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "channels.status") {
        return {
          ts: Date.now(),
          channelOrder: ["matrix"],
          channelLabels: { matrix: "Matrix" },
          channels: { matrix: { configured: true } },
          channelAccounts: { matrix: [] },
          channelDefaultAccountId: { matrix: "default" },
        };
      }
      if (method === "channels.catalog") {
        return {
          entries: [
            {
              id: "matrix",
              label: "Matrix",
              installed: true,
              configured: true,
              enabled: true,
              hasSchema: true,
            },
          ],
        };
      }
      if (method === "doctor.plan") {
        return { ok: true, issues: [], fixAvailable: false };
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const state = createState();
    state.connected = true;
    state.client = { request } as unknown as ChannelsState["client"];
    state.channelsSetupId = "matrix";

    await loadChannelsAndCatalog(state, true);

    expect(state.channelsSetupId).toBeNull();
  });

  it("keeps setup selection while channel is still a ghost", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "channels.status") {
        return {
          ts: Date.now(),
          channelOrder: ["telegram"],
          channelLabels: { telegram: "Telegram" },
          channels: { telegram: { configured: false } },
          channelAccounts: { telegram: [] },
          channelDefaultAccountId: { telegram: "default" },
        };
      }
      if (method === "channels.catalog") {
        return {
          entries: [
            {
              id: "matrix",
              label: "Matrix",
              installed: true,
              configured: false,
              enabled: false,
              hasSchema: true,
            },
          ],
        };
      }
      if (method === "doctor.plan") {
        return { ok: true, issues: [], fixAvailable: false };
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const state = createState();
    state.connected = true;
    state.client = { request } as unknown as ChannelsState["client"];
    state.channelsSetupId = "matrix";

    await loadChannelsAndCatalog(state, true);

    expect(state.channelsSetupId).toBe("matrix");
  });

  it("requests gateway.restart with channel-install reason", async () => {
    const request = vi.fn(async () => ({ ok: true }));
    const state = createState();
    state.connected = true;
    state.client = { request } as unknown as ChannelsState["client"];

    const res = await restartGateway(state);

    expect(res.ok).toBe(true);
    expect(request).toHaveBeenCalledWith("gateway.restart", {
      reason: "channels.install",
      restartDelayMs: 500,
    });
  });

  it("requests channels.enable for installed-but-disabled plugins", async () => {
    const request = vi.fn(async () => ({ ok: true, channelId: "whatsapp", restartRequired: true }));
    const state = createState();
    state.connected = true;
    state.client = { request } as unknown as ChannelsState["client"];

    const res = await enableChannel(state, "whatsapp");

    expect(res.ok).toBe(true);
    expect(request).toHaveBeenCalledWith("channels.enable", { channelId: "whatsapp" });
  });

  it("uses channels.install for normal installs", async () => {
    const request = vi.fn(async () => ({ ok: true, pluginId: "msteams", restartRequired: true }));
    const state = createState();
    state.connected = true;
    state.client = { request } as unknown as ChannelsState["client"];

    const res = await installChannel(state, "msteams");

    expect(res.ok).toBe(true);
    expect(request).toHaveBeenCalledWith("channels.install", {
      channelId: "msteams",
      timeoutMs: 300_000,
    });
  });

  it("uses channels.repair for update mode", async () => {
    const request = vi.fn(async () => ({ ok: true, pluginId: "msteams", restartRequired: true }));
    const state = createState();
    state.connected = true;
    state.client = { request } as unknown as ChannelsState["client"];

    const res = await installChannel(state, "msteams", "update");

    expect(res.ok).toBe(true);
    expect(request).toHaveBeenCalledWith("channels.repair", {
      channelId: "msteams",
      timeoutMs: 300_000,
    });
  });
});
