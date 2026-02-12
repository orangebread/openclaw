import lockfile from "proper-lockfile";
import {
  ensureWorkflowApprovalsFile,
  newWorkflowApprovalId,
  readWorkflowApprovalsFile,
  resolveWorkflowApprovalsPath,
  type WorkflowApprovalDecision,
  type WorkflowApprovalRecord,
  type WorkflowApprovalRequestPayload,
  type WorkflowApprovalsFile,
  writeWorkflowApprovalsFile,
} from "../infra/workflow-approvals.js";

const WORKFLOW_APPROVALS_LOCK_OPTIONS = {
  retries: {
    retries: 10,
    factor: 2,
    minTimeout: 100,
    maxTimeout: 10_000,
    randomize: true,
  },
  stale: 30_000,
} as const;

const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const MAX_TIMEOUT_MS = 2 * 60 * 60_000;
const MAX_RESOLVED_HISTORY = 200;

type Waiter = (decision: WorkflowApprovalDecision | null) => void;

type PendingEntry = {
  waiters: Waiter[];
  timer: NodeJS.Timeout;
};

function clampTimeoutMs(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.max(1_000, Math.min(MAX_TIMEOUT_MS, Math.floor(raw)));
}

function normalizeIdempotencyKey(value?: string | null): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? trimmed : null;
}

function now() {
  return Date.now();
}

function pruneExpired(
  file: WorkflowApprovalsFile,
  ts = now(),
): { file: WorkflowApprovalsFile; changed: boolean } {
  if (!file.pending.length) {
    return { file, changed: false };
  }
  const stillPending: WorkflowApprovalRecord[] = [];
  const resolved: WorkflowApprovalRecord[] = Array.isArray(file.resolved)
    ? file.resolved.slice()
    : [];
  let changed = false;
  for (const rec of file.pending) {
    if (!rec || typeof rec !== "object") {
      changed = true;
      continue;
    }
    if (typeof rec.expiresAtMs === "number" && rec.expiresAtMs <= ts) {
      changed = true;
      resolved.push({
        ...rec,
        resolvedAtMs: ts,
        decision: "expired",
      });
      continue;
    }
    stillPending.push(rec);
  }
  if (!changed) {
    return { file, changed: false };
  }
  const capped =
    resolved.length > MAX_RESOLVED_HISTORY
      ? resolved.slice(resolved.length - MAX_RESOLVED_HISTORY)
      : resolved;
  return { file: { ...file, pending: stillPending, resolved: capped }, changed: true };
}

export class WorkflowApprovalManager {
  private filePath: string;
  private pending = new Map<string, PendingEntry>();

  constructor(opts?: { filePath?: string }) {
    this.filePath = opts?.filePath ?? resolveWorkflowApprovalsPath();
    ensureWorkflowApprovalsFile(this.filePath);
  }

  private async withLock<T>(
    fn: (
      file: WorkflowApprovalsFile,
    ) => Promise<{ file: WorkflowApprovalsFile; value: T; changed: boolean }>,
  ): Promise<T> {
    const lockPath = this.filePath;
    ensureWorkflowApprovalsFile(lockPath);
    const release = await lockfile.lock(lockPath, WORKFLOW_APPROVALS_LOCK_OPTIONS);
    try {
      const loaded = readWorkflowApprovalsFile(lockPath);
      const pruned = pruneExpired(loaded);
      const base = pruned.file;
      const res = await fn(base);
      const changed = res.changed || pruned.changed;
      if (changed) {
        writeWorkflowApprovalsFile(res.file, lockPath);
      }
      return res.value;
    } finally {
      await release();
    }
  }

  async listPending(): Promise<WorkflowApprovalRecord[]> {
    return await this.withLock(async (file) => {
      const pruned = pruneExpired(file);
      return { file: pruned.file, changed: pruned.changed, value: pruned.file.pending.slice() };
    });
  }

  async getPending(recordId: string): Promise<WorkflowApprovalRecord | null> {
    const id = recordId.trim();
    if (!id) {
      return null;
    }
    return await this.withLock(async (file) => {
      const pruned = pruneExpired(file);
      const record = pruned.file.pending.find((r) => r.id === id) ?? null;
      return { file: pruned.file, changed: pruned.changed, value: record };
    });
  }

  async request(params: {
    request: WorkflowApprovalRequestPayload;
    timeoutMs?: number;
    id?: string | null;
    idempotencyKey?: string | null;
  }): Promise<WorkflowApprovalRecord> {
    const timeoutMs = clampTimeoutMs(params.timeoutMs);
    const explicitId = typeof params.id === "string" && params.id.trim() ? params.id.trim() : null;
    const idempotencyKey = normalizeIdempotencyKey(params.idempotencyKey);
    const ts = now();
    const expiresAtMs = ts + timeoutMs;

    const record = await this.withLock(async (file) => {
      const pending = file.pending.slice();
      const existingByIdempotency = idempotencyKey
        ? pending.find((r) => (r.idempotencyKey ?? null) === idempotencyKey)
        : undefined;
      if (existingByIdempotency) {
        return { file, changed: false, value: existingByIdempotency };
      }

      if (explicitId && pending.some((r) => r.id === explicitId)) {
        throw new Error("approval id already pending");
      }

      const id = explicitId ?? newWorkflowApprovalId();
      const next: WorkflowApprovalRecord = {
        id,
        idempotencyKey,
        request: params.request,
        createdAtMs: ts,
        expiresAtMs,
      };
      pending.push(next);
      return { file: { ...file, pending }, changed: true, value: next };
    });

    this.ensurePendingTimer(record.id, record.expiresAtMs);
    return record;
  }

