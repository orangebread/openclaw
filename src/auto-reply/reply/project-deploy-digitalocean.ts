import fs from "node:fs";
import path from "node:path";

type PackageManager = "npm" | "pnpm" | "yarn";
type AppComponentKind = "web-static" | "web-service" | "api-service";
type AppComponentCandidate = {
  relDir: string;
  kind: AppComponentKind;
  pm: PackageManager;
  scripts: Record<string, string>;
  deps: Record<string, string>;
};

function slugify(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function readJsonFileSafe(pathname: string): unknown {
  try {
    const raw = fs.readFileSync(pathname, "utf8");
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getPackageJsonDeps(pkg: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    const deps = pkg[key];
    if (!isPlainRecord(deps)) {
      continue;
    }
    for (const [name, version] of Object.entries(deps)) {
      if (typeof version === "string") {
        out[name] = version;
      }
    }
  }
  return out;
}

function getPackageJsonScripts(pkg: Record<string, unknown>): Record<string, string> {
  const scripts = pkg.scripts;
  if (!isPlainRecord(scripts)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(scripts)) {
    if (typeof value === "string") {
      out[name] = value;
    }
  }
  return out;
}

function resolvePackageManagerForDir(
  repoDir: string,
  relDir: string,
  pkg: Record<string, unknown>,
): PackageManager {
  const packageManager = typeof pkg.packageManager === "string" ? pkg.packageManager.trim() : "";
  if (packageManager.startsWith("pnpm@")) {
    return "pnpm";
  }
  if (packageManager.startsWith("yarn@")) {
    return "yarn";
  }
  if (packageManager.startsWith("npm@")) {
    return "npm";
  }

  const dir = path.join(repoDir, relDir);
  if (fs.existsSync(path.join(dir, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (fs.existsSync(path.join(dir, "yarn.lock"))) {
    return "yarn";
  }
  if (fs.existsSync(path.join(dir, "package-lock.json"))) {
    return "npm";
  }
  if (fs.existsSync(path.join(repoDir, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (fs.existsSync(path.join(repoDir, "yarn.lock"))) {
    return "yarn";
  }
  if (fs.existsSync(path.join(repoDir, "package-lock.json"))) {
    return "npm";
  }
  return "npm";
}

function buildInstallAndRunCommands(
  pm: PackageManager,
  params: { hasBuild: boolean; hasStart: boolean; hasDev: boolean },
) {
  const install =
    pm === "pnpm"
      ? "corepack enable && pnpm install --frozen-lockfile"
      : pm === "yarn"
        ? "corepack enable && yarn install --frozen-lockfile"
        : "npm ci";
  const build = params.hasBuild
    ? pm === "pnpm"
      ? "pnpm run build"
      : pm === "yarn"
        ? "yarn build"
        : "npm run build"
    : "";
  const start = params.hasStart
    ? pm === "pnpm"
      ? "pnpm run start"
      : pm === "yarn"
        ? "yarn start"
        : "npm run start"
    : params.hasDev
      ? pm === "pnpm"
        ? "pnpm run dev"
        : pm === "yarn"
          ? "yarn dev"
          : "npm run dev"
      : "";
  return { install, build, start };
}

function toPosixRelPath(rel: string): string {
  return rel.split(path.sep).join("/").replace(/\/+/g, "/");
}

function toDoSourceDir(relDir: string): string {
  const normalized = toPosixRelPath(relDir.trim());
  if (!normalized || normalized === ".") {
    return "/";
  }
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function classifyPackageJsonCandidate(params: {
  relDir: string;
  pkg: Record<string, unknown>;
  repoDir: string;
}): AppComponentCandidate | null {
  const deps = getPackageJsonDeps(params.pkg);
  const scripts = getPackageJsonScripts(params.pkg);
  const pm = resolvePackageManagerForDir(params.repoDir, params.relDir, params.pkg);
  const relLower = params.relDir.toLowerCase();
  const has = (name: string) => name in deps;
  const hasScript = (name: string) => Boolean(scripts[name]?.trim());

  const isWebDir =
    relLower.includes("frontend") ||
    relLower.includes("client") ||
    relLower.includes("web") ||
    relLower.includes("apps/web");
  const isApiDir =
    relLower.includes("backend") ||
    relLower.includes("server") ||
    relLower.includes("api") ||
    relLower.includes("apps/api");

  if (has("next") || hasScript("next")) {
    return { relDir: params.relDir, kind: "web-service", pm, scripts, deps };
  }
  if (has("react-scripts")) {
    return { relDir: params.relDir, kind: "web-static", pm, scripts, deps };
  }
  if (has("vite") || hasScript("vite")) {
    return { relDir: params.relDir, kind: "web-static", pm, scripts, deps };
  }
  if (has("astro")) {
    return { relDir: params.relDir, kind: "web-static", pm, scripts, deps };
  }
  if (has("gatsby")) {
    return { relDir: params.relDir, kind: "web-static", pm, scripts, deps };
  }

  const looksLikeApi =
    isApiDir ||
    has("@nestjs/core") ||
    has("express") ||
    has("fastify") ||
    has("koa") ||
    has("hono") ||
    has("elysia");
  const looksLikeWeb = isWebDir;

  if (looksLikeApi || (hasScript("start") && !looksLikeWeb)) {
    return { relDir: params.relDir, kind: "api-service", pm, scripts, deps };
  }
  if (looksLikeWeb && (hasScript("start") || hasScript("dev") || hasScript("build"))) {
    return { relDir: params.relDir, kind: "web-service", pm, scripts, deps };
  }

  return null;
}

function findPackageJsonCandidates(repoDir: string, opts: { maxDepth: number; maxFiles: number }) {
  const results: string[] = [];
  const denied = new Set([
    "node_modules",
    ".git",
    ".openclaw",
    ".do",
    "dist",
    "build",
    "coverage",
    ".next",
    "out",
  ]);
  const walk = (rel: string, depth: number) => {
    if (results.length >= opts.maxFiles) {
      return;
    }
    const abs = path.join(repoDir, rel);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= opts.maxFiles) {
        return;
      }
      const name = entry.name;
      if (denied.has(name)) {
        continue;
      }
      const childRel = rel ? path.join(rel, name) : name;
      if (entry.isFile() && name === "package.json") {
        results.push(childRel);
        continue;
      }
      if (entry.isDirectory() && depth < opts.maxDepth) {
        walk(childRel, depth + 1);
      }
    }
  };
  walk("", 0);
  return results;
}

export function resolveDoAppSpecPath(repoDir: string, env: "staging" | "prod"): string {
  return path.join(repoDir, ".do", `app.${env}.json`);
}

export function resolveDoAppName(repoSlug: string, env: "staging" | "prod"): string {
  const [owner, name] = repoSlug.split("/", 2).map((s) => slugify(s));
  const envSuffix = env === "prod" ? "prod" : "staging";
  const maxLen = 32;
  const maxCoreLen = Math.max(2, maxLen - envSuffix.length - 1);
  let core = `openclaw-${owner}-${name}`.replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  if (!core || core.length < 2) {
    core = "openclaw-app";
  }
  if (core.length > maxCoreLen) {
    core = core.slice(0, maxCoreLen).replace(/-+$/g, "");
  }
  if (!core) {
    core = "openclaw-app".slice(0, maxCoreLen).replace(/-+$/g, "");
  }

  let out = `${core}-${envSuffix}`;
  out = out.replace(/[^a-z0-9-]+/g, "").toLowerCase();
  if (!out || out.length < 2) {
    out = "openclaw-app";
  }
  if (out.length > maxLen) {
    out = out.slice(0, maxLen).replace(/-+$/g, "");
  }
  if (!/^[a-z]/.test(out)) {
    out = `a${out}`.slice(0, maxLen).replace(/-+$/g, "");
  }
  if (!/[a-z0-9]$/.test(out)) {
    out = out.replace(/[^a-z0-9]+$/g, "");
  }
  if (out.length < 2) {
    out = "openclaw-app";
  }
  return out;
}

function extractNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

function pickFirstNumberByKey(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const n = extractNumber(obj[key]);
    if (n !== null) {
      return n;
    }
  }
  return null;
}

export function parseDoctlProposeCosts(raw: string): {
  proposedMonthlyUsd?: number;
  proposedUpgradeMonthlyUsd?: number;
} {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const obj = parsed as Record<string, unknown>;
    const proposedMonthlyUsd = pickFirstNumberByKey(obj, [
      "app_cost",
      "monthly_cost",
      "cost_monthly",
      "cost",
    ]);
    const proposedUpgradeMonthlyUsd = pickFirstNumberByKey(obj, [
      "app_upgrade_cost",
      "upgrade_monthly_cost",
      "upgrade_cost_monthly",
      "upgrade_cost",
    ]);
    return {
      ...(proposedMonthlyUsd !== null ? { proposedMonthlyUsd } : {}),
      ...(proposedUpgradeMonthlyUsd !== null ? { proposedUpgradeMonthlyUsd } : {}),
    };
  } catch {
    return {};
  }
}

export function inferDoAppSpecTemplateFromRepo(params: {
  repoDir: string;
  repoSlug: string;
  env: "staging" | "prod";
  region: string;
}): Record<string, unknown> {
  const [owner, name] = params.repoSlug.split("/", 2);
  const repo = owner && name ? `${owner}/${name}` : params.repoSlug;
  const size = params.env === "prod" ? "basic-xs" : "basic-xxs";

  const rootPkgRaw = readJsonFileSafe(path.join(params.repoDir, "package.json"));
  const rootHasWorkspaces = (() => {
    if (fs.existsSync(path.join(params.repoDir, "pnpm-workspace.yaml"))) {
      return true;
    }
    if (!isPlainRecord(rootPkgRaw)) {
      return false;
    }
    const ws = rootPkgRaw.workspaces;
    if (Array.isArray(ws)) {
      return ws.length > 0;
    }
    if (isPlainRecord(ws)) {
      const pkgs = ws.packages;
      return Array.isArray(pkgs) && pkgs.length > 0;
    }
    return false;
  })();

  const usesWorkspaceDeps = (c: AppComponentCandidate) =>
    Object.values(c.deps).some((v) => typeof v === "string" && v.trim().startsWith("workspace:"));

  const candidates = findPackageJsonCandidates(params.repoDir, { maxDepth: 4, maxFiles: 32 })
    .map((relPath) => {
      const relDir = path.dirname(relPath) === "." ? "." : path.dirname(relPath);
      const pkgRaw = readJsonFileSafe(path.join(params.repoDir, relPath));
      if (!isPlainRecord(pkgRaw)) {
        return null;
      }
      return classifyPackageJsonCandidate({ relDir, pkg: pkgRaw, repoDir: params.repoDir });
    })
    .filter((v): v is AppComponentCandidate => Boolean(v));

  const preferDir = (needle: string) => (c: AppComponentCandidate) =>
    c.relDir.toLowerCase().includes(needle);

  const pickFirst = (
    list: AppComponentCandidate[],
    preds: Array<(c: AppComponentCandidate) => boolean>,
  ) => {
    for (const pred of preds) {
      const found = list.find(pred);
      if (found) {
        return found;
      }
    }
    return list[0] ?? null;
  };

  const webCandidates = candidates.filter(
    (c) => c.kind === "web-static" || c.kind === "web-service",
  );
  const apiCandidates = candidates.filter((c) => c.kind === "api-service");

  const web = pickFirst(webCandidates, [
    preferDir("apps/web"),
    preferDir("web"),
    preferDir("frontend"),
    preferDir("client"),
    (c) => c.relDir === ".",
  ]);
  const api = pickFirst(apiCandidates, [
    preferDir("apps/api"),
    preferDir("api"),
    preferDir("server"),
    preferDir("backend"),
  ]);

  const services: Array<Record<string, unknown>> = [];
  const staticSites: Array<Record<string, unknown>> = [];
  const ingressRules: Array<Record<string, unknown>> = [];

  const addWebStatic = (c: AppComponentCandidate) => {
    const useRootSourceDir = rootHasWorkspaces && c.relDir !== "." && usesWorkspaceDeps(c);
    const sourceDir = toDoSourceDir(useRootSourceDir ? "/" : c.relDir);
    const cdPrefix = useRootSourceDir ? `cd ${toPosixRelPath(c.relDir)} && ` : "";
    const cmds = buildInstallAndRunCommands(c.pm, {
      hasBuild: Boolean(c.scripts.build),
      hasStart: Boolean(c.scripts.start),
      hasDev: Boolean(c.scripts.dev),
    });
    const outputDir = c.deps["react-scripts"]
      ? "build"
      : c.deps.astro
        ? "dist"
        : c.deps.gatsby
          ? "public"
          : "dist";
    staticSites.push({
      name: "web",
      github: { repo, branch: "main", deploy_on_push: false },
      source_dir: sourceDir,
      environment_slug: "html",
      ...(cmds.build
        ? {
            build_command: `${cmds.install} && ${cdPrefix}${cmds.build}`,
          }
        : {}),
      output_dir: outputDir,
    });
    ingressRules.push({
      match: { path: { prefix: "/" } },
      component: { name: "web" },
    });
  };

  const addWebService = (c: AppComponentCandidate) => {
    const useRootSourceDir = rootHasWorkspaces && c.relDir !== "." && usesWorkspaceDeps(c);
    const sourceDir = toDoSourceDir(useRootSourceDir ? "/" : c.relDir);
    const cdPrefix = useRootSourceDir ? `cd ${toPosixRelPath(c.relDir)} && ` : "";
    const cmds = buildInstallAndRunCommands(c.pm, {
      hasBuild: Boolean(c.scripts.build),
      hasStart: Boolean(c.scripts.start),
      hasDev: Boolean(c.scripts.dev),
    });
    services.push({
      name: "web",
      github: { repo, branch: "main", deploy_on_push: false },
      source_dir: sourceDir,
      environment_slug: "node-js",
      http_port: 3000,
      instance_count: 1,
      instance_size_slug: size,
      ...(cmds.build
        ? {
            build_command: `${cmds.install} && ${cdPrefix}${cmds.build}`,
          }
        : {}),
      ...(cmds.start ? { run_command: `${cdPrefix}${cmds.start}` } : {}),
      envs: [{ key: "NODE_ENV", value: "production", scope: "RUN_TIME" }],
    });
    ingressRules.push({
      match: { path: { prefix: "/" } },
      component: { name: "web" },
    });
  };

  const addApiService = (c: AppComponentCandidate) => {
    const useRootSourceDir = rootHasWorkspaces && c.relDir !== "." && usesWorkspaceDeps(c);
    const sourceDir = toDoSourceDir(useRootSourceDir ? "/" : c.relDir);
    const cdPrefix = useRootSourceDir ? `cd ${toPosixRelPath(c.relDir)} && ` : "";
    const cmds = buildInstallAndRunCommands(c.pm, {
      hasBuild: Boolean(c.scripts.build),
      hasStart: Boolean(c.scripts.start),
      hasDev: Boolean(c.scripts.dev),
    });
    services.push({
      name: "api",
      github: { repo, branch: "main", deploy_on_push: false },
      source_dir: sourceDir,
      environment_slug: "node-js",
      http_port: 8080,
      instance_count: 1,
      instance_size_slug: size,
      ...(cmds.build
        ? {
            build_command: `${cmds.install} && ${cdPrefix}${cmds.build}`,
          }
        : {}),
      ...(cmds.start ? { run_command: `${cdPrefix}${cmds.start}` } : {}),
      envs: [
        { key: "NODE_ENV", value: "production", scope: "RUN_TIME" },
        { key: "PORT", value: "8080", scope: "RUN_TIME" },
      ],
    });
    ingressRules.unshift({
      match: { path: { prefix: "/api" } },
      component: { name: "api" },
      preserve_path_prefix: true,
    });
  };

  if (api) {
    addApiService(api);
  }
  if (web) {
    if (web.kind === "web-static") {
      addWebStatic(web);
    } else {
      addWebService(web);
    }
  }

  if (!web && !api) {
    services.push({
      name: "app",
      github: { repo, branch: "main", deploy_on_push: false },
      source_dir: "/",
      environment_slug: "node-js",
      http_port: 8080,
      instance_count: 1,
      instance_size_slug: size,
      envs: [
        { key: "NODE_ENV", value: "production", scope: "RUN_TIME" },
        { key: "PORT", value: "8080", scope: "RUN_TIME" },
      ],
    });
    ingressRules.push({ match: { path: { prefix: "/" } }, component: { name: "app" } });
  }

  return {
    name: resolveDoAppName(params.repoSlug, params.env),
    region: params.region,
    ...(services.length ? { services } : {}),
    ...(staticSites.length ? { static_sites: staticSites } : {}),
    ingress: { rules: ingressRules },
  };
}
