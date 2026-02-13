import fs from "node:fs";
import path from "node:path";
import type { ChannelAccountSnapshot, ChannelPlugin } from "../../channels/plugins/types.js";
import type { OpenClawConfig } from "../../config/config.js";
import type { GatewayRequestContext, GatewayRequestHandlers } from "./types.js";
import {
  buildChannelUiCatalog,
  getChannelPluginCatalogEntry,
  listChannelPluginCatalogEntries,
} from "../../channels/plugins/catalog.js";
import { resolveChannelDefaultAccountId } from "../../channels/plugins/helpers.js";
import {
  type ChannelId,
  getChannelPlugin,
  listChannelPlugins,
  normalizeChannelId as normalizePluginChannelId,
} from "../../channels/plugins/index.js";
import { buildChannelAccountSnapshot } from "../../channels/plugins/status.js";
import {
  listChatChannels,
  normalizeChannelId as normalizeDockedChannelId,
} from "../../channels/registry.js";
import { loadConfig, readConfigFileSnapshot, writeConfigFile } from "../../config/config.js";
import { getChannelActivity } from "../../infra/channel-activity.js";
import { resolveBundledPluginsDir } from "../../plugins/bundled-dir.js";
import { normalizePluginsConfig, resolveEnableState } from "../../plugins/config-state.js";
import { enablePluginInConfig } from "../../plugins/enable.js";
import {
  type InstallPluginResult,
  installPluginFromNpmSpec,
  installPluginFromPath,
  resolvePluginInstallDir,
} from "../../plugins/install.js";
import { getActivePluginRegistry } from "../../plugins/runtime.js";
import { DEFAULT_ACCOUNT_ID } from "../../routing/session-key.js";
import { defaultRuntime } from "../../runtime.js";
import { resolveConfigDir, resolveUserPath } from "../../utils.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateChannelsCatalogParams,
  validateChannelsEnableParams,
  validateChannelsInstallParams,
  validateChannelsRepairParams,
  validateChannelsLogoutParams,
  validateChannelsStatusParams,
} from "../protocol/index.js";
import { formatForLog } from "../ws-log.js";

type ChannelLogoutPayload = {
  channel: ChannelId;
  accountId: string;
  cleared: boolean;
  [key: string]: unknown;
};

function isCatalogPluginInstalled(params: { cfg: OpenClawConfig; channelId: string }): boolean {
  if (params.cfg.plugins?.installs?.[params.channelId]) {
    return true;
  }
  try {
    const installDir = resolvePluginInstallDir(
      params.channelId,
      path.join(resolveConfigDir(), "extensions"),
    );
    return fs.existsSync(installDir);
  } catch {
    return false;
  }
}

function resolveBundledPluginEnabled(params: { cfg: OpenClawConfig; pluginId: string }): boolean {
  const pluginsConfig = normalizePluginsConfig(params.cfg.plugins);
  const resolved = resolveEnableState(params.pluginId, "bundled", pluginsConfig);
  return resolved.enabled;
}

