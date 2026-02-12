import { describe, expect, it, vi } from "vitest";
import type { GatewayBrowserClient } from "../gateway.js";
import {
  advanceCredentialsAuthFlow,
  advanceCredentialsWizard,
  cancelCurrentCredentialsAuthFlow,
  confirmDeleteCredentialsProfile,
  openCredentialsAuthFlowUrl,
  requestDeleteCredentialsProfile,
  loadCredentials,
  startCredentialsAuthFlow,
  resumeCredentialsWizard,
  startCredentialsWizard,
  upsertCredentialsApiKeyProfile,
  type CredentialsState,
} from "./credentials.js";

function createState(overrides?: Partial<CredentialsState>): CredentialsState {
  return {
    client: null,
    connected: true,
    credentialsLoading: false,
    credentialsError: null,
    credentialsBaseHash: null,
    credentialsProfiles: [],
    credentialsSaving: false,
    credentialsSuccess: null,
    credentialsDisconnectDialog: null,
    credentialsApiKeyForm: { profileId: "", provider: "", email: "", apiKey: "" },
    credentialsAuthFlowLoading: false,
    credentialsAuthFlowError: null,
    credentialsAuthFlowList: null,
    credentialsAuthFlowBusy: false,
    credentialsAuthFlowRunning: false,
    credentialsAuthFlowOwned: false,
    credentialsAuthFlowSessionId: null,
    credentialsAuthFlowStep: null,
    credentialsAuthFlowAnswer: null,
    credentialsAuthFlowResult: null,
    credentialsAuthFlowApplyError: null,
    credentialsAuthFlowProviderId: null,
    credentialsAuthFlowMethodId: null,
    credentialsAuthFlowHadProviderProfilesBefore: false,
    credentialsAuthFlowPendingDefaultModel: null,
    credentialsWizardBusy: false,
    credentialsWizardError: null,
    credentialsWizardRunning: false,
    credentialsWizardOwned: false,
    credentialsWizardSessionId: null,
    credentialsWizardStep: null,
    credentialsWizardAnswer: null,
    ...overrides,
  };
}

