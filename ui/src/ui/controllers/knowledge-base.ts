import type { GatewayBrowserClient } from "../gateway";
import type { AgentsListResult, WorkspaceEntry, WorkspaceListResult, WorkspaceReadResult } from "../types";
import { parseAgentSessionKey } from "../../../../src/routing/session-key.js";

const KB_ROOTS = ["notes", "links", "review"] as const;
type KnowledgeBaseRoot = (typeof KB_ROOTS)[number];

export type KnowledgeBaseState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  sessionKey: string;
  agentsList: AgentsListResult | null;
  kbLoading: boolean;
  kbError: string | null;
  kbEntries: Record<KnowledgeBaseRoot, WorkspaceEntry[]>;
  kbReadLoading: boolean;
  kbReadError: string | null;
  kbReadResult: WorkspaceReadResult | null;
  kbSelectedPath: string | null;
  kbActiveView: "browse" | "review-queue";
  kbReviewQueueList: string[];
};

function resolveKnowledgeBaseAgentId(state: Pick<KnowledgeBaseState, "sessionKey" | "agentsList">) {
  const parsed = parseAgentSessionKey(state.sessionKey);
  return parsed?.agentId ?? state.agentsList?.defaultId ?? "main";
}

function toErrorMessage(err: unknown): string {
  const message = String((err as { message?: unknown } | null)?.message ?? err ?? "");
  return message || "Request failed.";
}

function isMissingError(message: string): boolean {
  const lowered = message.toLowerCase();
  return lowered.includes("not found") || lowered.includes("enoent");
}

export async function loadKnowledgeBase(state: KnowledgeBaseState) {
  if (!state.client || !state.connected) return;
  if (state.kbLoading) return;
  state.kbLoading = true;
  state.kbError = null;

  const agentId = resolveKnowledgeBaseAgentId(state);
  const nextEntries: Record<KnowledgeBaseRoot, WorkspaceEntry[]> = {
    notes: [],
    links: [],
    review: [],
  };
  const warnings: string[] = [];

  try {
    for (const root of KB_ROOTS) {
      try {
        const res = (await state.client.request("workspace.list", {
          agentId,
          dir: root,
          maxDepth: 4,
          includeHidden: false,
          maxEntries: 500,
          cursor: null,
        })) as WorkspaceListResult;
        nextEntries[root] = Array.isArray(res.entries) ? res.entries : [];
      } catch (err) {
        const message = toErrorMessage(err);
        if (!isMissingError(message)) {
          warnings.push(`${root}: ${message}`);
        }
        nextEntries[root] = [];
      }
    }

    state.kbEntries = nextEntries;
    state.kbError = warnings.length ? `Some folders could not be loaded: ${warnings.join("; ")}` : null;
  } finally {
    state.kbLoading = false;
  }
}

export async function selectKnowledgeBaseFile(state: KnowledgeBaseState, filePath: string) {
  if (!state.client || !state.connected) return;
  const path = filePath.trim();
  if (!path) return;
  state.kbActiveView = "browse";
  state.kbSelectedPath = path;
  state.kbReadLoading = true;
  state.kbReadError = null;
  state.kbReadResult = null;

  const agentId = resolveKnowledgeBaseAgentId(state);
  try {
    const res = (await state.client.request("workspace.read", {
      agentId,
      path,
      maxBytes: 200_000,
    })) as WorkspaceReadResult;
    state.kbReadResult = res;
  } catch (err) {
    state.kbReadError = toErrorMessage(err);
  } finally {
    state.kbReadLoading = false;
  }
}

export async function openReviewQueue(state: KnowledgeBaseState) {
  if (!state.client || !state.connected) return;
  state.kbActiveView = "review-queue";
  state.kbSelectedPath = null;
  state.kbReviewQueueList = [];
  state.kbReadLoading = true;
  state.kbReadError = null;
  state.kbReadResult = null;

  const agentId = resolveKnowledgeBaseAgentId(state);

  try {
    const res = (await state.client.request("workspace.read", {
      agentId,
      path: "review/QUEUE.md",
      maxBytes: 200_000,
    })) as WorkspaceReadResult;
    state.kbReadResult = res;
    return;
  } catch (err) {
    const message = toErrorMessage(err);
    if (!isMissingError(message)) {
      state.kbReadError = message;
      return;
    }
  } finally {
    state.kbReadLoading = false;
  }

  state.kbReadLoading = true;
  try {
    const list = (await state.client.request("workspace.list", {
      agentId,
      dir: "review",
      maxDepth: 0,
      includeHidden: false,
      maxEntries: 500,
      cursor: null,
    })) as WorkspaceListResult;
    const files = Array.isArray(list.entries) ? list.entries : [];
    state.kbReviewQueueList = files
      .filter((entry) => entry && entry.kind === "file" && entry.path.startsWith("review/"))
      .map((entry) => entry.path)
      .filter((p) => p.toLowerCase().endsWith(".md"))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  } catch (err) {
    state.kbReadError = toErrorMessage(err);
  } finally {
    state.kbReadLoading = false;
  }
}

