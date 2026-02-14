import type { AppViewState } from "../app-view-state.ts";

/**
 * Minimal host interface for data export/import operations.
 */
type DataHost = Pick<
  AppViewState,
  | "client"
  | "connected"
  | "hello"
  | "settings"
  | "password"
  | "basePath"
  | "dataExporting"
  | "dataImporting"
  | "dataImportManifest"
  | "dataImportUploadId"
  | "dataApplying"
  | "dataError"
  | "dataSuccess"
>;

function resolveAuthHeader(host: DataHost): string | null {
  const deviceToken = host.hello?.auth?.deviceToken?.trim();
  if (deviceToken) {
    return `Bearer ${deviceToken}`;
  }
  const token = host.settings.token.trim();
  if (token) {
    return `Bearer ${token}`;
  }
  const password = host.password.trim();
  if (password) {
    return `Bearer ${password}`;
  }
  return null;
}

function resolveBaseUrl(host: DataHost): string {
  const gwUrl = host.settings.gatewayUrl?.trim();
  if (gwUrl) {
    return gwUrl.replace(/\/$/, "");
  }
  return `${window.location.origin}${host.basePath}`;
}

export async function exportData(host: DataHost): Promise<void> {
  if (host.dataExporting || !host.connected) {
    return;
  }
  host.dataExporting = true;
  host.dataError = null;
  host.dataSuccess = null;

  try {
    const base = resolveBaseUrl(host);
    const headers: Record<string, string> = {};
    const auth = resolveAuthHeader(host);
    if (auth) {
      headers.Authorization = auth;
    }

    const res = await fetch(`${base}/api/data/export`, { headers });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Export failed: ${text}`);
    }

    const blob = await res.blob();
    const disposition = res.headers.get("Content-Disposition") ?? "";
    const filenameMatch = disposition.match(/filename="?([^"]+)"?/);
    const filename = filenameMatch?.[1] ?? "openclaw-export.tar.gz";

    // Trigger download
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    host.dataSuccess = "Export downloaded successfully.";
  } catch (err) {
    host.dataError = String(err);
  } finally {
    host.dataExporting = false;
  }
}

export async function importData(host: DataHost, file: File): Promise<void> {
  if (host.dataImporting || !host.connected) {
    return;
  }
  host.dataImporting = true;
  host.dataError = null;
  host.dataSuccess = null;
  host.dataImportManifest = null;
  host.dataImportUploadId = null;

  try {
    const base = resolveBaseUrl(host);
    const headers: Record<string, string> = {
      "Content-Type": "application/octet-stream",
    };
    const auth = resolveAuthHeader(host);
    if (auth) {
      headers.Authorization = auth;
    }

    const buffer = await file.arrayBuffer();
    const res = await fetch(`${base}/api/data/import`, {
      method: "POST",
      headers,
      body: buffer,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: { message: res.statusText } }));
      throw new Error(body?.error?.message ?? `Upload failed: ${res.statusText}`);
    }

    const body = await res.json();
    host.dataImportManifest = body.manifest;
    host.dataImportUploadId = body.uploadId;
  } catch (err) {
    host.dataError = String(err);
  } finally {
    host.dataImporting = false;
  }
}

export async function applyImport(host: DataHost): Promise<void> {
  if (!host.dataImportUploadId || !host.client || host.dataApplying) {
    return;
  }
  host.dataApplying = true;
  host.dataError = null;
  host.dataSuccess = null;

  try {
    const result = await host.client.request("data.import.apply", {
      uploadId: host.dataImportUploadId,
    });
    const res = result as {
      ok: boolean;
      error?: string;
      backupDir?: string;
      restartRequired: boolean;
    };

    if (!res.ok) {
      throw new Error(res.error ?? "Import apply failed");
    }

    host.dataImportManifest = null;
    host.dataImportUploadId = null;

    const backupNote = res.backupDir ? ` Previous state backed up.` : "";
    host.dataSuccess = `Import applied successfully.${backupNote} Gateway restart required.`;
  } catch (err) {
    host.dataError = String(err);
  } finally {
    host.dataApplying = false;
  }
}

export async function cancelImport(host: DataHost): Promise<void> {
  if (!host.dataImportUploadId || !host.client) {
    return;
  }

  try {
    await host.client.request("data.import.cancel", {
      uploadId: host.dataImportUploadId,
    });
  } catch {
    // Best effort
  }

  host.dataImportManifest = null;
  host.dataImportUploadId = null;
  host.dataError = null;
  host.dataSuccess = null;
}
