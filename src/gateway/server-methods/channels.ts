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
  normalizeChannelId,
} from "../../channels/plugins/index.js";
import { buildChannelAccountSnapshot } from "../../channels/plugins/status.js";
import { loadConfig, readConfigFileSnapshot } from "../../config/config.js";
import { getChannelActivity } from "../../infra/channel-activity.js";
import { installPluginFromNpmSpec, resolvePluginInstallDir } from "../../plugins/install.js";
import { DEFAULT_ACCOUNT_ID } from "../../routing/session-key.js";
import { defaultRuntime } from "../../runtime.js";
import { resolveConfigDir } from "../../utils.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateChannelsCatalogParams,
  validateChannelsInstallParams,
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
    const channelId = typeof rawChannel === "string" ? normalizeChannelId(rawChannel) : null;
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
    const loadedPlugins = listChannelPlugins();
    const loadedIds = new Set(loadedPlugins.map((p) => p.id));

    // Use listChannelPluginCatalogEntries for full discovery (bundled + external catalog).
    const catalogEntries = listChannelPluginCatalogEntries();

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
      });
    }

    // Catalog entries not already loaded (uninstalled extensions).
    for (const catalogEntry of catalogEntries) {
      if (loadedIds.has(catalogEntry.id)) {
        continue;
      }
      entries.push({
        id: catalogEntry.id,
        label: catalogEntry.meta.label,
        detailLabel:
          catalogEntry.meta.detailLabel ??
          catalogEntry.meta.selectionLabel ??
          catalogEntry.meta.label,
        blurb: catalogEntry.meta.blurb ?? "",
        ...(catalogEntry.meta.systemImage ? { systemImage: catalogEntry.meta.systemImage } : {}),
        installed: isCatalogPluginInstalled({ cfg, channelId: catalogEntry.id }),
        configured: false,
        enabled: false,
        hasSchema: false,
        install: {
          npmSpec: catalogEntry.install.npmSpec,
          ...(catalogEntry.install.localPath ? { localPath: catalogEntry.install.localPath } : {}),
        },
      });
    }

    respond(true, { entries }, undefined);
  },
  "channels.install": async ({ params, respond }) => {
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
    const timeoutMs =
      typeof (params as { timeoutMs?: unknown }).timeoutMs === "number"
        ? (params as { timeoutMs: number }).timeoutMs
        : 120_000;

    let npmSpec = npmSpecDirect;
    if (!npmSpec && channelId) {
      const catalogEntry = getChannelPluginCatalogEntry(channelId);
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

    try {
      const result = await installPluginFromNpmSpec({
        spec: npmSpec,
        timeoutMs,
        expectedPluginId: channelId ?? undefined,
      });

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
          errorShape(ErrorCodes.UNAVAILABLE, result.error ?? "channel install failed"),
        );
      }
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
};
