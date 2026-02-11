import { describe, expect, it } from "vitest";
import { _testOnly } from "./commands-project.js";

describe("/project helpers", () => {
  it("returns null for non-/project commands", () => {
    expect(_testOnly.parseProjectCommand("/help")).toBeNull();
    expect(_testOnly.parseProjectCommand("hello")).toBeNull();
  });

  it("parses help", () => {
    expect(_testOnly.parseProjectCommand("/project")).toEqual({ ok: true, action: "help" });
    expect(_testOnly.parseProjectCommand("/project help")).toEqual({ ok: true, action: "help" });
  });

  it("parses bootstrap args and flags", () => {
    const res = _testOnly.parseProjectCommand(
      "/project bootstrap openclaw/openclaw --category coding-projects --agent proj-a --channel proj-openclaw --no-clone",
    );
    expect(res).toEqual({
      ok: true,
      action: "bootstrap",
      repo: "openclaw/openclaw",
      categoryName: "coding-projects",
      agentId: "proj-a",
      channelName: "proj-openclaw",
      clone: false,
    });
  });

  it("parses ship and merge", () => {
    expect(_testOnly.parseProjectCommand("/project ship Add foo")).toEqual({
      ok: true,
      action: "ship",
      title: "Add foo",
    });
    expect(_testOnly.parseProjectCommand("/project merge")).toEqual({ ok: true, action: "merge" });
  });

  it("extracts and de-dupes URLs", () => {
    const urls = _testOnly.extractUrls(
      "Preview: https://example.vercel.app, and again https://example.vercel.app.",
    );
    expect(urls).toEqual(["https://example.vercel.app"]);
  });

  it("extracts URLs from JSON output", () => {
    const raw = JSON.stringify({
      url: "https://github.com/acme/repo/pull/1",
      comments: [{ body: "Preview: https://acme-preview.netlify.app" }],
      statusCheckRollup: [{ detailsUrl: "https://acme-preview.netlify.app" }],
    });
    const urls = _testOnly.extractUrlsFromJson(raw);
    expect(urls).toContain("https://acme-preview.netlify.app");
  });

  it("picks preferred preview hosts first", () => {
    const preview = _testOnly.pickPreviewUrl([
      "https://example.com",
      "https://hello.netlify.app",
      "https://world.vercel.app",
    ]);
    // vercel.app is preferred before netlify.app in the list
    expect(preview).toBe("https://world.vercel.app");
  });
});
