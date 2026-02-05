import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

function createRespondCapture() {
  const calls: Array<{ ok: boolean; payload?: unknown; error?: unknown }> = [];
  const respond = (ok: boolean, payload?: unknown, error?: unknown) => {
    calls.push({ ok, payload, error });
  };
  return { calls, respond };
}

describe("agents.profile RPC", () => {
  it("loads config-derived agent profiles and updates with omit-on-inherit semantics", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-agent-profiles-"));
    const stateDir = path.join(tempDir, "state");
    const agentDir = path.join(stateDir, "agents", "main", "agent");
    const configPath = path.join(tempDir, "openclaw.json");

    const prevEnv = {
      OPENCLAW_CONFIG_PATH: process.env.OPENCLAW_CONFIG_PATH,
      OPENCLAW_STATE_DIR: process.env.OPENCLAW_STATE_DIR,
      OPENCLAW_AGENT_DIR: process.env.OPENCLAW_AGENT_DIR,
      PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
    };

    process.env.OPENCLAW_CONFIG_PATH = configPath;
    process.env.OPENCLAW_STATE_DIR = stateDir;
    process.env.OPENCLAW_AGENT_DIR = agentDir;
    process.env.PI_CODING_AGENT_DIR = agentDir;

    try {
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(
        configPath,
        JSON.stringify({ agents: { list: [{ id: "main" }] } }, null, 2) + "\n",
        "utf8",
      );
      fs.mkdirSync(agentDir, { recursive: true });
      fs.writeFileSync(
        path.join(agentDir, "auth-profiles.json"),
        JSON.stringify(
          {
            version: 1,
            profiles: {
              "openai:default": { type: "api_key", provider: "openai", key: "sk-test" },
              "anthropic:default": { type: "api_key", provider: "anthropic", key: "sk-test" },
            },
            usageStats: {},
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );

      const { agentProfilesHandlers } = await import("./agent-profiles.js");

      let baseHash: string;
      {
        const { calls, respond } = createRespondCapture();
        await agentProfilesHandlers["agents.profile.get"]({ params: {}, respond } as any);
        expect(calls[0]?.ok).toBe(true);
        const payload = calls[0]?.payload as { baseHash?: string; agents?: Array<{ id?: string }> };
        expect(Array.isArray(payload.agents)).toBe(true);
        expect(payload.agents?.some((a) => a.id === "main")).toBe(true);
        expect(typeof payload.baseHash).toBe("string");
        baseHash = String(payload.baseHash);
      }

      {
        const { calls, respond } = createRespondCapture();
        await agentProfilesHandlers["agents.profile.update"]({
          params: {
            baseHash,
            agentId: "main",
            set: {
              model: "openai/gpt-5-mini",
              authProfileId: "anthropic:default",
            },
          },
          respond,
        } as any);
        expect(calls[0]?.ok).toBe(false);
        const err = calls[0]?.error as { message?: string } | undefined;
        expect(String(err?.message ?? "")).toContain(
          'Auth profile "anthropic:default" is for provider',
        );
      }

      {
        const { calls, respond } = createRespondCapture();
        await agentProfilesHandlers["agents.profile.update"]({
          params: {
            baseHash,
            agentId: "main",
            set: {
              model: "openai/gpt-5-mini",
              authProfileId: "openai:default",
            },
          },
          respond,
        } as any);
        expect(calls[0]?.ok).toBe(true);
        const payload = calls[0]?.payload as {
          ok?: boolean;
          baseHash?: string;
          agent?: { authProfileId?: string };
        };
        expect(payload.ok).toBe(true);
        expect(typeof payload.baseHash).toBe("string");
        expect(payload.agent?.authProfileId).toBe("openai:default");
        baseHash = String(payload.baseHash);
      }

      {
        const { calls, respond } = createRespondCapture();
        await agentProfilesHandlers["agents.profile.update"]({
          params: {
            baseHash,
            agentId: "main",
            unset: ["model", "authProfileId"],
          },
          respond,
        } as any);
        expect(calls[0]?.ok).toBe(true);
        baseHash = String((calls[0]?.payload as { baseHash?: string })?.baseHash);
      }

      {
        const { calls, respond } = createRespondCapture();
        await agentProfilesHandlers["agents.profile.get"]({ params: {}, respond } as any);
        expect(calls[0]?.ok).toBe(true);
        const payload = calls[0]?.payload as {
          agents?: Array<{ id?: string; model?: unknown; authProfileId?: unknown }>;
        };
        const main = payload.agents?.find((a) => a.id === "main");
        expect(main).toBeTruthy();
        expect(main?.model).toBeUndefined();
        expect(main?.authProfileId).toBeUndefined();
      }
    } finally {
      process.env.OPENCLAW_CONFIG_PATH = prevEnv.OPENCLAW_CONFIG_PATH;
      process.env.OPENCLAW_STATE_DIR = prevEnv.OPENCLAW_STATE_DIR;
      process.env.OPENCLAW_AGENT_DIR = prevEnv.OPENCLAW_AGENT_DIR;
      process.env.PI_CODING_AGENT_DIR = prevEnv.PI_CODING_AGENT_DIR;
    }
  });

  it("prevents silent clobber when two updates race with the same baseHash", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-agent-profiles-"));
    const stateDir = path.join(tempDir, "state");
    const agentDir = path.join(stateDir, "agents", "main", "agent");
    const configPath = path.join(tempDir, "openclaw.json");

    const prevEnv = {
      OPENCLAW_CONFIG_PATH: process.env.OPENCLAW_CONFIG_PATH,
      OPENCLAW_STATE_DIR: process.env.OPENCLAW_STATE_DIR,
      OPENCLAW_AGENT_DIR: process.env.OPENCLAW_AGENT_DIR,
      PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
    };

    process.env.OPENCLAW_CONFIG_PATH = configPath;
    process.env.OPENCLAW_STATE_DIR = stateDir;
    process.env.OPENCLAW_AGENT_DIR = agentDir;
    process.env.PI_CODING_AGENT_DIR = agentDir;

    try {
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(
        configPath,
        JSON.stringify(
          {
            agents: {
              defaults: {
                model: { primary: "openai/gpt-5-mini" },
                imageModel: { primary: "openai/gpt-5-mini" },
              },
              list: [{ id: "main" }],
            },
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
      fs.mkdirSync(agentDir, { recursive: true });
      fs.writeFileSync(
        path.join(agentDir, "auth-profiles.json"),
        JSON.stringify(
          {
            version: 1,
            profiles: {
              "openai:default": { type: "api_key", provider: "openai", key: "sk-test" },
            },
            usageStats: {},
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );

      const { agentProfilesHandlers } = await import("./agent-profiles.js");

      let baseHash: string;
      {
        const { calls, respond } = createRespondCapture();
        await agentProfilesHandlers["agents.profile.get"]({ params: {}, respond } as any);
        expect(calls[0]?.ok).toBe(true);
        baseHash = String((calls[0]?.payload as { baseHash?: string })?.baseHash ?? "");
        expect(baseHash).toBeTruthy();
      }

      const update1 = (() => {
        const { calls, respond } = createRespondCapture();
        const task = agentProfilesHandlers["agents.profile.update"]({
          params: {
            baseHash,
            agentId: "main",
            set: { authProfileId: "openai:default" },
          },
          respond,
        } as any).then(() => calls);
        return task;
      })();

      const update2 = (() => {
        const { calls, respond } = createRespondCapture();
        const task = agentProfilesHandlers["agents.profile.update"]({
          params: {
            baseHash,
            agentId: "main",
            set: { imageAuthProfileId: "openai:default" },
          },
          respond,
        } as any).then(() => calls);
        return task;
      })();

      const [calls1, calls2] = await Promise.all([update1, update2]);
      const okCount = [calls1[0]?.ok, calls2[0]?.ok].filter(Boolean).length;
      expect(okCount).toBe(1);

      const failures = [calls1[0], calls2[0]].filter((c) => c && c.ok === false);
      expect(failures.length).toBe(1);
      const err = failures[0]?.error as { message?: string } | undefined;
      expect(String(err?.message ?? "")).toContain("config changed since last load");
    } finally {
      process.env.OPENCLAW_CONFIG_PATH = prevEnv.OPENCLAW_CONFIG_PATH;
      process.env.OPENCLAW_STATE_DIR = prevEnv.OPENCLAW_STATE_DIR;
      process.env.OPENCLAW_AGENT_DIR = prevEnv.OPENCLAW_AGENT_DIR;
      process.env.PI_CODING_AGENT_DIR = prevEnv.PI_CODING_AGENT_DIR;
    }
  });
});
