import fs from "node:fs/promises";
import path from "node:path";
import type { GatewayRequestHandlers } from "./types.js";
import { resolveAgentWorkspaceDir } from "../../agents/agent-scope.js";
import { loadConfig } from "../../config/config.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateWorkspaceListParams,
  validateWorkspaceReadParams,
  type WorkspaceEntry,
  type WorkspaceListResult,
  type WorkspaceReadResult,
} from "../protocol/index.js";

const ALLOWED_ROOTS = new Set(["notes", "links", "review"]);

const DEFAULT_MAX_DEPTH = 4;
const MAX_DEPTH_CAP = 6;

const DEFAULT_MAX_ENTRIES = 500;
const MAX_ENTRIES_CAP = 1000;

const DEFAULT_MAX_BYTES = 200_000;
const MAX_BYTES_CAP = 500_000;

const WINDOWS_ABS_RE = /^[a-zA-Z]:[\\/]/;
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

const CONTENT_TYPES_BY_EXT: Record<string, string> = {
  ".md": "text/markdown",
  ".txt": "text/plain",
  ".json": "application/json",
};

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function normalizeWorkspacePath(
  input: string,
): { ok: true; path: string; segments: string[] } | { ok: false; error: string } {
  const raw = String(input ?? "").trim();
  if (!raw) {
    return { ok: false, error: "path required" };
  }
  if (raw.includes("\0")) {
    return { ok: false, error: "invalid path" };
  }
  if (WINDOWS_ABS_RE.test(raw)) {
    return { ok: false, error: "invalid path" };
  }
  if (SCHEME_RE.test(raw)) {
    return { ok: false, error: "invalid path" };
  }

  const withSlashes = raw.replace(/\\/g, "/");
  const stripped = withSlashes.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!stripped) {
    return { ok: false, error: "path required" };
  }
  const parts = stripped.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    return { ok: false, error: "invalid path" };
  }
  const root = parts[0];
  if (!root || !ALLOWED_ROOTS.has(root)) {
    return { ok: false, error: "disallowed path" };
  }
  return { ok: true, path: parts.join("/"), segments: parts };
}

function resolveWorkspaceAbsolute(
  workspaceRoot: string,
  rel: string,
): { ok: true; abs: string } | { ok: false; error: string } {
  const root = path.resolve(workspaceRoot);
  const abs = path.resolve(root, rel);
  const relative = path.relative(root, abs);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return { ok: false, error: "disallowed path" };
  }
  return { ok: true, abs };
}

async function assertNoSymlinkChain(workspaceRoot: string, segments: string[]) {
  let current = path.resolve(workspaceRoot);
  for (const segment of segments) {
    current = path.join(current, segment);
    const st = await fs.lstat(current);
    if (st.isSymbolicLink()) {
      throw new Error("symlinks not supported");
    }
  }
}

function toSafeWorkspaceError(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message === "symlinks not supported") {
    return err.message;
  }
  const code = (err as { code?: unknown } | null)?.code;
  if (code === "ENOENT") {
    return "not found";
  }
  if (code === "EACCES" || code === "EPERM") {
    return "unavailable";
  }
  return fallback;
}

function sortEntriesDeterministic(entries: WorkspaceEntry[]) {
  entries.sort((a, b) => {
    const ak = a.kind === "dir" ? 0 : 1;
    const bk = b.kind === "dir" ? 0 : 1;
    if (ak !== bk) {
      return ak - bk;
    }
    if (a.path < b.path) {
      return -1;
    }
    if (a.path > b.path) {
      return 1;
    }
    return 0;
  });
}

