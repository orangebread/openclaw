import type { AuthFlowSession } from "./auth-flow-session.js";

export type AuthFlowSessionOwner = {
  deviceId?: string;
};

export type AuthFlowSessionEntry = {
  session: AuthFlowSession;
  owner?: AuthFlowSessionOwner;
  startedAtMs: number;
  providerId: string;
  methodId: string;
};

export function createAuthFlowSessionTracker() {
  const authFlowSessions = new Map<string, AuthFlowSessionEntry>();

  const findRunningAuthFlow = (): string | null => {
    for (const [id, entry] of authFlowSessions) {
      if (entry.session.getStatus() === "running") {
        return id;
      }
    }
    return null;
  };

  const purgeAuthFlowSession = (id: string) => {
    const entry = authFlowSessions.get(id);
    if (!entry) {
      return;
    }
    if (entry.session.getStatus() === "running") {
      return;
    }
    authFlowSessions.delete(id);
  };

  return { authFlowSessions, findRunningAuthFlow, purgeAuthFlowSession };
}
