import { describe, expect, it } from "vitest";
import type { AuthProfileStore } from "./auth-profiles/types.js";
import { isEnvSatisfiedByAuthStore, resolveProvidersForEnvVar } from "./model-auth.js";

describe("resolveProvidersForEnvVar", () => {
  it("maps standard env vars to their provider", () => {
    expect(resolveProvidersForEnvVar("GEMINI_API_KEY")).toContain("google");
    expect(resolveProvidersForEnvVar("OPENAI_API_KEY")).toContain("openai");
    expect(resolveProvidersForEnvVar("VOYAGE_API_KEY")).toContain("voyage");
    expect(resolveProvidersForEnvVar("MISTRAL_API_KEY")).toContain("mistral");
  });

  it("maps special-case env vars to their provider", () => {
    expect(resolveProvidersForEnvVar("ANTHROPIC_API_KEY")).toContain("anthropic");
    expect(resolveProvidersForEnvVar("ANTHROPIC_OAUTH_TOKEN")).toContain("anthropic");
    expect(resolveProvidersForEnvVar("COPILOT_GITHUB_TOKEN")).toContain("github-copilot");
    expect(resolveProvidersForEnvVar("GH_TOKEN")).toContain("github-copilot");
    expect(resolveProvidersForEnvVar("KIMI_API_KEY")).toContain("kimi-coding");
    expect(resolveProvidersForEnvVar("KIMICODE_API_KEY")).toContain("kimi-coding");
  });

  it("maps MINIMAX_API_KEY to both minimax and minimax-portal", () => {
    const providers = resolveProvidersForEnvVar("MINIMAX_API_KEY");
    expect(providers).toContain("minimax");
    expect(providers).toContain("minimax-portal");
  });

  it("returns empty array for unknown env vars", () => {
    expect(resolveProvidersForEnvVar("TOTALLY_UNKNOWN_KEY")).toEqual([]);
    expect(resolveProvidersForEnvVar("")).toEqual([]);
  });
});

function makeStore(profiles: Record<string, { provider: string }>): AuthProfileStore {
  const normalized: AuthProfileStore["profiles"] = {};
  for (const [id, { provider }] of Object.entries(profiles)) {
    normalized[id] = { type: "api_key", provider, key: "test-key" };
  }
  return { version: 1, profiles: normalized };
}

describe("isEnvSatisfiedByAuthStore", () => {
  it("returns true when the auth store has a matching provider profile", () => {
    const store = makeStore({ "google:default": { provider: "google" } });
    expect(isEnvSatisfiedByAuthStore("GEMINI_API_KEY", store)).toBe(true);
  });

  it("returns false when the auth store has no matching provider", () => {
    const store = makeStore({ "openai:default": { provider: "openai" } });
    expect(isEnvSatisfiedByAuthStore("GEMINI_API_KEY", store)).toBe(false);
  });

  it("returns false for an empty auth store", () => {
    const store: AuthProfileStore = { version: 1, profiles: {} };
    expect(isEnvSatisfiedByAuthStore("GEMINI_API_KEY", store)).toBe(false);
  });

  it("returns false for an unknown env var name", () => {
    const store = makeStore({ "google:default": { provider: "google" } });
    expect(isEnvSatisfiedByAuthStore("UNKNOWN_KEY", store)).toBe(false);
  });

  it("matches special-case providers (anthropic)", () => {
    const store = makeStore({ "anthropic:default": { provider: "anthropic" } });
    expect(isEnvSatisfiedByAuthStore("ANTHROPIC_API_KEY", store)).toBe(true);
    expect(isEnvSatisfiedByAuthStore("ANTHROPIC_OAUTH_TOKEN", store)).toBe(true);
  });

  it("matches when MINIMAX_API_KEY is satisfied by minimax-portal profile", () => {
    const store = makeStore({ "minimax-portal:default": { provider: "minimax-portal" } });
    expect(isEnvSatisfiedByAuthStore("MINIMAX_API_KEY", store)).toBe(true);
  });
});
