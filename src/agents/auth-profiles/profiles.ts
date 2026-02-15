import * as lockfile from "proper-lockfile";
import type { AuthProfileCredential, AuthProfileStore } from "./types.js";
import { normalizeSecretInput } from "../../utils/normalize-secret-input.js";
import { normalizeProviderId } from "../model-selection.js";
import { AUTH_STORE_LOCK_OPTIONS } from "./constants.js";
import { ensureAuthStoreFile, resolveAuthStorePath } from "./paths.js";
import {
  ensureAuthProfileStore,
  saveAuthProfileStore,
  updateAuthProfileStoreWithLock,
} from "./store.js";

const AUTH_STORE_LOCK_OPTIONS_SYNC = {
  stale: AUTH_STORE_LOCK_OPTIONS.stale,
} as const;

export async function setAuthProfileOrder(params: {
  agentDir?: string;
  provider: string;
  order?: string[] | null;
}): Promise<AuthProfileStore | null> {
  const providerKey = normalizeProviderId(params.provider);
  const sanitized =
    params.order && Array.isArray(params.order)
      ? params.order.map((entry) => String(entry).trim()).filter(Boolean)
      : [];

  const deduped: string[] = [];
  for (const entry of sanitized) {
    if (!deduped.includes(entry)) {
      deduped.push(entry);
    }
  }

  return await updateAuthProfileStoreWithLock({
    agentDir: params.agentDir,
    updater: (store) => {
      store.order = store.order ?? {};
      if (deduped.length === 0) {
        if (!store.order[providerKey]) {
          return false;
        }
        delete store.order[providerKey];
        if (Object.keys(store.order).length === 0) {
          store.order = undefined;
        }
        return true;
      }
      store.order[providerKey] = deduped;
      return true;
    },
  }).then((res) => (res.ok ? res.store : null));
}

export function upsertAuthProfile(params: {
  profileId: string;
  credential: AuthProfileCredential;
  agentDir?: string;
}): void {
  const credential =
    params.credential.type === "api_key"
      ? {
          ...params.credential,
          ...(typeof params.credential.key === "string"
            ? { key: normalizeSecretInput(params.credential.key) }
            : {}),
        }
      : params.credential.type === "token"
        ? { ...params.credential, token: normalizeSecretInput(params.credential.token) }
        : params.credential;
  const authPath = resolveAuthStorePath(params.agentDir);
  ensureAuthStoreFile(authPath);

  let release: (() => void) | undefined;
  try {
    release = (
      lockfile as unknown as {
        lockSync: (path: string, options: typeof AUTH_STORE_LOCK_OPTIONS_SYNC) => () => void;
      }
    ).lockSync(authPath, AUTH_STORE_LOCK_OPTIONS_SYNC);
    const store = ensureAuthProfileStore(params.agentDir);
    store.profiles[params.profileId] = credential;
    saveAuthProfileStore(store, params.agentDir);
  } finally {
    if (release) {
      try {
        release();
      } catch {
        // ignore unlock errors
      }
    }
  }
}

export async function upsertAuthProfileWithLock(params: {
  profileId: string;
  credential: AuthProfileCredential;
  agentDir?: string;
}): Promise<AuthProfileStore | null> {
  const result = await updateAuthProfileStoreWithLock({
    agentDir: params.agentDir,
    updater: (store) => {
      store.profiles[params.profileId] = params.credential;
      return true;
    },
  });
  return result?.ok ? result.store : null;
}

export function listProfilesForProvider(store: AuthProfileStore, provider: string): string[] {
  const providerKey = normalizeProviderId(provider);
  return Object.entries(store.profiles)
    .filter(([, cred]) => normalizeProviderId(cred.provider) === providerKey)
    .map(([id]) => id);
}

export async function markAuthProfileGood(params: {
  store: AuthProfileStore;
  provider: string;
  profileId: string;
  agentDir?: string;
}): Promise<void> {
  const { store, provider, profileId, agentDir } = params;
  const updated = await updateAuthProfileStoreWithLock({
    agentDir,
    updater: (freshStore) => {
      const profile = freshStore.profiles[profileId];
      if (!profile || profile.provider !== provider) {
        return false;
      }
      freshStore.lastGood = { ...freshStore.lastGood, [provider]: profileId };
      return true;
    },
  });
  if (updated.ok) {
    store.lastGood = updated.store.lastGood;
    return;
  }
  const profile = store.profiles[profileId];
  if (!profile || profile.provider !== provider) {
    return;
  }
  // Best-effort only: avoid unlocked writes that could clobber concurrent updates.
  store.lastGood = { ...store.lastGood, [provider]: profileId };
}
