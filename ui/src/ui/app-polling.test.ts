import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startLogsPolling, stopLogsPolling } from "./app-polling.ts";

describe("startLogsPolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("polls logs when on the logs tab and not paused", async () => {
    const request = vi.fn().mockResolvedValue({ file: "openclaw.log", cursor: 1, lines: [] });

    const host = {
      nodesPollInterval: null as number | null,
      logsPollInterval: null as number | null,
      debugPollInterval: null as number | null,
      tab: "logs",
      logsPaused: false,
      client: { request } as unknown,
      connected: true,
      logsLoading: false,
      logsFetchInFlight: false,
      logsError: null as string | null,
      logsCursor: null as number | null,
      logsFile: null as string | null,
      logsEntries: [] as unknown[],
      logsTruncated: false,
      logsLastFetchAt: null as number | null,
      logsLimit: 500,
      logsMaxBytes: 250_000,
    };

    startLogsPolling(host);
    vi.advanceTimersByTime(2000);
    await Promise.resolve();
    expect(request).toHaveBeenCalled();
    stopLogsPolling(host);
  });

  it("does not poll logs while paused", async () => {
    const request = vi.fn().mockResolvedValue({ file: "openclaw.log", cursor: 1, lines: [] });

    const host = {
      nodesPollInterval: null as number | null,
      logsPollInterval: null as number | null,
      debugPollInterval: null as number | null,
      tab: "logs",
      logsPaused: true,
      client: { request } as unknown,
      connected: true,
      logsLoading: false,
      logsFetchInFlight: false,
      logsError: null as string | null,
      logsCursor: null as number | null,
      logsFile: null as string | null,
      logsEntries: [] as unknown[],
      logsTruncated: false,
      logsLastFetchAt: null as number | null,
      logsLimit: 500,
      logsMaxBytes: 250_000,
    };

    startLogsPolling(host);
    vi.advanceTimersByTime(6000);
    await Promise.resolve();
    expect(request).not.toHaveBeenCalled();
    stopLogsPolling(host);
  });
});
