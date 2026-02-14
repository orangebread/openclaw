import type { IncomingMessage, ServerResponse } from "node:http";
/**
 * HTTP endpoints for data export/import.
 *
 * GET  /api/data/export  → streams archive as application/gzip
 * POST /api/data/import  → accepts application/octet-stream body, returns manifest preview + uploadId
 */
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import { collectWorkspaceDirs } from "../commands/cleanup-utils.js";
import {
  ARCHIVE_ROOT_DIR,
  type ExportManifest,
  MANIFEST_VERSION,
  dirExists,
  fileExists,
  makeTempDir,
  normalizePathForArchive,
  readManifest,
  stageEntry,
  stageStateDir,
  writeManifest,
} from "../commands/export-import-utils.js";
import {
  loadConfig,
  resolveConfigPath,
  resolveOAuthDir,
  resolveStateDir,
} from "../config/config.js";
import { extractArchive, resolveArchiveKind } from "../infra/archive.js";
import { resolveHomeDir } from "../utils.js";
import { VERSION } from "../version.js";
import { authorizeGatewayConnect, type ResolvedGatewayAuth } from "./auth.js";
import { sendJson, sendMethodNotAllowed, sendUnauthorized } from "./http-common.js";
import { getBearerToken } from "./http-utils.js";

// ---------------------------------------------------------------------------
// Upload store — holds uploaded archives in temp dirs keyed by uploadId
// ---------------------------------------------------------------------------

const UPLOAD_TTL_MS = 10 * 60_000; // 10 minutes
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // 200 MB

type PendingUpload = {
  id: string;
  tempDir: string;
  extractedRoot: string;
  manifest: ExportManifest;
  createdAt: number;
};

const pendingUploads = new Map<string, PendingUpload>();

