import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { renderKnowledgeBase } from "./knowledge-base";

describe("knowledge base view", () => {
  const base = () => ({
    connected: true,
    loading: false,
    error: null as string | null,
    entries: {
      notes: [
        { path: "notes/dir", kind: "dir" as const, modifiedAtMs: 0 },
        { path: "notes/a.md", kind: "file" as const, modifiedAtMs: 0, sizeBytes: 10 },
      ],
      links: [],
      review: [],
    },
    readLoading: false,
    readError: null as string | null,
    readResult: null,
    selectedPath: null as string | null,
    activeView: "browse" as const,
    reviewQueueList: [] as string[],
    onRefresh: vi.fn(),
    onSelectFile: vi.fn(),
    onOpenReviewQueue: vi.fn(),
  });

  it("shows disconnected state", () => {
    const container = document.createElement("div");
    render(renderKnowledgeBase({ ...base(), connected: false }), container);
    expect(container.textContent).toContain("Disconnected from gateway");
  });

  it("renders tree and triggers file selection", () => {
    const container = document.createElement("div");
    const props = base();
    render(renderKnowledgeBase(props), container);

    const fileButton = Array.from(container.querySelectorAll("button")).find((btn) =>
      btn.textContent?.includes("a.md"),
    ) as HTMLButtonElement | undefined;
    expect(fileButton).toBeTruthy();
    fileButton?.click();
    expect(props.onSelectFile).toHaveBeenCalledWith("notes/a.md");
  });

  it("renders markdown preview for .md", () => {
    const container = document.createElement("div");
    render(
      renderKnowledgeBase({
        ...base(),
        readResult: {
          path: "notes/a.md",
          contentType: "text/markdown",
          truncated: false,
          content: "# Hello\n",
        },
        selectedPath: "notes/a.md",
      }),
      container,
    );
    expect(container.querySelector(".kb-markdown")?.innerHTML).toContain("<h1");
    expect(container.textContent).toContain("notes/a.md");
  });

  it("renders Review Queue list when QUEUE.md missing", () => {
    const container = document.createElement("div");
    const props = base();
    props.activeView = "review-queue";
    props.reviewQueueList = ["review/a.md"];
    render(renderKnowledgeBase(props), container);
    expect(container.textContent).toContain("Review Queue");

    const queueButton = Array.from(container.querySelectorAll("button")).find((btn) =>
      btn.textContent?.includes("a.md"),
    ) as HTMLButtonElement | undefined;
    expect(queueButton).toBeTruthy();
    queueButton?.click();
    expect(props.onSelectFile).toHaveBeenCalledWith("review/a.md");
  });
});
