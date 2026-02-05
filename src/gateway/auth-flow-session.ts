import { randomUUID } from "node:crypto";

export type AuthFlowStepOption = {
  value: unknown;
  label: string;
  hint?: string;
};

export type AuthFlowStep =
  | {
      id: string;
      type: "note";
      title?: string;
      message?: string;
    }
  | {
      id: string;
      type: "openUrl";
      title?: string;
      url: string;
      message?: string;
    }
  | {
      id: string;
      type: "text";
      title?: string;
      message: string;
      initialValue?: string;
      placeholder?: string;
      sensitive?: boolean;
    }
  | {
      id: string;
      type: "confirm";
      title?: string;
      message: string;
      initialValue?: boolean;
    }
  | {
      id: string;
      type: "select";
      title?: string;
      message: string;
      options: AuthFlowStepOption[];
      initialValue?: unknown;
    }
  | {
      id: string;
      type: "multiselect";
      title?: string;
      message: string;
      options: AuthFlowStepOption[];
      initialValue?: unknown[];
    };

export type AuthFlowStepInput =
  | {
      type: "note";
      title?: string;
      message?: string;
    }
  | {
      type: "openUrl";
      title?: string;
      url: string;
      message?: string;
    }
  | {
      type: "text";
      title?: string;
      message: string;
      initialValue?: string;
      placeholder?: string;
      sensitive?: boolean;
    }
  | {
      type: "confirm";
      title?: string;
      message: string;
      initialValue?: boolean;
    }
  | {
      type: "select";
      title?: string;
      message: string;
      options: AuthFlowStepOption[];
      initialValue?: unknown;
    }
  | {
      type: "multiselect";
      title?: string;
      message: string;
      options: AuthFlowStepOption[];
      initialValue?: unknown[];
    };

export type AuthFlowSessionStatus = "running" | "done" | "cancelled" | "error";

export type AuthFlowCompleteProfile = {
  id: string;
  provider: string;
  type: string;
  preview?: string;
  email?: string;
  expires?: number;
};

export type AuthFlowCompletePayload = {
  profiles: AuthFlowCompleteProfile[];
  configPatch?: unknown;
  defaultModel?: string;
  notes?: string[];
};

