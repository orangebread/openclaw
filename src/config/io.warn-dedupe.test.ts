import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { withTempHome } from "./test-helpers.js";

async function writePluginFixture(params: { dir: string; id: string }) {
  await fs.mkdir(params.dir, { recursive: true });
  await fs.writeFile(
    path.join(params.dir, "index.js"),
    `export default { id: "${params.id}" };`,
    "utf-8",
  );
  await fs.writeFile(
    path.join(params.dir, "openclaw.plugin.json"),
    JSON.stringify({ id: params.id, configSchema: { type: "object" } }, null, 2),
    "utf-8",
  );
}

describe("config io", () => {
  it("deduplicates repeated config warnings when loading the same config", async () => {
    await withTempHome(async (home) => {
      const previousStateDir = process.env.OPENCLAW_STATE_DIR;
      try {
        const stateDir = path.join(home, ".openclaw");
        process.env.OPENCLAW_STATE_DIR = stateDir;
        await fs.mkdir(stateDir, { recursive: true });

        const pluginDir = path.join(home, "test-plugin");
        await writePluginFixture({ dir: pluginDir, id: "test-plugin" });

        const configPath = path.join(stateDir, "openclaw.json");
        await fs.writeFile(
          configPath,
          JSON.stringify(
            {
              agents: { list: [{ id: "pi" }] },
              plugins: {
                enabled: false,
                load: { paths: [pluginDir] },
                entries: { "test-plugin": { config: {} } },
              },
            },
            null,
            2,
          ),
          "utf-8",
        );

        vi.resetModules();
        const { createConfigIO } = await import("./io.js");
        const logger = {
          warn: vi.fn(),
          error: vi.fn(),
        };

        createConfigIO({ configPath, logger }).loadConfig();
        createConfigIO({ configPath, logger }).loadConfig();

        expect(logger.warn).toHaveBeenCalledTimes(1);
        expect(String(logger.warn.mock.calls[0]?.[0] ?? "")).toContain("Config warnings");
      } finally {
        if (previousStateDir === undefined) {
          delete process.env.OPENCLAW_STATE_DIR;
        } else {
          process.env.OPENCLAW_STATE_DIR = previousStateDir;
        }
      }
    });
  });
});
