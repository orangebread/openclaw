import { cancel, confirm, isCancel } from "@clack/prompts";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { RuntimeEnv } from "../runtime.js";
import { resolveDefaultAgentWorkspaceDir } from "../agents/workspace.js";
import { formatCliCommand } from "../cli/command-format.js";
import { isNixMode, loadConfig, resolveConfigPath, resolveStateDir } from "../config/config.js";
import { resolveGatewayService } from "../daemon/service.js";
import { extractArchive, resolveArchiveKind } from "../infra/archive.js";
import { stylePromptMessage } from "../terminal/prompt-style.js";
import { resolveHomeDir, shortenHomePath } from "../utils.js";
import { collectWorkspaceDirs, isPathWithin } from "./cleanup-utils.js";
import {
  ARCHIVE_ROOT_DIR,
  type ExportManifest,
  dirExists,
  fileExists,
  makeTempDir,
  readManifest,
  rewriteConfigPaths,
} from "./export-import-utils.js";

export type ImportOptions = {
  archive: string;
  backup?: boolean;
  yes?: boolean;
  nonInteractive?: boolean;
  dryRun?: boolean;
};

async function stopGatewayIfRunning(runtime: RuntimeEnv): Promise<void> {
  if (isNixMode) {
    return;
  }
  const service = resolveGatewayService();
  let loaded = false;
  try {
    loaded = await service.isLoaded({ env: process.env });
  } catch (err) {
    runtime.error(`Gateway service check failed: ${String(err)}`);
    return;
  }
  if (!loaded) {
    return;
  }
  try {
    await service.stop({ env: process.env, stdout: process.stdout });
  } catch (err) {
    runtime.error(`Gateway stop failed: ${String(err)}`);
  }
}