function generateUploadId(): string {
  return `imp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function cleanupExpired() {
  const now = Date.now();
  for (const [id, upload] of pendingUploads) {
    if (now - upload.createdAt > UPLOAD_TTL_MS) {
      pendingUploads.delete(id);
      fs.rm(upload.tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

export function getPendingUpload(uploadId: string): PendingUpload | undefined {
  cleanupExpired();
  return pendingUploads.get(uploadId);
}

export function removePendingUpload(uploadId: string): void {
  const upload = pendingUploads.get(uploadId);
  if (upload) {
    pendingUploads.delete(uploadId);
    fs.rm(upload.tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

async function authorizeRequest(
  req: IncomingMessage,
  auth: ResolvedGatewayAuth,
  trustedProxies: string[],
): Promise<boolean> {
  const token = getBearerToken(req);
  const result = await authorizeGatewayConnect({
    auth,
    connectAuth: token ? { token, password: token } : null,
    req,
    trustedProxies,
  });
  return result.ok;
}

// ---------------------------------------------------------------------------
// Raw body reader for binary upload
// ---------------------------------------------------------------------------

function readRawBody(
  req: IncomingMessage,
  maxBytes: number,
): Promise<{ ok: true; data: Buffer } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    let done = false;
    let total = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      if (done) {
        return;
      }
      total += chunk.length;
      if (total > maxBytes) {
        done = true;
        resolve({ ok: false, error: `payload too large (max ${maxBytes} bytes)` });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (done) {
        return;
      }
      done = true;
      resolve({ ok: true, data: Buffer.concat(chunks) });
    });
    req.on("error", (err) => {
      if (done) {
        return;
      }
      done = true;
      resolve({ ok: false, error: String(err) });
    });
  });
}

// ---------------------------------------------------------------------------
// GET /api/data/export
// ---------------------------------------------------------------------------

export async function handleDataExportRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: { auth: ResolvedGatewayAuth; trustedProxies: string[] },
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/api/data/export") {
    return false;
  }

  if (req.method !== "GET") {
    sendMethodNotAllowed(res, "GET");
    return true;
  }
  if (!(await authorizeRequest(req, opts.auth, opts.trustedProxies))) {
    sendUnauthorized(res);
    return true;
  }

  let tempDir: string | undefined;
  try {
    const homeDir = resolveHomeDir() ?? os.homedir();
    const stateDir = resolveStateDir();
    const configPath = resolveConfigPath();
    const oauthDir = resolveOAuthDir();
    const cfg = loadConfig();
    const workspaceDirs = collectWorkspaceDirs(cfg);
    const profile = process.env.OPENCLAW_PROFILE?.trim() || undefined;

    tempDir = await makeTempDir();
    const stagingRoot = path.join(tempDir, ARCHIVE_ROOT_DIR);
    const stagingConfig = path.join(stagingRoot, "config");
    const stagingState = path.join(stagingRoot, "state");
    const stagingWorkspaces = path.join(stagingRoot, "workspaces");

    await fs.mkdir(stagingRoot, { recursive: true });

    // Config
    let configStaged = false;
    if (await fileExists(configPath)) {
      await fs.mkdir(stagingConfig, { recursive: true });
      const configText = await fs.readFile(configPath, "utf-8");
      await fs.writeFile(
        path.join(stagingConfig, path.basename(configPath)),
        configText.replaceAll(homeDir, "~"),
      );
      configStaged = true;
    }

    // State
    const { agents } = await stageStateDir(stateDir, stagingState);

    // OAuth (if external)
    const oauthInState = oauthDir.startsWith(stateDir);
    if (!oauthInState && (await dirExists(oauthDir))) {
      await stageEntry(oauthDir, stagingState, "credentials");
    }

    // Workspaces
    const stagedWorkspaceNames: string[] = [];
    for (const ws of workspaceDirs) {
      if (await dirExists(ws)) {
        const wsName = path.basename(ws);
        await stageEntry(ws, stagingWorkspaces, wsName);
        stagedWorkspaceNames.push(wsName);
      }
    }

    // Manifest
    const manifest: ExportManifest = {
      version: MANIFEST_VERSION,
      exportedAt: new Date().toISOString(),
      openclawVersion: VERSION,
      platform: process.platform,
      homeDir: normalizePathForArchive(homeDir, homeDir),
      stateDir: normalizePathForArchive(stateDir, homeDir),
      profile,
      contents: {
        config: configStaged,
        workspaces: stagedWorkspaceNames,
        agents,
        credentials: oauthInState
          ? await dirExists(path.join(stateDir, "credentials"))
          : await dirExists(oauthDir),
        sessions: agents.length > 0,
        approvals: await fileExists(path.join(stateDir, "exec-approvals.json")),
        cron: await dirExists(path.join(stateDir, "cron")),
        identity: await dirExists(path.join(stateDir, "identity")),
      },
    };
    await writeManifest(stagingRoot, manifest);

    // Create archive
    const archivePath = path.join(tempDir, "export.tar.gz");
    await tar.c({ gzip: true, file: archivePath, cwd: tempDir }, [ARCHIVE_ROOT_DIR]);

    const stat = await fs.stat(archivePath);
    const ts = new Date()
      .toISOString()
      .replace(/[T:]/g, "-")
      .replace(/\.\d+Z$/, "");

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/gzip");
    res.setHeader("Content-Length", stat.size);
    res.setHeader("Content-Disposition", `attachment; filename="openclaw-export-${ts}.tar.gz"`);

    const stream = createReadStream(archivePath);
    stream.pipe(res);
    stream.on("end", () => {
      fs.rm(tempDir!, { recursive: true, force: true }).catch(() => {});
    });
    stream.on("error", () => {
      fs.rm(tempDir!, { recursive: true, force: true }).catch(() => {});
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end("Internal Server Error");
      }
    });
  } catch (err) {
    if (tempDir) {
      fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
    sendJson(res, 500, { error: { message: String(err), type: "export_error" } });
  }

  return true;
}

// ---------------------------------------------------------------------------
// POST /api/data/import
// ---------------------------------------------------------------------------

export async function handleDataImportRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: { auth: ResolvedGatewayAuth; trustedProxies: string[] },
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/api/data/import") {
    return false;
  }

  if (req.method !== "POST") {
    sendMethodNotAllowed(res, "POST");
    return true;
  }
  if (!(await authorizeRequest(req, opts.auth, opts.trustedProxies))) {
    sendUnauthorized(res);
    return true;
  }

  cleanupExpired();

  let tempDir: string | undefined;
  try {
    // Read raw body
    const body = await readRawBody(req, MAX_UPLOAD_BYTES);
    if (!body.ok) {
      sendJson(res, 400, { error: { message: body.error, type: "invalid_request_error" } });
      return true;
    }
    if (body.data.length === 0) {
      sendJson(res, 400, {
        error: { message: "empty request body", type: "invalid_request_error" },
      });
      return true;
    }

    // Write to temp file so we can use existing extractArchive()
    tempDir = await makeTempDir("openclaw-import-");
    const archivePath = path.join(tempDir, "upload.tar.gz");
    await fs.writeFile(archivePath, body.data);

    // Validate format
    const kind = resolveArchiveKind(archivePath);
    if (!kind) {
      sendJson(res, 400, {
        error: {
          message: "unsupported archive format (expected .tar.gz, .tgz, or .zip)",
          type: "invalid_request_error",
        },
      });
      fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      return true;
    }

    // Extract and read manifest
    await extractArchive({ archivePath, destDir: tempDir, timeoutMs: 120_000 });
    const extractedRoot = path.join(tempDir, ARCHIVE_ROOT_DIR);
    if (!(await dirExists(extractedRoot))) {
      sendJson(res, 400, {
        error: {
          message: `invalid archive: missing ${ARCHIVE_ROOT_DIR}/ directory`,
          type: "invalid_request_error",
        },
      });
      fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      return true;
    }

    const manifest = await readManifest(extractedRoot);

    // Store pending upload
    const uploadId = generateUploadId();
    pendingUploads.set(uploadId, {
      id: uploadId,
      tempDir,
      extractedRoot,
      manifest,
      createdAt: Date.now(),
    });

    sendJson(res, 200, { uploadId, manifest });
  } catch (err) {
    if (tempDir) {
      fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
    sendJson(res, 400, {
      error: { message: String(err), type: "import_error" },
    });
  }

  return true;
}
