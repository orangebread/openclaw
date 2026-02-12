import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleGatewayRequest } from "../server-methods.js";
import { workspaceHandlers } from "./workspace.js";

const noop = () => false;

type WorkspaceListHandlerArgs = Parameters<(typeof workspaceHandlers)["workspace.list"]>[0];
type WorkspaceReadHandlerArgs = Parameters<(typeof workspaceHandlers)["workspace.read"]>[0];

async function withTempWorkspace<T>(fn: (workspaceDir: string) => Promise<T>) {
  const prev = {
    home: process.env.HOME,
    configPath: process.env.OPENCLAW_CONFIG_PATH,
    skipChannels: process.env.OPENCLAW_SKIP_CHANNELS,
    skipCron: process.env.OPENCLAW_SKIP_CRON,
    skipGmail: process.env.OPENCLAW_SKIP_GMAIL_WATCHER,
  };

  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-kb-workspace-"));
  process.env.HOME = tempHome;
  process.env.OPENCLAW_SKIP_CHANNELS = "1";
  process.env.OPENCLAW_SKIP_CRON = "1";
  process.env.OPENCLAW_SKIP_GMAIL_WATCHER = "1";

  const workspaceDir = path.join(tempHome, "workspace");
  await fs.mkdir(workspaceDir, { recursive: true });

  const configDir = path.join(tempHome, ".openclaw");
  await fs.mkdir(configDir, { recursive: true });
  const configPath = path.join(configDir, "openclaw.json");
  await fs.writeFile(
    configPath,
    `${JSON.stringify({ agents: { defaults: { workspace: workspaceDir } } }, null, 2)}\n`,
  );
  process.env.OPENCLAW_CONFIG_PATH = configPath;

  try {
    return await fn(workspaceDir);
  } finally {
    process.env.HOME = prev.home;
    process.env.OPENCLAW_CONFIG_PATH = prev.configPath;
    process.env.OPENCLAW_SKIP_CHANNELS = prev.skipChannels;
    process.env.OPENCLAW_SKIP_CRON = prev.skipCron;
    process.env.OPENCLAW_SKIP_GMAIL_WATCHER = prev.skipGmail;
    await fs.rm(tempHome, { recursive: true, force: true });
  }
}

