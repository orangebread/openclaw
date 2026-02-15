import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const wsInstances: WebSocketMock[] = [];

class WebSocketMock {
  static OPEN = 1;
  readonly readyState = WebSocketMock.OPEN;

  private listeners = new Map<string, Array<(ev: unknown) => void>>();

  readonly send = vi.fn();
  readonly close = vi.fn();

  constructor(readonly url: string) {
    wsInstances.push(this);
  }

  addEventListener(type: string, handler: (ev: unknown) => void) {
    const existing = this.listeners.get(type) ?? [];
    existing.push(handler);
    this.listeners.set(type, existing);
  }

  emitMessage(data: unknown) {
    const handlers = this.listeners.get("message") ?? [];
    for (const handler of handlers) {
      handler({ data: JSON.stringify(data) });
    }
  }

  emitClose(code: number, reason?: string) {
    const handlers = this.listeners.get("close") ?? [];
    for (const handler of handlers) {
      handler({ code, reason: reason ?? "" });
    }
  }
}

const { connectGateway } = await import("./app-gateway.ts");

function createHost() {
  return {
    settings: {
      gatewayUrl: "ws://127.0.0.1:18789",
      token: "",
      sessionKey: "main",
      lastActiveSessionKey: "main",
      theme: "system",
      chatFocusMode: false,
      chatShowThinking: true,
      splitRatio: 0.6,
      navCollapsed: false,
      navGroupsCollapsed: {},
    },
    password: "",
    client: null,
    connected: false,
    hello: null,
    lastError: null,
    eventLogBuffer: [],
    eventLog: [],
    tab: "overview",
    presenceEntries: [],
    presenceError: null,
    presenceStatus: null,
    agentsLoading: false,
    agentsList: null,
    agentsError: null,
    debugHealth: null,
    assistantName: "OpenClaw",
    assistantAvatar: null,
    assistantAgentId: null,
    sessionKey: "main",
    chatRunId: null,
    refreshSessionsAfterChat: new Set<string>(),
    execApprovalQueue: [],
    execApprovalError: null,
  } as unknown as Parameters<typeof connectGateway>[0];
}

describe("connectGateway", () => {
  let setTimeoutSpy: { mockRestore: () => void } | null = null;

  beforeEach(() => {
    wsInstances.length = 0;
    setTimeoutSpy?.mockRestore();
    setTimeoutSpy = vi
      .spyOn(window, "setTimeout")
      .mockImplementation(() => 0 as unknown as ReturnType<typeof window.setTimeout>);
    vi.stubGlobal("WebSocket", WebSocketMock);
  });

  afterEach(() => {
    setTimeoutSpy?.mockRestore();
    setTimeoutSpy = null;
    vi.unstubAllGlobals();
  });

  it("ignores stale client onGap callbacks after reconnect", () => {
    const host = createHost();

    connectGateway(host);
    const firstClient = host.client;
    const firstWs = wsInstances[0];
    expect(firstClient).toBeDefined();
    expect(firstWs).toBeDefined();

    connectGateway(host);
    const secondClient = host.client;
    const secondWs = wsInstances[1];
    expect(secondClient).toBeDefined();
    expect(secondWs).toBeDefined();

    firstWs.emitMessage({ type: "event", event: "presence", seq: 10, payload: {} });
    firstWs.emitMessage({ type: "event", event: "presence", seq: 13, payload: {} });
    expect(host.lastError).toBeNull();

    secondWs.emitMessage({ type: "event", event: "presence", seq: 20, payload: {} });
    secondWs.emitMessage({ type: "event", event: "presence", seq: 24, payload: {} });
    expect(host.lastError).toBe(
      "event gap detected (expected seq 21, got 24); refresh recommended",
    );

    firstClient?.stop();
    secondClient?.stop();
  });

  it("ignores stale client onEvent callbacks after reconnect", () => {
    const host = createHost();

    connectGateway(host);
    const firstClient = host.client;
    const firstWs = wsInstances[0];
    expect(firstClient).toBeDefined();
    expect(firstWs).toBeDefined();

    connectGateway(host);
    const secondClient = host.client;
    const secondWs = wsInstances[1];
    expect(secondClient).toBeDefined();
    expect(secondWs).toBeDefined();

    firstWs.emitMessage({
      type: "event",
      event: "presence",
      seq: 1,
      payload: { presence: [{ host: "stale" }] },
    });
    expect(host.eventLogBuffer).toHaveLength(0);

    secondWs.emitMessage({
      type: "event",
      event: "presence",
      seq: 1,
      payload: { presence: [{ host: "active" }] },
    });
    expect(host.eventLogBuffer).toHaveLength(1);
    expect(host.eventLogBuffer[0]?.event).toBe("presence");

    firstClient?.stop();
    secondClient?.stop();
  });

  it("ignores stale client onClose callbacks after reconnect", () => {
    const host = createHost();

    connectGateway(host);
    const firstClient = host.client;
    const firstWs = wsInstances[0];
    expect(firstClient).toBeDefined();
    expect(firstWs).toBeDefined();

    connectGateway(host);
    const secondClient = host.client;
    const secondWs = wsInstances[1];
    expect(secondClient).toBeDefined();
    expect(secondWs).toBeDefined();

    firstWs.emitClose(1005);
    expect(host.lastError).toBeNull();

    secondWs.emitClose(1005);
    expect(host.lastError).toBe("disconnected (1005): no reason");

    firstClient?.stop();
    secondClient?.stop();
  });
});
