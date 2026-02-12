import { ChannelType, type APIChannel } from "discord-api-types/v10";
import fs from "node:fs";
import path from "node:path";
import lockfile from "proper-lockfile";
import type { CommandHandler } from "./commands-types.js";
import { resolveAgentWorkspaceDir } from "../../agents/agent-scope.js";
import { createExecTool } from "../../agents/bash-tools.js";
import { callGatewayTool } from "../../agents/tools/gateway.js";
import {
  readConfigFileSnapshot,
  validateConfigObjectWithPlugins,
  writeConfigFile,
} from "../../config/config.js";
import { createChannelDiscord } from "../../discord/send.channels.js";
import { listGuildChannelsDiscord } from "../../discord/send.guild.js";
import { sendMessageDiscord } from "../../discord/send.outbound.js";
import { logVerbose } from "../../globals.js";
import { resolveDigitalOceanAccessToken, sha256Hex } from "../../infra/digitalocean.js";
import { loadJsonFile, saveJsonFile } from "../../infra/json-file.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import {
  inferDoAppSpecTemplateFromRepo,
  parseDoctlProposeCosts,
  resolveDoAppName,
  resolveDoAppSpecPath,
} from "./project-deploy-digitalocean.js";

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
  stale: 2 * 60 * 60_000,
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
  deploy?: {
    digitalocean?: {
      region?: string;
      apps?: Record<string, { appId: string; appName: string; ingress?: string | null }>;
      lastPlan?: Record<
        string,
        {
          createdAtMs: number;
          gitSha: string;
          appName: string;
          region: string;
          specHash: string;
          proposedMonthlyUsd?: number;
          proposedUpgradeMonthlyUsd?: number;
          existingAppId?: string | null;
        }
      >;
    };
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
  | { ok: true; action: "merge" }
  | {
      ok: true;
      action: "deploy";
      subaction: "init" | "plan" | "apply" | "status";
      env: "staging" | "prod";
    };

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

  if (action === "deploy") {
    const sub = args[0]?.toLowerCase();
    const subaction =
      sub === "init" || sub === "plan" || sub === "apply" || sub === "status" ? sub : null;
    if (!subaction) {
      return {
        ok: false,
        error: "Usage: /project deploy init|plan|apply|status [--env staging|prod]",
      };
    }
    let env: "staging" | "prod" = "staging";
    for (let i = 1; i < args.length; i += 1) {
      const tok = args[i];
      if (tok === "--env") {
        const value = (args[i + 1] ?? "").trim().toLowerCase();
        if (value !== "staging" && value !== "prod") {
          return {
            ok: false,
            error: "Usage: /project deploy init|plan|apply|status [--env staging|prod]",
          };
        }
        env = value;
        i += 1;
      }
    }
    return { ok: true, action: "deploy", subaction, env };
  }

  return { ok: false, error: "Usage: /project help|bootstrap|ship|merge|deploy" };
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
  return channels.find(
    (ch) => ch.type === ChannelType.GuildCategory && (ch.name ?? "").toLowerCase() === lowered,
  );
}

function findTextChannelInCategory(
  channels: APIChannel[],
  categoryId: string,
  name: string,
): APIChannel | undefined {
  const lowered = name.trim().toLowerCase();
  return channels.find(
    (ch) =>
      (ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement) &&
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
    "- /project deploy init [--env staging|prod]",
    "- /project deploy plan [--env staging|prod]",
    "- /project deploy apply [--env staging|prod]",
    "- /project deploy status [--env staging|prod]",
  ].join("\n");
}

async function runShell(
  params: Parameters<CommandHandler>[0],
  opts: {
    workdir: string;
    command: string;
    env?: Record<string, string>;
    yieldMs?: number;
    timeoutSec?: number;
    elevatedLevel?: "on" | "full";
  },
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
      defaultLevel: opts.elevatedLevel === "full" ? "full" : "on",
    },
  });

  const result = await execTool.execute("chat-project", {
    command: opts.command,
    workdir: opts.workdir,
    ...(opts.env ? { env: opts.env } : {}),
    yieldMs: opts.yieldMs,
    ...(opts.timeoutSec ? { timeout: opts.timeoutSec } : {}),
    elevated: true,
  });
  const text =
    result.details?.status === "completed"
      ? (result.details.aggregated ?? "")
      : result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
  return { result, text };
}

