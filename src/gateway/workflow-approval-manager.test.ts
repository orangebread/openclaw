import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WorkflowApprovalManager } from "./workflow-approval-manager.js";

let dir = os.tmpdir();
let filePath = "";

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-workflow-approvals-"));
  filePath = path.join(dir, "workflow-approvals.json");
});

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("WorkflowApprovalManager", () => {
  it("creates and lists pending approvals", async () => {
    const manager = new WorkflowApprovalManager({ filePath });
    const record = await manager.request({
      idempotencyKey: "k1",
      timeoutMs: 60_000,
      request: { kind: "test.kind", title: "Test", summary: "Hello", details: { a: "b" } },
    });
    const pending = await manager.listPending();
    expect(pending.some((p) => p.id === record.id)).toBe(true);
  });

  it("dedupes requests by idempotency key", async () => {
    const manager = new WorkflowApprovalManager({ filePath });
    const a = await manager.request({
      idempotencyKey: "same-key",
      timeoutMs: 60_000,
      request: { kind: "test.kind", title: "Test", summary: null, details: null },
    });
    const b = await manager.request({
      idempotencyKey: "same-key",
      timeoutMs: 60_000,
      request: { kind: "test.kind", title: "Test2", summary: null, details: null },
    });
    expect(b.id).toBe(a.id);
  });

  it("resolves pending approvals and wakes waiters", async () => {
    const manager = new WorkflowApprovalManager({ filePath });
    const record = await manager.request({
      idempotencyKey: "resolve-key",
      timeoutMs: 60_000,
      request: { kind: "test.kind", title: "Resolve", summary: null, details: null },
    });
    const wait = manager.waitForDecision(record);
    const ok = await manager.resolve(record.id, "approve", "tester");
    expect(ok).toBe(true);
    await expect(wait).resolves.toBe("approve");
    const pending = await manager.listPending();
    expect(pending.some((p) => p.id === record.id)).toBe(false);
  });

  it("returns the persisted decision when resolved before wait starts", async () => {
    const manager = new WorkflowApprovalManager({ filePath });
    const record = await manager.request({
      idempotencyKey: "resolve-before-wait",
      timeoutMs: 60_000,
      request: { kind: "test.kind", title: "Resolve First", summary: null, details: null },
    });
    const ok = await manager.resolve(record.id, "approve", "tester");
    expect(ok).toBe(true);
    const outcome = await Promise.race([
      manager.waitForDecision(record),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 300)),
    ]);
    expect(outcome).toBe("approve");
  });

  it("expires pending approvals and wakes waiters with null", async () => {
    const manager = new WorkflowApprovalManager({ filePath });
    const record = await manager.request({
      idempotencyKey: "expire-key",
      timeoutMs: 60_000,
      request: { kind: "test.kind", title: "Expire", summary: null, details: null },
    });
    const wait = manager.waitForDecision(record);
    await manager.expire(record.id);
    await expect(wait).resolves.toBeNull();
  });
});
