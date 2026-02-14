import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { renderKnowledgeBase, type KnowledgeBaseProps } from "./knowledge-base.js";

describe("knowledge base view", () => {
  const base = (): KnowledgeBaseProps => ({
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
      images: [],
    },
    readLoading: false,
    readError: null as string | null,
    readResult: null,
    selectedPath: null as string | null,
    activeView: "browse",
    reviewQueueList: [],
    embeddingSettingsLoading: false,
    embeddingSettingsSaving: false,
    embeddingSettingsError: null as string | null,
    embeddingSettingsNotice: null as string | null,
    embeddingSettings: {
      provider: "auto",
      fallback: "none",
      localModelPath: "",
    },
    editorMode: "browse" as const,
    editorTitle: "",
    editorContent: "",
    editorSaving: false,
    editorError: null as string | null,
    editorNotice: null as string | null,
    editorPreviewOpen: false,
    editorTags: "",
    editorDirty: false,
    deleteConfirmPath: null as string | null,
    deleting: false,
    deleteError: null as string | null,
    linkUrl: "",
    linkAnalyzing: false,
    linkError: null as string | null,
    uploading: false,
    uploadError: null as string | null,
    collapsedSections: new Set<string>(),
    onRefresh: vi.fn(),
    onSelectFile: vi.fn(),
    onOpenReviewQueue: vi.fn(),
    onRefreshEmbeddingSettings: vi.fn(),
    onProviderChange: vi.fn(),
    onFallbackChange: vi.fn(),
    onLocalModelPathChange: vi.fn(),
    onUseLocalPreset: vi.fn(),
    onSaveEmbeddingSettings: vi.fn(),
    onCreateNote: vi.fn(),
    onEditNote: vi.fn(),
    onSaveNote: vi.fn(),
    onCancelEditor: vi.fn(),
    onEditorTitleChange: vi.fn(),
    onEditorContentChange: vi.fn(),
    onEditorTogglePreview: vi.fn(),
    onEditorTagsChange: vi.fn(),
    onDeleteEntry: vi.fn(),
    onConfirmDelete: vi.fn(),
    onCancelDelete: vi.fn(),
    onSaveLinkStart: vi.fn(),
    onLinkUrlChange: vi.fn(),
    onSaveLink: vi.fn(),
    onUploadImageStart: vi.fn(),
    onUploadImage: vi.fn(),
    onToggleSection: vi.fn(),
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
    );
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

  it("renders embedding settings and wires save", () => {
    const container = document.createElement("div");
    const props = base();
    props.embeddingSettings.provider = "local";
    props.embeddingSettings.localModelPath =
      "hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf";
    render(renderKnowledgeBase(props), container);
    expect(container.textContent).toContain("Memory Embeddings");

    const saveButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button.btn.primary"),
    ).find((btn) => btn.textContent?.trim() === "Save");
    expect(saveButton).toBeTruthy();
    saveButton?.click();
    expect(props.onSaveEmbeddingSettings).toHaveBeenCalled();
  });

  it("renders Review Queue list when QUEUE.md missing", () => {
    const container = document.createElement("div");
    const props = base();
    props.activeView = "review-queue";
    props.reviewQueueList = ["review/a.md"];
    render(renderKnowledgeBase(props), container);
    expect(container.textContent).toContain("Review Queue");

    const queueButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button.kb-queue-item"),
    ).find((btn) => btn.textContent?.includes("a.md"));
    expect(queueButton).toBeTruthy();
    queueButton?.click();
    expect(props.onSelectFile).toHaveBeenCalledWith("review/a.md");
  });
});
