import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

  it("parses deploy commands", () => {
    expect(_testOnly.parseProjectCommand("/project deploy init")).toEqual({
      ok: true,
      action: "deploy",
      subaction: "init",
      env: "staging",
    });
    expect(_testOnly.parseProjectCommand("/project deploy plan --env prod")).toEqual({
      ok: true,
      action: "deploy",
      subaction: "plan",
      env: "prod",
    });
    expect(_testOnly.parseProjectCommand("/project deploy apply --env staging")).toEqual({
      ok: true,
      action: "deploy",
      subaction: "apply",
      env: "staging",
    });
    expect(_testOnly.parseProjectCommand("/project deploy status --env prod")).toEqual({
      ok: true,
      action: "deploy",
      subaction: "status",
      env: "prod",
    });
  });

  it("uses distinct app names for staging and prod when slug is long", () => {
    const repoSlug = "verylongownername/verylongreponamethatisalsolong";
    const staging = _testOnly.resolveDoAppName(repoSlug, "staging");
    const prod = _testOnly.resolveDoAppName(repoSlug, "prod");
    expect(staging).not.toBe(prod);
    expect(staging.endsWith("-staging")).toBe(true);
    expect(prod.endsWith("-prod")).toBe(true);
    expect(staging.length).toBeLessThanOrEqual(32);
    expect(prod.length).toBeLessThanOrEqual(32);
  });

  it("infers a basic static site spec from a Vite repo", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-project-"));
    try {
      fs.writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify(
          {
            name: "vite-web",
            scripts: { build: "vite build" },
            devDependencies: { vite: "^5.0.0" },
          },
          null,
          2,
        ),
      );
      fs.writeFileSync(path.join(dir, "package-lock.json"), "{}");

      const spec = _testOnly.inferDoAppSpecTemplateFromRepo({
        repoDir: dir,
        repoSlug: "acme/vite-web",
        env: "staging",
        region: "nyc1",
      });

      expect(spec.region).toBe("nyc1");
      const ingress = spec.ingress;
      expect(ingress && typeof ingress === "object").toBe(true);
      const ingressRules = (ingress as Record<string, unknown>).rules;
      expect(Array.isArray(ingressRules)).toBe(true);
      const staticSites = spec.static_sites;
      expect(Array.isArray(staticSites)).toBe(true);
      const firstSite = (staticSites as unknown[])[0];
      expect((firstSite as Record<string, unknown>).name).toBe("web");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("infers a web+api spec from apps/web + apps/api", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-project-"));
    try {
      fs.mkdirSync(path.join(dir, "apps", "web"), { recursive: true });
      fs.mkdirSync(path.join(dir, "apps", "api"), { recursive: true });
      fs.writeFileSync(
        path.join(dir, "apps", "web", "package.json"),
        JSON.stringify(
          {
            name: "web",
            scripts: { build: "next build", start: "next start" },
            dependencies: { next: "^14.0.0" },
          },
          null,
          2,
        ),
      );
      fs.writeFileSync(
        path.join(dir, "apps", "api", "package.json"),
        JSON.stringify(
          {
            name: "api",
            scripts: { start: "node server.js" },
            dependencies: { express: "^4.0.0" },
          },
          null,
          2,
        ),
      );
      fs.writeFileSync(path.join(dir, "package-lock.json"), "{}");

      const spec = _testOnly.inferDoAppSpecTemplateFromRepo({
        repoDir: dir,
        repoSlug: "acme/monorepo",
        env: "prod",
        region: "nyc1",
      });

      const services = spec.services;
      expect(Array.isArray(services)).toBe(true);
      const names = (services as unknown[])
        .map((s) => (s && typeof s === "object" ? (s as Record<string, unknown>).name : null))
        .filter((v): v is string => typeof v === "string")
        .toSorted();
      expect(names).toEqual(["api", "web"]);

      const ingress = spec.ingress;
      const rules =
        ingress && typeof ingress === "object" ? (ingress as Record<string, unknown>).rules : null;
      expect(Array.isArray(rules)).toBe(true);
      const firstRule = (rules as unknown[])[0];
      expect(firstRule && typeof firstRule === "object").toBe(true);
      const match = (firstRule as Record<string, unknown>).match;
      expect(match && typeof match === "object").toBe(true);
      const pathMatch = (match as Record<string, unknown>).path;
      expect(pathMatch && typeof pathMatch === "object").toBe(true);
      const prefix = (pathMatch as Record<string, unknown>).prefix;
      expect(prefix).toBe("/api");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
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
