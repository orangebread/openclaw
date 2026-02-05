import { describe, expect, it, vi } from "vitest";
import { loadKnowledgeBase, openReviewQueue, selectKnowledgeBaseFile, type KnowledgeBaseState } from "./knowledge-base";

function createState(overrides: Partial<KnowledgeBaseState> = {}): KnowledgeBaseState {
  return {
    client: null,
    connected: true,
    sessionKey: "main",
    agentsList: { defaultId: "main", agents: [] } as any,
    kbLoading: false,
    kbError: null,
    kbEntries: { notes: [], links: [], review: [] },
    kbReadLoading: false,
    kbReadError: null,
    kbReadResult: null,
    kbSelectedPath: null,
    kbActiveView: "browse",
    kbReviewQueueList: [],
    ...overrides,
  };
}

describe("knowledge base controller", () => {
  it("loads trees for notes/links/review", async () => {
    const request = vi.fn(async (method: string, params: Record<string, unknown>) => {
      if (method !== "workspace.list") throw new Error(`unexpected method: ${method}`);
      const dir = String(params?.dir ?? "");
      return {
        dir,
        cursor: null,
        entries: dir === "notes" ? [{ path: "notes/a.md", kind: "file", modifiedAtMs: 0 }] : [],
      };
    });

    const state = createState({
      client: { request } as any,
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
      if (method !== "workspace.read") throw new Error(`unexpected method: ${method}`);
      return {
        path: String(params.path ?? ""),
        contentType: "text/markdown",
        truncated: false,
        content: "# Hello\n",
      };
    });

    const state = createState({ client: { request } as any });
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

    const state = createState({ client: { request } as any });
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

    const state = createState({ client: { request } as any });
    await openReviewQueue(state);
    expect(state.kbReadResult).toBe(null);
    expect(state.kbReviewQueueList).toEqual(["review/a.md", "review/b.md"]);
  });
});