describe("workspace.*", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists allowlisted workspace content (deterministic sorting)", async () => {
    await withTempWorkspace(async (workspaceDir) => {
      await fs.mkdir(path.join(workspaceDir, "notes", "bdir"), { recursive: true });
      await fs.mkdir(path.join(workspaceDir, "notes", "adir"), { recursive: true });
      await fs.writeFile(path.join(workspaceDir, "notes", "z.md"), "# z\n");
      await fs.writeFile(path.join(workspaceDir, "notes", "a.md"), "# a\n");

      const respond = vi.fn();
      await workspaceHandlers["workspace.list"]({
        params: { agentId: "main", dir: "notes", maxDepth: 0, maxEntries: 1000, cursor: null },
        respond,
        context: {} as unknown as WorkspaceListHandlerArgs["context"],
        client: null,
        req: { id: "req-1", type: "req", method: "workspace.list" },
        isWebchatConnect: noop,
      });

      const payload = respond.mock.calls[0]?.[1] as {
        entries?: Array<{ path: string; kind: string }>;
      };
      expect(payload.entries?.map((e) => `${e.kind}:${e.path}`)).toEqual([
        "dir:notes/adir",
        "dir:notes/bdir",
        "file:notes/a.md",
        "file:notes/z.md",
      ]);
    });
  });

  it("rejects disallowed prefixes", async () => {
    const respond = vi.fn();
    await workspaceHandlers["workspace.list"]({
      params: { agentId: "main", dir: "secrets", maxDepth: 0, maxEntries: 10, cursor: null },
      respond,
      context: {} as unknown as WorkspaceListHandlerArgs["context"],
      client: null,
      req: { id: "req-1", type: "req", method: "workspace.list" },
      isWebchatConnect: noop,
    });

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ code: "INVALID_REQUEST" }),
    );
  });

  it("rejects traversal attempts", async () => {
    const respond = vi.fn();
    await workspaceHandlers["workspace.read"]({
      params: { agentId: "main", path: "notes/../links/x.md", maxBytes: 10 },
      respond,
      context: {} as unknown as WorkspaceReadHandlerArgs["context"],
      client: null,
      req: { id: "req-1", type: "req", method: "workspace.read" },
      isWebchatConnect: noop,
    });

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ code: "INVALID_REQUEST" }),
    );
  });

  it("returns UNSUPPORTED for disallowed file types", async () => {
    const respond = vi.fn();
    await workspaceHandlers["workspace.read"]({
      params: { agentId: "main", path: "notes/image.png", maxBytes: 10 },
      respond,
      context: {} as unknown as WorkspaceReadHandlerArgs["context"],
      client: null,
      req: { id: "req-1", type: "req", method: "workspace.read" },
      isWebchatConnect: noop,
    });

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ code: "UNSUPPORTED" }),
    );
  });

  it("rejects symlink reads and ignores symlinks in listings", async () => {
    await withTempWorkspace(async (workspaceDir) => {
      await fs.mkdir(path.join(workspaceDir, "notes"), { recursive: true });
      const outside = path.join(workspaceDir, "..", "outside.txt");
      await fs.writeFile(outside, "nope\n");
      await fs.symlink(outside, path.join(workspaceDir, "notes", "evil.txt"));

      const respondList = vi.fn();
      await workspaceHandlers["workspace.list"]({
        params: { agentId: "main", dir: "notes", maxDepth: 0, maxEntries: 50, cursor: null },
        respond: respondList,
        context: {} as unknown as WorkspaceListHandlerArgs["context"],
        client: null,
        req: { id: "req-1", type: "req", method: "workspace.list" },
        isWebchatConnect: noop,
      });
      const payload = respondList.mock.calls[0]?.[1] as { entries?: Array<{ path: string }> };
      expect(payload.entries?.some((e) => e.path === "notes/evil.txt")).toBe(false);

      const respondRead = vi.fn();
      await workspaceHandlers["workspace.read"]({
        params: { agentId: "main", path: "notes/evil.txt", maxBytes: 50 },
        respond: respondRead,
        context: {} as unknown as WorkspaceReadHandlerArgs["context"],
        client: null,
        req: { id: "req-1", type: "req", method: "workspace.read" },
        isWebchatConnect: noop,
      });
      expect(String(respondRead.mock.calls[0]?.[2]?.message ?? "")).toContain("symlinks");
    });
  });

  it("truncates large files and clamps maxBytes", async () => {
    await withTempWorkspace(async (workspaceDir) => {
      await fs.mkdir(path.join(workspaceDir, "notes"), { recursive: true });
      const big = "x".repeat(600_000);
      await fs.writeFile(path.join(workspaceDir, "notes", "big.txt"), big);

      const respondSmall = vi.fn();
      await workspaceHandlers["workspace.read"]({
        params: { agentId: "main", path: "notes/big.txt", maxBytes: 10 },
        respond: respondSmall,
        context: {} as unknown as WorkspaceReadHandlerArgs["context"],
        client: null,
        req: { id: "req-1", type: "req", method: "workspace.read" },
        isWebchatConnect: noop,
      });
      expect(respondSmall).toHaveBeenCalledWith(
        true,
        expect.objectContaining({ truncated: true, content: expect.any(String) }),
        undefined,
      );
      const smallContent = String(respondSmall.mock.calls[0]?.[1]?.content ?? "");
      expect(smallContent.length).toBeLessThanOrEqual(10);

      const respondClamped = vi.fn();
      await workspaceHandlers["workspace.read"]({
        params: { agentId: "main", path: "notes/big.txt", maxBytes: 9_999_999 },
        respond: respondClamped,
        context: {} as unknown as WorkspaceReadHandlerArgs["context"],
        client: null,
        req: { id: "req-2", type: "req", method: "workspace.read" },
        isWebchatConnect: noop,
      });
      const clampedContent = String(respondClamped.mock.calls[0]?.[1]?.content ?? "");
      expect(clampedContent.length).toBeLessThanOrEqual(500_000);
    });
  });

  it("requires operator.read (or operator.admin) scope", async () => {
    const respond = vi.fn();
    await handleGatewayRequest({
      req: {
        id: "req-1",
        type: "req",
        method: "workspace.list",
        params: { agentId: "main", dir: "notes", maxDepth: 0, maxEntries: 10, cursor: null },
      },
      respond,
      client: { connect: { role: "operator", scopes: [] } } as unknown as Parameters<
        typeof handleGatewayRequest
      >[0]["client"],
      isWebchatConnect: noop,
      context: {} as unknown as Parameters<typeof handleGatewayRequest>[0]["context"],
      extraHandlers: workspaceHandlers,
    });

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ code: "INVALID_REQUEST", message: "missing scope: operator.read" }),
    );
  });
});
