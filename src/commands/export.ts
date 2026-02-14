import { cancel, confirm, isCancel } from "@clack/prompts";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import type { RuntimeEnv } from "../runtime.js";
import {
  loadConfig,
  resolveConfigPath,
  resolveOAuthDir,
  resolveStateDir,
} from "../config/config.js";
import { stylePromptMessage } from "../terminal/prompt-style.js";
import { resolveHomeDir, shortenHomePath } from "../utils.js";
import { VERSION } from "../version.js";
import { collectWorkspaceDirs } from "./cleanup-utils.js";
import {
  ARCHIVE_ROOT_DIR,
  MANIFEST_VERSION,
  type ExportManifest,
  dirExists,
  fileExists,
  makeTempDir,
  normalizePathForArchive,
  stageEntry,
  stageStateDir,
  writeManifest,
} from "./export-import-utils.js";

export type ExportOptions = {
  output?: string;
  yes?: boolean;
  nonInteractive?: boolean;
  dryRun?: boolean;
};

function defaultArchiveName(): string {
  const now = new Date();
  const ts = now
    .toISOString()
    .replace(/[T:]/g, "-")
    .replace(/\.\d+Z$/, "");
  return `openclaw-export-${ts}.tar.gz`;
}

export async function exportCommand(runtime: RuntimeEnv, opts: ExportOptions): Promise<void> {
  const interactive = !opts.nonInteractive;
  if (!interactive && !opts.yes) {
    runtime.error("Non-interactive mode requires --yes.");
    runtime.exit(1);
    return;
  }

  // ── Resolve paths ──────────────────────────────────────────────────────
  const homeDir = resolveHomeDir() ?? os.homedir();
  const stateDir = resolveStateDir();
  const configPath = resolveConfigPath();
  const oauthDir = resolveOAuthDir();
  const cfg = loadConfig();
  const workspaceDirs = collectWorkspaceDirs(cfg);
  const profile = process.env.OPENCLAW_PROFILE?.trim() || undefined;
  const outputPath = path.resolve(opts.output ?? defaultArchiveName());

  // ── Dry-run: print what would be exported ──────────────────────────────
  if (opts.dryRun) {
    runtime.log("Export dry-run — the following would be archived:\n");
    runtime.log(`  Config:     ${shortenHomePath(configPath)}`);
    runtime.log(`  State dir:  ${shortenHomePath(stateDir)}`);
    for (const ws of workspaceDirs) {
      runtime.log(`  Workspace:  ${shortenHomePath(ws)}`);
    }
    runtime.log(`  OAuth:      ${shortenHomePath(oauthDir)}`);
    runtime.log(`\n  Output:     ${outputPath}`);
    return;
  }

  // ── Confirm ────────────────────────────────────────────────────────────
  if (interactive && !opts.yes) {
    runtime.log("This will export your full OpenClaw state to a portable archive.\n");
    runtime.log(`  State dir:  ${shortenHomePath(stateDir)}`);
    runtime.log(`  Config:     ${shortenHomePath(configPath)}`);
    for (const ws of workspaceDirs) {
      runtime.log(`  Workspace:  ${shortenHomePath(ws)}`);
    }
    runtime.log(`  Output:     ${outputPath}\n`);

    const ok = await confirm({ message: stylePromptMessage("Proceed with export?") });
    if (isCancel(ok) || !ok) {
      cancel("Export cancelled.");
      return;
    }
  }

  // ── Stage files into temp dir ──────────────────────────────────────────
  const tempDir = await makeTempDir();
  const stagingRoot = path.join(tempDir, ARCHIVE_ROOT_DIR);
  const stagingConfig = path.join(stagingRoot, "config");
  const stagingState = path.join(stagingRoot, "state");
  const stagingWorkspaces = path.join(stagingRoot, "workspaces");

  try {
    await fs.mkdir(stagingRoot, { recursive: true });

    // Config file — rewrite home paths to ~/
    let configStaged = false;
    if (await fileExists(configPath)) {
      await fs.mkdir(stagingConfig, { recursive: true });
      const configText = await fs.readFile(configPath, "utf-8");
      const normalized = configText.replaceAll(homeDir, "~");
      await fs.writeFile(path.join(stagingConfig, path.basename(configPath)), normalized);
      configStaged = true;
    }

    // State dir (skips transient dirs, config, workspaces)
    const { agents } = await stageStateDir(stateDir, stagingState);

    // OAuth dir — may already be under state/credentials, but handle external case
    const oauthInState = oauthDir.startsWith(stateDir);
    if (!oauthInState && (await dirExists(oauthDir))) {
      await stageEntry(oauthDir, stagingState, "credentials");
    }

    // Workspaces
    const stagedWorkspaceNames: string[] = [];
    for (const ws of workspaceDirs) {
      if (await dirExists(ws)) {
        const wsName = path.basename(ws);
        await stageEntry(ws, stagingWorkspaces, wsName);
        stagedWorkspaceNames.push(wsName);
      }
    }

    // Manifest
    const manifest: ExportManifest = {
      version: MANIFEST_VERSION,
      exportedAt: new Date().toISOString(),
      openclawVersion: VERSION,
      platform: process.platform,
      homeDir: normalizePathForArchive(homeDir, homeDir),
      stateDir: normalizePathForArchive(stateDir, homeDir),
      profile,
      contents: {
        config: configStaged,
        workspaces: stagedWorkspaceNames,
        agents,
        credentials: oauthInState
          ? await dirExists(path.join(stateDir, "credentials"))
          : await dirExists(oauthDir),
        sessions: agents.length > 0,
        approvals: await fileExists(path.join(stateDir, "exec-approvals.json")),
        cron: await dirExists(path.join(stateDir, "cron")),
        identity: await dirExists(path.join(stateDir, "identity")),
      },
    };
    await writeManifest(stagingRoot, manifest);

    // ── Create archive ─────────────────────────────────────────────────
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await tar.c({ gzip: true, file: outputPath, cwd: tempDir }, [ARCHIVE_ROOT_DIR]);

    const stat = await fs.stat(outputPath);
    const sizeMB = (stat.size / (1024 * 1024)).toFixed(1);
    runtime.log(`\nExported to ${outputPath} (${sizeMB} MB)`);
    runtime.log(`Agents: ${agents.length > 0 ? agents.join(", ") : "(none)"}`);
    runtime.log(
      `Workspaces: ${stagedWorkspaceNames.length > 0 ? stagedWorkspaceNames.join(", ") : "(none)"}`,
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
