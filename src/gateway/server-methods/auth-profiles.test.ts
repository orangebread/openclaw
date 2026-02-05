import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { QWEN_CLI_PROFILE_ID } from "../../agents/auth-profiles/constants.js";
import { resetCliCredentialCachesForTest } from "../../agents/cli-credentials.js";
import { authProfilesHandlers } from "./auth-profiles.js";

function createRespondCapture() {
  const calls: Array<{ ok: boolean; payload?: unknown; error?: unknown }> = [];
  const respond = (ok: boolean, payload?: unknown, error?: unknown) => {
    calls.push({ ok, payload, error });
  };
  return { calls, respond };
}

describe("auth.profiles RPC", () => {
  it("supports get/upsertApiKey/delete with baseHash concurrency", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-auth-profiles-"));
    const prevAgentDir = process.env.OPENCLAW_AGENT_DIR;
    const prevPiAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.OPENCLAW_AGENT_DIR = tempDir;
    process.env.PI_CODING_AGENT_DIR = tempDir;
    try {
      {
        const { calls, respond } = createRespondCapture();
        await authProfilesHandlers["auth.profiles.get"]({ params: {}, respond } as any);
        expect(calls[0]?.ok).toBe(true);
        const payload = calls[0]?.payload as {
          exists?: boolean;
          baseHash?: string;
          profiles?: unknown[];
        };
        expect(payload.exists).toBe(false);
        expect(payload.baseHash).toBeUndefined();
        expect(Array.isArray(payload.profiles)).toBe(true);
      }

      let createdHash: string;
      {
        const { calls, respond } = createRespondCapture();
        await authProfilesHandlers["auth.profiles.upsertApiKey"]({
          params: {
            profileId: "anthropic:default",
            provider: "anthropic",
            apiKey: "sk-1234567890abcdef1234567890abcdef",
          },
          respond,
        } as any);
        expect(calls[0]?.ok).toBe(true);
        const payload = calls[0]?.payload as { baseHash?: string };
        expect(typeof payload.baseHash).toBe("string");
        createdHash = String(payload.baseHash);
      }

      let baseHash: string;
      {
        const { calls, respond } = createRespondCapture();
        await authProfilesHandlers["auth.profiles.get"]({ params: {}, respond } as any);
        expect(calls[0]?.ok).toBe(true);
        const payload = calls[0]?.payload as {
          exists?: boolean;
          baseHash?: string;
          profiles?: Array<{ id?: string; provider?: string; type?: string; preview?: string }>;
        };
        expect(payload.exists).toBe(true);
        expect(typeof payload.baseHash).toBe("string");
        baseHash = String(payload.baseHash);
        expect(baseHash).toBe(createdHash);
        expect(payload.profiles?.some((p) => p.id === "anthropic:default")).toBe(true);
        const profile = payload.profiles?.find((p) => p.id === "anthropic:default");
        expect(profile?.provider).toBe("anthropic");
        expect(profile?.type).toBe("api_key");
        expect(typeof profile?.preview).toBe("string");
        expect(profile?.preview).not.toContain("1234567890abcdef1234567890abcdef");
      }

      {
        const { calls, respond } = createRespondCapture();
        await authProfilesHandlers["auth.profiles.delete"]({
          params: { baseHash, profileId: "anthropic:default" },
          respond,
        } as any);
        expect(calls[0]?.ok).toBe(true);
      }
    } finally {
      process.env.OPENCLAW_AGENT_DIR = prevAgentDir;
      process.env.PI_CODING_AGENT_DIR = prevPiAgentDir;
    }
  });

  it("deletes external CLI profiles by disabling re-import", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-auth-profiles-"));
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-home-"));
    const prevAgentDir = process.env.OPENCLAW_AGENT_DIR;
    const prevPiAgentDir = process.env.PI_CODING_AGENT_DIR;
    const prevHome = process.env.HOME;
    process.env.OPENCLAW_AGENT_DIR = tempDir;
    process.env.PI_CODING_AGENT_DIR = tempDir;
    process.env.HOME = tempHome;
    resetCliCredentialCachesForTest();
    try {
      fs.mkdirSync(path.join(tempHome, ".qwen"), { recursive: true });
      fs.writeFileSync(
        path.join(tempHome, ".qwen", "oauth_creds.json"),
        JSON.stringify({
          access_token: "access",
          refresh_token: "refresh",
          expiry_date: Date.now() + 24 * 60 * 60 * 1000,
        }),
        "utf8",
      );
      resetCliCredentialCachesForTest();

      let baseHash: string;
      {
        const { calls, respond } = createRespondCapture();
        await authProfilesHandlers["auth.profiles.get"]({ params: {}, respond } as any);
        expect(calls[0]?.ok).toBe(true);
        const payload = calls[0]?.payload as {
          baseHash?: string;
          profiles?: Array<{ id?: string }>;
        };
        baseHash = String(payload.baseHash ?? "");
        expect(baseHash).toBeTruthy();
        expect(payload.profiles?.some((p) => p.id === QWEN_CLI_PROFILE_ID)).toBe(true);
      }

      {
        const { calls, respond } = createRespondCapture();
        await authProfilesHandlers["auth.profiles.delete"]({
          params: { baseHash, profileId: QWEN_CLI_PROFILE_ID },
          respond,
        } as any);
        expect(calls[0]?.ok).toBe(true);
      }

      resetCliCredentialCachesForTest();
      {
        const { calls, respond } = createRespondCapture();
        await authProfilesHandlers["auth.profiles.get"]({ params: {}, respond } as any);
        expect(calls[0]?.ok).toBe(true);
        const payload = calls[0]?.payload as { profiles?: Array<{ id?: string }> };
        expect(payload.profiles?.some((p) => p.id === QWEN_CLI_PROFILE_ID)).toBe(false);
      }
    } finally {
      process.env.OPENCLAW_AGENT_DIR = prevAgentDir;
      process.env.PI_CODING_AGENT_DIR = prevPiAgentDir;
      process.env.HOME = prevHome;
      resetCliCredentialCachesForTest();
    }
  });

  it("requires baseHash for mutations once the store exists", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-auth-profiles-"));
    const prevAgentDir = process.env.OPENCLAW_AGENT_DIR;
    const prevPiAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.OPENCLAW_AGENT_DIR = tempDir;
    process.env.PI_CODING_AGENT_DIR = tempDir;
    try {
      let baseHash: string;
      {
        const { calls, respond } = createRespondCapture();
        await authProfilesHandlers["auth.profiles.upsertApiKey"]({
          params: {
            profileId: "openai:default",
            provider: "openai",
            apiKey: "sk-test",
          },
          respond,
        } as any);
        expect(calls[0]?.ok).toBe(true);
      }
      {
        const { calls, respond } = createRespondCapture();
        await authProfilesHandlers["auth.profiles.get"]({ params: {}, respond } as any);
        expect(calls[0]?.ok).toBe(true);
        baseHash = String((calls[0]?.payload as { baseHash?: string })?.baseHash ?? "");
        expect(baseHash).toBeTruthy();
      }

      {
        const { calls, respond } = createRespondCapture();
        await authProfilesHandlers["auth.profiles.upsertApiKey"]({
          params: {
            profileId: "openai:default",
            provider: "openai",
            apiKey: "sk-test",
          },
          respond,
        } as any);
        expect(calls[0]?.ok).toBe(false);
        const err = calls[0]?.error as { message?: string } | undefined;
        expect(String(err?.message ?? "")).toContain("auth base hash required");
      }

      {
        const { calls, respond } = createRespondCapture();
        await authProfilesHandlers["auth.profiles.upsertApiKey"]({
          params: {
            baseHash: "wrong-hash",
            profileId: "openai:default",
            provider: "openai",
            apiKey: "sk-test",
          },
          respond,
        } as any);
        expect(calls[0]?.ok).toBe(false);
        const err = calls[0]?.error as { message?: string } | undefined;
        expect(String(err?.message ?? "")).toContain("auth store changed since last load");
      }

      // sanity: correct baseHash still works
      {
        const { calls, respond } = createRespondCapture();
        await authProfilesHandlers["auth.profiles.upsertApiKey"]({
          params: {
            baseHash,
            profileId: "openai:default",
            provider: "openai",
            apiKey: "sk-test",
          },
          respond,
        } as any);
        expect(calls[0]?.ok).toBe(true);
      }
    } finally {
      process.env.OPENCLAW_AGENT_DIR = prevAgentDir;
      process.env.PI_CODING_AGENT_DIR = prevPiAgentDir;
    }
  });

  it("returns baseHash when legacy auth.json is migrated during get", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-auth-profiles-"));
    const prevAgentDir = process.env.OPENCLAW_AGENT_DIR;
    const prevPiAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.OPENCLAW_AGENT_DIR = tempDir;
    process.env.PI_CODING_AGENT_DIR = tempDir;
    try {
      fs.writeFileSync(
        path.join(tempDir, "auth.json"),
        JSON.stringify(
          {
            openai: {
              type: "api_key",
              provider: "openai",
              key: "sk-legacy",
            },
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );

      const { calls, respond } = createRespondCapture();
      await authProfilesHandlers["auth.profiles.get"]({ params: {}, respond } as any);
      expect(calls[0]?.ok).toBe(true);
      const payload = calls[0]?.payload as {
        exists?: boolean;
        baseHash?: string;
        profiles?: Array<{ id?: string; provider?: string; type?: string; preview?: string }>;
      };
      expect(payload.exists).toBe(true);
      expect(typeof payload.baseHash).toBe("string");
      expect(payload.profiles?.some((p) => p.id === "openai:default")).toBe(true);
      const migrated = payload.profiles?.find((p) => p.id === "openai:default");
      expect(migrated?.provider).toBe("openai");
      expect(migrated?.type).toBe("api_key");
      expect(typeof migrated?.preview).toBe("string");
      expect(migrated?.preview).not.toContain("sk-legacy");
    } finally {
      process.env.OPENCLAW_AGENT_DIR = prevAgentDir;
      process.env.PI_CODING_AGENT_DIR = prevPiAgentDir;
    }
  });
});