function resolveCatalogLocalInstallPath(localPath?: string): string | undefined {
  const trimmed = localPath?.trim();
  if (!trimmed) {
    return undefined;
  }

  const candidates: string[] = [];
  if (path.isAbsolute(trimmed)) {
    candidates.push(resolveUserPath(trimmed));
  } else {
    candidates.push(path.resolve(process.cwd(), trimmed));
    const bundledDir = resolveBundledPluginsDir();
    if (bundledDir) {
      candidates.push(path.resolve(path.dirname(bundledDir), trimmed));
    }
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function resolveExtensionsInstallDir(): string {
  return path.join(resolveConfigDir(), "extensions");
}

function resolvePluginRootFromSource(sourcePath?: string): string | undefined {
  const raw = sourcePath?.trim();
  if (!raw) {
    return undefined;
  }
  const resolved = resolveUserPath(raw);
  if (!fs.existsSync(resolved)) {
    return undefined;
  }
  let cursor = resolved;
  try {
    if (fs.statSync(resolved).isFile()) {
      cursor = path.dirname(resolved);
    }
  } catch {
    return undefined;
  }
  for (let i = 0; i < 10; i += 1) {
    if (fs.existsSync(path.join(cursor, "package.json"))) {
      return cursor;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) {
      break;
    }
    cursor = parent;
  }
  return undefined;
}

type ChannelInstallAttempt = {
  kind: "source" | "local" | "npm";
  run: () => Promise<InstallPluginResult>;
};

function createInstallProgressLogger(params: {
  context: GatewayRequestContext;
  connId?: string;
  clientRunId?: string;
  channelId?: string;
  kind: ChannelInstallAttempt["kind"];
}) {
  const connIds = params.connId ? new Set([params.connId]) : null;
  let sentChars = 0;
  let truncated = false;
  const maxChars = 150_000;

  const send = (payload: Record<string, unknown>) => {
    if (!connIds || truncated) {
      return;
    }
    const chunk = typeof payload.chunk === "string" ? payload.chunk : "";
    sentChars += chunk.length;
    if (sentChars > maxChars) {
      truncated = true;
      params.context.broadcastToConnIds(
        "channels.install.progress",
        {
          kind: "status",
          level: "warn",
          message: "Install output truncated.",
          ts: Date.now(),
          clientRunId: params.clientRunId,
          channelId: params.channelId,
          attempt: params.kind,
          truncated: true,
        },
        connIds,
        { dropIfSlow: true },
      );
      return;
    }
    params.context.broadcastToConnIds(
      "channels.install.progress",
      {
        ...payload,
        ts: Date.now(),
        clientRunId: params.clientRunId,
        channelId: params.channelId,
        attempt: params.kind,
      },
      connIds,
      { dropIfSlow: true },
    );
  };

  return {
    info: (message: string) => send({ kind: "status", level: "info", message }),
    warn: (message: string) => send({ kind: "status", level: "warn", message }),
    stdout: (chunk: string) => send({ kind: "log", stream: "stdout", chunk }),
    stderr: (chunk: string) => send({ kind: "log", stream: "stderr", chunk }),
  };
}

async function runChannelInstallAttempts(
  attempts: ChannelInstallAttempt[],
): Promise<{ ok: true; pluginId: string; version?: string } | { ok: false; error: string }> {
  if (attempts.length === 0) {
    return { ok: false, error: "no install attempts available" };
  }

  const errors: string[] = [];
  for (const attempt of attempts) {
    const result = await attempt.run();
    if (result.ok) {
      return { ok: true, pluginId: result.pluginId, version: result.version };
    }
    errors.push(`${attempt.kind}: ${result.error}`);
  }

  return { ok: false, error: errors.join("; ") || "channel install failed" };
}

export async function logoutChannelAccount(params: {
  channelId: ChannelId;
  accountId?: string | null;
  cfg: OpenClawConfig;
  context: GatewayRequestContext;
  plugin: ChannelPlugin;
}): Promise<ChannelLogoutPayload> {
  const resolvedAccountId =
    params.accountId?.trim() ||
    params.plugin.config.defaultAccountId?.(params.cfg) ||
    params.plugin.config.listAccountIds(params.cfg)[0] ||
    DEFAULT_ACCOUNT_ID;
  const account = params.plugin.config.resolveAccount(params.cfg, resolvedAccountId);
  await params.context.stopChannel(params.channelId, resolvedAccountId);
  const result = await params.plugin.gateway?.logoutAccount?.({
    cfg: params.cfg,
    accountId: resolvedAccountId,
    account,
    runtime: defaultRuntime,
  });
  if (!result) {
    throw new Error(`Channel ${params.channelId} does not support logout`);
  }
  const cleared = Boolean(result.cleared);
  const loggedOut = typeof result.loggedOut === "boolean" ? result.loggedOut : cleared;
  if (loggedOut) {
    params.context.markChannelLoggedOut(params.channelId, true, resolvedAccountId);
  }
  return {
    channel: params.channelId,
    accountId: resolvedAccountId,
    ...result,
    cleared,
  };
}

export const channelsHandlers: GatewayRequestHandlers = {
  "channels.status": async ({ params, respond, context }) => {
    if (!validateChannelsStatusParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid channels.status params: ${formatValidationErrors(validateChannelsStatusParams.errors)}`,
        ),
      );
      return;
    }
    const probe = (params as { probe?: boolean }).probe === true;
    const timeoutMsRaw = (params as { timeoutMs?: unknown }).timeoutMs;
    const timeoutMs = typeof timeoutMsRaw === "number" ? Math.max(1000, timeoutMsRaw) : 10_000;
    const cfg = loadConfig();
    const runtime = context.getRuntimeSnapshot();
    const plugins = listChannelPlugins();
    const pluginMap = new Map<ChannelId, ChannelPlugin>(
      plugins.map((plugin) => [plugin.id, plugin]),
    );

    const resolveRuntimeSnapshot = (
      channelId: ChannelId,
      accountId: string,
      defaultAccountId: string,
    ): ChannelAccountSnapshot | undefined => {
      const accounts = runtime.channelAccounts[channelId];
      const defaultRuntime = runtime.channels[channelId];
      const raw =
        accounts?.[accountId] ?? (accountId === defaultAccountId ? defaultRuntime : undefined);
      if (!raw) {
        return undefined;
      }
      return raw;
    };

    const isAccountEnabled = (plugin: ChannelPlugin, account: unknown) =>
      plugin.config.isEnabled
        ? plugin.config.isEnabled(account, cfg)
        : !account ||
          typeof account !== "object" ||
          (account as { enabled?: boolean }).enabled !== false;

    const buildChannelAccounts = async (channelId: ChannelId) => {
      const plugin = pluginMap.get(channelId);
      if (!plugin) {
        return {
          accounts: [] as ChannelAccountSnapshot[],
          defaultAccountId: DEFAULT_ACCOUNT_ID,
          defaultAccount: undefined as ChannelAccountSnapshot | undefined,
          resolvedAccounts: {} as Record<string, unknown>,
        };
      }
      const accountIds = plugin.config.listAccountIds(cfg);
      const defaultAccountId = resolveChannelDefaultAccountId({
        plugin,
        cfg,
        accountIds,
      });
      const accounts: ChannelAccountSnapshot[] = [];
      const resolvedAccounts: Record<string, unknown> = {};
      for (const accountId of accountIds) {
        const account = plugin.config.resolveAccount(cfg, accountId);
        const enabled = isAccountEnabled(plugin, account);
        resolvedAccounts[accountId] = account;
        let probeResult: unknown;
        let lastProbeAt: number | null = null;
        if (probe && enabled && plugin.status?.probeAccount) {
          let configured = true;
          if (plugin.config.isConfigured) {
            configured = await plugin.config.isConfigured(account, cfg);
          }
          if (configured) {
            probeResult = await plugin.status.probeAccount({
              account,
              timeoutMs,
              cfg,
            });
            lastProbeAt = Date.now();
          }
        }
        let auditResult: unknown;
        if (probe && enabled && plugin.status?.auditAccount) {
          let configured = true;
          if (plugin.config.isConfigured) {
            configured = await plugin.config.isConfigured(account, cfg);
          }
          if (configured) {
            auditResult = await plugin.status.auditAccount({
              account,
              timeoutMs,
              cfg,
              probe: probeResult,
            });
          }
        }
        const runtimeSnapshot = resolveRuntimeSnapshot(channelId, accountId, defaultAccountId);
        const snapshot = await buildChannelAccountSnapshot({
          plugin,
          cfg,
          accountId,
          runtime: runtimeSnapshot,
          probe: probeResult,
          audit: auditResult,
        });
        if (lastProbeAt) {
          snapshot.lastProbeAt = lastProbeAt;
        }
        const activity = getChannelActivity({
          channel: channelId as never,
          accountId,
        });
        if (snapshot.lastInboundAt == null) {
          snapshot.lastInboundAt = activity.inboundAt;
        }
        if (snapshot.lastOutboundAt == null) {
          snapshot.lastOutboundAt = activity.outboundAt;
        }
        accounts.push(snapshot);
      }
      const defaultAccount =
        accounts.find((entry) => entry.accountId === defaultAccountId) ?? accounts[0];
      return { accounts, defaultAccountId, defaultAccount, resolvedAccounts };
    };

    const uiCatalog = buildChannelUiCatalog(plugins);
    const payload: Record<string, unknown> = {
      ts: Date.now(),
      channelOrder: uiCatalog.order,
      channelLabels: uiCatalog.labels,
      channelDetailLabels: uiCatalog.detailLabels,
      channelSystemImages: uiCatalog.systemImages,
      channelMeta: uiCatalog.entries,
      channels: {} as Record<string, unknown>,
      channelAccounts: {} as Record<string, unknown>,
      channelDefaultAccountId: {} as Record<string, unknown>,
    };
    const channelsMap = payload.channels as Record<string, unknown>;
    const accountsMap = payload.channelAccounts as Record<string, unknown>;
    const defaultAccountIdMap = payload.channelDefaultAccountId as Record<string, unknown>;
    for (const plugin of plugins) {
      const { accounts, defaultAccountId, defaultAccount, resolvedAccounts } =
        await buildChannelAccounts(plugin.id);
      const fallbackAccount =
        resolvedAccounts[defaultAccountId] ?? plugin.config.resolveAccount(cfg, defaultAccountId);
      const summary = plugin.status?.buildChannelSummary
        ? await plugin.status.buildChannelSummary({
            account: fallbackAccount,
            cfg,
            defaultAccountId,
            snapshot:
              defaultAccount ??
              ({
                accountId: defaultAccountId,
              } as ChannelAccountSnapshot),
          })
        : {
            configured: defaultAccount?.configured ?? false,
          };
      channelsMap[plugin.id] = summary;
      accountsMap[plugin.id] = accounts;
      defaultAccountIdMap[plugin.id] = defaultAccountId;
    }

    respond(true, payload, undefined);
  },
  "channels.logout": async ({ params, respond, context }) => {
    if (!validateChannelsLogoutParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid channels.logout params: ${formatValidationErrors(validateChannelsLogoutParams.errors)}`,
        ),
      );
      return;
    }
    const rawChannel = (params as { channel?: unknown }).channel;
    const channelId = typeof rawChannel === "string" ? normalizePluginChannelId(rawChannel) : null;
    if (!channelId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid channels.logout channel"),
      );
      return;
    }
    const plugin = getChannelPlugin(channelId);
    if (!plugin?.gateway?.logoutAccount) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `channel ${channelId} does not support logout`),
      );
      return;
    }
    const accountIdRaw = (params as { accountId?: unknown }).accountId;
    const accountId = typeof accountIdRaw === "string" ? accountIdRaw.trim() : undefined;
    const snapshot = await readConfigFileSnapshot();
    if (!snapshot.valid) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "config invalid; fix it before logging out"),
      );
      return;
    }
    try {
      const payload = await logoutChannelAccount({
        channelId,
        accountId,
        cfg: snapshot.config ?? {},
        context,
        plugin,
      });
      respond(true, payload, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
  "channels.enable": async ({ params, respond }) => {
    if (!validateChannelsEnableParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid channels.enable params: ${formatValidationErrors(validateChannelsEnableParams.errors)}`,
        ),
      );
      return;
    }

    const rawChannelId = (params as { channelId?: string }).channelId?.trim();
    if (!rawChannelId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "channelId is required"));
      return;
    }
    const channelId = normalizeDockedChannelId(rawChannelId) ?? rawChannelId;
    const knownChannelIds = new Set<string>([
      ...listChannelPlugins().map((plugin) => plugin.id),
      ...listChannelPluginCatalogEntries().map((entry) => entry.id),
      ...listChatChannels().map((meta) => meta.id),
    ]);
    if (!knownChannelIds.has(channelId)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `channel "${channelId}" not found in catalog`),
      );
      return;
    }

    const snapshot = await readConfigFileSnapshot();
    if (!snapshot.valid) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "config invalid; fix it before enabling channels"),
      );
      return;
    }

    const enabled = enablePluginInConfig(snapshot.config ?? {}, channelId);
    if (!enabled.enabled) {
      respond(
        false,
        {
          ok: false,
          channelId,
          error: enabled.reason ?? "channel enable failed",
          restartRequired: false,
        },
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `channel "${channelId}" cannot be enabled: ${enabled.reason ?? "unknown reason"}`,
        ),
      );
      return;
    }

    try {
      await writeConfigFile(enabled.config);
      respond(
        true,
        {
          ok: true,
          channelId,
          restartRequired: true,
        },
        undefined,
      );
    } catch (err) {
      const message = formatForLog(err);
      respond(
        false,
        {
          ok: false,
          channelId,
          error: message,
          restartRequired: false,
        },
        errorShape(ErrorCodes.UNAVAILABLE, message),
      );
    }
  },
  "channels.catalog": ({ params, respond }) => {
    if (!validateChannelsCatalogParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid channels.catalog params: ${formatValidationErrors(validateChannelsCatalogParams.errors)}`,
        ),
      );
      return;
    }

    const cfg = loadConfig();
    const pluginRegistry = getActivePluginRegistry();
    const pluginHealthById = new Map<
      string,
      { status: "loaded" | "disabled" | "error"; error?: string }
    >();
    for (const record of pluginRegistry?.plugins ?? []) {
      const existing = pluginHealthById.get(record.id);
      const rank = record.status === "loaded" ? 2 : record.status === "error" ? 1 : 0;
      const existingRank = existing?.status === "loaded" ? 2 : existing?.status === "error" ? 1 : 0;
      if (!existing || rank > existingRank) {
        pluginHealthById.set(record.id, {
          status: record.status,
          ...(record.status === "error" && record.error ? { error: record.error } : {}),
        });
      } else if (rank === 1 && existing.status === "error" && !existing.error && record.error) {
        existing.error = record.error;
      }
    }
    const pluginsConfig = normalizePluginsConfig(cfg.plugins);
    const loadedPlugins = listChannelPlugins();
    const loadedIds = new Set(loadedPlugins.map((p) => p.id));
    const coreChannelMeta = listChatChannels();
    const coreChannelMetaById = new Map(coreChannelMeta.map((meta) => [meta.id, meta]));

    // Use listChannelPluginCatalogEntries for full discovery (bundled + external catalog).
    const catalogEntries = listChannelPluginCatalogEntries();
    const catalogIds = new Set(catalogEntries.map((entry) => entry.id));

    const entries: Array<Record<string, unknown>> = [];

    // Loaded plugins: installed and have runtime state.
    // Avoid calling isConfigured() — it can be async. Use lightweight heuristic.
    for (const plugin of loadedPlugins) {
      const channelCfg = cfg.channels?.[plugin.id];
      const hasAnyConfig =
        channelCfg != null &&
        typeof channelCfg === "object" &&
        Object.keys(channelCfg as Record<string, unknown>).length > 0;
      const defaultAccount = plugin.config.resolveAccount(cfg);
      const enabled = plugin.config.isEnabled
        ? plugin.config.isEnabled(defaultAccount, cfg)
        : (channelCfg as Record<string, unknown> | undefined)?.enabled !== false;

      entries.push({
        id: plugin.id,
        label: plugin.meta.label,
        detailLabel: plugin.meta.detailLabel ?? plugin.meta.selectionLabel ?? plugin.meta.label,
        blurb: plugin.meta.blurb ?? "",
        ...(plugin.meta.systemImage ? { systemImage: plugin.meta.systemImage } : {}),
        installed: true,
        configured: hasAnyConfig,
        enabled: Boolean(enabled),
        hasSchema: Boolean(plugin.configSchema),
        pluginStatus: "loaded",
      });
    }

    // Catalog entries not already loaded (uninstalled extensions).
    for (const catalogEntry of catalogEntries) {
      if (loadedIds.has(catalogEntry.id)) {
        continue;
      }
      const isCoreChannel = coreChannelMetaById.has(catalogEntry.id);
      const pluginHealth = pluginHealthById.get(catalogEntry.id);
      const pluginStatus = pluginHealth?.status;
      entries.push({
        id: catalogEntry.id,
        label: catalogEntry.meta.label,
        detailLabel:
          catalogEntry.meta.detailLabel ??
          catalogEntry.meta.selectionLabel ??
          catalogEntry.meta.label,
        blurb: catalogEntry.meta.blurb ?? "",
        ...(catalogEntry.meta.systemImage ? { systemImage: catalogEntry.meta.systemImage } : {}),
        installed: isCoreChannel || isCatalogPluginInstalled({ cfg, channelId: catalogEntry.id }),
        configured: false,
        enabled: isCoreChannel
          ? resolveBundledPluginEnabled({ cfg, pluginId: catalogEntry.id })
          : resolveEnableState(catalogEntry.id, "global", pluginsConfig).enabled,
        hasSchema: false,
        ...(pluginStatus ? { pluginStatus } : {}),
        ...(pluginStatus === "error" && pluginHealth?.error
          ? { pluginError: pluginHealth.error }
          : {}),
        install: {
          npmSpec: catalogEntry.install.npmSpec,
          ...(catalogEntry.install.localPath ? { localPath: catalogEntry.install.localPath } : {}),
        },
      });
    }

    // Core channels can still be valid catalog targets even when plugin package metadata
    // omits `openclaw.channel`. Keep them visible and actionable in the UI.
    for (const meta of coreChannelMeta) {
      if (loadedIds.has(meta.id) || catalogIds.has(meta.id)) {
        continue;
      }
      entries.push({
        id: meta.id,
        label: meta.label,
        detailLabel: meta.detailLabel ?? meta.selectionLabel ?? meta.label,
        blurb: meta.blurb ?? "",
        ...(meta.systemImage ? { systemImage: meta.systemImage } : {}),
        installed: true,
        configured: false,
        enabled: resolveBundledPluginEnabled({ cfg, pluginId: meta.id }),
        hasSchema: false,
      });
    }

    respond(true, { entries }, undefined);
  },
  "channels.repair": async ({ params, respond, context, client }) => {
    if (!validateChannelsRepairParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid channels.repair params: ${formatValidationErrors(validateChannelsRepairParams.errors)}`,
        ),
      );
      return;
    }

    const rawChannelId = (params as { channelId?: string }).channelId?.trim();
    if (!rawChannelId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "channelId is required"));
      return;
    }
    const channelId = normalizeDockedChannelId(rawChannelId) ?? rawChannelId;
    const clientRunId = (params as { clientRunId?: string }).clientRunId?.trim() || undefined;
    const connId = client?.connId;
    const timeoutMs =
      typeof (params as { timeoutMs?: unknown }).timeoutMs === "number"
        ? (params as { timeoutMs: number }).timeoutMs
        : 120_000;

    const installAttempts: ChannelInstallAttempt[] = [];
    const seenPathAttempts = new Set<string>();
    const registry = getActivePluginRegistry();
    for (const record of registry?.plugins ?? []) {
      if (record.id !== channelId || record.status !== "error") {
        continue;
      }
      const pluginRoot = resolvePluginRootFromSource(record.source);
      if (!pluginRoot) {
        continue;
      }
      const normalized = resolveUserPath(pluginRoot);
      if (seenPathAttempts.has(normalized)) {
        continue;
      }
      seenPathAttempts.add(normalized);
      installAttempts.push({
        kind: "source",
        run: async () => {
          const logger = createInstallProgressLogger({
            context,
            connId,
            clientRunId,
            channelId,
            kind: "source",
          });
          logger.info(`Repair attempt: source (${pluginRoot})`);
          const result = await installPluginFromPath({
            path: pluginRoot,
            extensionsDir: resolveExtensionsInstallDir(),
            timeoutMs,
            expectedPluginId: channelId,
            mode: "update",
            logger,
          });
          if (!result.ok) {
            logger.warn(`Repair attempt failed: ${result.error}`);
          } else {
            logger.info(
              `Repair attempt succeeded: ${result.pluginId}${result.version ? `@${result.version}` : ""}`,
            );
          }
          return result;
        },
      });
    }

    const catalogEntry = getChannelPluginCatalogEntry(channelId);
    const localInstallPath = resolveCatalogLocalInstallPath(catalogEntry?.install.localPath);
    if (localInstallPath) {
      const normalized = resolveUserPath(localInstallPath);
      if (!seenPathAttempts.has(normalized)) {
        seenPathAttempts.add(normalized);
        installAttempts.push({
          kind: "local",
          run: async () => {
            const logger = createInstallProgressLogger({
              context,
              connId,
              clientRunId,
              channelId,
              kind: "local",
            });
            logger.info(`Repair attempt: local (${localInstallPath})`);
            const result = await installPluginFromPath({
              path: localInstallPath,
              extensionsDir: resolveExtensionsInstallDir(),
              timeoutMs,
              expectedPluginId: channelId,
              mode: "update",
              logger,
            });
            if (!result.ok) {
              logger.warn(`Repair attempt failed: ${result.error}`);
            } else {
              logger.info(
                `Repair attempt succeeded: ${result.pluginId}${result.version ? `@${result.version}` : ""}`,
              );
            }
            return result;
          },
        });
      }
    }

    const npmSpec = catalogEntry?.install.npmSpec?.trim();
    if (npmSpec) {
      installAttempts.push({
        kind: "npm",
        run: async () => {
          const logger = createInstallProgressLogger({
            context,
            connId,
            clientRunId,
            channelId,
            kind: "npm",
          });
          logger.info(`Repair attempt: npm (${npmSpec})`);
          const result = await installPluginFromNpmSpec({
            spec: npmSpec,
            extensionsDir: resolveExtensionsInstallDir(),
            timeoutMs,
            expectedPluginId: channelId,
            mode: "update",
            logger,
          });
          if (!result.ok) {
            logger.warn(`Repair attempt failed: ${result.error}`);
          } else {
            logger.info(
              `Repair attempt succeeded: ${result.pluginId}${result.version ? `@${result.version}` : ""}`,
            );
          }
          return result;
        },
      });
    }

    if (installAttempts.length === 0) {
      respond(
        false,
        { ok: false, error: `no repair source found for channel "${channelId}"` },
        errorShape(ErrorCodes.INVALID_REQUEST, `no repair source found for channel "${channelId}"`),
      );
      return;
    }

    try {
      const result = await runChannelInstallAttempts(installAttempts);
      if (result.ok) {
        respond(
          true,
          {
            ok: true,
            pluginId: result.pluginId,
            version: result.version,
            restartRequired: true,
          },
          undefined,
        );
      } else {
        respond(
          false,
          { ok: false, error: result.error },
          errorShape(ErrorCodes.UNAVAILABLE, result.error),
        );
      }
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
  "channels.install": async ({ params, respond, context, client }) => {
    if (!validateChannelsInstallParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid channels.install params: ${formatValidationErrors(validateChannelsInstallParams.errors)}`,
        ),
      );
      return;
    }

    const channelId = (params as { channelId?: string }).channelId?.trim();
    const npmSpecDirect = (params as { npmSpec?: string }).npmSpec?.trim();
    const clientRunId = (params as { clientRunId?: string }).clientRunId?.trim() || undefined;
    const modeRaw = (params as { mode?: unknown }).mode;
    const modeParam: "install" | "update" | undefined =
      typeof modeRaw === "string"
        ? modeRaw.trim() === "update"
          ? "update"
          : modeRaw.trim() === "install"
            ? "install"
            : undefined
        : undefined;
    const timeoutMs =
      typeof (params as { timeoutMs?: unknown }).timeoutMs === "number"
        ? (params as { timeoutMs: number }).timeoutMs
        : 120_000;

    const connId = client?.connId;

    const catalogEntry = channelId ? getChannelPluginCatalogEntry(channelId) : undefined;
    let npmSpec = npmSpecDirect;
    if (!npmSpec && channelId) {
      if (!catalogEntry) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `channel "${channelId}" not found in catalog`),
        );
        return;
      }
      npmSpec = catalogEntry.install.npmSpec;
    }

    if (!npmSpec) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "either channelId or npmSpec is required"),
      );
      return;
    }

    let mode: "install" | "update" | undefined = modeParam;
    if (!mode && channelId) {
      // Make channels.install idempotent for UI flows:
      // if the plugin directory exists already (even partially), treat it as an update/repair.
      try {
        const installDir = resolvePluginInstallDir(
          channelId,
          path.join(resolveConfigDir(), "extensions"),
        );
        if (fs.existsSync(installDir)) {
          mode = "update";
        }
      } catch {
        // ignore
      }
    }

    const localInstallPath = resolveCatalogLocalInstallPath(catalogEntry?.install.localPath);
    const preferLocalInstall = Boolean(localInstallPath) && mode === "update";
    const installAttempts: ChannelInstallAttempt[] = [];
    if (preferLocalInstall && localInstallPath) {
      installAttempts.push({
        kind: "local",
        run: async () => {
          const logger = createInstallProgressLogger({
            context,
            connId,
            clientRunId,
            channelId,
            kind: "local",
          });
          logger.info(`Install attempt: local (${localInstallPath})`);
          const result = await installPluginFromPath({
            path: localInstallPath,
            extensionsDir: resolveExtensionsInstallDir(),
            timeoutMs,
            expectedPluginId: channelId ?? undefined,
            mode: mode ?? "install",
            logger,
          });
          if (!result.ok) {
            logger.warn(`Install attempt failed: ${result.error}`);
          } else {
            logger.info(
              `Install attempt succeeded: ${result.pluginId}${result.version ? `@${result.version}` : ""}`,
            );
          }
          return result;
        },
      });
    }
    installAttempts.push({
      kind: "npm",
      run: async () => {
        const logger = createInstallProgressLogger({
          context,
          connId,
          clientRunId,
          channelId,
          kind: "npm",
        });
        logger.info(`Install attempt: npm (${npmSpec})`);
        const result = await installPluginFromNpmSpec({
          spec: npmSpec,
          extensionsDir: resolveExtensionsInstallDir(),
          timeoutMs,
          expectedPluginId: channelId ?? undefined,
          mode: mode ?? "install",
          logger,
        });
        if (!result.ok) {
          logger.warn(`Install attempt failed: ${result.error}`);
        } else {
          logger.info(
            `Install attempt succeeded: ${result.pluginId}${result.version ? `@${result.version}` : ""}`,
          );
        }
        return result;
      },
    });
    if (!preferLocalInstall && localInstallPath) {
      installAttempts.push({
        kind: "local",
        run: async () => {
          const logger = createInstallProgressLogger({
            context,
            connId,
            clientRunId,
            channelId,
            kind: "local",
          });
          logger.info(`Install attempt: local (${localInstallPath})`);
          const result = await installPluginFromPath({
            path: localInstallPath,
            extensionsDir: resolveExtensionsInstallDir(),
            timeoutMs,
            expectedPluginId: channelId ?? undefined,
            mode: mode ?? "install",
            logger,
          });
          if (!result.ok) {
            logger.warn(`Install attempt failed: ${result.error}`);
          } else {
            logger.info(
              `Install attempt succeeded: ${result.pluginId}${result.version ? `@${result.version}` : ""}`,
            );
          }
          return result;
        },
      });
    }

    try {
      const result = await runChannelInstallAttempts(installAttempts);
      if (result.ok) {
        respond(
          true,
          {
            ok: true,
            pluginId: result.pluginId,
            version: result.version,
            restartRequired: true,
          },
          undefined,
        );
      } else {
        respond(
          false,
          { ok: false, error: result.error },
          errorShape(ErrorCodes.UNAVAILABLE, result.error),
        );
      }
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
};
