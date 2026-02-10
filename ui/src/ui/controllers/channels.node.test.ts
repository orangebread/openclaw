import { describe, expect, it, vi } from "vitest";
import { loadChannelsAndCatalog, restartGateway, type ChannelsState } from "./channels.ts";

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
    channelRestartBusy: false,
    channelRestartError: null,
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
});
