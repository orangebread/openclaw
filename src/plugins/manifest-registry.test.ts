import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PluginCandidate } from "./discovery.js";
import { loadPluginManifestRegistry } from "./manifest-registry.js";

const tempDirs: string[] = [];
const EMPTY_PLUGIN_SCHEMA = { type: "object", additionalProperties: false, properties: {} };

function makeTempDir() {
  const dir = path.join(os.tmpdir(), `openclaw-plugin-${randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

function writeManifest(dir: string, id: string) {
  fs.writeFileSync(
    path.join(dir, "openclaw.plugin.json"),
    JSON.stringify(
      {
        id,
        configSchema: EMPTY_PLUGIN_SCHEMA,
      },
      null,
      2,
    ),
    "utf-8",
  );
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures
    }
  }
});

describe("loadPluginManifestRegistry", () => {
  it("does not warn about duplicate ids for disabled-by-default candidates", () => {
    const pluginId = "msteams";
    const globalDir = makeTempDir();
    const bundledDir = makeTempDir();
    writeManifest(globalDir, pluginId);
    writeManifest(bundledDir, pluginId);

    const candidates: PluginCandidate[] = [
      {
        idHint: pluginId,
        source: path.join(globalDir, "index.ts"),
        rootDir: globalDir,
        origin: "global",
      },
      {
        idHint: pluginId,
        source: path.join(bundledDir, "index.ts"),
        rootDir: bundledDir,
        origin: "bundled",
      },
    ];

    const registry = loadPluginManifestRegistry({
      config: {},
      candidates,
      diagnostics: [],
      cache: false,
    });

    expect(
      registry.diagnostics.some(
        (d) => d.level === "warn" && d.message.includes("duplicate plugin id"),
      ),
    ).toBe(false);
  });

  it("warns about duplicate ids when the later candidate would be enabled", () => {
    const pluginId = "msteams";
    const globalDir = makeTempDir();
    const bundledDir = makeTempDir();
    writeManifest(globalDir, pluginId);
    writeManifest(bundledDir, pluginId);

    const candidates: PluginCandidate[] = [
      {
        idHint: pluginId,
        source: path.join(globalDir, "index.ts"),
        rootDir: globalDir,
        origin: "global",
      },
      {
        idHint: pluginId,
        source: path.join(bundledDir, "index.ts"),
        rootDir: bundledDir,
        origin: "bundled",
      },
    ];

    const registry = loadPluginManifestRegistry({
      config: {
        plugins: {
          entries: {
            [pluginId]: {
              enabled: true,
            },
          },
        },
      },
      candidates,
      diagnostics: [],
      cache: false,
    });

    expect(
      registry.diagnostics.some(
        (d) => d.level === "warn" && d.message.includes("duplicate plugin id"),
      ),
    ).toBe(true);
  });
});
