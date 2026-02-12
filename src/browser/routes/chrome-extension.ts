import type { BrowserRouteContext } from "../server-context.js";
import type { BrowserRouteRegistrar } from "./types.js";
import {
  installChromeExtension,
  resolveChromeExtensionInstallStatus,
} from "../chrome-extension-install.js";
import { jsonError } from "./utils.js";

export function registerBrowserChromeExtensionRoutes(
  app: BrowserRouteRegistrar,
  _ctx: BrowserRouteContext,
) {
  app.get("/chrome-extension", async (_req, res) => {
    res.json({ ok: true, ...resolveChromeExtensionInstallStatus() });
  });

  app.post("/chrome-extension/install", async (_req, res) => {
    try {
      const installed = await installChromeExtension();
      res.json({ ok: true, path: installed.path });
    } catch (err) {
      jsonError(res, 500, String(err));
    }
  });
}