describe("credentials controller", () => {
  it("loads auth profiles and baseHash", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "auth.profiles.get") {
        return {
          baseHash: "hash-1",
          exists: true,
          profiles: [
            { id: "openai:default", provider: "openai", type: "api_key", preview: "sk-••••" },
          ],
        };
      }
      if (method === "auth.flow.list") {
        return { quickConnect: [], providers: [] };
      }
      if (method === "auth.flow.current") {
        return { running: false };
      }
      if (method === "wizard.current") {
        return { running: false };
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const state = createState({ client: { request } as unknown as GatewayBrowserClient });
    await loadCredentials(state);
    expect(state.credentialsBaseHash).toBe("hash-1");
    expect(state.credentialsProfiles.map((profile) => profile.id)).toEqual(["openai:default"]);
  });

  it("clears apiKey after failed upsert", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "auth.profiles.upsertApiKey") {
        throw new Error("auth store changed since last load; re-run auth.profiles.get and retry");
      }
      if (method === "wizard.current") {
        return { running: false };
      }
      if (method === "auth.flow.list") {
        return { quickConnect: [], providers: [] };
      }
      if (method === "auth.flow.current") {
        return { running: false };
      }
      if (method === "auth.profiles.get") {
        return { exists: true, profiles: [], baseHash: "hash-1" };
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const state = createState({
      client: { request } as unknown as GatewayBrowserClient,
      credentialsBaseHash: "hash-1",
      credentialsApiKeyForm: {
        profileId: "openai:default",
        provider: "openai",
        email: "",
        apiKey: "sk-test",
      },
    });
    await upsertCredentialsApiKeyProfile(state);
    expect(state.credentialsApiKeyForm.apiKey).toBe("");
    expect(state.credentialsError).toContain("auth store changed");
  });

  it("starts and advances wizard steps without persisting secrets", async () => {
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "wizard.start") {
        return {
          sessionId: "sess-1",
          done: false,
          status: "running",
          step: { id: "step-1", type: "text", message: "Secret", sensitive: true },
        };
      }
      if (method === "wizard.next") {
        const answer = params?.answer as { stepId?: string } | undefined;
        if (answer?.stepId !== "step-1") {
          throw new Error("unexpected stepId");
        }
        return { done: true, status: "done" };
      }
      if (method === "wizard.current") {
        return { running: false };
      }
      if (method === "auth.flow.list") {
        return { quickConnect: [], providers: [] };
      }
      if (method === "auth.flow.current") {
        return { running: false };
      }
      if (method === "auth.profiles.get") {
        return { exists: true, profiles: [], baseHash: "hash-1" };
      }
      if (method === "wizard.cancelCurrent") {
        return { cancelled: true };
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const state = createState({ client: { request } as unknown as GatewayBrowserClient });
    await startCredentialsWizard(state);
    expect(state.credentialsWizardRunning).toBe(true);
    expect(state.credentialsWizardStep?.type).toBe("text");
    state.credentialsWizardAnswer = "super-secret";
    await advanceCredentialsWizard(state);
    expect(state.credentialsWizardRunning).toBe(false);
    expect(state.credentialsWizardStep).toBeNull();
    expect(state.credentialsWizardAnswer).toBeNull();
  });

  it("resumes wizard via wizard.current and wizard.next", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "wizard.current") {
        return { running: true, owned: true, sessionId: "sess-2" };
      }
      if (method === "wizard.next") {
        return {
          done: false,
          status: "running",
          step: { id: "step-2", type: "note", title: "Hello", message: "Welcome" },
        };
      }
      if (method === "auth.flow.list") {
        return { quickConnect: [], providers: [] };
      }
      if (method === "auth.flow.current") {
        return { running: false };
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const state = createState({ client: { request } as unknown as GatewayBrowserClient });
    await resumeCredentialsWizard(state);
    expect(state.credentialsWizardRunning).toBe(true);
    expect(state.credentialsWizardOwned).toBe(true);
    expect(state.credentialsWizardSessionId).toBe("sess-2");
    expect(state.credentialsWizardStep?.id).toBe("step-2");
  });

  it("retries delete once on baseHash mismatch", async () => {
    let deleteCalls = 0;
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "auth.profiles.delete") {
        deleteCalls += 1;
        if (deleteCalls === 1) {
          throw new Error("auth store changed since last load; re-run auth.profiles.get and retry");
        }
        expect(params?.baseHash).toBe("hash-2");
        expect(params?.profileId).toBe("openai:default");
        return { baseHash: "hash-3" };
      }
      if (method === "auth.profiles.get") {
        return { exists: true, profiles: [], baseHash: "hash-2" };
      }
      if (method === "config.get") {
        return { valid: false };
      }
      if (method === "wizard.current") {
        return { running: false };
      }
      if (method === "auth.flow.list") {
        return { quickConnect: [], providers: [] };
      }
      if (method === "auth.flow.current") {
        return { running: false };
      }
      throw new Error(`unexpected method: ${method}`);
    });

    const state = createState({
      client: { request } as unknown as GatewayBrowserClient,
      credentialsBaseHash: "hash-1",
      credentialsProfiles: [
        { id: "openai:default", provider: "openai", type: "api_key", preview: "sk-••••" },
      ],
    });

    await requestDeleteCredentialsProfile(state, "openai:default");
    await confirmDeleteCredentialsProfile(state, "openai:default");
    expect(deleteCalls).toBe(2);
    expect(state.credentialsProfiles).toEqual([]);
  });

  it("refreshes credentials after delete even if a load is in-flight", async () => {
    let resolveFirstGet!: (value: unknown) => void;
    const firstGet = new Promise<unknown>((resolve) => {
      resolveFirstGet = resolve;
    });

    let getCalls = 0;
    const request = vi.fn(async (method: string) => {
      if (method === "auth.profiles.get") {
        getCalls += 1;
        if (getCalls === 1) {
          return await firstGet;
        }
        return { exists: true, profiles: [], baseHash: "hash-2" };
      }
      if (method === "wizard.current") {
        return { running: false };
      }
      if (method === "auth.flow.list") {
        return { quickConnect: [], providers: [] };
      }
      if (method === "auth.flow.current") {
        return { running: false };
      }
      if (method === "auth.profiles.delete") {
        return { baseHash: "hash-1" };
      }
      if (method === "config.get") {
        return { valid: false };
      }
      throw new Error(`unexpected method: ${method}`);
    });

    const state = createState({
      client: { request } as unknown as GatewayBrowserClient,
      credentialsBaseHash: "hash-1",
      credentialsProfiles: [
        { id: "openai:default", provider: "openai", type: "api_key", preview: "sk-••••" },
      ],
    });

    const loadPromise = loadCredentials(state);
    const deletePromise = (async () => {
      await requestDeleteCredentialsProfile(state, "openai:default");
      await confirmDeleteCredentialsProfile(state, "openai:default");
    })();

    resolveFirstGet({
      exists: true,
      profiles: [{ id: "openai:default", provider: "openai", type: "api_key", preview: "sk-••••" }],
      baseHash: "hash-1",
    });

    await loadPromise;
    await deletePromise;
    expect(getCalls).toBe(2);
    expect(state.credentialsProfiles).toEqual([]);
  });

  it("starts and completes auth flow and applies config patch", async () => {
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "auth.flow.start") {
        expect(params?.providerId).toBe("openai-codex");
        return {
          sessionId: "flow-1",
          done: false,
          status: "running",
          step: { id: "step-1", type: "text", message: "Paste secret", sensitive: true },
        };
      }
      if (method === "auth.flow.next") {
        expect(params?.sessionId).toBe("flow-1");
        const answer = params?.answer as { stepId?: string } | undefined;
        expect(answer?.stepId).toBe("step-1");
        return {
          done: true,
          status: "done",
          result: {
            profiles: [{ id: "openai-codex:default", provider: "openai-codex", type: "oauth" }],
            defaultModel: "openai-codex/gpt-5.2",
            configPatch: { agents: { defaults: { model: { primary: "openai-codex/gpt-5.2" } } } },
          },
        };
      }
      if (method === "config.get") {
        return { exists: true, hash: "cfg-1", valid: true, raw: "{ }", config: {} };
      }
      if (method === "config.patch") {
        expect(params?.baseHash).toBe("cfg-1");
        expect(String(params?.raw)).toContain("openai-codex/gpt-5.2");
        return { ok: true };
      }
      if (method === "auth.flow.current") {
        return { running: false };
      }
      if (method === "auth.flow.list") {
        return { quickConnect: [], providers: [] };
      }
      if (method === "wizard.current") {
        return { running: false };
      }
      if (method === "auth.profiles.get") {
        return { exists: true, profiles: [], baseHash: "hash-1" };
      }
      throw new Error(`unexpected method: ${method}`);
    });

    const state = createState({ client: { request } as unknown as GatewayBrowserClient });
    await startCredentialsAuthFlow(state, {
      providerId: "openai-codex",
      methodId: "oauth",
      mode: "remote",
    });
    expect(state.credentialsAuthFlowRunning).toBe(true);
    state.credentialsAuthFlowAnswer = "super-secret";
    await advanceCredentialsAuthFlow(state);
    expect(state.credentialsAuthFlowRunning).toBe(false);
    expect(state.credentialsAuthFlowStep).toBeNull();
    expect(state.credentialsAuthFlowAnswer).toBeNull();
    expect(state.credentialsAuthFlowResult?.defaultModel).toBe("openai-codex/gpt-5.2");
    expect(state.credentialsAuthFlowApplyError).toBeNull();
  });

  it("auto-advances oauth note steps", async () => {
    vi.useFakeTimers();
    try {
      const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
        if (method === "auth.flow.start") {
          return {
            sessionId: "flow-note",
            done: false,
            status: "running",
            step: { id: "note-1", type: "note", message: "OAuth intro" },
          };
        }
        if (method === "auth.flow.next") {
          expect(params?.sessionId).toBe("flow-note");
          const answer = params?.answer as { stepId?: string; value?: unknown } | undefined;
          expect(answer?.stepId).toBe("note-1");
          expect(answer?.value).toBe(true);
          return {
            done: false,
            status: "running",
            step: { id: "text-1", type: "text", message: "Paste callback URL", sensitive: true },
          };
        }
        throw new Error(`unexpected method: ${method}`);
      });

      const state = createState({ client: { request } as unknown as GatewayBrowserClient });
      await startCredentialsAuthFlow(state, {
        providerId: "openai-codex",
        methodId: "oauth",
        mode: "remote",
      });
      expect(state.credentialsAuthFlowStep?.id).toBe("note-1");

      await vi.runAllTimersAsync();
      expect(state.credentialsAuthFlowStep?.id).toBe("text-1");
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens oauth URL in pre-opened popup and closes it after completion", async () => {
    vi.useFakeTimers();
    const popup = {
      closed: false,
      focus: vi.fn(),
      close: vi.fn(),
      location: { assign: vi.fn() },
      document: {
        title: "",
        body: { innerHTML: "" },
      },
    } as unknown as Window;
    const openSpy = vi.spyOn(window, "open").mockReturnValue(popup);
    try {
      const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
        if (method === "auth.flow.start") {
          return {
            sessionId: "flow-open",
            done: false,
            status: "running",
            step: { id: "open-1", type: "openUrl", url: "https://example.com/oauth" },
          };
        }
        if (method === "auth.flow.next") {
          expect(params?.sessionId).toBe("flow-open");
          const answer = params?.answer as { stepId?: string; value?: unknown } | undefined;
          expect(answer?.stepId).toBe("open-1");
          expect(answer?.value).toBe(true);
          return {
            done: true,
            status: "done",
            result: { profiles: [] },
          };
        }
        if (method === "auth.profiles.get") {
          return { exists: true, profiles: [], baseHash: "hash-1" };
        }
        if (method === "auth.flow.list") {
          return { quickConnect: [], providers: [] };
        }
        if (method === "auth.flow.current") {
          return { running: false };
        }
        if (method === "wizard.current") {
          return { running: false };
        }
        throw new Error(`unexpected method: ${method}`);
      });

      const state = createState({ client: { request } as unknown as GatewayBrowserClient });
      await startCredentialsAuthFlow(state, {
        providerId: "openai-codex",
        methodId: "oauth",
        mode: "local",
      });
      expect(openSpy).toHaveBeenCalledWith("", "_blank");
      expect(state.credentialsAuthFlowStep?.id).toBe("open-1");

      await vi.runAllTimersAsync();
      expect(popup.location.assign).toHaveBeenCalledWith("https://example.com/oauth");
      expect(popup.close).toHaveBeenCalled();
      expect(state.credentialsAuthFlowRunning).toBe(false);
    } finally {
      openSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("opens URL and advances from manual open-url action", async () => {
    const popup = {
      closed: false,
      focus: vi.fn(),
      close: vi.fn(),
    } as unknown as Window;
    const openSpy = vi.spyOn(window, "open").mockReturnValue(popup);
    try {
      const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
        if (method === "auth.flow.next") {
          expect(params?.sessionId).toBe("flow-manual");
          return { done: true, status: "done", result: { profiles: [] } };
        }
        if (method === "auth.profiles.get") {
          return { exists: true, profiles: [], baseHash: "hash-1" };
        }
        if (method === "auth.flow.list") {
          return { quickConnect: [], providers: [] };
        }
        if (method === "auth.flow.current") {
          return { running: false };
        }
        if (method === "wizard.current") {
          return { running: false };
        }
        throw new Error(`unexpected method: ${method}`);
      });
      const state = createState({
        client: { request } as unknown as GatewayBrowserClient,
        credentialsAuthFlowRunning: true,
        credentialsAuthFlowOwned: true,
        credentialsAuthFlowSessionId: "flow-manual",
        credentialsAuthFlowMethodId: "oauth",
        credentialsAuthFlowStep: {
          id: "open-manual",
          type: "openUrl",
          url: "https://example.com/login",
        },
        credentialsAuthFlowAnswer: true,
      });

      await openCredentialsAuthFlowUrl(state, "https://example.com/login");
      expect(openSpy).toHaveBeenCalledWith("https://example.com/login", "_blank");
      expect(state.credentialsAuthFlowRunning).toBe(false);
    } finally {
      openSpy.mockRestore();
    }
  });

  it("cancels current auth flow", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "auth.flow.cancelCurrent") {
        return { cancelled: true };
      }
      if (method === "auth.flow.list") {
        return { quickConnect: [], providers: [] };
      }
      if (method === "auth.flow.current") {
        return { running: false };
      }
      if (method === "wizard.current") {
        return { running: false };
      }
      if (method === "auth.profiles.get") {
        return { exists: true, profiles: [], baseHash: "hash-1" };
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const state = createState({
      client: { request } as unknown as GatewayBrowserClient,
      credentialsAuthFlowRunning: true,
      credentialsAuthFlowOwned: true,
      credentialsAuthFlowSessionId: "flow-2",
      credentialsAuthFlowStep: { id: "step-2", type: "note", title: "Hi", message: "Hello" },
      credentialsAuthFlowAnswer: true,
    });
    await cancelCurrentCredentialsAuthFlow(state);
    expect(state.credentialsAuthFlowRunning).toBe(false);
    expect(state.credentialsAuthFlowStep).toBeNull();
  });
});
