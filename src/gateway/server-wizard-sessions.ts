import type { WizardSession } from "../wizard/session.js";

export type WizardSessionOwner = {
  deviceId?: string;
};

export type WizardSessionEntry = {
  session: WizardSession;
  owner?: WizardSessionOwner;
  startedAtMs: number;
};

export function createWizardSessionTracker() {
  const wizardSessions = new Map<string, WizardSessionEntry>();

  const findRunningWizard = (): string | null => {
    for (const [id, session] of wizardSessions) {
      if (session.session.getStatus() === "running") {
        return id;
      }
    }
    return null;
  };

  const purgeWizardSession = (id: string) => {
    const session = wizardSessions.get(id);
    if (!session) {
      return;
    }
    if (session.session.getStatus() === "running") {
      return;
    }
    wizardSessions.delete(id);
  };

  return { wizardSessions, findRunningWizard, purgeWizardSession };
}
