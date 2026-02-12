import { describe, expect, it } from "vitest";
import type { AuthFlowSessionApi } from "../auth-flow-session.js";
import type { GatewayClient, GatewayRequestContext } from "./types.js";
import { createAuthFlowSessionTracker } from "../server-auth-flow-sessions.js";
import { authFlowHandlers } from "./auth-flow.js";

function createRespondCapture() {
  const calls: Array<{ ok: boolean; payload?: unknown; error?: unknown }> = [];
  const respond = (ok: boolean, payload?: unknown, error?: unknown) => {
    calls.push({ ok, payload, error });
  };
  return { calls, respond };
}

describe("auth.flow RPC ownership", () => {
  it("hides sessionId from non-owner and blocks next/cancel", async () => {
    const tracker = createAuthFlowSessionTracker();
    const context = {
      authFlowSessions: tracker.authFlowSessions,
      findRunningAuthFlow: tracker.findRunningAuthFlow,
      purgeAuthFlowSession: tracker.purgeAuthFlowSession,
      authFlowResolver: async () => {
        return async (api: AuthFlowSessionApi) => {
          await api.text({ message: "Secret", sensitive: true });
          return { profiles: [] };
        };
      },
    } as unknown as GatewayRequestContext;

    const ownerClient = { connect: { device: { id: "dev-owner" } } } as unknown as GatewayClient;
    const otherClient = { connect: { device: { id: "dev-other" } } } as unknown as GatewayClient;

    {
      const { calls, respond } = createRespondCapture();
      await authFlowHandlers["auth.flow.start"]({
        params: { providerId: "test", methodId: "mock", mode: "remote" },
        respond,
        context,
        client: ownerClient,
      });
      expect(calls[0]?.ok).toBe(true);
      const payload = calls[0]?.payload as { sessionId?: string; step?: { id?: string } };
      expect(typeof payload.sessionId).toBe("string");
      expect(payload.step?.id).toBeTruthy();
    }

    const sessionId = tracker.findRunningAuthFlow();
    expect(typeof sessionId).toBe("string");

    {
      const { calls, respond } = createRespondCapture();
      await authFlowHandlers["auth.flow.current"]({
        params: {},
        respond,
        context,
        client: otherClient,
      });
      expect(calls[0]?.ok).toBe(true);
      expect(calls[0]?.payload).toEqual({ running: true, owned: false });
    }

    {
      const { calls, respond } = createRespondCapture();
      await authFlowHandlers["auth.flow.current"]({
        params: {},
        respond,
        context,
        client: ownerClient,
      });
      expect(calls[0]?.ok).toBe(true);
      const payload = calls[0]?.payload as {
        running?: boolean;
        owned?: boolean;
        sessionId?: string;
      };
      expect(payload.running).toBe(true);
      expect(payload.owned).toBe(true);
      expect(payload.sessionId).toBe(sessionId);
    }

    {
      const { calls, respond } = createRespondCapture();
      await authFlowHandlers["auth.flow.next"]({
        params: { sessionId },
        respond,
        context,
        client: otherClient,
      });
      expect(calls[0]?.ok).toBe(false);
    }

    {
      const { calls, respond } = createRespondCapture();
      await authFlowHandlers["auth.flow.cancelCurrent"]({
        params: {},
        respond,
        context,
        client: otherClient,
      });
      expect(calls[0]?.ok).toBe(false);
    }
  });
});
