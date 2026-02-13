import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import type { ChannelPlugin } from "../channels/plugins/types.js";
import type { PluginRegistry } from "../plugins/registry.js";
import type { PluginRecord } from "../plugins/registry.js";
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

const createPluginRecord = (params: {
  id: string;
  status: PluginRecord["status"];
  error?: string;
  source?: string;
}): PluginRecord => ({
  id: params.id,
  name: params.id,
  source: params.source ?? `/tmp/${params.id}/index.ts`,
  origin: "config",
  enabled: params.status === "loaded",
  status: params.status,
  ...(params.error ? { error: params.error } : {}),
  toolNames: [],
  hookNames: [],
  channelIds: [],
  providerIds: [],
  gatewayMethods: [],
  cliCommands: [],
  services: [],
  commands: [],
  httpHandlers: 0,
  hookCount: 0,
  configSchema: true,
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
    expect(helloOk.features?.methods).toContain("channels.enable");
    expect(helloOk.features?.methods).toContain("channels.install");
    expect(helloOk.features?.methods).toContain("channels.repair");
    expect(helloOk.features?.methods).toContain("gateway.restart");
    expect(helloOk.features?.methods).toContain("doctor.plan");
    expect(helloOk.features?.methods).toContain("doctor.fix");
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

  test("channels.install repairs from local catalog path when mode=update", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-channel-local-repair-"));
    const pluginDir = path.join(tempDir, "plugin");
    const pluginId = "local-repair-test";
    const pluginInstallDir = path.join(resolveConfigDir(), "extensions", pluginId);
    await fs.mkdir(pluginDir, { recursive: true });
    await fs.writeFile(path.join(pluginDir, "index.ts"), "export {};\n", "utf8");
    await fs.writeFile(
      path.join(pluginDir, "package.json"),
      JSON.stringify(
        {
          name: `@openclaw/${pluginId}`,
          version: "0.0.1",
          [MANIFEST_KEY]: {
            extensions: ["./index.ts"],
            channel: {
              id: pluginId,
              label: "Local Repair",
              selectionLabel: "Local Repair",
              docsPath: `/channels/${pluginId}`,
              blurb: "Local repair test plugin.",
            },
            install: {
              npmSpec: "@openclaw/does-not-exist",
              localPath: pluginDir,
              defaultChoice: "local",
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    const catalogPath = path.join(tempDir, "catalog.json");
    await fs.writeFile(
      catalogPath,
      JSON.stringify(
        {
          entries: [
            {
              name: `@openclaw/${pluginId}`,
              [MANIFEST_KEY]: {
                extensions: ["./index.ts"],
                channel: {
                  id: pluginId,
                  label: "Local Repair",
                  selectionLabel: "Local Repair",
                  docsPath: `/channels/${pluginId}`,
                  blurb: "Local repair test plugin.",
                },
                install: {
                  npmSpec: "@openclaw/does-not-exist",
                  localPath: pluginDir,
                  defaultChoice: "local",
                },
              },
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    vi.stubEnv("OPENCLAW_PLUGIN_CATALOG_PATHS", catalogPath);
    await fs.rm(pluginInstallDir, { recursive: true, force: true });
    try {
      const res = await rpcReq<{ ok?: boolean; pluginId?: string }>(ws, "channels.install", {
        channelId: pluginId,
        mode: "update",
        timeoutMs: 10_000,
      });
      expect(res.ok).toBe(true);
      expect(res.payload?.pluginId).toBe(pluginId);
    } finally {
      vi.stubEnv("OPENCLAW_PLUGIN_CATALOG_PATHS", undefined);
      await fs.rm(pluginInstallDir, { recursive: true, force: true });
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test("channels.repair uses failing plugin source path first", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-channel-source-repair-"));
    const pluginId = "source-repair-test";
    const pluginDir = path.join(tempDir, pluginId);
    const pluginInstallDir = path.join(resolveConfigDir(), "extensions", pluginId);
    await fs.mkdir(pluginDir, { recursive: true });
    await fs.writeFile(path.join(pluginDir, "index.ts"), "export {};\n", "utf8");
    await fs.writeFile(
      path.join(pluginDir, "package.json"),
      JSON.stringify(
        {
          name: `@openclaw/${pluginId}`,
          version: "0.0.1",
          [MANIFEST_KEY]: {
            extensions: ["./index.ts"],
            channel: {
              id: pluginId,
              label: "Source Repair",
              selectionLabel: "Source Repair",
              docsPath: `/channels/${pluginId}`,
              blurb: "Source repair test plugin.",
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    const registry = createRegistry([]);
    registry.plugins = [
      createPluginRecord({
        id: pluginId,
        status: "error",
        error: "Cannot find module 'proper-lockfile'",
        source: path.join(pluginDir, "index.ts"),
      }),
    ];
    setRegistry(registry);
    await fs.rm(pluginInstallDir, { recursive: true, force: true });
    try {
      const res = await rpcReq<{ ok?: boolean; pluginId?: string }>(ws, "channels.repair", {
        channelId: pluginId,
        timeoutMs: 10_000,
      });
      expect(res.ok).toBe(true);
      expect(res.payload?.pluginId).toBe(pluginId);
    } finally {
      await fs.rm(pluginInstallDir, { recursive: true, force: true });
      await fs.rm(tempDir, { recursive: true, force: true });
      setRegistry(defaultRegistry);
    }
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

  test("channels.catalog includes core bundled channels even when plugin metadata is absent", async () => {
    setRegistry(createRegistry([]));
    const { writeConfigFile } = await loadConfigHelpers();
    await writeConfigFile({});

    const res = await rpcReq<{
      entries?: Array<{
        id?: string;
        installed?: boolean;
        enabled?: boolean;
        configured?: boolean;
      }>;
    }>(ws, "channels.catalog", {});
    expect(res.ok).toBe(true);
    const whatsapp = res.payload?.entries?.find((entry) => entry.id === "whatsapp");
    expect(whatsapp).toBeDefined();
    expect(whatsapp?.installed).toBe(true);
    expect(whatsapp?.enabled).toBe(false);
    expect(whatsapp?.configured).toBe(false);
  });

  test("channels.catalog surfaces plugin load errors even when another origin record is disabled", async () => {
    const previousBundledDir = process.env.OPENCLAW_BUNDLED_PLUGINS_DIR;
    process.env.OPENCLAW_BUNDLED_PLUGINS_DIR = path.join(process.cwd(), "extensions");
    try {
      const registry = createRegistry([]);
      registry.plugins = [
        createPluginRecord({ id: "msteams", status: "error", error: "boom" }),
        createPluginRecord({ id: "msteams", status: "disabled" }),
      ];
      setRegistry(registry);

      const res = await rpcReq<{
        entries?: Array<{ id?: string; pluginStatus?: string; pluginError?: string }>;
      }>(ws, "channels.catalog", {});

      expect(res.ok).toBe(true);
      const entry = res.payload?.entries?.find((item) => item.id === "msteams");
      expect(entry).toBeDefined();
      expect(entry?.pluginStatus).toBe("error");
      expect(entry?.pluginError).toBe("boom");
    } finally {
      process.env.OPENCLAW_BUNDLED_PLUGINS_DIR = previousBundledDir;
    }
  });

  test("channels.enable writes plugin enablement for a channel", async () => {
    setRegistry(createRegistry([]));
    const { readConfigFileSnapshot, writeConfigFile } = await loadConfigHelpers();
    await writeConfigFile({});

    const res = await rpcReq<{
      ok?: boolean;
      channelId?: string;
      restartRequired?: boolean;
    }>(ws, "channels.enable", { channelId: "whatsapp" });
    expect(res.ok).toBe(true);
    expect(res.payload?.ok).toBe(true);
    expect(res.payload?.channelId).toBe("whatsapp");
    expect(res.payload?.restartRequired).toBe(true);

    const snapshot = await readConfigFileSnapshot();
    expect(snapshot.valid).toBe(true);
    expect(snapshot.config?.plugins?.entries?.whatsapp?.enabled).toBe(true);
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
