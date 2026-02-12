import { describe, expect, it } from "vitest";
import { authFlowHandlers } from "./auth-flow.js";

type AuthFlowListHandler = (typeof authFlowHandlers)["auth.flow.list"];
type AuthFlowListHandlerArgs = Parameters<AuthFlowListHandler>[0];

function createRespondCapture() {
  const calls: Array<{ ok: boolean; payload?: unknown; error?: unknown }> = [];
  const respond = (ok: boolean, payload?: unknown, error?: unknown) => {
    calls.push({ ok, payload, error });
  };
  return { calls, respond };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

describe("auth.flow.list", () => {
  it("includes Anthropic OAuth as a built-in auth method", async () => {
    const { calls, respond } = createRespondCapture();
    await authFlowHandlers["auth.flow.list"]({
      params: {},
      respond,
    } as unknown as AuthFlowListHandlerArgs);
    expect(calls[0]?.ok).toBe(true);

    const payload = (calls[0]?.payload ?? {}) as Record<string, unknown>;
    const providers = Array.isArray(payload.providers) ? payload.providers : [];
    const quickConnect = Array.isArray(payload.quickConnect) ? payload.quickConnect : [];

    const anthropic = providers.find(
      (p): p is Record<string, unknown> => isPlainRecord(p) && p.providerId === "anthropic",
    );
    expect(anthropic).toBeTruthy();
    expect(Array.isArray(anthropic?.methods)).toBe(true);
    const methods = Array.isArray(anthropic?.methods) ? anthropic.methods : [];
    expect(
      methods.some((m) => isPlainRecord(m) && m.methodId === "oauth" && m.kind === "oauth"),
    ).toBe(true);

    expect(
      quickConnect.some(
        (m) => isPlainRecord(m) && m.providerId === "anthropic" && m.methodId === "oauth",
      ),
    ).toBe(true);
  });

  const EXPECTED_BUILTIN_API_KEY_PROVIDERS = [
    "openrouter",
    "xai",
    "moonshot",
    "kimi-coding",
    "zai",
    "xiaomi",
    "synthetic",
    "venice",
    "together",
    "opencode",
    "vercel-ai-gateway",
    "qianfan",
    "cloudflare-ai-gateway",
  ];

  it.each(EXPECTED_BUILTIN_API_KEY_PROVIDERS)(
    "includes %s as a built-in provider with a custom flow method",
    async (providerId) => {
      const { calls, respond } = createRespondCapture();
      await authFlowHandlers["auth.flow.list"]({
        params: {},
        respond,
      } as unknown as AuthFlowListHandlerArgs);
      expect(calls[0]?.ok).toBe(true);

      const payload = (calls[0]?.payload ?? {}) as Record<string, unknown>;
      const providers = Array.isArray(payload.providers) ? payload.providers : [];
      const provider = providers.find(
        (p): p is Record<string, unknown> => isPlainRecord(p) && p.providerId === providerId,
      );
      expect(provider, `provider ${providerId} missing from auth.flow.list`).toBeTruthy();
      expect(Array.isArray(provider?.methods)).toBe(true);
      const methods = Array.isArray(provider?.methods) ? provider.methods : [];
      expect(
        methods.some((m) => isPlainRecord(m) && m.methodId === "api_key" && m.kind === "custom"),
        `provider ${providerId} missing custom api_key method`,
      ).toBe(true);
    },
  );

  it("returns all expected provider IDs in the provider list", async () => {
    const { calls, respond } = createRespondCapture();
    await authFlowHandlers["auth.flow.list"]({
      params: {},
      respond,
    } as unknown as AuthFlowListHandlerArgs);
    expect(calls[0]?.ok).toBe(true);

    const payload = (calls[0]?.payload ?? {}) as Record<string, unknown>;
    const providers = Array.isArray(payload.providers) ? payload.providers : [];
    const providerIds = providers
      .map((p) => (isPlainRecord(p) && typeof p.providerId === "string" ? p.providerId : ""))
      .filter(Boolean);

    // Core built-in providers (Quick Connect).
    expect(providerIds).toContain("openai-codex");
    expect(providerIds).toContain("anthropic");
    expect(providerIds).toContain("google");

    // All API-key providers.
    for (const id of EXPECTED_BUILTIN_API_KEY_PROVIDERS) {
      expect(providerIds, `missing provider: ${id}`).toContain(id);
    }
  });
});
