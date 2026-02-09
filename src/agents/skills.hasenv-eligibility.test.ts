import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { SkillEntry } from "./skills/types.js";
import { buildWorkspaceSkillStatus } from "./skills-status.js";
import { shouldIncludeSkill } from "./skills/config.js";

async function writeSkill(params: {
  dir: string;
  name: string;
  description: string;
  metadata?: string;
  body?: string;
}) {
  const { dir, name, description, metadata, body } = params;
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "SKILL.md"),
    `---
name: ${name}
description: ${description}${metadata ? `\nmetadata: ${metadata}` : ""}
---

${body ?? `# ${name}\n`}
`,
    "utf-8",
  );
}

function makeSkillEntry(overrides?: {
  name?: string;
  env?: string[];
  primaryEnv?: string;
}): SkillEntry {
  return {
    skill: {
      name: overrides?.name ?? "test-skill",
      description: "A test skill",
      source: "workspace",
      filePath: "/fake/path/SKILL.md",
      baseDir: "/fake/path",
      prompt: "# test\n",
    },
    frontmatter: {},
    metadata: {
      requires: {
        env: overrides?.env ?? ["TEST_API_KEY"],
      },
      ...(overrides?.primaryEnv ? { primaryEnv: overrides.primaryEnv } : {}),
    },
  };
}

describe("shouldIncludeSkill with hasEnv", () => {
  it("excludes skill when env is missing and no hasEnv callback", () => {
    const entry = makeSkillEntry({ env: ["MISSING_KEY"] });
    const result = shouldIncludeSkill({ entry });
    expect(result).toBe(false);
  });

  it("includes skill when hasEnv returns true for the required env var", () => {
    const entry = makeSkillEntry({ env: ["SOME_PROVIDER_KEY"] });
    const result = shouldIncludeSkill({
      entry,
      eligibility: { hasEnv: (name) => name === "SOME_PROVIDER_KEY" },
    });
    expect(result).toBe(true);
  });

  it("excludes skill when hasEnv returns false", () => {
    const entry = makeSkillEntry({ env: ["SOME_PROVIDER_KEY"] });
    const result = shouldIncludeSkill({
      entry,
      eligibility: { hasEnv: () => false },
    });
    expect(result).toBe(false);
  });

  it("checks all required env vars against hasEnv", () => {
    const entry = makeSkillEntry({ env: ["KEY_A", "KEY_B"] });
    // Only KEY_A is satisfied
    const result = shouldIncludeSkill({
      entry,
      eligibility: { hasEnv: (name) => name === "KEY_A" },
    });
    expect(result).toBe(false);
  });

  it("includes skill when all required env vars are satisfied by hasEnv", () => {
    const entry = makeSkillEntry({ env: ["KEY_A", "KEY_B"] });
    const result = shouldIncludeSkill({
      entry,
      eligibility: { hasEnv: () => true },
    });
    expect(result).toBe(true);
  });
});

describe("buildWorkspaceSkillStatus with hasEnv", () => {
  it("marks skill eligible when hasEnv satisfies env requirement", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-"));
    const skillDir = path.join(workspaceDir, "skills", "env-skill");

    await writeSkill({
      dir: skillDir,
      name: "env-skill",
      description: "Needs an API key",
      metadata: '{"openclaw":{"requires":{"env":["PROVIDER_API_KEY"]}}}',
    });

    const report = buildWorkspaceSkillStatus(workspaceDir, {
      managedSkillsDir: path.join(workspaceDir, ".managed"),
      eligibility: { hasEnv: (name) => name === "PROVIDER_API_KEY" },
    });
    const skill = report.skills.find((entry) => entry.name === "env-skill");

    expect(skill).toBeDefined();
    expect(skill?.eligible).toBe(true);
    expect(skill?.missing.env).toEqual([]);
  });

  it("marks skill ineligible when hasEnv does not satisfy env requirement", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-"));
    const skillDir = path.join(workspaceDir, "skills", "env-skill");

    await writeSkill({
      dir: skillDir,
      name: "env-skill",
      description: "Needs an API key",
      metadata: '{"openclaw":{"requires":{"env":["PROVIDER_API_KEY"]}}}',
    });

    const report = buildWorkspaceSkillStatus(workspaceDir, {
      managedSkillsDir: path.join(workspaceDir, ".managed"),
      eligibility: { hasEnv: () => false },
    });
    const skill = report.skills.find((entry) => entry.name === "env-skill");

    expect(skill).toBeDefined();
    expect(skill?.eligible).toBe(false);
    expect(skill?.missing.env).toContain("PROVIDER_API_KEY");
  });

  it("still reports missing env when no eligibility context is provided", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-"));
    const skillDir = path.join(workspaceDir, "skills", "env-skill");

    await writeSkill({
      dir: skillDir,
      name: "env-skill",
      description: "Needs an API key",
      metadata: '{"openclaw":{"requires":{"env":["PROVIDER_API_KEY"]}}}',
    });

    const report = buildWorkspaceSkillStatus(workspaceDir, {
      managedSkillsDir: path.join(workspaceDir, ".managed"),
    });
    const skill = report.skills.find((entry) => entry.name === "env-skill");

    expect(skill).toBeDefined();
    expect(skill?.eligible).toBe(false);
    expect(skill?.missing.env).toContain("PROVIDER_API_KEY");
  });
});
