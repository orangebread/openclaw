import type { APIChannel } from "discord-api-types/v10";
import fs from "node:fs";
import path from "node:path";
import lockfile from "proper-lockfile";
import type { CommandHandler } from "./commands-types.js";
import { resolveAgentWorkspaceDir } from "../../agents/agent-scope.js";
import { createExecTool } from "../../agents/bash-tools.js";
import {
  readConfigFileSnapshot,
  validateConfigObjectWithPlugins,
  writeConfigFile,
} from "../../config/config.js";
import { createChannelDiscord } from "../../discord/send.channels.js";
import { listGuildChannelsDiscord } from "../../discord/send.guild.js";
import { logVerbose } from "../../globals.js";
import { loadJsonFile, saveJsonFile } from "../../infra/json-file.js";
import { normalizeAgentId } from "../../routing/session-key.js";

const COMMAND = "/project";
const DEFAULT_CATEGORY_NAME = "coding-projects";
const DEFAULT_REPO_SUBDIR = "repo";

const PROJECT_STATE_DIR = ".openclaw";
const PROJECT_STATE_FILE = "project.json";
const PROJECT_LOCK_FILE = "project.lock";

const PROJECT_LOCK_OPTIONS = {
  retries: {
    retries: 10,
    factor: 2,
    minTimeout: 100,
    maxTimeout: 10_000,
    randomize: true,
  },
  stale: 60_000,
} as const;

type ProjectStateV1 = {
  version: 1;
  agentId: string;
  repo?: {
    slug: string;
    url: string;
  };
  discord?: {
    guildId: string;
    categoryName: string;
    channelId: string;
    channelName: string;
  };
  createdAt: string;
  updatedAt: string;
  lastShip?: {
    branch: string;
    baseBranch: string;
    prUrl: string;
    previewUrl?: string | null;
    shippedAt: string;
  };
};

type ParsedProjectCommand =
  | { ok: false; error: string }
  | { ok: true; action: "help" }
  | {
      ok: true;
      action: "bootstrap";
      repo: string;
      categoryName: string;
      agentId?: string;
      channelName?: string;
      clone: boolean;
    }
  | { ok: true; action: "ship"; title?: string }
  | { ok: true; action: "merge" };

function parseProjectCommand(raw: string): ParsedProjectCommand | null {
  const trimmed = raw.trim();
  if (!trimmed.toLowerCase().startsWith(COMMAND)) {
    return null;
  }

  const rest = trimmed.slice(COMMAND.length).trim();
  if (!rest) {
    return { ok: true, action: "help" };
  }

  const tokens = rest.split(/\s+/).filter(Boolean);
  const action = tokens[0]?.toLowerCase();
  const args = tokens.slice(1);

  if (!action || action === "help") {
    return { ok: true, action: "help" };
  }

  if (action === "bootstrap") {
    const repo = args[0]?.trim();
    if (!repo || !repo.includes("/")) {
      return {
        ok: false,
        error:
          "Usage: /project bootstrap <owner>/<repo> [--category <name>] [--agent <id>] [--channel <name>] [--no-clone]",
      };
    }
    let categoryName = DEFAULT_CATEGORY_NAME;
    let agentId: string | undefined;
    let channelName: string | undefined;
    let clone = true;
    for (let i = 1; i < args.length; i += 1) {
      const tok = args[i];
      if (tok === "--category") {
        const value = args[i + 1];
        if (!value) {
          return {
            ok: false,
            error: "Usage: /project bootstrap <owner>/<repo> [--category <name>] ...",
          };
        }
        categoryName = value;
        i += 1;
        continue;
      }
      if (tok === "--agent") {
        const value = args[i + 1];
        if (!value) {
          return {
            ok: false,
            error: "Usage: /project bootstrap <owner>/<repo> [--agent <id>] ...",
          };
        }
        agentId = value;
        i += 1;
        continue;
      }
      if (tok === "--channel") {
        const value = args[i + 1];
        if (!value) {
          return {
            ok: false,
            error: "Usage: /project bootstrap <owner>/<repo> [--channel <name>] ...",
          };
        }
        channelName = value;
        i += 1;
        continue;
      }
      if (tok === "--no-clone") {
        clone = false;
        continue;
      }
    }
    return { ok: true, action: "bootstrap", repo, categoryName, agentId, channelName, clone };
  }

  if (action === "ship") {
    const title = args.length ? args.join(" ").trim() : undefined;
    return { ok: true, action: "ship", title: title || undefined };
  }

  if (action === "merge") {
    return { ok: true, action: "merge" };
  }

  return { ok: false, error: "Usage: /project help|bootstrap|ship|merge" };
}

