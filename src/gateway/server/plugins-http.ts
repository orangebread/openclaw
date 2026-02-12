import type { IncomingMessage, ServerResponse } from "node:http";
import type { createSubsystemLogger } from "../../logging/subsystem.js";
import type { PluginRegistry } from "../../plugins/registry.js";
import { loadConfig } from "../../config/config.js";
import { authorizeGatewayConnect, type ResolvedGatewayAuth } from "../auth.js";
import { sendUnauthorized } from "../http-common.js";
import { getBearerToken } from "../http-utils.js";

type SubsystemLogger = ReturnType<typeof createSubsystemLogger>;

export type PluginHttpRequestHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => Promise<boolean>;

export function createGatewayPluginRequestHandler(params: {
  registry: PluginRegistry;
  log: SubsystemLogger;
  auth: ResolvedGatewayAuth;
  getTrustedProxies?: () => string[];
}): PluginHttpRequestHandler {
  const { registry, log, auth } = params;
  const getTrustedProxies =
    params.getTrustedProxies ??
    (() => {
      const cfg = loadConfig();
      return cfg.gateway?.trustedProxies ?? [];
    });
  return async (req, res) => {
    const routes = registry.httpRoutes ?? [];
    const handlers = registry.httpHandlers ?? [];
    if (routes.length === 0 && handlers.length === 0) {
      return false;
    }

    let authorized: boolean | null = null;
    const ensureAuthorized = async (): Promise<boolean> => {
      if (authorized !== null) {
        return authorized;
      }
      const token = getBearerToken(req);
      const authResult = await authorizeGatewayConnect({
        auth,
        connectAuth: token ? { token, password: token } : null,
        req,
        trustedProxies: getTrustedProxies(),
      });
      authorized = authResult.ok;
      return authorized;
    };

    if (routes.length > 0) {
      const url = new URL(req.url ?? "/", "http://localhost");
      const route = routes.find((entry) => entry.path === url.pathname);
      if (route) {
        if (route.auth !== "none") {
          const ok = await ensureAuthorized();
          if (!ok) {
            sendUnauthorized(res);
            return true;
          }
        }
        try {
          await route.handler(req, res);
          return true;
        } catch (err) {
          log.warn(`plugin http route failed (${route.pluginId ?? "unknown"}): ${String(err)}`);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            res.end("Internal Server Error");
          }
          return true;
        }
      }
    }

    for (const entry of handlers) {
      try {
        const matched = entry.match ? entry.match(req) : true;
        if (!matched) {
          continue;
        }
        if (entry.auth !== "none") {
          const ok = await ensureAuthorized();
          if (!ok) {
            sendUnauthorized(res);
            return true;
          }
        }
        const handled = await entry.handler(req, res);
        if (handled) {
          return true;
        }
      } catch (err) {
        log.warn(`plugin http handler failed (${entry.pluginId}): ${String(err)}`);
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end("Internal Server Error");
        }
        return true;
      }
    }
    return false;
  };
}
