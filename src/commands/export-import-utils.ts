import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

export const MANIFEST_VERSION = 1 as const;
export const MANIFEST_FILENAME = "manifest.json";
export const ARCHIVE_ROOT_DIR = "openclaw-export";

export type ExportManifest = {
  version: typeof MANIFEST_VERSION;
  exportedAt: string;
  openclawVersion: string;
  platform: string;
  homeDir: string;
  stateDir: string;
  profile: string | undefined;
  contents: {
    config: boolean;
    workspaces: string[];
    agents: string[];
    credentials: boolean;
    sessions: boolean;
    approvals: boolean;
    cron: boolean;
    identity: boolean;
  };
};

export async function writeManifest(dir: string, manifest: ExportManifest): Promise<void> {
  await fs.writeFile(path.join(dir, MANIFEST_FILENAME), JSON.stringify(manifest, null, 2));
}

export async function readManifest(dir: string): Promise<ExportManifest> {
  const raw = await fs.readFile(path.join(dir, MANIFEST_FILENAME), "utf-8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const version = parsed.version;
  if (version !== MANIFEST_VERSION) {
    throw new Error(
      `Unsupported manifest version ${String(version)} (expected ${String(MANIFEST_VERSION)})`,
    );
  }
  return parsed as ExportManifest;
}

// ---------------------------------------------------------------------------
// Transient directories to skip during export
// ---------------------------------------------------------------------------

/** Top-level state-dir children that are transient / cache / derived. */
export const TRANSIENT_DIRS = new Set([
  "logs",
  "media",
  "browser",
  "canvas",
  "sandbox",
  "completions",
]);

/** Per-agent subdirectories to skip. */
export const TRANSIENT_AGENT_SUBDIRS = new Set(["qmd"]);

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

export function normalizePathForArchive(absPath: string, homeDir: string): string {
  if (absPath === homeDir) {
    return "~";
  }
  if (absPath.startsWith(`${homeDir}/`) || absPath.startsWith(`${homeDir}${path.sep}`)) {
    return `~${absPath.slice(homeDir.length)}`;
  }
  return absPath;
}

export function denormalizePath(normalized: string, targetHomeDir: string): string {
  if (normalized === "~") {
    return targetHomeDir;
  }
  if (normalized.startsWith("~/") || normalized.startsWith(`~${path.sep}`)) {
    return path.join(targetHomeDir, normalized.slice(2));
  }
  return normalized;
}

/**
 * Rewrite absolute home-dir paths in config text.
 * Works at string level so JSON5 comments and formatting are preserved.
 */
export function rewriteConfigPaths(
  configText: string,
  sourceHome: string,
  targetHome: string,
): string {
  if (sourceHome === targetHome) {
    return configText;
  }
  // Replace both forward-slash and native-sep variants
  let result = configText.replaceAll(`${sourceHome}/`, `${targetHome}/`);
  if (path.sep !== "/") {
    result = result.replaceAll(`${sourceHome}${path.sep}`, `${targetHome}${path.sep}`);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

export async function dirExists(dir: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dir);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

export async function makeTempDir(prefix = "openclaw-export-"): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

/**
 * Copy a directory or file into a staging directory, creating parent dirs as needed.
 * Returns true if the source existed and was copied.
 */
export async function stageEntry(source: string, destDir: string, name: string): Promise<boolean> {
  const dest = path.join(destDir, name);
  try {
    const stat = await fs.stat(source);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    if (stat.isDirectory()) {
      await fs.cp(source, dest, { recursive: true });
    } else {
      await fs.copyFile(source, dest);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Stage the state directory, skipping transient top-level dirs and per-agent transient subdirs.
 */
export async function stageStateDir(
  stateDir: string,
  stagingStateDir: string,
): Promise<{ agents: string[] }> {
  const agents: string[] = [];
  const entries = await fs.readdir(stateDir, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    const name = entry.name as unknown as string;
    // Skip transient dirs
    if (TRANSIENT_DIRS.has(name)) {
      continue;
    }
    // Skip config file (handled separately) and backups
    if (name.startsWith("openclaw.json")) {
      continue;
    }
    // Skip workspace dirs (handled separately)
    if (name.startsWith("workspace")) {
      continue;
    }

    const srcPath = path.join(stateDir, name);
    const destPath = path.join(stagingStateDir, name);

    if (name === "agents" && entry.isDirectory()) {
      // Walk agents individually so we can skip qmd/ per agent
      await stageAgentsDir(srcPath, destPath, agents);
    } else if (entry.isDirectory()) {
      await fs.cp(srcPath, destPath, { recursive: true });
    } else {
      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await fs.copyFile(srcPath, destPath);
    }
  }

  return { agents };
}

async function stageAgentsDir(
  agentsSrc: string,
  agentsDest: string,
  agentIds: string[],
): Promise<void> {
  const agentEntries = await fs.readdir(agentsSrc, { withFileTypes: true }).catch(() => []);

  for (const agentEntry of agentEntries) {
    if (!agentEntry.isDirectory()) {
      continue;
    }
    const agentName = agentEntry.name as unknown as string;
    agentIds.push(agentName);
    const agentSrc = path.join(agentsSrc, agentName);
    const agentDest = path.join(agentsDest, agentName);

    // Walk agent subdirectories, skipping transient ones
    const agentSubEntries = await fs.readdir(agentSrc, { withFileTypes: true }).catch(() => []);

    for (const sub of agentSubEntries) {
      const subName = sub.name as unknown as string;
      if (TRANSIENT_AGENT_SUBDIRS.has(subName)) {
        continue;
      }
      const subSrc = path.join(agentSrc, subName);
      const subDest = path.join(agentDest, subName);
      if (sub.isDirectory()) {
        await fs.cp(subSrc, subDest, { recursive: true });
      } else {
        await fs.mkdir(agentDest, { recursive: true });
        await fs.copyFile(subSrc, subDest);
      }
    }
  }
}
