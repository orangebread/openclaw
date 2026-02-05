import { describe, expect, it } from "vitest";
import { createWizardSessionTracker } from "../server-wizard-sessions.js";
import { wizardHandlers } from "./wizard.js";

function createRespondCapture() {
  const calls: Array<{ ok: boolean; payload?: unknown; error?: unknown }> = [];
  const respond = (ok: boolean, payload?: unknown, error?: unknown) => {
    calls.push({ ok, payload, error });
  };
  return { calls, respond };
}

describe("wizard RPC ownership", () => {
  it("hides sessionId from non-owner and blocks status/next/cancel", async () => {
    const tracker = createWizardSessionTracker();
    const context = {
      wizardSessions: tracker.wizardSessions,
      findRunningWizard: tracker.findRunningWizard,
      purgeWizardSession: tracker.purgeWizardSession,
      wizardRunner: async (_opts: unknown, _runtime: unknown, prompter: any) => {
        await prompter.text({ message: "Secret", sensitive: true });
      },
    } as any;

    const ownerClient = { connect: { device: { id: "dev-owner" } } } as any;
    const otherClient = { connect: { device: { id: "dev-other" } } } as any;

    {
      const { calls, respond } = createRespondCapture();
      await wizardHandlers["wizard.start"]({
        params: {},
        respond,
        context,
        client: ownerClient,
      });
      expect(calls[0]?.ok).toBe(true);
      const payload = calls[0]?.payload as { sessionId?: string; step?: { id?: string } };
      expect(typeof payload.sessionId).toBe("string");
    }

    const sessionId = tracker.findRunningWizard();
    expect(typeof sessionId).toBe("string");

    {
      const { calls, respond } = createRespondCapture();
      await wizardHandlers["wizard.current"]({
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
      await wizardHandlers["wizard.current"]({
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
      await wizardHandlers["wizard.status"]({
        params: { sessionId },
        respond,
        context,
        client: otherClient,
      });
      expect(calls[0]?.ok).toBe(false);
    }

    {
      const { calls, respond } = createRespondCapture();
      await wizardHandlers["wizard.cancel"]({
        params: { sessionId },
        respond,
        context,
        client: otherClient,
      });
      expect(calls[0]?.ok).toBe(false);
    }
  });
});
