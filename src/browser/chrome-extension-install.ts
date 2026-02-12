import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STATE_DIR } from "../config/paths.js";
import { movePathToTrash } from "./trash.js";

function hasManifest(dir: string) {
  return fs.existsSync(path.join(dir, "manifest.json"));
}

export function resolveBundledChromeExtensionRootDir(
  here = path.dirname(fileURLToPath(import.meta.url)),
) {
  let current = here;
  while (true) {
    const candidate = path.join(current, "assets", "chrome-extension");
    if (hasManifest(candidate)) {
      return candidate;
    }
    const candidateDist = path.join(current, "dist", "assets", "chrome-extension");
    if (hasManifest(candidateDist)) {
      return candidateDist;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return path.resolve(here, "../../assets/chrome-extension");
}

export function resolveInstalledChromeExtensionRootDir(stateDir = STATE_DIR) {
  return path.join(stateDir, "browser", "chrome-extension");
}

export function resolveChromeExtensionInstallStatus(opts?: { stateDir?: string }): {
  installed: boolean;
  path: string;
} {
  const dir = resolveInstalledChromeExtensionRootDir(opts?.stateDir);
  return {
    installed: hasManifest(dir),
    path: dir,
  };
}

export async function installChromeExtension(opts?: {
  stateDir?: string;
  sourceDir?: string;
}): Promise<{ path: string }> {
  const src = opts?.sourceDir ?? resolveBundledChromeExtensionRootDir();
  if (!hasManifest(src)) {
    throw new Error("Bundled Chrome extension is missing. Reinstall OpenClaw and try again.");
  }

  const stateDir = opts?.stateDir ?? STATE_DIR;
  const dest = resolveInstalledChromeExtensionRootDir(stateDir);
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  if (fs.existsSync(dest)) {
    await movePathToTrash(dest).catch(() => {
      const backup = `${dest}.old-${Date.now()}`;
      fs.renameSync(dest, backup);
    });
  }

  await fs.promises.cp(src, dest, { recursive: true });
  if (!hasManifest(dest)) {
    throw new Error("Chrome extension install failed (manifest.json missing). Try again.");
  }

  return { path: dest };
}