  async resolve(
    recordId: string,
    decision: WorkflowApprovalDecision,
    resolvedBy?: string | null,
  ): Promise<boolean> {
    const ts = now();
    const ok = await this.withLock(async (file) => {
      const idx = file.pending.findIndex((r) => r.id === recordId);
      if (idx < 0) {
        return { file, changed: false, value: false };
      }
      const record = file.pending[idx];
      if (!record) {
        return { file, changed: false, value: false };
      }
      const pending = file.pending.slice();
      pending.splice(idx, 1);
      const resolved = Array.isArray(file.resolved) ? file.resolved.slice() : [];
      resolved.push({
        ...record,
        resolvedAtMs: ts,
        decision,
        resolvedBy: resolvedBy ?? null,
      });
      const capped =
        resolved.length > MAX_RESOLVED_HISTORY
          ? resolved.slice(resolved.length - MAX_RESOLVED_HISTORY)
          : resolved;
      return { file: { ...file, pending, resolved: capped }, changed: true, value: true };
    });

    if (!ok) {
      return false;
    }
    this.settle(recordId, decision);
    return true;
  }

  async expire(recordId: string): Promise<void> {
    const ts = now();
    const didExpire = await this.withLock(async (file) => {
      const idx = file.pending.findIndex((r) => r.id === recordId);
      if (idx < 0) {
        return { file, changed: false, value: false };
      }
      const record = file.pending[idx];
      if (!record) {
        return { file, changed: false, value: false };
      }
      const pending = file.pending.slice();
      pending.splice(idx, 1);
      const resolved = Array.isArray(file.resolved) ? file.resolved.slice() : [];
      resolved.push({
        ...record,
        resolvedAtMs: ts,
        decision: "expired",
      });
      const capped =
        resolved.length > MAX_RESOLVED_HISTORY
          ? resolved.slice(resolved.length - MAX_RESOLVED_HISTORY)
          : resolved;
      return { file: { ...file, pending, resolved: capped }, changed: true, value: true };
    });
    if (didExpire) {
      this.settle(recordId, null);
    }
  }

  async waitForDecision(record: WorkflowApprovalRecord): Promise<WorkflowApprovalDecision | null> {
    const ts = now();
    const remaining = Math.max(0, record.expiresAtMs - ts);
    if (remaining <= 0) {
      await this.expire(record.id);
      return null;
    }

    const waiter = new Promise<WorkflowApprovalDecision | null>((resolve) => {
      const entry = this.pending.get(record.id);
      if (entry) {
        entry.waiters.push(resolve);
        return;
      }
      const timer = setTimeout(() => {
        void this.expire(record.id);
      }, remaining);
      this.pending.set(record.id, { waiters: [resolve], timer });
    });

    // Resolve-before-wait race guard: if the approval already moved out of pending
    // before a waiter attached, settle immediately with the persisted decision.
    void this.withLock<{ pending: boolean; decision: WorkflowApprovalDecision | null }>(
      async (file) => {
        const pruned = pruneExpired(file);
        if (pruned.file.pending.some((r) => r.id === record.id)) {
          return {
            file: pruned.file,
            changed: pruned.changed,
            value: { pending: true, decision: null },
          };
        }
        const resolvedList = Array.isArray(pruned.file.resolved) ? pruned.file.resolved : [];
        let decision: WorkflowApprovalDecision | null = null;
        for (let i = resolvedList.length - 1; i >= 0; i -= 1) {
          const resolved = resolvedList[i];
          if (resolved?.id === record.id) {
            decision = resolved.decision ?? null;
            break;
          }
        }
        return {
          file: pruned.file,
          changed: pruned.changed,
          value: { pending: false, decision },
        };
      },
    )
      .then((state) => {
        if (!state.pending) {
          this.settle(record.id, state.decision);
        }
      })
      .catch(() => {
        // ignore; waiter timeout/explicit resolve still apply
      });

    return await waiter;
  }

  private ensurePendingTimer(recordId: string, expiresAtMs: number) {
    if (this.pending.has(recordId)) {
      return;
    }
    const remaining = Math.max(0, expiresAtMs - now());
    const timer = setTimeout(() => {
      void this.expire(recordId);
    }, remaining);
    this.pending.set(recordId, { waiters: [], timer });
  }

  private settle(recordId: string, decision: WorkflowApprovalDecision | null) {
    const entry = this.pending.get(recordId);
    if (!entry) {
      return;
    }
    clearTimeout(entry.timer);
    this.pending.delete(recordId);
    for (const waiter of entry.waiters) {
      try {
        waiter(decision);
      } catch {
        // ignore
      }
    }
  }
}
