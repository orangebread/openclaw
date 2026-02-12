import crypto from "node:crypto";
import type { OpenClawConfig } from "../config/config.js";
import { ensureAuthProfileStore } from "../agents/auth-profiles.js";
import { resolveApiKeyForProvider } from "../agents/model-auth.js";
import { resolveSkillConfig } from "../agents/skills/config.js";
import { normalizeOptionalSecretInput } from "../utils/normalize-secret-input.js";

export function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export async function resolveDigitalOceanAccessToken(
  cfg?: OpenClawConfig,
): Promise<{ token: string; source: string } | null> {
  const envToken = normalizeOptionalSecretInput(process.env.DIGITALOCEAN_ACCESS_TOKEN);
  if (envToken) {
    return { token: envToken, source: "env:DIGITALOCEAN_ACCESS_TOKEN" };
  }

  const skillToken = normalizeOptionalSecretInput(resolveSkillConfig(cfg, "digitalocean")?.apiKey);
  if (skillToken) {
    return { token: skillToken, source: "config:skills.entries.digitalocean.apiKey" };
  }

  try {
    const store = ensureAuthProfileStore();
    const resolved = await resolveApiKeyForProvider({ provider: "digitalocean", cfg, store });
    const token = normalizeOptionalSecretInput(resolved.apiKey);
    if (token) {
      return { token, source: resolved.source };
    }
  } catch {
    // ignore; fall through
  }

  return null;
}
