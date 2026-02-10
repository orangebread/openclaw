import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import type { ChannelPlugin } from "../channels/plugins/types.js";
import type { PluginRegistry } from "../plugins/registry.js";
import { MANIFEST_KEY } from "../compat/legacy-names.js";
import { setActivePluginRegistry } from "../plugins/runtime.js";
import { resolveConfigDir } from "../utils.js";
import {
  connectOk,
  installGatewayTestHooks,
  rpcReq,
  startServerWithClient,
} from "./test-helpers.js";

const loadConfigHelpers = async () => await import("../config/config.js");

installGatewayTestHooks({ scope: "suite" });

const registryState = vi.hoisted(() => ({
  registry: {
    plugins: [],
    tools: [],
    channels: [],
    providers: [],
    gatewayHandlers: {},
    httpHandlers: [],
    httpRoutes: [],
    cliRegistrars: [],
    services: [],
    diagnostics: [],
  } as PluginRegistry,
}));

vi.mock("./server-plugins.js", async () => {
  const { setActivePluginRegistry } = await import("../plugins/runtime.js");
  return {
    loadGatewayPlugins: (params: { baseMethods: string[] }) => {
      setActivePluginRegistry(registryState.registry);
      return {
        pluginRegistry: registryState.registry,
        gatewayMethods: params.baseMethods ?? [],
      };
    },
  };
});

const createRegistry = (channels: PluginRegistry["channels"]): PluginRegistry => ({
  plugins: [],
  tools: [],
  channels,
  providers: [],
  gatewayHandlers: {},
  httpHandlers: [],
  httpRoutes: [],
  cliRegistrars: [],
  services: [],
  diagnostics: [],
});

const createStubChannelPlugin = (params: {
  id: ChannelPlugin["id"];
  label: string;
  summary?: Record<string, unknown>;
  logoutCleared?: boolean;
}): ChannelPlugin => ({
  id: params.id,
  meta: {
    id: params.id,
    label: params.label,
    selectionLabel: params.label,
    docsPath: `/channels/${params.id}`,
    blurb: "test stub.",
  },
  capabilities: { chatTypes: ["direct"] },
  config: {
    listAccountIds: () => ["default"],
    resolveAccount: () => ({}),
    isConfigured: async () => false,
  },
  status: {
    buildChannelSummary: async () => ({
      configured: false,
      ...params.summary,
    }),
  },
  gateway: {
    logoutAccount: async () => ({
      cleared: params.logoutCleared ?? false,
      envToken: false,
    }),
  },
});

const telegramPlugin: ChannelPlugin = {
  ...createStubChannelPlugin({
    id: "telegram",
    label: "Telegram",
    summary: { tokenSource: "none", lastProbeAt: null },
    logoutCleared: true,
  }),
  gateway: {
    logoutAccount: async ({ cfg }) => {
      const { writeConfigFile } = await import("../config/config.js");
      const nextTelegram = cfg.channels?.telegram ? { ...cfg.channels.telegram } : {};
      delete nextTelegram.botToken;
      await writeConfigFile({
        ...cfg,
        channels: {
          ...cfg.channels,
          telegram: nextTelegram,
        },
      });
      return { cleared: true, envToken: false, loggedOut: true };
    },
  },
};

const defaultRegistry = createRegistry([
  {
    pluginId: "whatsapp",
    source: "test",
    plugin: createStubChannelPlugin({ id: "whatsapp", label: "WhatsApp" }),
  },
  {
    pluginId: "telegram",
    source: "test",
    plugin: telegramPlugin,
  },
  {
    pluginId: "signal",
    source: "test",
    plugin: createStubChannelPlugin({
      id: "signal",
      label: "Signal",
      summary: { lastProbeAt: null },
    }),
  },
]);

let server: Awaited<ReturnType<typeof startServerWithClient>>["server"];
let ws: Awaited<ReturnType<typeof startServerWithClient>>["ws"];
let helloOk: { type: "hello-ok"; features?: { methods?: string[] } };

beforeAll(async () => {
  setRegistry(defaultRegistry);
  const started = await startServerWithClient();
  server = started.server;
  ws = started.ws;
  helloOk = await connectOk(ws);
});

afterAll(async () => {
  ws.close();
  await server.close();
});

function setRegistry(registry: PluginRegistry) {
  registryState.registry = registry;
  setActivePluginRegistry(registry);
}