export type AuthFlowNextResult = {
  done: boolean;
  step?: AuthFlowStep;
  status: AuthFlowSessionStatus;
  error?: string;
  result?: AuthFlowCompletePayload;
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export class AuthFlowCancelledError extends Error {
  constructor(message = "auth flow cancelled") {
    super(message);
    this.name = "AuthFlowCancelledError";
  }
}

export class AuthFlowSession {
  private currentStep: AuthFlowStep | null = null;
  private stepDeferred: Deferred<AuthFlowStep | null> | null = null;
  private answerDeferred = new Map<string, Deferred<unknown>>();
  private status: AuthFlowSessionStatus = "running";
  private error: string | undefined;
  private result: AuthFlowCompletePayload | undefined;

  constructor(
    private runner: (api: AuthFlowSessionApi) => Promise<AuthFlowCompletePayload | void>,
  ) {
    void this.run();
  }

  async next(): Promise<AuthFlowNextResult> {
    if (this.currentStep) {
      return { done: false, step: this.currentStep, status: this.status };
    }
    if (this.status !== "running") {
      return {
        done: true,
        status: this.status,
        error: this.error,
        ...(this.result ? { result: this.result } : {}),
      };
    }
    if (!this.stepDeferred) {
      this.stepDeferred = createDeferred();
    }
    const step = await this.stepDeferred.promise;
    if (step) {
      return { done: false, step, status: this.status };
    }
    return {
      done: true,
      status: this.status,
      error: this.error,
      ...(this.result ? { result: this.result } : {}),
    };
  }

  async answer(stepId: string, value: unknown): Promise<void> {
    const deferred = this.answerDeferred.get(stepId);
    if (!deferred) {
      throw new Error("auth.flow: no pending step");
    }
    this.answerDeferred.delete(stepId);
    this.currentStep = null;
    deferred.resolve(value);
  }

  cancel() {
    if (this.status !== "running") {
      return;
    }
    this.status = "cancelled";
    this.error = "cancelled";
    this.currentStep = null;
    for (const [, deferred] of this.answerDeferred) {
      deferred.reject(new AuthFlowCancelledError());
    }
    this.answerDeferred.clear();
    this.resolveStep(null);
  }

  getStatus(): AuthFlowSessionStatus {
    return this.status;
  }

  getError(): string | undefined {
    return this.error;
  }

  private async run() {
    const api = new AuthFlowSessionApi(this);
    try {
      const maybe = await this.runner(api);
      if (maybe && typeof maybe === "object" && "profiles" in maybe) {
        this.result = maybe;
      }
      this.status = "done";
    } catch (err) {
      if (err instanceof AuthFlowCancelledError) {
        this.status = "cancelled";
        this.error = err.message;
      } else {
        this.status = "error";
        this.error = err instanceof Error ? err.message : String(err);
      }
    } finally {
      this.resolveStep(null);
    }
  }

  async awaitAnswer(step: AuthFlowStepInput): Promise<unknown> {
    if (this.status !== "running") {
      throw new Error("auth.flow: session not running");
    }
    const full = { ...step, id: randomUUID() } as AuthFlowStep;
    this.pushStep(full);
    const deferred = createDeferred<unknown>();
    this.answerDeferred.set(full.id, deferred);
    return await deferred.promise;
  }

  pushStep(step: AuthFlowStep) {
    this.currentStep = step;
    this.resolveStep(step);
  }

  private resolveStep(step: AuthFlowStep | null) {
    if (!this.stepDeferred) {
      return;
    }
    const deferred = this.stepDeferred;
    this.stepDeferred = null;
    deferred.resolve(step);
  }
}

export class AuthFlowSessionApi {
  constructor(private session: AuthFlowSession) {}

  async note(message: string, title?: string): Promise<void> {
    await this.session.awaitAnswer({ type: "note", title, message });
  }

  async openUrl(url: string, opts?: { title?: string; message?: string }): Promise<void> {
    await this.session.awaitAnswer({
      type: "openUrl",
      title: opts?.title,
      message: opts?.message,
      url,
    });
  }

  async text(params: {
    message: string;
    title?: string;
    initialValue?: string;
    placeholder?: string;
    sensitive?: boolean;
    validate?: (value: string) => string | undefined;
  }): Promise<string> {
    const raw = await this.session.awaitAnswer({
      type: "text",
      title: params.title,
      message: params.message,
      initialValue: params.initialValue,
      placeholder: params.placeholder,
      sensitive: params.sensitive,
    });
    const value =
      raw === null || raw === undefined
        ? ""
        : typeof raw === "string"
          ? raw
          : typeof raw === "number" || typeof raw === "boolean" || typeof raw === "bigint"
            ? String(raw)
            : "";
    const err = params.validate?.(value);
    if (err) {
      throw new Error(err);
    }
    return value;
  }

  async confirm(params: {
    message: string;
    title?: string;
    initialValue?: boolean;
  }): Promise<boolean> {
    const raw = await this.session.awaitAnswer({
      type: "confirm",
      title: params.title,
      message: params.message,
      initialValue: params.initialValue,
    });
    return Boolean(raw);
  }

  async select<T>(params: {
    message: string;
    title?: string;
    options: Array<{ value: T; label: string; hint?: string }>;
    initialValue?: T;
  }): Promise<T> {
    const raw = await this.session.awaitAnswer({
      type: "select",
      title: params.title,
      message: params.message,
      options: params.options.map((opt) => ({
        value: opt.value,
        label: opt.label,
        hint: opt.hint,
      })),
      initialValue: params.initialValue,
    });
    return raw as T;
  }

  async multiselect<T>(params: {
    message: string;
    title?: string;
    options: Array<{ value: T; label: string; hint?: string }>;
    initialValues?: T[];
  }): Promise<T[]> {
    const raw = await this.session.awaitAnswer({
      type: "multiselect",
      title: params.title,
      message: params.message,
      options: params.options.map((opt) => ({
        value: opt.value,
        label: opt.label,
        hint: opt.hint,
      })),
      initialValue: params.initialValues,
    });
    return (Array.isArray(raw) ? raw : []) as T[];
  }

  progress(_label: string): {
    update: (message: string) => void;
    stop: (message?: string) => void;
  } {
    return {
      update: (_message: string) => {},
      stop: (_message?: string) => {},
    };
  }
}
