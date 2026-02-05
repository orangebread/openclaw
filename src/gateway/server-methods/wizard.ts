import { randomUUID } from "node:crypto";
import type { GatewayRequestHandlers } from "./types.js";
import { defaultRuntime } from "../../runtime.js";
import { WizardSession } from "../../wizard/session.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateWizardCancelParams,
  validateWizardCurrentParams,
  validateWizardNextParams,
  validateWizardStartParams,
  validateWizardStatusParams,
} from "../protocol/index.js";
import { formatForLog } from "../ws-log.js";

function resolveWizardOwnerDeviceId(params: {
  client: { connect?: { device?: { id?: string } } } | null;
}) {
  const client = params.client;
  if (!client) {
    return undefined;
  }
  const id = client.connect?.device?.id;
  return typeof id === "string" && id.trim() ? id.trim() : undefined;
}

export const wizardHandlers: GatewayRequestHandlers = {
  "wizard.start": async ({ params, respond, context, client }) => {
    if (!validateWizardStartParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid wizard.start params: ${formatValidationErrors(validateWizardStartParams.errors)}`,
        ),
      );
      return;
    }
    const running = context.findRunningWizard();
    if (running) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "wizard already running"));
      return;
    }
    const sessionId = randomUUID();
    const opts = {
      mode: params.mode,
      workspace: typeof params.workspace === "string" ? params.workspace : undefined,
    };
    const session = new WizardSession((prompter) =>
      context.wizardRunner(opts, defaultRuntime, prompter),
    );
    const ownerDeviceId = resolveWizardOwnerDeviceId({ client });
    context.wizardSessions.set(sessionId, {
      session,
      owner: ownerDeviceId ? { deviceId: ownerDeviceId } : undefined,
      startedAtMs: Date.now(),
    });
    const result = await session.next();
    if (result.done) {
      context.purgeWizardSession(sessionId);
    }
    respond(true, { sessionId, ...result }, undefined);
  },
  "wizard.current": ({ params, respond, client, context }) => {
    if (!validateWizardCurrentParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid wizard.current params: ${formatValidationErrors(validateWizardCurrentParams.errors)}`,
        ),
      );
      return;
    }
    const runningId = context.findRunningWizard();
    if (!runningId) {
      respond(true, { running: false }, undefined);
      return;
    }
    const entry = context.wizardSessions.get(runningId);
    if (!entry) {
      respond(true, { running: false }, undefined);
      return;
    }
    const ownerDeviceId = resolveWizardOwnerDeviceId({ client: client ?? { connect: undefined } });
    const owned = Boolean(ownerDeviceId && entry.owner?.deviceId === ownerDeviceId);
    respond(
      true,
      {
        running: true,
        ...(owned ? { sessionId: runningId, owned: true } : { owned: false }),
      },
      undefined,
    );
  },
  "wizard.cancelCurrent": ({ params, respond, client, context }) => {
    if (!validateWizardCurrentParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid wizard.cancelCurrent params: ${formatValidationErrors(validateWizardCurrentParams.errors)}`,
        ),
      );
      return;
    }
    const runningId = context.findRunningWizard();
    if (!runningId) {
      respond(true, { cancelled: false }, undefined);
      return;
    }
    const entry = context.wizardSessions.get(runningId);
    if (!entry) {
      respond(true, { cancelled: false }, undefined);
      return;
    }
    const ownerDeviceId = resolveWizardOwnerDeviceId({ client: client ?? { connect: undefined } });
    if (!ownerDeviceId || entry.owner?.deviceId !== ownerDeviceId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "wizard not owned by client"),
      );
      return;
    }
    entry.session.cancel();
    context.wizardSessions.delete(runningId);
    respond(true, { cancelled: true }, undefined);
  },
  "wizard.next": async ({ params, respond, context, client }) => {
    if (!validateWizardNextParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid wizard.next params: ${formatValidationErrors(validateWizardNextParams.errors)}`,
        ),
      );
      return;
    }
    const sessionId = params.sessionId;
    const entry = context.wizardSessions.get(sessionId);
    if (!entry) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "wizard not found"));
      return;
    }
    const ownerDeviceId = resolveWizardOwnerDeviceId({ client });
    if (entry.owner?.deviceId && entry.owner.deviceId !== ownerDeviceId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "wizard not owned by client"),
      );
      return;
    }
    const session = entry.session;
    const answer = params.answer as { stepId?: string; value?: unknown } | undefined;
    if (answer) {
      if (session.getStatus() !== "running") {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "wizard not running"));
        return;
      }
      try {
        await session.answer(String(answer.stepId ?? ""), answer.value);
      } catch (err) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, formatForLog(err)));
        return;
      }
    }
    const result = await session.next();
    if (result.done) {
      context.purgeWizardSession(sessionId);
    }
    respond(true, result, undefined);
  },
  "wizard.cancel": ({ params, respond, context, client }) => {
    if (!validateWizardCancelParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid wizard.cancel params: ${formatValidationErrors(validateWizardCancelParams.errors)}`,
        ),
      );
      return;
    }
    const sessionId = params.sessionId;
    const entry = context.wizardSessions.get(sessionId);
    if (!entry) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "wizard not found"));
      return;
    }
    const ownerDeviceId = resolveWizardOwnerDeviceId({ client });
    if (entry.owner?.deviceId && entry.owner.deviceId !== ownerDeviceId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "wizard not owned by client"),
      );
      return;
    }
    entry.session.cancel();
    const status = {
      status: entry.session.getStatus(),
      error: entry.session.getError(),
    };
    context.wizardSessions.delete(sessionId);
    respond(true, status, undefined);
  },
  "wizard.status": ({ params, respond, context, client }) => {
    if (!validateWizardStatusParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid wizard.status params: ${formatValidationErrors(validateWizardStatusParams.errors)}`,
        ),
      );
      return;
    }
    const sessionId = params.sessionId;
    const entry = context.wizardSessions.get(sessionId);
    if (!entry) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "wizard not found"));
      return;
    }
    const ownerDeviceId = resolveWizardOwnerDeviceId({ client });
    if (entry.owner?.deviceId && entry.owner.deviceId !== ownerDeviceId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "wizard not owned by client"),
      );
      return;
    }
    const status = {
      status: entry.session.getStatus(),
      error: entry.session.getError(),
    };
    if (status.status !== "running") {
      context.wizardSessions.delete(sessionId);
    }
    respond(true, status, undefined);
  },
};
