import { describe, expect, it, vi } from "vitest";
import { subscribeEmbeddedPiSession } from "./pi-embedded-subscribe.js";

type StubSession = {
  subscribe: (fn: (evt: unknown) => void) => () => void;
};

type SessionEventHandler = (evt: unknown) => void;

describe("subscribeEmbeddedPiSession", () => {
  const _THINKING_TAG_CASES = [
    { tag: "think", open: "<think>", close: "</think>" },
    { tag: "thinking", open: "<thinking>", close: "</thinking>" },
    { tag: "thought", open: "<thought>", close: "</thought>" },
    { tag: "antthinking", open: "<antthinking>", close: "</antthinking>" },
  ] as const;

  it("calls onBlockReplyFlush before tool_execution_start to preserve message boundaries", () => {
    let handler: SessionEventHandler | undefined;
    const session: StubSession = {
      subscribe: (fn) => {
        handler = fn;
        return () => {};
      },
    };

    const onBlockReplyFlush = vi.fn();
    const onBlockReply = vi.fn();

    subscribeEmbeddedPiSession({
      session: session as unknown as Parameters<typeof subscribeEmbeddedPiSession>[0]["session"],
      runId: "run-flush-test",
      onBlockReply,
      onBlockReplyFlush,
      blockReplyBreak: "text_end",
    });

    // Simulate text arriving before tool
    handler?.({
      type: "message_start",
      message: { role: "assistant" },
    });

    handler?.({
      type: "message_update",
      message: { role: "assistant" },
      assistantMessageEvent: {
        type: "text_delta",
        delta: "First message before tool.",
      },
    });

    expect(onBlockReplyFlush).not.toHaveBeenCalled();

    // Tool execution starts - should trigger flush
    handler?.({
      type: "tool_execution_start",
      toolName: "bash",
      toolCallId: "tool-flush-1",
      args: { command: "echo hello" },
    });

    expect(onBlockReplyFlush).toHaveBeenCalledTimes(1);

    // Another tool - should flush again
    handler?.({
      type: "tool_execution_start",
      toolName: "read",
      toolCallId: "tool-flush-2",
      args: { path: "/tmp/test.txt" },
    });

    expect(onBlockReplyFlush).toHaveBeenCalledTimes(2);
  });
  it("discards buffered block chunks before tool execution to suppress pre-tool text", () => {
    let handler: SessionEventHandler | undefined;
    const session: StubSession = {
      subscribe: (fn) => {
        handler = fn;
        return () => {};
      },
    };

    const onBlockReply = vi.fn();
    const onBlockReplyDiscard = vi.fn();

    subscribeEmbeddedPiSession({
      session: session as unknown as Parameters<typeof subscribeEmbeddedPiSession>[0]["session"],
      runId: "run-discard-buffer",
      onBlockReply,
      onBlockReplyDiscard,
      blockReplyBreak: "text_end",
      blockReplyChunking: { minChars: 50, maxChars: 200 },
    });

    handler?.({
      type: "message_start",
      message: { role: "assistant" },
    });

    handler?.({
      type: "message_update",
      message: { role: "assistant" },
      assistantMessageEvent: {
        type: "text_delta",
        delta: "Short chunk.",
      },
    });

    expect(onBlockReply).not.toHaveBeenCalled();

    // Tool execution starts - should DISCARD (not send) the buffered text
    handler?.({
      type: "tool_execution_start",
      toolName: "bash",
      toolCallId: "tool-discard-buffer-1",
      args: { command: "echo flush" },
    });

    // Pre-tool text should NOT be sent via onBlockReply
    expect(onBlockReply).not.toHaveBeenCalled();
    // Discard callback should be invoked instead
    expect(onBlockReplyDiscard).toHaveBeenCalledTimes(1);
  });
});
