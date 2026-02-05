import { describe, expect, it } from "vitest";
import { authFlowHandlers } from "./auth-flow.js";

function createRespondCapture() {
  const calls: Array<{ ok: boolean; payload?: unknown; error?: unknown }> = [];
  const respond = (ok: boolean, payload?: unknown, error?: unknown) => {
    calls.push({ ok, payload, error });
  };
  return { calls, respond };
}

describe("auth.flow.list", () => {
  it("includes Anthropic OAuth as a built-in auth method", async () => {
    const { calls, respond } = createRespondCapture();
    await authFlowHandlers["auth.flow.list"]({ params: {}, respond } as any);
    expect(calls[0]?.ok).toBe(true);

    const payload = calls[0]?.payload as { quickConnect?: any[]; providers?: any[] };
    const providers = Array.isArray(payload?.providers) ? payload.providers : [];
    const quickConnect = Array.isArray(payload?.quickConnect) ? payload.quickConnect : [];

    const anthropic = providers.find((p) => p?.providerId === "anthropic");
    expect(anthropic).toBeTruthy();
    expect(Array.isArray(anthropic?.methods)).toBe(true);
    expect(
      anthropic?.methods?.some((m: any) => m?.methodId === "oauth" && m?.kind === "oauth"),
    ).toBe(true);

    expect(quickConnect.some((m) => m?.providerId === "anthropic" && m?.methodId === "oauth")).toBe(
      true,
    );
  });
});