function slugify(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function defaultAgentIdForRepo(repo: string): string {
  const [owner, name] = repo.split("/", 2).map((s) => slugify(s));
  return normalizeAgentId(`proj-${owner}-${name}`);
}

function defaultChannelNameForRepo(repo: string): string {
  const [owner, name] = repo.split("/", 2).map((s) => slugify(s));
  return `proj-${owner}-${name}`;
}

function isDiscordGuildContext(
  params: Parameters<CommandHandler>[0],
): { ok: true; guildId: string } | { ok: false; error: string } {
  if ((params.ctx.Surface ?? "").toLowerCase() !== "discord") {
    return { ok: false, error: "⚠️ /project is only supported on Discord right now." };
  }
  const guildId = typeof params.ctx.GroupSpace === "string" ? params.ctx.GroupSpace.trim() : "";
  if (!guildId || !/^\d+$/.test(guildId)) {
    return {
      ok: false,
      error: "⚠️ /project bootstrap must be run from a Discord server channel (guild), not a DM.",
    };
  }
  return { ok: true, guildId };
}

function findCategory(channels: APIChannel[], name: string): APIChannel | undefined {
  const lowered = name.trim().toLowerCase();
  return channels.find((ch) => ch.type === 4 && (ch.name ?? "").toLowerCase() === lowered);
}

function findTextChannelInCategory(
  channels: APIChannel[],
  categoryId: string,
  name: string,
): APIChannel | undefined {
  const lowered = name.trim().toLowerCase();
  return channels.find(
    (ch) =>
      (ch.type === 0 || ch.type === 5) &&
      (ch.name ?? "").toLowerCase() === lowered &&
      // Discord APIChannel uses parent_id for category.
      // oxlint-disable-next-line typescript/no-explicit-any
      ((ch as any).parent_id as string | undefined) === categoryId,
  );
}

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function resolveProjectRepoDir(workspaceDir: string): string {
  return path.join(workspaceDir, DEFAULT_REPO_SUBDIR);
}

function resolveProjectStatePath(workspaceDir: string) {
  return path.join(workspaceDir, PROJECT_STATE_DIR, PROJECT_STATE_FILE);
}

function resolveProjectLockPath(workspaceDir: string) {
  return path.join(workspaceDir, PROJECT_STATE_DIR, PROJECT_LOCK_FILE);
}

function ensureProjectLockFile(workspaceDir: string) {
  const lockPath = resolveProjectLockPath(workspaceDir);
  ensureDir(path.dirname(lockPath));
  if (!fs.existsSync(lockPath)) {
    fs.writeFileSync(lockPath, "", { encoding: "utf8", mode: 0o600 });
    try {
      fs.chmodSync(lockPath, 0o600);
    } catch {
      // best-effort
    }
  }
  return lockPath;
}

async function withProjectLock<T>(workspaceDir: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = ensureProjectLockFile(workspaceDir);
  const release = await lockfile.lock(lockPath, PROJECT_LOCK_OPTIONS);
  try {
    return await fn();
  } finally {
    await release();
  }
}

function nowIso() {
  return new Date().toISOString();
}

function loadProjectState(workspaceDir: string): ProjectStateV1 | null {
  const loaded = loadJsonFile(resolveProjectStatePath(workspaceDir));
  if (!loaded || typeof loaded !== "object") {
    return null;
  }
  const v = loaded as Partial<ProjectStateV1>;
  if (v.version !== 1 || typeof v.agentId !== "string") {
    return null;
  }
  return v as ProjectStateV1;
}

function saveProjectState(workspaceDir: string, state: ProjectStateV1) {
  saveJsonFile(resolveProjectStatePath(workspaceDir), state);
}

function buildUsage(): string {
  return [
    "⚙️ Usage:",
    "- /project bootstrap <owner>/<repo> [--category coding-projects] [--agent <id>] [--channel <name>] [--no-clone]",
    "- /project ship [title]",
    "- /project merge",
  ].join("\n");
}

async function runShell(
  params: Parameters<CommandHandler>[0],
  opts: { workdir: string; command: string; yieldMs?: number },
) {
  const execTool = createExecTool({
    scopeKey: "chat:project",
    allowBackground: true,
    timeoutSec: params.cfg.tools?.exec?.timeoutSec,
    sessionKey: params.sessionKey,
    notifyOnExit: params.cfg.tools?.exec?.notifyOnExit,
    elevated: {
      enabled: params.elevated.enabled,
      allowed: params.elevated.allowed,
      defaultLevel: "on",
    },
  });

  const result = await execTool.execute("chat-project", {
    command: opts.command,
    workdir: opts.workdir,
    yieldMs: opts.yieldMs,
    elevated: true,
  });
  const text =
    result.details?.status === "completed"
      ? (result.details.aggregated ?? "")
      : result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
  return { result, text };
}

function requireElevated(
  params: Parameters<CommandHandler>[0],
): { ok: true } | { ok: false; error: string } {
  if (params.elevated.enabled && params.elevated.allowed) {
    return { ok: true };
  }
  const failures = params.elevated.failures;
  const gates = failures.length
    ? failures.map((f) => `${f.gate} (${f.key})`).join(", ")
    : "tools.elevated.enabled + tools.elevated.allowFrom.<provider>";
  return {
    ok: false,
    error: [
      "⚠️ This command needs elevated exec to run git/gh on the gateway host.",
      `Failing gates: ${gates}`,
      "Fix-it keys:",
      "- tools.elevated.enabled",
      "- tools.elevated.allowFrom.discord",
      "- agents.list[].tools.elevated.enabled",
      "- agents.list[].tools.elevated.allowFrom.discord",
    ].join("\n"),
  };
}

function extractUrls(text: string): string[] {
  const urls = text.match(/https?:\/\/[^\s)>"]+/g) ?? [];
  const unique = Array.from(new Set(urls.map((u) => u.replace(/[.,;]+$/g, ""))));
  return unique;
}

function extractUrlsFromJson(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const strings: string[] = [];
    const visit = (value: unknown) => {
      if (strings.length >= 10_000) {
        return;
      }
      if (typeof value === "string") {
        if (value.trim()) {
          strings.push(value);
        }
        return;
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          visit(item);
        }
        return;
      }
      if (value && typeof value === "object") {
        for (const v of Object.values(value as Record<string, unknown>)) {
          visit(v);
        }
      }
    };
    visit(parsed);
    return extractUrls(strings.join("\n"));
  } catch {
    return extractUrls(raw);
  }
}