function isCompletedOk(result: { details?: { status?: string; exitCode?: number | null } }) {
  const details = result.details;
  if (!details) {
    return true;
  }
  if (details.status === "failed") {
    return false;
  }
  if (details.status === "completed") {
    const code = typeof details.exitCode === "number" ? details.exitCode : 0;
    return code === 0;
  }
  return false;
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

async function listDoAppsByName(params: Parameters<CommandHandler>[0], token: string) {
  const { text } = await runShell(params, {
    workdir: params.workspaceDir,
    command: "doctl apps list --output json",
    env: { DIGITALOCEAN_ACCESS_TOKEN: token },
    yieldMs: 60_000,
    timeoutSec: 120,
    elevatedLevel: "full",
  });
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((v) => v && typeof v === "object") as Array<Record<string, unknown>>;
  } catch {
    return [];
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
        ? channelEntry.users.filter((u): u is string => typeof u === "string")
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

      const repoDir = resolveProjectRepoDir(params.workspaceDir);
      if (!fs.existsSync(path.join(repoDir, ".git"))) {
        return {
          shouldContinue: false,
          reply: { text: `⚠️ Repo not found at ${repoDir}.` },
        };
      }

      const state = loadProjectState(params.workspaceDir);
      const prUrl = state?.lastShip?.prUrl?.trim() ?? "";
      if (!prUrl) {
        return {
          shouldContinue: false,
          reply: { text: "⚠️ No PR recorded for this project yet. Run /project ship first." },
        };
      }

      const approvalTimeoutMs = 10 * 60_000;
      const approvalKey = `project.merge:${prUrl}`;
      const approvalRes = await callGatewayTool<{
        id: string;
        decision: string | null;
        createdAtMs: number;
        expiresAtMs: number;
      }>(
        "workflow.approval.create",
        { timeoutMs: 30_000 },
        {
          idempotencyKey: approvalKey,
          kind: "project.merge",
          title: "Enable auto-merge (merge commit)",
          summary: `PR: ${prUrl}`,
          details: {
            prUrl,
            mode: "merge-commit",
            auto: "true",
            deleteBranch: "true",
          },
          agentId: state?.agentId ?? params.agentId ?? null,
          sessionKey: params.sessionKey ?? null,
          timeoutMs: approvalTimeoutMs,
        },
      );
      const approvalId = typeof approvalRes?.id === "string" ? approvalRes.id : "";
      if (!approvalId) {
        return {
          shouldContinue: false,
          reply: { text: "⚠️ Failed to create workflow approval request." },
        };
      }

      const replyTarget = typeof params.ctx.To === "string" ? params.ctx.To.trim() : "";
      const accountId =
        typeof params.ctx.AccountId === "string" ? params.ctx.AccountId.trim() : undefined;

      void (async () => {
        const waitRes = await callGatewayTool<{
          id: string;
          decision: string | null;
          createdAtMs: number;
          expiresAtMs: number;
        }>(
          "workflow.approval.wait",
          { timeoutMs: approvalTimeoutMs + 60_000 },
          { id: approvalId },
        ).catch(() => null);
        const decision =
          waitRes && typeof waitRes === "object" && "decision" in waitRes
            ? (waitRes as { decision?: unknown }).decision
            : null;

        const sendToChannel = async (text: string) => {
          if (!replyTarget) {
            return;
          }
          await sendMessageDiscord(replyTarget, text, { accountId });
        };

        if (decision !== "approve") {
          const status = decision === "deny" ? "denied" : "expired";
          await sendToChannel(`❌ Auto-merge ${status}.\nPR: ${prUrl}`).catch(() => {});
          return;
        }

        try {
          await withProjectLock(params.workspaceDir, async () => {
            // Enable auto-merge with merge commit; GitHub will merge only when mergeable + checks pass.
            const mergeRes = await runShell(params, {
              workdir: repoDir,
              command: `gh pr merge ${JSON.stringify(prUrl)} --merge --auto --delete-branch`,
              yieldMs: 10_000,
              elevatedLevel: "full",
            });
            if (!isCompletedOk(mergeRes.result)) {
              throw new Error(
                mergeRes.text.trim().slice(0, 2000) || "gh pr merge returned a non-zero exit code",
              );
            }
          });
          const previewUrl = state?.lastShip?.previewUrl?.trim() || "";
          await sendToChannel(
            `✅ Auto-merge enabled.\nPR: ${prUrl}${previewUrl ? `\nPreview: ${previewUrl}` : ""}`,
          ).catch(() => {});
        } catch (err) {
          await sendToChannel(`⚠️ Auto-merge failed: ${String(err)}\nPR: ${prUrl}`).catch(() => {});
        }
      })();

      return {
        shouldContinue: false,
        reply: {
          text:
            `🟧 Merge approval requested in DMs (id ${approvalId.slice(0, 8)}…). ` +
            "Approve to enable GitHub auto-merge; I’ll post the result here.",
        },
      };
    } catch (err) {
      return {
        shouldContinue: false,
        reply: { text: `⚠️ /project merge failed: ${String(err)}` },
      };
    }
  }

  if (parsed.action === "deploy") {
    try {
      const elevatedCheck = requireElevated(params);
      if (!elevatedCheck.ok) {
        return { shouldContinue: false, reply: { text: elevatedCheck.error } };
      }

      const repoDir = resolveProjectRepoDir(params.workspaceDir);
      if (!fs.existsSync(path.join(repoDir, ".git"))) {
        return {
          shouldContinue: false,
          reply: { text: `⚠️ Repo not found at ${repoDir}.` },
        };
      }

      const state = loadProjectState(params.workspaceDir);
      const repoSlug = state?.repo?.slug ?? "";
      if (!repoSlug) {
        return {
          shouldContinue: false,
          reply: { text: "⚠️ Project repo metadata missing; re-run /project bootstrap." },
        };
      }

      const resolvedToken = await resolveDigitalOceanAccessToken(params.cfg);
      if (!resolvedToken) {
        return {
          shouldContinue: false,
          reply: {
            text: [
              "⚠️ DigitalOcean is not configured (missing DIGITALOCEAN_ACCESS_TOKEN).",
              "",
              "Recommended setup (Control UI):",
              "- Go to Skills → DigitalOcean → set API key (stored in config with 0600 perms).",
              "",
              "Alternative:",
              "- Export DIGITALOCEAN_ACCESS_TOKEN in the gateway environment.",
            ].join("\n"),
          },
        };
      }

      const env = parsed.env;
      const region = state?.deploy?.digitalocean?.region?.trim() || "nyc1";

      const gitSha = (
        await runShell(params, {
          workdir: repoDir,
          command: "git rev-parse HEAD",
          yieldMs: 10_000,
          elevatedLevel: "full",
        })
      ).text.trim();
      if (!/^[a-f0-9]{7,40}$/i.test(gitSha)) {
        return {
          shouldContinue: false,
          reply: { text: "⚠️ Failed to read git HEAD SHA for this repo." },
        };
      }

      const appName = resolveDoAppName(repoSlug, env);
      const specPath = resolveDoAppSpecPath(repoDir, env);

      if (parsed.subaction === "init") {
        const doDir = path.dirname(specPath);
        ensureDir(doDir);
        const created: string[] = [];

        const writeIfMissing = (targetEnv: "staging" | "prod") => {
          const targetPath = resolveDoAppSpecPath(repoDir, targetEnv);
          if (fs.existsSync(targetPath)) {
            return;
          }
          const template = inferDoAppSpecTemplateFromRepo({
            repoDir,
            repoSlug,
            env: targetEnv,
            region,
          });
          fs.writeFileSync(targetPath, `${JSON.stringify(template, null, 2)}\n`, {
            encoding: "utf8",
            mode: 0o600,
          });
          created.push(targetPath);
        };

        if (env === "staging") {
          writeIfMissing("staging");
        } else {
          writeIfMissing("prod");
        }

        if (created.length === 0) {
          return {
            shouldContinue: false,
            reply: {
              text: [
                "✅ DigitalOcean spec already exists.",
                `Env: ${env}`,
                `Spec: ${specPath}`,
                "",
                `Next: /project deploy plan --env ${env}`,
              ].join("\n"),
            },
          };
        }

        return {
          shouldContinue: false,
          reply: {
            text: [
              "✅ DigitalOcean App Platform spec template created.",
              `Env: ${env}`,
              ...created.map((p) => `- ${p}`),
              "",
              "Next:",
              `- Review/edit the spec file(s) for your repo layout and build/run commands.`,
              `- /project deploy plan --env ${env}`,
            ].join("\n"),
          },
        };
      }

      if (parsed.subaction === "status") {
        const existing = state?.deploy?.digitalocean?.apps?.[env] ?? null;
        const lines: string[] = [];
        lines.push("📦 DigitalOcean deploy status");
        lines.push(`Env: ${env}`);
        lines.push(`Region: ${region}`);
        lines.push(`App name: ${appName}`);
        if (existing?.appId) {
          lines.push(`App: ${existing.appId}`);
        } else {
          lines.push("App: (not created yet)");
        }
        if (existing?.ingress) {
          lines.push(`Ingress: ${existing.ingress}`);
        }
        lines.push("");
        lines.push(`Spec: ${specPath}`);
        return { shouldContinue: false, reply: { text: lines.join("\n") } };
      }

      if (!fs.existsSync(specPath)) {
        return {
          shouldContinue: false,
          reply: {
            text: [
              "⚠️ Missing DigitalOcean App Platform spec for this repo/env.",
              "",
              `Create: ${specPath}`,
              "",
              "Recommended workflow:",
              `- Run: /project deploy init --env ${env}`,
              "- Edit the generated spec to match your repo layout and build/run commands.",
              "- Keep deploy_on_push=false for deterministic approval-gated deploys (defaults to false).",
              "",
              "Then run:",
              `- /project deploy plan --env ${env}`,
            ].join("\n"),
          },
        };
      }

      const rawSpec = fs.readFileSync(specPath, "utf8").trim();
      let renderedSpec: Record<string, unknown>;
      try {
        const parsedSpec = JSON.parse(rawSpec) as unknown;
        if (!parsedSpec || typeof parsedSpec !== "object" || Array.isArray(parsedSpec)) {
          throw new Error("spec must be a JSON object");
        }
        renderedSpec = { ...(parsedSpec as Record<string, unknown>) };
      } catch (err) {
        return {
          shouldContinue: false,
          reply: { text: `⚠️ Invalid JSON in spec (${specPath}): ${String(err)}` },
        };
      }

      // Enforce deterministic name/region defaults.
      renderedSpec.name = appName;
      renderedSpec.region = region;

      const renderedSpecJson = JSON.stringify(renderedSpec, null, 2);
      const specHash = sha256Hex(renderedSpecJson);

      const token = resolvedToken.token;
      const doctlEnv = { DIGITALOCEAN_ACCESS_TOKEN: token };

      // Fast validation (won't create anything).
      const validateCmd = [
        "cat <<'EOF' | doctl apps spec validate --spec -",
        renderedSpecJson,
        "EOF",
      ].join("\n");
      const validateRes = await runShell(params, {
        workdir: repoDir,
        command: validateCmd,
        env: doctlEnv,
        yieldMs: 60_000,
        timeoutSec: 120,
        elevatedLevel: "full",
      });
      if (!isCompletedOk(validateRes.result)) {
        return {
          shouldContinue: false,
          reply: {
            text: [
              "⚠️ Spec validation failed (doctl apps spec validate).",
              "",
              validateRes.text.trim().slice(0, 4000),
            ].join("\n"),
          },
        };
      }

      // Discover existing app (best-effort).
      const apps = await listDoAppsByName(params, token);
      const existingApp = apps.find((a) => {
        const spec = a.spec as Record<string, unknown> | undefined;
        const name = spec && typeof spec.name === "string" ? spec.name : "";
        return name === appName;
      });
      const existingAppId =
        existingApp && typeof existingApp.id === "string" ? existingApp.id : null;

      if (parsed.subaction === "plan") {
        const proposeCmd = [
          `cat <<'EOF' | doctl apps propose --spec - --output json${existingAppId ? ` --app ${existingAppId}` : ""}`,
          renderedSpecJson,
          "EOF",
        ].join("\n");
        const proposeRes = await runShell(params, {
          workdir: repoDir,
          command: proposeCmd,
          env: doctlEnv,
          yieldMs: 90_000,
          timeoutSec: 180,
          elevatedLevel: "full",
        });
        if (!isCompletedOk(proposeRes.result)) {
          return {
            shouldContinue: false,
            reply: {
              text: [
                "⚠️ Cost proposal failed (doctl apps propose).",
                "",
                proposeRes.text.trim().slice(0, 4000),
              ].join("\n"),
            },
          };
        }

        const costs = parseDoctlProposeCosts(proposeRes.text);

        await withProjectLock(params.workspaceDir, async () => {
          const current = loadProjectState(params.workspaceDir);
          if (!current) {
            return;
          }
          const next: ProjectStateV1 = {
            ...current,
            updatedAt: nowIso(),
            deploy: {
              ...(current.deploy ?? undefined),
              digitalocean: {
                ...(current.deploy?.digitalocean ?? undefined),
                region,
                lastPlan: {
                  ...(current.deploy?.digitalocean?.lastPlan ?? undefined),
                  [env]: {
                    createdAtMs: Date.now(),
                    gitSha,
                    appName,
                    region,
                    specHash,
                    existingAppId,
                    ...costs,
                  },
                },
              },
            },
          };
          saveProjectState(params.workspaceDir, next);
        });

        const lines: string[] = [];
        lines.push("🧾 DigitalOcean deploy plan ready.");
        lines.push(`Env: ${env}`);
        lines.push(`Region: ${region}`);
        lines.push(`App: ${appName}${existingAppId ? ` (update ${existingAppId})` : " (create)"}`);
        if (costs.proposedMonthlyUsd !== undefined) {
          lines.push(`Estimated monthly: $${costs.proposedMonthlyUsd.toFixed(2)}`);
        }
        if (costs.proposedUpgradeMonthlyUsd !== undefined) {
          lines.push(`Upgrade delta (monthly): $${costs.proposedUpgradeMonthlyUsd.toFixed(2)}`);
        }
        lines.push(`Commit: ${gitSha.slice(0, 12)}`);
        lines.push("");
        lines.push("Next:");
        lines.push(`- /project deploy apply --env ${env}`);
        return { shouldContinue: false, reply: { text: lines.join("\n") } };
      }

      if (parsed.subaction === "apply") {
        const plan = state?.deploy?.digitalocean?.lastPlan?.[env] ?? null;
        if (!plan) {
          return {
            shouldContinue: false,
            reply: { text: `⚠️ No plan found for ${env}. Run: /project deploy plan --env ${env}` },
          };
        }
        const planAgeMs = Date.now() - plan.createdAtMs;
        if (planAgeMs > 60 * 60_000) {
          return {
            shouldContinue: false,
            reply: {
              text: `⚠️ Plan is older than 60 minutes. Re-run: /project deploy plan --env ${env}`,
            },
          };
        }
        if (plan.specHash !== specHash || plan.gitSha !== gitSha) {
          return {
            shouldContinue: false,
            reply: {
              text: [
                "⚠️ Deploy inputs changed since plan.",
                `Expected commit: ${plan.gitSha.slice(0, 12)}; current: ${gitSha.slice(0, 12)}`,
                `Expected spec hash: ${plan.specHash.slice(0, 10)}…; current: ${specHash.slice(0, 10)}…`,
                "",
                `Re-run: /project deploy plan --env ${env}`,
              ].join("\n"),
            },
          };
        }

        const approvalTimeoutMs = 15 * 60_000;
        const approvalKey = `project.deploy.digitalocean:${repoSlug}:${env}:${plan.specHash}:${plan.gitSha}`;
        const approvalRes = await callGatewayTool<{
          id: string;
          decision: string | null;
          createdAtMs: number;
          expiresAtMs: number;
        }>(
          "workflow.approval.create",
          { timeoutMs: 30_000 },
          {
            idempotencyKey: approvalKey,
            kind: "digitalocean.deploy",
            title: `Deploy to DigitalOcean (${env})`,
            summary: `App: ${appName} (${region}) @ ${gitSha.slice(0, 12)}`,
            details: {
              env,
              region,
              appName,
              gitSha,
              specPath,
              ...(plan.proposedMonthlyUsd !== undefined
                ? { proposedMonthlyUsd: plan.proposedMonthlyUsd.toFixed(2) }
                : {}),
              ...(plan.proposedUpgradeMonthlyUsd !== undefined
                ? { proposedUpgradeMonthlyUsd: plan.proposedUpgradeMonthlyUsd.toFixed(2) }
                : {}),
            },
            agentId: state?.agentId ?? params.agentId ?? null,
            sessionKey: params.sessionKey ?? null,
            timeoutMs: approvalTimeoutMs,
          },
        );
        const approvalId = typeof approvalRes?.id === "string" ? approvalRes.id : "";
        if (!approvalId) {
          return {
            shouldContinue: false,
            reply: { text: "⚠️ Failed to create workflow approval request." },
          };
        }

        const replyTarget = typeof params.ctx.To === "string" ? params.ctx.To.trim() : "";
        const accountId =
          typeof params.ctx.AccountId === "string" ? params.ctx.AccountId.trim() : undefined;

        void (async () => {
          const sendToChannel = async (text: string) => {
            if (!replyTarget) {
              return;
            }
            await sendMessageDiscord(replyTarget, text, { accountId });
          };

          const waitRes = await callGatewayTool<{
            id: string;
            decision: string | null;
            createdAtMs: number;
            expiresAtMs: number;
          }>(
            "workflow.approval.wait",
            { timeoutMs: approvalTimeoutMs + 60_000 },
            { id: approvalId },
          ).catch(() => null);
          const decision =
            waitRes && typeof waitRes === "object" && "decision" in waitRes
              ? (waitRes as { decision?: unknown }).decision
              : null;

          if (decision !== "approve") {
            const status = decision === "deny" ? "denied" : "expired";
            await sendToChannel(`❌ Deploy ${status}.\nEnv: ${env}\nApp: ${appName}`).catch(
              () => {},
            );
            return;
          }

          try {
            await withProjectLock(params.workspaceDir, async () => {
              const applyCmd = [
                "cat <<'EOF' | doctl apps create --spec - --upsert --update-sources --wait --output json",
                renderedSpecJson,
                "EOF",
              ].join("\n");
              const applyRes = await runShell(params, {
                workdir: repoDir,
                command: applyCmd,
                env: doctlEnv,
                yieldMs: 240_000,
                timeoutSec: 900,
                elevatedLevel: "full",
              });
              if (!isCompletedOk(applyRes.result)) {
                throw new Error(
                  `doctl apps create failed: ${applyRes.text.trim().slice(0, 2000) || "(no output)"}`,
                );
              }
              const outRaw = applyRes.text.trim();
              let appId: string | null = null;
              let ingress: string | null = null;
              try {
                const parsedOut = JSON.parse(outRaw) as unknown;
                if (parsedOut && typeof parsedOut === "object") {
                  const obj = parsedOut as Record<string, unknown>;
                  if (typeof obj.id === "string") {
                    appId = obj.id;
                  }
                  if (typeof obj.default_ingress === "string") {
                    ingress = obj.default_ingress;
                  }
                }
              } catch {
                // ignore
              }
              if (!appId) {
                // Fall back: refresh list and look up by name.
                const refreshed = await listDoAppsByName(params, token);
                const match = refreshed.find((a) => {
                  const spec = a.spec as Record<string, unknown> | undefined;
                  const name = spec && typeof spec.name === "string" ? spec.name : "";
                  return name === appName;
                });
                if (match && typeof match.id === "string") {
                  appId = match.id;
                  const di = match.default_ingress;
                  ingress = typeof di === "string" ? di : ingress;
                }
              }

              const current = loadProjectState(params.workspaceDir);
              if (current) {
                const next: ProjectStateV1 = {
                  ...current,
                  updatedAt: nowIso(),
                  deploy: {
                    ...(current.deploy ?? undefined),
                    digitalocean: {
                      ...(current.deploy?.digitalocean ?? undefined),
                      region,
                      apps: {
                        ...(current.deploy?.digitalocean?.apps ?? undefined),
                        [env]: {
                          appId: appId ?? existingAppId ?? "(unknown)",
                          appName,
                          ingress,
                        },
                      },
                    },
                  },
                };
                saveProjectState(params.workspaceDir, next);
              }

              const urlLine = ingress ? `\nIngress: ${ingress}` : "";
              await sendToChannel(
                `✅ Deploy applied.\nEnv: ${env}\nApp: ${appName}${urlLine}`,
              ).catch(() => {});
            });
          } catch (err) {
            await sendToChannel(
              `⚠️ Deploy failed: ${String(err)}\nEnv: ${env}\nApp: ${appName}`,
            ).catch(() => {});
          }
        })();

        return {
          shouldContinue: false,
          reply: {
            text:
              `🟧 Deploy approval requested in DMs (id ${approvalId.slice(0, 8)}…). ` +
              "Approve to provision/update the DigitalOcean app; I’ll post the result here.",
          },
        };
      }

      return { shouldContinue: false, reply: { text: buildUsage() } };
    } catch (err) {
      return {
        shouldContinue: false,
        reply: { text: `⚠️ /project deploy failed: ${String(err)}` },
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
  inferDoAppSpecTemplateFromRepo,
  resolveDoAppName,
};