describe("gateway server channels", () => {
  test("connect advertises channels catalog/install methods", () => {
    expect(helloOk.features?.methods).toContain("channels.catalog");
    expect(helloOk.features?.methods).toContain("channels.install");
    expect(helloOk.features?.methods).toContain("gateway.restart");
  });

  test("channels.status returns snapshot without probe", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", undefined);
    setRegistry(defaultRegistry);
    const res = await rpcReq<{
      channels?: Record<
        string,
        | {
            configured?: boolean;
            tokenSource?: string;
            probe?: unknown;
            lastProbeAt?: unknown;
          }
        | { linked?: boolean }
      >;
    }>(ws, "channels.status", { probe: false, timeoutMs: 2000 });
    expect(res.ok).toBe(true);
    const telegram = res.payload?.channels?.telegram;
    const signal = res.payload?.channels?.signal;
    expect(res.payload?.channels?.whatsapp).toBeTruthy();
    expect(telegram?.configured).toBe(false);
    expect(telegram?.tokenSource).toBe("none");
    expect(telegram?.probe).toBeUndefined();
    expect(telegram?.lastProbeAt).toBeNull();
    expect(signal?.configured).toBe(false);
    expect(signal?.probe).toBeUndefined();
    expect(signal?.lastProbeAt).toBeNull();
  });

  test("channels.logout reports no session when missing", async () => {
    setRegistry(defaultRegistry);
    const res = await rpcReq<{ cleared?: boolean; channel?: string }>(ws, "channels.logout", {
      channel: "whatsapp",
    });
    expect(res.ok).toBe(true);
    expect(res.payload?.channel).toBe("whatsapp");
    expect(res.payload?.cleared).toBe(false);
  });

  test("channels.logout clears telegram bot token from config", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", undefined);
    setRegistry(defaultRegistry);
    const { readConfigFileSnapshot, writeConfigFile } = await loadConfigHelpers();
    await writeConfigFile({
      channels: {
        telegram: {
          botToken: "123:abc",
          groups: { "*": { requireMention: false } },
        },
      },
    });
    const res = await rpcReq<{
      cleared?: boolean;
      envToken?: boolean;
      channel?: string;
    }>(ws, "channels.logout", { channel: "telegram" });
    expect(res.ok).toBe(true);
    expect(res.payload?.channel).toBe("telegram");
    expect(res.payload?.cleared).toBe(true);
    expect(res.payload?.envToken).toBe(false);

    const snap = await readConfigFileSnapshot();
    expect(snap.valid).toBe(true);
    expect(snap.config?.channels?.telegram?.botToken).toBeUndefined();
    expect(snap.config?.channels?.telegram?.groups?.["*"]?.requireMention).toBe(false);
  });

  test("channels.install surfaces installer errors in RPC error message", async () => {
    const res = await rpcReq(ws, "channels.install", {
      npmSpec: "./__openclaw_missing_plugin_package__",
      timeoutMs: 1_000,
    });
    expect(res.ok).toBe(false);
    expect(res.error?.message).toContain("npm pack failed");
  });

  test("channels.catalog marks discovered on-disk plugin as installed before restart", async () => {
    const pluginId = "matrix";
    const pluginDir = path.join(resolveConfigDir(), "extensions", pluginId);
    await fs.mkdir(pluginDir, { recursive: true });
    await fs.writeFile(
      path.join(pluginDir, "package.json"),
      JSON.stringify(
        {
          name: `@openclaw/${pluginId}`,
          version: "0.0.1",
          [MANIFEST_KEY]: {
            extensions: ["index.ts"],
            channel: {
              id: pluginId,
              label: "Matrix",
              selectionLabel: "Matrix",
              docsPath: "/channels/matrix",
              blurb: "Matrix test plugin.",
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    try {
      const res = await rpcReq<{
        entries?: Array<{
          id?: string;
          installed?: boolean;
          hasSchema?: boolean;
          configured?: boolean;
        }>;
      }>(ws, "channels.catalog", {});
      expect(res.ok).toBe(true);
      const matrix = res.payload?.entries?.find((entry) => entry.id === pluginId);
      expect(matrix).toBeDefined();
      expect(matrix?.installed).toBe(true);
      expect(matrix?.hasSchema).toBe(false);
      expect(matrix?.configured).toBe(false);
    } finally {
      await fs.rm(pluginDir, { recursive: true, force: true });
    }
  });

  test("gateway.restart validates params", async () => {
    const res = await rpcReq(ws, "gateway.restart", {
      restartDelayMs: 0,
      unexpected: true,
    });
    expect(res.ok).toBe(false);
    expect(res.error?.message).toContain("invalid gateway.restart params");
  });
});