function pickPreviewUrl(urls: string[]): string | undefined {
  const preferred = ["vercel.app", "netlify.app", "fly.dev", "ondigitalocean.app", "pages.dev"];
  for (const host of preferred) {
    const match = urls.find((u) => u.includes(host));
    if (match) {
      return match;
    }
  }
  return urls[0];
}

async function tryWritePreviewLink(workspaceDir: string, prUrl: string, previewUrl?: string) {
  try {
    const dir = path.join(workspaceDir, "preview");
    ensureDir(dir);
    const outPath = path.join(dir, "last.json");
    fs.writeFileSync(
      outPath,
      JSON.stringify(
        { prUrl, previewUrl: previewUrl ?? null, updatedAt: new Date().toISOString() },
        null,
        2,
      ),
      "utf-8",
    );
  } catch {
    // best-effort
  }
}

export const handleProjectCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }

  const parsed = parseProjectCommand(params.command.commandBodyNormalized);
  if (!parsed) {
    return null;
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /project from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }
  if (!parsed.ok) {
    return { shouldContinue: false, reply: { text: `⚠️ ${parsed.error}\n\n${buildUsage()}` } };
  }

  if (parsed.action === "help") {
    return { shouldContinue: false, reply: { text: buildUsage() } };
  }

  if (parsed.action === "bootstrap") {
    try {
      const ctxGuild = isDiscordGuildContext(params);
      if (!ctxGuild.ok) {
        return { shouldContinue: false, reply: { text: ctxGuild.error } };
      }
      const senderId = typeof params.ctx.SenderId === "string" ? params.ctx.SenderId.trim() : "";
      if (!senderId || !/^\d+$/.test(senderId)) {
        return {
          shouldContinue: false,
          reply: { text: "⚠️ Missing Discord sender id in context." },
        };
      }

      const agentId = normalizeAgentId(parsed.agentId ?? defaultAgentIdForRepo(parsed.repo));
      const channelName = parsed.channelName ?? defaultChannelNameForRepo(parsed.repo);

      let channels: APIChannel[];
      try {
        channels = await listGuildChannelsDiscord(ctxGuild.guildId);
      } catch (err) {
        return {
          shouldContinue: false,
          reply: { text: `⚠️ Failed to list Discord channels: ${String(err)}` },
        };
      }

      let category = findCategory(channels, parsed.categoryName);
      if (!category) {
        try {
          category = await createChannelDiscord({
            guildId: ctxGuild.guildId,
            name: parsed.categoryName,
            type: 4,
          });
          channels = [...channels, category];
        } catch (err) {
          return {
            shouldContinue: false,
            reply: {
              text: `⚠️ Failed to create category "${parsed.categoryName}": ${String(err)}`,
            },
          };
        }
      }

      let projectChannel = findTextChannelInCategory(channels, category.id, channelName);
      if (!projectChannel) {
        try {
          projectChannel = await createChannelDiscord({
            guildId: ctxGuild.guildId,
            name: channelName,
            type: 0,
            parentId: category.id,
            topic: `Project: ${parsed.repo}`,
          });
          channels = [...channels, projectChannel];
        } catch (err) {
          return {
            shouldContinue: false,
            reply: { text: `⚠️ Failed to create channel "${channelName}": ${String(err)}` },
          };
        }
      }

      const snapshot = await readConfigFileSnapshot();
      if (!snapshot.valid || !snapshot.parsed || typeof snapshot.parsed !== "object") {
        return {
          shouldContinue: false,
          reply: { text: "⚠️ Config file is invalid; fix it before using /project." },
        };
      }
      const next = structuredClone(snapshot.parsed as Record<string, unknown>);

      // Ensure agents.list contains this agent id (minimal entry).
      const agents = (next.agents ?? {}) as Record<string, unknown>;
      const listRaw = agents.list;
      const list = Array.isArray(listRaw) ? (listRaw as Array<Record<string, unknown>>) : [];
      const hasAgent = list.some(
        (entry) => typeof entry?.id === "string" && normalizeAgentId(entry.id) === agentId,
      );
      if (!hasAgent) {
        list.push({ id: agentId, name: `Project ${parsed.repo}` });
        agents.list = list;
        next.agents = agents;
      }

      // Ensure bindings entry mapping discord channel -> agent.
      const bindingsRaw = (next.bindings ?? []) as unknown;
      const bindings = Array.isArray(bindingsRaw)
        ? (bindingsRaw as Array<Record<string, unknown>>)
        : [];
      const channelId = projectChannel.id;
      const hasBinding = bindings.some((b) => {
        const match = (b.match ?? {}) as Record<string, unknown>;
        const peer = (match.peer ?? {}) as Record<string, unknown>;
        return (
          typeof b.agentId === "string" &&
          normalizeAgentId(b.agentId) === agentId &&
          typeof match.channel === "string" &&
          match.channel.toLowerCase() === "discord" &&
          typeof peer.kind === "string" &&
          peer.kind === "channel" &&
          typeof peer.id === "string" &&
          peer.id === channelId
        );
      });
      if (!hasBinding) {
        bindings.push({
          agentId,
          match: { channel: "discord", peer: { kind: "channel", id: channelId } },
        });
        next.bindings = bindings;
      }

      // Ensure channel allowlist entry exists for the new channel.
      const channelsCfg = (next.channels ?? {}) as Record<string, unknown>;
      const discordCfg = (channelsCfg.discord ?? {}) as Record<string, unknown>;
      const guilds = (discordCfg.guilds ?? {}) as Record<string, unknown>;
      const guildEntry = ((guilds[ctxGuild.guildId] ?? {}) as Record<string, unknown>) || {};
      const guildChannels = (guildEntry.channels ?? {}) as Record<string, unknown>;
      const channelEntry = ((guildChannels[channelId] ?? {}) as Record<string, unknown>) || {};
      if (channelEntry.allow !== true) {
        channelEntry.allow = true;
      }
      if (channelEntry.requireMention !== false) {
        channelEntry.requireMention = false;
      }
      const users = Array.isArray(channelEntry.users)
        ? ((channelEntry.users as unknown[]).filter((u) => typeof u === "string") as string[])
        : [];
      if (!users.includes(senderId)) {
        users.push(senderId);
      }
      channelEntry.users = users;
      guildChannels[channelId] = channelEntry;
      guildEntry.channels = guildChannels;
      if (guildEntry.requireMention !== false) {
        guildEntry.requireMention = false;
      }
      guilds[ctxGuild.guildId] = guildEntry;
      discordCfg.guilds = guilds;
      channelsCfg.discord = discordCfg;
      next.channels = channelsCfg;

      const validated = validateConfigObjectWithPlugins(next);
      if (!validated.ok) {
        const issue = validated.issues[0];
        return {
          shouldContinue: false,
          reply: {
            text: `⚠️ Config invalid after project bootstrap (${issue.path}: ${issue.message}).`,
          },
        };
      }
      await writeConfigFile(validated.config);

      let cloneResult = "";
      if (parsed.clone) {
        const elevatedCheck = requireElevated(params);
        if (!elevatedCheck.ok) {
          cloneResult = `\n\n${elevatedCheck.error}`;
        } else {
          const cfgAfter = validated.config;
          const agentWorkspace = resolveAgentWorkspaceDir(cfgAfter, agentId);
          ensureDir(agentWorkspace);
          const repoDir = resolveProjectRepoDir(agentWorkspace);
          ensureDir(repoDir);
          const isGit = fs.existsSync(path.join(repoDir, ".git"));
          if (!isGit) {
            const gitClone = `git clone https://github.com/${parsed.repo}.git .`;
            const { result } = await runShell(params, {
              workdir: repoDir,
              command: gitClone,
              yieldMs: 10_000,
            });
            if (result.details?.status === "running") {
              cloneResult =
                "\n\n⚠️ Clone still running in background; use /bash poll to inspect sessions (scope chat:project).";
            }
          }
        }
      }

      // Persist per-project state in the project agent workspace (idempotent, best-effort).
      try {
        const cfgAfter = validated.config;
        const agentWorkspace = resolveAgentWorkspaceDir(cfgAfter, agentId);
        ensureDir(agentWorkspace);
        const existingState = loadProjectState(agentWorkspace);
        const createdAt = existingState?.createdAt ?? nowIso();
        const nextState: ProjectStateV1 = {
          version: 1,
          agentId,
          repo: { slug: parsed.repo, url: `https://github.com/${parsed.repo}` },
          discord: {
            guildId: ctxGuild.guildId,
            categoryName: parsed.categoryName,
            channelId: projectChannel.id,
            channelName: projectChannel.name ?? channelName,
          },
          createdAt,
          updatedAt: nowIso(),
          lastShip: existingState?.lastShip,
        };
        saveProjectState(agentWorkspace, nextState);
      } catch {
        // best-effort
      }

      const reply = [
        "✅ Project bootstrap complete.",
        `Repo: ${parsed.repo}`,
        `AgentId: ${agentId}`,
        `Category: ${parsed.categoryName}`,
        `ChannelId: ${projectChannel.id}`,
        `Channel: #${projectChannel.name ?? channelName}`,
        "",
        "Next:",
        `- Go to the project channel and talk to the bot there.`,
        `- When ready to open a PR, run: /project ship <title>`,
        cloneResult ? cloneResult.trimEnd() : "",
      ]
        .filter(Boolean)
        .join("\n");
      return { shouldContinue: false, reply: { text: reply } };
    } catch (err) {
      return {
        shouldContinue: false,
        reply: { text: `⚠️ /project bootstrap failed: ${String(err)}` },
      };
    }
  }

  if (parsed.action === "ship") {
    try {
      const elevatedCheck = requireElevated(params);
      if (!elevatedCheck.ok) {
        return { shouldContinue: false, reply: { text: elevatedCheck.error } };
      }

      return await withProjectLock(params.workspaceDir, async () => {
        const repoDir = resolveProjectRepoDir(params.workspaceDir);
        if (!fs.existsSync(path.join(repoDir, ".git"))) {
          return {
            shouldContinue: false,
            reply: {
              text: `⚠️ Repo not found at ${repoDir}. Run /project bootstrap (or clone manually).`,
            },
          };
        }

        const messageSid =
          typeof params.ctx.MessageSid === "string" ? params.ctx.MessageSid.trim() : "";
        const sid = messageSid ? messageSid.slice(0, 8) : String(Date.now()).slice(-8);

        const title = parsed.title ?? "OpenClaw changes";
        const branch = `openclaw/${new Date().toISOString().slice(0, 10)}/${sid}`;

        // Determine base branch from origin/HEAD (fallback main).
        const { text: headRefText } = await runShell(params, {
          workdir: repoDir,
          command: "git symbolic-ref --quiet refs/remotes/origin/HEAD || true",
        });
        const baseBranch = headRefText.trim().split("/").pop() || "main";

        await runShell(params, {
          workdir: repoDir,
          command: `git fetch origin ${baseBranch}`,
          yieldMs: 10_000,
        });

        const { text: currentBranchText } = await runShell(params, {
          workdir: repoDir,
          command: "git rev-parse --abbrev-ref HEAD || true",
        });
        const currentBranch = currentBranchText.trim().split(/\s+/)[0] ?? "";

        // Avoid stomping existing work: only create a new branch when on base (or detached).
        const effectiveBranch =
          currentBranch && currentBranch !== "HEAD" && currentBranch !== baseBranch
            ? currentBranch
            : branch;
        if (effectiveBranch !== currentBranch) {
          await runShell(params, {
            workdir: repoDir,
            command: `git checkout -B ${effectiveBranch}`,
            yieldMs: 10_000,
          });
        }

        await runShell(params, { workdir: repoDir, command: "git add -A", yieldMs: 10_000 });
        const { text: stagedCheckText } = await runShell(params, {
          workdir: repoDir,
          command: "git diff --cached --quiet && echo CLEAN || echo DIRTY",
        });

        if (!stagedCheckText.trim().endsWith("CLEAN")) {
          await runShell(params, {
            workdir: repoDir,
            command: `git commit -m ${JSON.stringify(title)}`,
            yieldMs: 10_000,
          });
        }

        const { text: aheadText } = await runShell(params, {
          workdir: repoDir,
          command: `git rev-list --count origin/${baseBranch}..HEAD || true`,
        });
        const aheadCount = Number.parseInt(aheadText.trim(), 10);
        if (
          stagedCheckText.trim().endsWith("CLEAN") &&
          (!Number.isFinite(aheadCount) || aheadCount <= 0)
        ) {
          return {
            shouldContinue: false,
            reply: {
              text: "⚠️ Nothing to ship (no commits or staged changes vs base).",
            },
          };
        }

        await runShell(params, {
          workdir: repoDir,
          command: `git push -u origin ${effectiveBranch}`,
          yieldMs: 10_000,
        });

        // Create PR if missing (gh exits non-zero when PR not found).
        await runShell(params, {
          workdir: repoDir,
          command: `gh pr view --head ${JSON.stringify(effectiveBranch)} --json url,number --jq '.url' >/dev/null 2>&1 || gh pr create --title ${JSON.stringify(title)} --body "" --head ${JSON.stringify(effectiveBranch)} --base ${JSON.stringify(baseBranch)}`,
          yieldMs: 10_000,
        });

        // Print PR URL.
        const { text: prUrlText } = await runShell(params, {
          workdir: repoDir,
          command: `gh pr view --head ${JSON.stringify(effectiveBranch)} --json url,number --jq '.url'`,
        });
        const prUrl = prUrlText.trim().split(/\s+/)[0] ?? "";
        if (!prUrl.startsWith("http")) {
          return {
            shouldContinue: false,
            reply: {
              text: `⚠️ Failed to resolve PR URL (got: ${prUrlText.trim() || "(empty)"}).`,
            },
          };
        }

        // Best-effort preview detection from PR metadata.
        const { text: previewText } = await runShell(params, {
          workdir: repoDir,
          command: "gh pr view --json url,comments,statusCheckRollup 2>/dev/null || true",
        });
        const urls = extractUrlsFromJson(previewText);
        const previewUrl = pickPreviewUrl(urls.filter((u) => u !== prUrl));
        await tryWritePreviewLink(params.workspaceDir, prUrl, previewUrl);

        // Best-effort change summary (deterministic vs base).
        const { text: nameStatusText } = await runShell(params, {
          workdir: repoDir,
          command: `git diff --name-status origin/${baseBranch}...HEAD || true`,
        });
        const changedFiles = nameStatusText
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);

        // Persist ship metadata for follow-ups (best-effort).
        try {
          const existing = loadProjectState(params.workspaceDir);
          const createdAt = existing?.createdAt ?? nowIso();
          saveProjectState(params.workspaceDir, {
            version: 1,
            agentId: existing?.agentId ?? normalizeAgentId(params.agentId ?? "default"),
            repo: existing?.repo,
            discord: existing?.discord,
            createdAt,
            updatedAt: nowIso(),
            lastShip: {
              branch: effectiveBranch,
              baseBranch,
              prUrl,
              previewUrl: previewUrl ?? null,
              shippedAt: nowIso(),
            },
          });
        } catch {
          // best-effort
        }

        const lines: string[] = [];
        lines.push("✅ PR opened.");
        lines.push(`PR: ${prUrl}`);
        if (previewUrl) {
          lines.push(`Preview: ${previewUrl}`);
        } else {
          lines.push("Preview: (not detected yet)");
        }
        if (changedFiles.length > 0) {
          lines.push("");
          lines.push("Changelog (name-status):");
          for (const entry of changedFiles.slice(0, 50)) {
            lines.push(`- ${entry}`);
          }
          if (changedFiles.length > 50) {
            lines.push("- …");
          }
        }
        lines.push("");
        lines.push("Next:");
        lines.push("- Wait for checks to go green.");
        lines.push("- When you want auto-merge (merge commit) enabled, run: /project merge");
        return { shouldContinue: false, reply: { text: lines.join("\n") } };
      });
    } catch (err) {
      return {
        shouldContinue: false,
        reply: { text: `⚠️ /project ship failed: ${String(err)}` },
      };
    }
  }

  if (parsed.action === "merge") {
    try {
      const elevatedCheck = requireElevated(params);
      if (!elevatedCheck.ok) {
        return { shouldContinue: false, reply: { text: elevatedCheck.error } };
      }

      return await withProjectLock(params.workspaceDir, async () => {
        const repoDir = resolveProjectRepoDir(params.workspaceDir);
        if (!fs.existsSync(path.join(repoDir, ".git"))) {
          return {
            shouldContinue: false,
            reply: { text: `⚠️ Repo not found at ${repoDir}.` },
          };
        }

        // Enable auto-merge with merge commit; GitHub will merge only when mergeable + checks pass.
        const { text } = await runShell(params, {
          workdir: repoDir,
          command: "gh pr merge --merge --auto --delete-branch",
          yieldMs: 10_000,
        });
        const msg = text.trim() || "Auto-merge requested.";
        return { shouldContinue: false, reply: { text: `✅ ${msg}` } };
      });
    } catch (err) {
      return {
        shouldContinue: false,
        reply: { text: `⚠️ /project merge failed: ${String(err)}` },
      };
    }
  }

  return null;
};

export const _testOnly = {
  extractUrls,
  extractUrlsFromJson,
  pickPreviewUrl,
  parseProjectCommand,
  defaultAgentIdForRepo,
  defaultChannelNameForRepo,
};