export const workspaceHandlers: GatewayRequestHandlers = {
  "workspace.list": async ({ params, respond }) => {
    if (!validateWorkspaceListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid workspace.list params: ${formatValidationErrors(validateWorkspaceListParams.errors)}`,
        ),
      );
      return;
    }
    const p = params;
    const agentId = String(p.agentId ?? "").trim();
    const normalized = normalizeWorkspacePath(String(p.dir ?? ""));
    if (!agentId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "agentId required"));
      return;
    }
    if (!normalized.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, normalized.error));
      return;
    }

    const maxDepth = clampInt(p.maxDepth, DEFAULT_MAX_DEPTH, 0, MAX_DEPTH_CAP);
    const maxEntries = clampInt(p.maxEntries, DEFAULT_MAX_ENTRIES, 1, MAX_ENTRIES_CAP);
    const includeHidden = Boolean(p.includeHidden);

    const cfg = loadConfig();
    const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
    const workspaceRoot = path.resolve(workspaceDir);
    const resolved = resolveWorkspaceAbsolute(workspaceRoot, normalized.path);
    if (!resolved.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, resolved.error));
      return;
    }

    try {
      await assertNoSymlinkChain(workspaceRoot, normalized.segments);
      const dirStat = await fs.lstat(resolved.abs);
      if (!dirStat.isDirectory()) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "dir is not a directory"));
        return;
      }

      const entries: WorkspaceEntry[] = [];
      const queue: Array<{ rel: string; abs: string; depth: number }> = [
        { rel: normalized.path, abs: resolved.abs, depth: 0 },
      ];

      while (queue.length > 0 && entries.length < maxEntries) {
        const next = queue.shift();
        if (!next) {
          break;
        }
        let dirents: import("node:fs").Dirent[];
        try {
          dirents = await fs.readdir(next.abs, { withFileTypes: true });
        } catch {
          continue;
        }
        dirents.sort((a, b) => {
          if (a.name < b.name) {
            return -1;
          }
          if (a.name > b.name) {
            return 1;
          }
          return 0;
        });

        for (const dirent of dirents) {
          if (entries.length >= maxEntries) {
            break;
          }
          const name = dirent.name;
          if (!includeHidden && name.startsWith(".")) {
            continue;
          }
          if (dirent.isSymbolicLink()) {
            continue;
          }

          const childRel = `${next.rel}/${name}`;
          const childAbs = path.join(next.abs, name);
          let st: import("node:fs").Stats;
          try {
            st = await fs.lstat(childAbs);
          } catch {
            continue;
          }
          if (st.isSymbolicLink()) {
            continue;
          }

          const modifiedAtMs = Math.max(0, Math.trunc(st.mtimeMs));
          if (st.isDirectory()) {
            entries.push({ path: childRel, kind: "dir", modifiedAtMs });
            if (next.depth < maxDepth) {
              queue.push({ rel: childRel, abs: childAbs, depth: next.depth + 1 });
            }
            continue;
          }
          if (st.isFile()) {
            entries.push({
              path: childRel,
              kind: "file",
              sizeBytes: Math.max(0, Math.trunc(st.size)),
              modifiedAtMs,
            });
          }
        }
      }

      sortEntriesDeterministic(entries);

      const result: WorkspaceListResult = {
        dir: normalized.path,
        cursor: null,
        entries,
      };
      respond(true, result, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, toSafeWorkspaceError(err, "workspace.list failed")),
      );
    }
  },
  "workspace.read": async ({ params, respond }) => {
    if (!validateWorkspaceReadParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid workspace.read params: ${formatValidationErrors(validateWorkspaceReadParams.errors)}`,
        ),
      );
      return;
    }
    const p = params;
    const agentId = String(p.agentId ?? "").trim();
    const normalized = normalizeWorkspacePath(String(p.path ?? ""));
    if (!agentId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "agentId required"));
      return;
    }
    if (!normalized.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, normalized.error));
      return;
    }
    const ext = path.extname(normalized.path).toLowerCase();
    const contentType = CONTENT_TYPES_BY_EXT[ext];
    if (!contentType) {
      respond(false, undefined, errorShape(ErrorCodes.UNSUPPORTED, "unsupported file type"));
      return;
    }

    const maxBytes = clampInt(p.maxBytes, DEFAULT_MAX_BYTES, 1, MAX_BYTES_CAP);

    const cfg = loadConfig();
    const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
    const workspaceRoot = path.resolve(workspaceDir);
    const resolved = resolveWorkspaceAbsolute(workspaceRoot, normalized.path);
    if (!resolved.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, resolved.error));
      return;
    }

    try {
      await assertNoSymlinkChain(workspaceRoot, normalized.segments);
      const st = await fs.lstat(resolved.abs);
      if (!st.isFile()) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "path is not a file"));
        return;
      }

      const handle = await fs.open(resolved.abs, "r");
      try {
        const toRead = Math.min(Math.max(0, Math.trunc(st.size)), maxBytes + 1);
        const buf = Buffer.alloc(toRead);
        const { bytesRead } = await handle.read(buf, 0, toRead, 0);
        const truncated = bytesRead > maxBytes || st.size > maxBytes;
        const content = buf.subarray(0, Math.min(bytesRead, maxBytes)).toString("utf8");
        const result: WorkspaceReadResult = {
          path: normalized.path,
          contentType,
          truncated,
          content,
        };
        respond(true, result, undefined);
      } finally {
        await handle.close();
      }
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, toSafeWorkspaceError(err, "workspace.read failed")),
      );
    }
  },
};
