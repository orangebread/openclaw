import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { OpenClawConfig } from "../../config/config.js";
import type { GatewayRequestHandlers } from "./types.js";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../../agents/agent-scope.js";
import { normalizeLegacyConfigValues } from "../../commands/doctor-legacy-config.js";
import { readConfigFileSnapshot, writeConfigFile } from "../../config/config.js";
import { PLUGIN_MANIFEST_FILENAME } from "../../plugins/manifest.js";
import { resolveConfigDir, resolveUserPath } from "../../utils.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateDoctorFixParams,
  validateDoctorPlanParams,
} from "../protocol/index.js";

const EXTENSION_FILE_EXTS = new Set([".ts", ".js", ".mjs", ".cjs", ".mts", ".cts"]);

function isLikelyPluginDir(dir: string): boolean {
  try {
    if (fs.existsSync(path.join(dir, "package.json"))) {
      return true;
    }
    const indexCandidates = [
      "index.ts",
      "index.js",
      "index.mjs",
      "index.cjs",
      "index.mts",
      "index.cts",
    ];
    if (indexCandidates.some((candidate) => fs.existsSync(path.join(dir, candidate)))) {
      return true;
    }
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      const ext = path.extname(entry.name);
      if (EXTENSION_FILE_EXTS.has(ext) && !entry.name.endsWith(".d.ts")) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

async function listBrokenExtensionDirs(extensionsDir: string): Promise<string[]> {
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(extensionsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const broken: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const rootDir = path.join(extensionsDir, entry.name);
    const manifestPath = path.join(rootDir, PLUGIN_MANIFEST_FILENAME);
    if (fs.existsSync(manifestPath)) {
      continue;
    }
    if (!isLikelyPluginDir(rootDir)) {
      continue;
    }
    broken.push(rootDir);
  }
  return broken;
}

function buildWorkspaceExtensionsDir(cfg: OpenClawConfig): string | null {
  try {
    const workspaceDir = resolveAgentWorkspaceDir(cfg, resolveDefaultAgentId(cfg));
    if (!workspaceDir?.trim()) {
      return null;
    }
    const resolved = resolveUserPath(workspaceDir);
    return path.join(resolved, ".openclaw", "extensions");
  } catch {
    return null;
  }
}

async function buildDoctorPlan(): Promise<{
  issues: Array<{
    code: string;
    level: "error" | "warn";
    message: string;
    source?: string;
    fixable: boolean;
    fixHint?: string;
  }>;
  brokenDirs: string[];
  missingLoadPaths: string[];
  configSnapshot: Awaited<ReturnType<typeof readConfigFileSnapshot>>;
}> {
  const snapshot = await readConfigFileSnapshot();
  const cfg = snapshot.config ?? {};
  const issues: Array<{
    code: string;
    level: "error" | "warn";
    message: string;
    source?: string;
    fixable: boolean;
    fixHint?: string;
  }> = [];

  if (snapshot.exists && !snapshot.valid) {
    const count = snapshot.issues.length;
    const issuesTail = snapshot.issues
      .slice(0, 8)
      .map((issue) => `- ${issue.path}: ${issue.message}`)
      .join("\n");
    issues.push({
      code: "config.invalid",
      level: "error",
      message: `Config is invalid (${count} issue${count === 1 ? "" : "s"}). Fix in the Config tab, then retry.`,
      source: snapshot.path,
      fixable: false,
      fixHint: issuesTail || undefined,
    });
  }

  const legacy = normalizeLegacyConfigValues(cfg);
  if (snapshot.valid && legacy.changes.length > 0) {
    issues.push({
      code: "config.legacy.values",
      level: "warn",
      message:
        "Legacy channel DM config keys detected (Slack/Discord). Click Fix to migrate to dmPolicy/allowFrom.",
      source: snapshot.path,
      fixable: true,
      fixHint: legacy.changes
        .slice(0, 8)
        .map((line) => `- ${line}`)
        .join("\n"),
    });
  }

  const rawLoadPaths = Array.isArray(cfg.plugins?.load?.paths) ? cfg.plugins?.load?.paths : [];
  const missingLoadPaths = rawLoadPaths
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean)
    .filter((entry) => !fs.existsSync(resolveUserPath(entry)));
  for (const entry of missingLoadPaths) {
    const resolved = resolveUserPath(entry);
    issues.push({
      code: "plugins.load.paths.missing",
      level: "error",
      message: `Plugin load path not found: ${resolved}`,
      source: entry,
      fixable: snapshot.valid,
      fixHint: snapshot.valid ? "Remove missing entry from plugins.load.paths" : "Fix config first",
    });
  }

  const globalExtensionsDir = path.join(resolveConfigDir(), "extensions");
  const workspaceExtensionsDir = buildWorkspaceExtensionsDir(cfg);
  const brokenDirs = [
    ...(await listBrokenExtensionDirs(globalExtensionsDir)),
    ...(workspaceExtensionsDir ? await listBrokenExtensionDirs(workspaceExtensionsDir) : []),
  ];
  for (const dir of brokenDirs) {
    issues.push({
      code: "plugins.extensions.broken",
      level: "error",
      message: `Broken plugin install detected (missing ${PLUGIN_MANIFEST_FILENAME}): ${dir}`,
      source: dir,
      fixable: true,
      fixHint: "Move broken plugin directory out of the extensions folder",
    });
  }

  return { issues, brokenDirs, missingLoadPaths, configSnapshot: snapshot };
}

async function moveToBackup(params: { backupDir: string; sourceDir: string }): Promise<void> {
  const dst = path.join(params.backupDir, path.basename(params.sourceDir));
  await fsp.mkdir(params.backupDir, { recursive: true });
  try {
    await fsp.rename(params.sourceDir, dst);
  } catch {
    await fsp.cp(params.sourceDir, dst, { recursive: true });
    await fsp.rm(params.sourceDir, { recursive: true, force: true });
  }
}

export const doctorHandlers: GatewayRequestHandlers = {
  "doctor.plan": async ({ params, respond }) => {
    if (!validateDoctorPlanParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid doctor.plan params: ${formatValidationErrors(validateDoctorPlanParams.errors)}`,
        ),
      );
      return;
    }

    const plan = await buildDoctorPlan();
    respond(
      true,
      {
        ok: true,
        issues: plan.issues,
        fixAvailable: plan.issues.some((issue) => issue.fixable),
      },
      undefined,
    );
  },
  "doctor.fix": async ({ params, respond }) => {
    if (!validateDoctorFixParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid doctor.fix params: ${formatValidationErrors(validateDoctorFixParams.errors)}`,
        ),
      );
      return;
    }

    const plan = await buildDoctorPlan();
    const snapshot = plan.configSnapshot;
    let cfg = structuredClone(snapshot.config ?? {});

    const fixed: typeof plan.issues = [];
    let configChanged = false;
    let fsChanged = false;
    let backupDir: string | undefined;

    if (snapshot.valid) {
      const legacy = normalizeLegacyConfigValues(cfg);
      if (legacy.changes.length > 0) {
        cfg = legacy.config;
        configChanged = true;
        for (const change of legacy.changes) {
          fixed.push({
            code: "config.legacy.values",
            level: "warn",
            message: change,
            source: snapshot.path,
            fixable: true,
            fixHint: "Migrated",
          });
        }
      }
    }

    if (snapshot.valid && plan.missingLoadPaths.length > 0) {
      const current = Array.isArray(cfg.plugins?.load?.paths) ? cfg.plugins?.load?.paths : [];
      const normalized = current
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter(Boolean);
      const filtered = normalized.filter((entry) => !plan.missingLoadPaths.includes(entry));
      if (filtered.length !== normalized.length) {
        cfg.plugins = {
          ...cfg.plugins,
          load: {
            ...cfg.plugins?.load,
            paths: filtered,
          },
        };
        configChanged = true;
        for (const entry of plan.missingLoadPaths) {
          const resolved = resolveUserPath(entry);
          fixed.push({
            code: "plugins.load.paths.missing",
            level: "error",
            message: `Removed missing plugin load path: ${resolved}`,
            source: entry,
            fixable: true,
            fixHint: "Removed",
          });
        }
      }
    }

    if (plan.brokenDirs.length > 0) {
      const timestamp = new Date().toISOString().replaceAll(":", "-");
      backupDir = path.join(resolveConfigDir(), "doctor-backups", "extensions", timestamp);
      for (const dir of plan.brokenDirs) {
        await moveToBackup({ backupDir, sourceDir: dir });
        fixed.push({
          code: "plugins.extensions.broken",
          level: "error",
          message: `Moved broken plugin directory to backup: ${dir}`,
          source: dir,
          fixable: true,
          fixHint: backupDir,
        });
      }
      fsChanged = true;
    }

    if (configChanged) {
      if (!snapshot.valid) {
        respond(
          false,
          {
            ok: false,
            changed: false,
            fixed: [],
            restartRequired: false,
            error: "Config is invalid; fix config before applying doctor fixes.",
          },
          errorShape(ErrorCodes.INVALID_REQUEST, "config invalid; fix before doctor.fix"),
        );
        return;
      }
      await writeConfigFile(cfg);
    }

    const changed = configChanged || fsChanged;

    respond(
      true,
      {
        ok: true,
        changed,
        fixed,
        restartRequired: changed ? true : undefined,
        backupDir,
      },
      undefined,
    );
  },
};
