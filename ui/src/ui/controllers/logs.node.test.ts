import { describe, expect, it, vi } from "vitest";
import { loadLogs, type LogsState } from "./logs.ts";

function createState(overrides: Partial<LogsState> = {}): LogsState {
  return {
    client: null,
    connected: false,
    logsLoading: false,
    logsFetchInFlight: false,
    logsPaused: false,
    logsError: null,
    logsCursor: 10,
    logsFile: "/tmp/openclaw.log",
    logsEntries: [],
    logsTruncated: false,
    logsLastFetchAt: null,
    logsLimit: 500,
    logsMaxBytes: 250_000,
    ...overrides,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("loadLogs", () => {
  it("skips quiet polling while paused before request", async () => {
    const request = vi.fn();
    const state = createState({
      connected: true,
      logsPaused: true,
      client: { request } as unknown as LogsState["client"],
    });

    await loadLogs(state, { quiet: true });

    expect(request).not.toHaveBeenCalled();
  });

  it("keeps existing log array and timestamp when quiet poll has no new lines", async () => {
    const existingEntries = [{ raw: '{"msg":"old"}', message: "old" }];
    const request = vi.fn(async () => ({
      cursor: 10,
      file: "/tmp/openclaw.log",
      lines: [],
      truncated: false,
      reset: false,
    }));
    const state = createState({
      connected: true,
      logsEntries: existingEntries,
      logsLastFetchAt: 1234,
      client: { request } as unknown as LogsState["client"],
    });

    await loadLogs(state, { quiet: true });

    expect(request).toHaveBeenCalledWith("logs.tail", {
      cursor: 10,
      limit: 500,
      maxBytes: 250_000,
    });
    expect(state.logsEntries).toBe(existingEntries);
    expect(state.logsLastFetchAt).toBe(1234);
  });

  it("appends new lines and updates lastFetchAt", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(98765);
    const request = vi.fn(async () => ({
      cursor: 20,
      file: "/tmp/openclaw.log",
      lines: ['{"time":"2026-02-13T10:00:00Z","_meta":{"logLevelName":"INFO"},"1":"new line"}'],
      truncated: false,
      reset: false,
    }));
    const state = createState({
      connected: true,
      logsEntries: [{ raw: '{"msg":"old"}', message: "old" }],
      logsLastFetchAt: 1234,
      client: { request } as unknown as LogsState["client"],
    });

    await loadLogs(state, { quiet: true });

    expect(state.logsEntries).toHaveLength(2);
    expect(state.logsEntries[1]?.message).toBe("new line");
    expect(state.logsEntries[1]?.level).toBe("info");
    expect(state.logsLastFetchAt).toBe(98765);
    nowSpy.mockRestore();
  });

  it("ignores in-flight quiet response if user pauses before it resolves", async () => {
    const deferred = createDeferred<unknown>();
    const request = vi.fn(() => deferred.promise);
    const state = createState({
      connected: true,
      logsEntries: [{ raw: '{"msg":"old"}', message: "old" }],
      logsLastFetchAt: 1234,
      client: { request } as unknown as LogsState["client"],
    });

    const pending = loadLogs(state, { quiet: true });
    state.logsPaused = true;
    deferred.resolve({
      cursor: 11,
      file: "/tmp/openclaw.log",
      lines: ['{"1":"should not apply"}'],
      truncated: false,
      reset: false,
    });
    await pending;

    expect(state.logsEntries).toEqual([{ raw: '{"msg":"old"}', message: "old" }]);
    expect(state.logsLastFetchAt).toBe(1234);
    expect(state.logsCursor).toBe(10);
    expect(state.logsFetchInFlight).toBe(false);
  });
});
