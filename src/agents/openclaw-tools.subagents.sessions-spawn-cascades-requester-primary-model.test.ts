import { beforeEach, describe, expect, it, vi } from "vitest";

const callGatewayMock = vi.fn();
vi.mock("../gateway/call.js", () => ({
  callGateway: (opts: unknown) => callGatewayMock(opts),
}));

let configOverride: ReturnType<(typeof import("../config/config.js"))["loadConfig"]> = {
  session: {
    mainKey: "main",
    scope: "per-sender",
  },
};

vi.mock("../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/config.js")>();
  return {
    ...actual,
    loadConfig: () => configOverride,
    resolveGatewayPort: () => 18789,
  };
});

import "./test-helpers/fast-core-tools.js";
import { createOpenClawTools } from "./openclaw-tools.js";
import { resetSubagentRegistryForTests } from "./subagent-registry.js";

describe("openclaw-tools: subagents", () => {
  beforeEach(() => {
    configOverride = {
      session: {
        mainKey: "main",
        scope: "per-sender",
      },
    };
  });

  it("sessions_spawn cascades requester primary model when no subagent model configured", async () => {
    resetSubagentRegistryForTests();
    callGatewayMock.mockReset();
    configOverride = {
      session: { mainKey: "main", scope: "per-sender" },
      agents: {
        list: [
          {
            id: "main",
            model: "openai/gpt-5",
            subagents: { allowAgents: ["research"] },
          },
          { id: "research" },
        ],
      },
    };
    const calls: Array<{ method?: string; params?: unknown }> = [];

    callGatewayMock.mockImplementation(async (opts: unknown) => {
      const request = opts as { method?: string; params?: unknown };
      calls.push(request);
      if (request.method === "sessions.patch") {
        return { ok: true };
      }
      if (request.method === "agent") {
        return { runId: "run-cascade", status: "accepted" };
      }
      return {};
    });

    const tool = createOpenClawTools({
      agentSessionKey: "main",
      agentChannel: "discord",
    }).find((candidate) => candidate.name === "sessions_spawn");
    if (!tool) {
      throw new Error("missing sessions_spawn tool");
    }

    const result = await tool.execute("call-cascade", {
      task: "research something",
      agentId: "research",
    });
    expect(result.details).toMatchObject({
      status: "accepted",
      modelApplied: true,
    });

    const patchCall = calls.find(
      (call) =>
        call.method === "sessions.patch" && (call.params as Record<string, unknown>)?.model != null,
    );
    expect(patchCall?.params).toMatchObject({
      model: "openai/gpt-5",
    });
  });

  it("sessions_spawn does not cascade when subagent model is explicitly set", async () => {
    resetSubagentRegistryForTests();
    callGatewayMock.mockReset();
    configOverride = {
      session: { mainKey: "main", scope: "per-sender" },
      agents: {
        list: [
          {
            id: "main",
            model: "openai/gpt-5",
            subagents: { allowAgents: ["research"] },
          },
          { id: "research", subagents: { model: "anthropic/claude-sonnet-4-5" } },
        ],
      },
    };
    const calls: Array<{ method?: string; params?: unknown }> = [];

    callGatewayMock.mockImplementation(async (opts: unknown) => {
      const request = opts as { method?: string; params?: unknown };
      calls.push(request);
      if (request.method === "sessions.patch") {
        return { ok: true };
      }
      if (request.method === "agent") {
        return { runId: "run-explicit", status: "accepted" };
      }
      return {};
    });

    const tool = createOpenClawTools({
      agentSessionKey: "main",
      agentChannel: "discord",
    }).find((candidate) => candidate.name === "sessions_spawn");
    if (!tool) {
      throw new Error("missing sessions_spawn tool");
    }

    const result = await tool.execute("call-explicit", {
      task: "research something",
      agentId: "research",
    });
    expect(result.details).toMatchObject({
      status: "accepted",
      modelApplied: true,
    });

    const patchCall = calls.find(
      (call) =>
        call.method === "sessions.patch" && (call.params as Record<string, unknown>)?.model != null,
    );
    expect(patchCall?.params).toMatchObject({
      model: "anthropic/claude-sonnet-4-5",
    });
  });
});
