import { describe, expect, it, vi } from "vitest";
import type { GatewayBrowserClient } from "../gateway.js";
import {
  applyKnowledgeBaseLocalEmbeddingPreset,
  loadKnowledgeBase,
  loadKnowledgeBaseEmbeddingSettings,
  openReviewQueue,
  saveKnowledgeBaseEmbeddingSettings,
  selectKnowledgeBaseFile,
  updateKnowledgeBaseEmbeddingSettings,
  type KnowledgeBaseState,
} from "./knowledge-base.js";

function createState(overrides: Partial<KnowledgeBaseState> = {}): KnowledgeBaseState {
  return {
    client: null,
    connected: true,
    sessionKey: "main",
    agentsList: {
      defaultId: "main",
      mainKey: "main",
      scope: "single",
      agents: [],
    },
    kbLoading: false,
    kbError: null,
    kbEntries: { notes: [], links: [], review: [] },
    kbReadLoading: false,
    kbReadError: null,
    kbReadResult: null,
    kbSelectedPath: null,
    kbActiveView: "browse",
    kbReviewQueueList: [],
    kbEmbeddingSettingsLoading: false,
    kbEmbeddingSettingsSaving: false,
    kbEmbeddingSettingsError: null,
    kbEmbeddingSettingsNotice: null,
    kbEmbeddingSettings: {
      provider: "auto",
      fallback: "none",
      localModelPath: "",
    },
    ...overrides,
  };
}

describe("knowledge base controller", () => {
  it("loads trees for notes/links/review", async () => {
    const request = vi.fn(async (method: string, params: Record<string, unknown>) => {
      if (method !== "workspace.list") {
        throw new Error(`unexpected method: ${method}`);
      }
      const dir = typeof params.dir === "string" ? params.dir : "";
      return {
        dir,
        cursor: null,
        entries: dir === "notes" ? [{ path: "notes/a.md", kind: "file", modifiedAtMs: 0 }] : [],
      };
    });

    const state = createState({
      client: { request } as unknown as GatewayBrowserClient,
    });

    await loadKnowledgeBase(state);
    expect(state.kbLoading).toBe(false);
    expect(state.kbEntries.notes.map((e) => e.path)).toEqual(["notes/a.md"]);
    expect(state.kbEntries.links).toEqual([]);
    expect(state.kbEntries.review).toEqual([]);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("reads file on selection", async () => {
    const request = vi.fn(async (method: string, params: Record<string, unknown>) => {
      if (method !== "workspace.read") {
        throw new Error(`unexpected method: ${method}`);
      }
      return {
        path: typeof params.path === "string" ? params.path : "",
        contentType: "text/markdown",
        truncated: false,
        content: "# Hello\n",
      };
    });

    const state = createState({ client: { request } as unknown as GatewayBrowserClient });
    await selectKnowledgeBaseFile(state, "notes/a.md");
    expect(state.kbSelectedPath).toBe("notes/a.md");
    expect(state.kbReadResult?.content).toContain("Hello");
  });

  it("opens Review Queue (QUEUE.md when present)", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "workspace.read") {
        return {
          path: "review/QUEUE.md",
          contentType: "text/markdown",
          truncated: false,
          content: "Queue\n",
        };
      }
      throw new Error("unexpected");
    });

    const state = createState({ client: { request } as unknown as GatewayBrowserClient });
    await openReviewQueue(state);
    expect(state.kbActiveView).toBe("review-queue");
    expect(state.kbReadResult?.path).toBe("review/QUEUE.md");
    expect(state.kbReviewQueueList).toEqual([]);
  });

  it("falls back to review/*.md list when QUEUE.md missing", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "workspace.read") {
        throw new Error("not found");
      }
      if (method === "workspace.list") {
        return {
          dir: "review",
          cursor: null,
          entries: [
            { path: "review/b.md", kind: "file", modifiedAtMs: 0 },
            { path: "review/a.md", kind: "file", modifiedAtMs: 0 },
            { path: "review/sub", kind: "dir", modifiedAtMs: 0 },
          ],
        };
      }
      throw new Error("unexpected");
    });

    const state = createState({ client: { request } as unknown as GatewayBrowserClient });
    await openReviewQueue(state);
    expect(state.kbReadResult).toBe(null);
    expect(state.kbReviewQueueList).toEqual(["review/a.md", "review/b.md"]);
  });

  it("loads embedding settings from config", async () => {
    const request = vi.fn(async (method: string) => {
      if (method !== "config.get") {
        throw new Error("unexpected");
      }
      return {
        exists: true,
        hash: "abc",
        valid: true,
        config: {
          agents: {
            defaults: {
              memorySearch: {
                provider: "local",
                fallback: "none",
                local: {
                  modelPath: "hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf",
                },
              },
            },
          },
        },
      };
    });

    const state = createState({ client: { request } as unknown as GatewayBrowserClient });
    await loadKnowledgeBaseEmbeddingSettings(state);
    expect(state.kbEmbeddingSettings.provider).toBe("local");
    expect(state.kbEmbeddingSettings.fallback).toBe("none");
    expect(state.kbEmbeddingSettings.localModelPath).toContain("embeddinggemma");
  });

  it("updates embedding draft fields locally", () => {
    const state = createState();
    updateKnowledgeBaseEmbeddingSettings(state, { provider: "local" });
    expect(state.kbEmbeddingSettings.provider).toBe("local");
    applyKnowledgeBaseLocalEmbeddingPreset(state);
    expect(state.kbEmbeddingSettings.provider).toBe("local");
    expect(state.kbEmbeddingSettings.fallback).toBe("none");
  });

  it("saves embedding settings via config.patch", async () => {
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "config.get") {
        return {
          exists: true,
          hash: "base-hash",
          valid: true,
          config: {},
        };
      }
      if (method === "config.patch") {
        return { ok: true, params };
      }
      throw new Error(`unexpected method: ${method}`);
    });

    const state = createState({
      client: { request } as unknown as GatewayBrowserClient,
      kbEmbeddingSettings: {
        provider: "local",
        fallback: "none",
        localModelPath: "/models/embedding.gguf",
      },
    });
    await saveKnowledgeBaseEmbeddingSettings(state);
    expect(state.kbEmbeddingSettingsNotice).toContain("Gateway restart scheduled");

    const patchCall = request.mock.calls.find((entry) => entry[0] === "config.patch");
    expect(patchCall).toBeTruthy();
    const payload = patchCall?.[1] as { raw?: string } | undefined;
    expect(payload?.raw).toContain('"provider": "local"');
    expect(payload?.raw).toContain('"modelPath": "/models/embedding.gguf"');
  });
});
