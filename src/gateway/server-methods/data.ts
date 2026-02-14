import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { GatewayRequestHandlers } from "./types.js";
import { resolveDefaultAgentWorkspaceDir } from "../../agents/workspace.js";
import { collectWorkspaceDirs, isPathWithin } from "../../commands/cleanup-utils.js";
import { dirExists, rewriteConfigPaths } from "../../commands/export-import-utils.js";
import { loadConfig, resolveConfigPath, resolveStateDir } from "../../config/config.js";
import { resolveHomeDir } from "../../utils.js";
import { getPendingUpload, removePendingUpload } from "../data-http.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateDataImportApplyParams,
  validateDataImportCancelParams,
} from "../protocol/index.js";

// ---------------------------------------------------------------------------
// Backup helpers (mirror of CLI import.ts, adapted for gateway context)
// ---------------------------------------------------------------------------

async function backupDir(dir: string, suffix: string): Promise<string | null> {
  try {
    const stat = await fs.stat(dir);
    if (!stat.isDirectory()) {
      return null;
    }
  } catch {
    return null;
  }
  const backupPath = `${dir}.${suffix}`;
  await fs.rename(dir, backupPath);
  return backupPath;
}

async function backupFile(filePath: string, suffix: string): Promise<string | null> {
  try {
    await fs.stat(filePath);
  } catch {
    return null;
  }
  const backupPath = `${filePath}.${suffix}`;
  await fs.rename(filePath, backupPath);
  return backupPath;
}

export const dataHandlers: GatewayRequestHandlers = {
  "data.import.apply": async ({ params, respond }) => {
    if (!validateDataImportApplyParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid data.import.apply params: ${formatValidationErrors(validateDataImportApplyParams.errors)}`,
        ),
      );
      return;
    }

    const upload = getPendingUpload(params.uploadId);
    if (!upload) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "upload not found or expired"),
      );
      return;
    }

    const extractedRoot = upload.extractedRoot;
    const targetHomeDir = resolveHomeDir() ?? os.homedir();
    const targetStateDir = resolveStateDir();
    const targetConfigPath = resolveConfigPath();

    try {
      // ── Backup existing state ──────────────────────────────────────
      const backupSuffix = `bak.${Date.now()}`;
      let backupDir_: string | null = null;

      // Collect external workspace dirs before backup
      let externalWorkspaces: string[] = [];
      try {
        const cfg = loadConfig();
        externalWorkspaces = collectWorkspaceDirs(cfg).filter(
          (ws) => !isPathWithin(ws, targetStateDir),
        );
      } catch {
        // Config may not exist yet
      }

      // Backup state dir — abort if this fails
      try {
        backupDir_ = await backupDir(targetStateDir, backupSuffix);
      } catch (err) {
        respond(
          true,
          {
            ok: false,
            error: `backup failed, import aborted: ${String(err)}`,
            restartRequired: false,
          },
          undefined,
        );
        return;
      }

      // Backup config if outside state dir (best-effort)
      if (!isPathWithin(targetConfigPath, targetStateDir)) {
        await backupFile(targetConfigPath, backupSuffix).catch(() => {});
      }

      // Backup external workspace dirs (best-effort)
      for (const ws of externalWorkspaces) {
        await backupDir(ws, backupSuffix).catch(() => {});
      }

      // ── Restore state dir ──────────────────────────────────────────
      const extractedState = path.join(extractedRoot, "state");
      if (await dirExists(extractedState)) {
        await fs.mkdir(targetStateDir, { recursive: true });
        await fs.cp(extractedState, targetStateDir, { recursive: true });
      }

      // ── Restore config ─────────────────────────────────────────────
      const extractedConfig = path.join(extractedRoot, "config");
      if (await dirExists(extractedConfig)) {
        const configEntries = await fs.readdir(extractedConfig);
        const configFile = configEntries.find((f) => f.endsWith(".json"));
        if (configFile) {
          let configText = await fs.readFile(path.join(extractedConfig, configFile), "utf-8");
          configText = rewriteConfigPaths(configText, "~", targetHomeDir);
          await fs.mkdir(path.dirname(targetConfigPath), { recursive: true });
          await fs.writeFile(targetConfigPath, configText);
        }
      }

      // ── Restore workspaces ─────────────────────────────────────────
      const extractedWorkspaces = path.join(extractedRoot, "workspaces");
      if (await dirExists(extractedWorkspaces)) {
        const wsEntries = await fs.readdir(extractedWorkspaces, {
          withFileTypes: true,
        });
        for (const entry of wsEntries) {
          if (!entry.isDirectory()) {
            continue;
          }
          const wsName = entry.name as unknown as string;
          const src = path.join(extractedWorkspaces, wsName);
          let dest: string;
          if (wsName === "workspace") {
            dest = resolveDefaultAgentWorkspaceDir();
          } else {
            dest = path.join(path.dirname(resolveDefaultAgentWorkspaceDir()), wsName);
          }
          await fs.mkdir(path.dirname(dest), { recursive: true });
          await fs.cp(src, dest, { recursive: true });
        }
      }

      // Clean up the pending upload
      removePendingUpload(params.uploadId);

      respond(
        true,
        {
          ok: true,
          backupDir: backupDir_ ?? undefined,
          restartRequired: true,
        },
        undefined,
      );
    } catch (err) {
      removePendingUpload(params.uploadId);
      respond(
        true,
        {
          ok: false,
          error: String(err),
          restartRequired: false,
        },
        undefined,
      );
    }
  },

  "data.import.cancel": async ({ params, respond }) => {
    if (!validateDataImportCancelParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid data.import.cancel params: ${formatValidationErrors(validateDataImportCancelParams.errors)}`,
        ),
      );
      return;
    }

    removePendingUpload(params.uploadId);
    respond(true, { ok: true }, undefined);
  },
};