export async function importCommand(runtime: RuntimeEnv, opts: ImportOptions): Promise<void> {
  const interactive = !opts.nonInteractive;
  if (!interactive && !opts.yes) {
    runtime.error("Non-interactive mode requires --yes.");
    runtime.exit(1);
    return;
  }

  const archivePath = path.resolve(opts.archive);

  // ── Validate archive ───────────────────────────────────────────────────
  if (!(await fileExists(archivePath))) {
    runtime.error(`Archive not found: ${archivePath}`);
    runtime.exit(1);
    return;
  }

  const kind = resolveArchiveKind(archivePath);
  if (!kind) {
    runtime.error(`Unsupported archive format. Expected .tar.gz, .tgz, or .zip`);
    runtime.exit(1);
    return;
  }

  // ── Extract to temp dir ────────────────────────────────────────────────
  const tempDir = await makeTempDir("openclaw-import-");
  let lockAcquired = false;
  let lockPath = "";
  try {
    await extractArchive({
      archivePath,
      destDir: tempDir,
      timeoutMs: 120_000,
    });

    // Locate archive root
    const extractedRoot = path.join(tempDir, ARCHIVE_ROOT_DIR);
    if (!(await dirExists(extractedRoot))) {
      runtime.error(
        `Invalid archive: missing ${ARCHIVE_ROOT_DIR}/ directory. Is this an OpenClaw export?`,
      );
      runtime.exit(1);
      return;
    }

    // ── Read manifest ──────────────────────────────────────────────────
    let manifest: ExportManifest;
    try {
      manifest = await readManifest(extractedRoot);
    } catch (err) {
      runtime.error(`Failed to read manifest: ${String(err)}`);
      runtime.exit(1);
      return;
    }

    // ── Print summary ──────────────────────────────────────────────────
    const targetHomeDir = resolveHomeDir() ?? os.homedir();
    const targetStateDir = resolveStateDir();
    const targetConfigPath = resolveConfigPath();

    runtime.log("Import summary:\n");
    runtime.log(`  Exported at:  ${manifest.exportedAt}`);
    runtime.log(`  Version:      ${manifest.openclawVersion}`);
    runtime.log(`  Platform:     ${manifest.platform}`);
    if (manifest.platform !== process.platform) {
      runtime.log(`  (current platform: ${process.platform})`);
    }
    runtime.log(`  Agents:       ${manifest.contents.agents.join(", ") || "(none)"}`);
    runtime.log(`  Workspaces:   ${manifest.contents.workspaces.join(", ") || "(none)"}`);
    runtime.log(`  Sessions:     ${manifest.contents.sessions ? "yes" : "no"}`);
    runtime.log(`  Credentials:  ${manifest.contents.credentials ? "yes" : "no"}`);
    runtime.log(`  Cron jobs:    ${manifest.contents.cron ? "yes" : "no"}`);
    runtime.log(`\n  Target:       ${shortenHomePath(targetStateDir)}`);

    // ── Dry-run ────────────────────────────────────────────────────────
    if (opts.dryRun) {
      runtime.log("\n[dry-run] No changes made.");
      return;
    }

    // ── Confirm ────────────────────────────────────────────────────────
    if (interactive && !opts.yes) {
      runtime.log("");
      const ok = await confirm({
        message: stylePromptMessage("This will replace your current OpenClaw state. Proceed?"),
      });
      if (isCancel(ok) || !ok) {
        cancel("Import cancelled.");
        return;
      }
    }

    // ── Stop gateway ───────────────────────────────────────────────────
    await stopGatewayIfRunning(runtime);

    // ── Acquire import lock ─────────────────────────────────────────
    lockPath = path.join(targetStateDir, ".import-lock");
    try {
      await fs.mkdir(targetStateDir, { recursive: true });
      await fs.writeFile(lockPath, String(process.pid), { flag: "wx" });
      lockAcquired = true;
    } catch (lockErr) {
      if ((lockErr as NodeJS.ErrnoException).code === "EEXIST") {
        runtime.error(
          "Another import is in progress (lock file exists). " +
            `If this is stale, remove ${lockPath} and retry.`,
        );
        runtime.exit(1);
        return;
      }
      // State dir may not exist yet — no lock needed for fresh installs
    }

    // ── Backup existing state ──────────────────────────────────────────
    const doBackup = opts.backup !== false;
    const backupSuffix = `bak.${Date.now()}`;

    if (doBackup) {
      // Collect workspace dirs before backup (loadConfig reads from state dir)
      let externalWorkspaces: string[] = [];
      try {
        const cfg = loadConfig();
        externalWorkspaces = collectWorkspaceDirs(cfg).filter(
          (ws) => !isPathWithin(ws, targetStateDir),
        );
      } catch {
        // Config may not exist yet — no external workspaces to back up
      }

      // Fail hard if state dir backup fails — abort to prevent data loss
      const backupResult = await backupDir(targetStateDir, backupSuffix, runtime);
      if (backupResult === "error") {
        if (lockAcquired) {
          await fs.rm(lockPath, { force: true }).catch(() => {});
        }
        runtime.error("State directory backup failed. Import aborted to prevent data loss.");
        runtime.exit(1);
        return;
      }

      // Backup config if outside state dir (best-effort)
      if (!isPathWithin(targetConfigPath, targetStateDir)) {
        await backupFile(targetConfigPath, backupSuffix, runtime);
      }

      // Backup workspace dirs outside state dir (best-effort)
      for (const ws of externalWorkspaces) {
        await backupDir(ws, backupSuffix, runtime);
      }
    }

    // ── Restore state dir ──────────────────────────────────────────────
    const extractedState = path.join(extractedRoot, "state");
    if (await dirExists(extractedState)) {
      await fs.mkdir(targetStateDir, { recursive: true });
      await fs.cp(extractedState, targetStateDir, { recursive: true });
    }

    // ── Restore config ─────────────────────────────────────────────────
    const extractedConfig = path.join(extractedRoot, "config");
    if (await dirExists(extractedConfig)) {
      const configEntries = await fs.readdir(extractedConfig);
      const configFile = configEntries.find((f) => f.endsWith(".json"));
      if (configFile) {
        let configText = await fs.readFile(path.join(extractedConfig, configFile), "utf-8");
        // The exported config has ~ paths — expand them for the target system
        configText = rewriteConfigPaths(configText, "~", targetHomeDir);
        await fs.mkdir(path.dirname(targetConfigPath), { recursive: true });
        await fs.writeFile(targetConfigPath, configText);
      }
    }

    // ── Restore workspaces ─────────────────────────────────────────────
    const extractedWorkspaces = path.join(extractedRoot, "workspaces");
    if (await dirExists(extractedWorkspaces)) {
      const wsEntries = await fs.readdir(extractedWorkspaces, { withFileTypes: true });
      for (const entry of wsEntries) {
        if (!entry.isDirectory()) {
          continue;
        }
        const wsName = entry.name as unknown as string;
        // Default workspace goes to resolveDefaultAgentWorkspaceDir()
        // Others go under state dir as workspace-{name}
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

    // ── Release lock ──────────────────────────────────────────────────
    if (lockAcquired) {
      await fs.rm(lockPath, { force: true }).catch(() => {});
    }

    // ── Done ───────────────────────────────────────────────────────────
    runtime.log("\nImport complete.");
    if (doBackup) {
      runtime.log(`Previous state backed up with .${backupSuffix} suffix.`);
    }
    runtime.log(`\nRecommended: ${formatCliCommand("openclaw doctor")}`);
  } finally {
    if (lockAcquired) {
      await fs.rm(lockPath, { force: true }).catch(() => {});
    }
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Backup helpers
// ---------------------------------------------------------------------------

async function backupDir(
  dir: string,
  suffix: string,
  runtime: RuntimeEnv,
): Promise<"ok" | "skipped" | "error"> {
  try {
    const stat = await fs.stat(dir);
    if (!stat.isDirectory()) {
      return "skipped";
    }
  } catch {
    return "skipped";
  }
  const backupPath = `${dir}.${suffix}`;
  try {
    await fs.rename(dir, backupPath);
    runtime.log(`Backed up ${shortenHomePath(dir)} → ${shortenHomePath(backupPath)}`);
    return "ok";
  } catch (err) {
    runtime.error(`Failed to backup ${shortenHomePath(dir)}: ${String(err)}`);
    return "error";
  }
}

async function backupFile(filePath: string, suffix: string, runtime: RuntimeEnv): Promise<void> {
  try {
    await fs.stat(filePath);
  } catch {
    return;
  }
  const backupPath = `${filePath}.${suffix}`;
  try {
    await fs.rename(filePath, backupPath);
    runtime.log(`Backed up ${shortenHomePath(filePath)} → ${shortenHomePath(backupPath)}`);
  } catch (err) {
    runtime.error(`Failed to backup ${shortenHomePath(filePath)}: ${String(err)}`);
  }
}
