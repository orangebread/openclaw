import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadJsonFile, saveJsonFile } from "./json-file.js";

export type WorkflowApprovalDecision = "approve" | "deny" | "expired";

export type WorkflowApprovalRequestPayload = {
  kind: string;
  title: string;
  summary?: string | null;
  details?: Record<string, string> | null;
  agentId?: string | null;
  sessionKey?: string | null;
};

export type WorkflowApprovalRecord = {
  id: string;
  idempotencyKey?: string | null;
  request: WorkflowApprovalRequestPayload;
  createdAtMs: number;
  expiresAtMs: number;
  resolvedAtMs?: number;
  decision?: WorkflowApprovalDecision | null;
  resolvedBy?: string | null;
};

export type WorkflowApprovalsFile = {
  version: 1;
  pending: WorkflowApprovalRecord[];
  resolved?: WorkflowApprovalRecord[];
};

const DEFAULT_FILE = "~/.openclaw/workflow-approvals.json";

function expandHome(value: string): string {
  if (!value) {
    return value;
  }
  if (value === "~") {
    return os.homedir();
  }
  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function ensureDir(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function resolveWorkflowApprovalsPath(): string {
  return expandHome(DEFAULT_FILE);
}

export function normalizeWorkflowApprovalsFile(file: WorkflowApprovalsFile): WorkflowApprovalsFile {
  const pending = Array.isArray(file.pending) ? file.pending : [];
  const resolved = Array.isArray(file.resolved) ? file.resolved : undefined;
  return {
    version: 1,
    pending,
    resolved,
  };
}

export function ensureWorkflowApprovalsFile(filePath = resolveWorkflowApprovalsPath()) {
  const resolvedPath = expandHome(filePath);
  if (fs.existsSync(resolvedPath)) {
    return;
  }
  ensureDir(resolvedPath);
  saveJsonFile(resolvedPath, normalizeWorkflowApprovalsFile({ version: 1, pending: [] }));
  try {
    fs.chmodSync(resolvedPath, 0o600);
  } catch {
    // best-effort
  }
}

export function readWorkflowApprovalsFile(
  filePath = resolveWorkflowApprovalsPath(),
): WorkflowApprovalsFile {
  const resolvedPath = expandHome(filePath);
  const loaded = loadJsonFile(resolvedPath);
  if (!loaded || typeof loaded !== "object") {
    return normalizeWorkflowApprovalsFile({ version: 1, pending: [] });
  }
  const parsed = loaded as Partial<WorkflowApprovalsFile>;
  if (parsed.version !== 1) {
    return normalizeWorkflowApprovalsFile({ version: 1, pending: [] });
  }
  return normalizeWorkflowApprovalsFile(parsed as WorkflowApprovalsFile);
}

export function writeWorkflowApprovalsFile(
  file: WorkflowApprovalsFile,
  filePath = resolveWorkflowApprovalsPath(),
) {
  const resolvedPath = expandHome(filePath);
  ensureDir(resolvedPath);
  saveJsonFile(resolvedPath, normalizeWorkflowApprovalsFile(file));
  try {
    fs.chmodSync(resolvedPath, 0o600);
  } catch {
    // best-effort
  }
}

export function newWorkflowApprovalId(): string {
  return crypto.randomUUID();
}
