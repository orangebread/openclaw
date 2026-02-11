import { html, nothing } from "lit";
import type {
  CredentialsApiKeyFormState,
  CredentialsDisconnectDialogState,
  CredentialsSuccessState,
} from "../controllers/credentials.ts";
import type {
  AuthProfileSummary,
  AuthFlowCompletePayload,
  AuthFlowListResult,
  AuthFlowMode,
  AuthFlowStep,
  AuthFlowStepOption,
  WizardStep,
  WizardStepOption,
} from "../types.ts";
import { formatMs } from "../format.ts";

function normalizeProviderId(provider?: string | null): string {
  if (!provider) {
    return "";
  }
  const normalized = provider.trim().toLowerCase();
  if (normalized === "z.ai" || normalized === "z-ai") {
    return "zai";
  }
  return normalized;
}

function inferAuthFlowMode(gatewayUrl: string): AuthFlowMode {
  try {
    const url = new URL(gatewayUrl);
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1") {
      return "local";
    }
  } catch {
    // ignore
  }
  return "remote";
}

function scrollToCardWithinContent(targetId: string) {
  const el = document.getElementById(targetId);
  if (!el) {
    return;
  }

  const content = el.closest(".content") as HTMLElement | null;
  if (!content) {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  const elRect = el.getBoundingClientRect();
  const contentRect = content.getBoundingClientRect();
  const top = content.scrollTop + (elRect.top - contentRect.top) - 8;
  content.scrollTo({ top, behavior: "smooth" });
}

function resolveAuthFlowMethod(
  list: AuthFlowListResult | null,
  providerId: string,
  methodId: string,
) {
  const providers = list?.providers ?? [];
  for (const provider of providers) {
    if (normalizeProviderId(provider.providerId) !== normalizeProviderId(providerId)) {
      continue;
    }
    const method = provider.methods.find(
      (m) => m.methodId.toLowerCase() === methodId.toLowerCase(),
    );
    if (method) {
      return method;
    }
  }
  return null;
}

export type CredentialsProps = {
  connected: boolean;
  gatewayUrl: string;
  loading: boolean;
  saving: boolean;
  error: string | null;
  success: CredentialsSuccessState | null;
  disconnectDialog: CredentialsDisconnectDialogState | null;

  baseHash: string | null;
  profiles: AuthProfileSummary[];
  apiKeyForm: CredentialsApiKeyFormState;

  authFlowLoading: boolean;
  authFlowError: string | null;
  authFlowList: AuthFlowListResult | null;
  authFlowBusy: boolean;
  authFlowRunning: boolean;
  authFlowOwned: boolean;
  authFlowStep: AuthFlowStep | null;
  authFlowAnswer: unknown;
  authFlowResult: AuthFlowCompletePayload | null;
  authFlowApplyError: string | null;
  authFlowProviderId: string | null;
  authFlowMethodId: string | null;
  authFlowPendingDefaultModel: string | null;

  wizardBusy: boolean;
  wizardError: string | null;
  wizardRunning: boolean;
  wizardOwned: boolean;
  wizardStep: WizardStep | null;
  wizardAnswer: unknown;

  onRefresh: () => void;
  onOpenChat: () => void;
  onOpenAgentProfile: () => void;
  onApiKeyFormChange: (patch: Partial<CredentialsApiKeyFormState>) => void;
  onUpsertApiKey: () => void;
  onRequestDeleteProfile: (profileId: string) => void;
  onCancelDeleteProfile: () => void;
  onConfirmDeleteProfile: (profileId: string) => void;

  onStartAuthFlow: (providerId: string, methodId: string, mode: AuthFlowMode) => void;
  onResumeAuthFlow: () => void;
  onCancelAuthFlow: () => void;
  onAuthFlowAnswerChange: (next: unknown) => void;
  onAuthFlowContinue: () => void;
  onApplyAuthFlowDefaults: () => void;

  onStartWizard: () => void;
  onResumeWizard: () => void;
  onCancelWizard: () => void;
  onWizardAnswerChange: (next: unknown) => void;
  onWizardContinue: () => void;
};

function isProfileUnavailable(profile: AuthProfileSummary): boolean {
  const now = Date.now();
  const cooldown = profile.cooldownUntil ?? 0;
  const disabled = profile.disabledUntil ?? 0;
  const until = Math.max(cooldown, disabled);
  return until > 0 ? now < until : false;
}

function profileStatusText(profile: AuthProfileSummary): string {
  const now = Date.now();
  const cooldown = profile.cooldownUntil ?? 0;
  const disabled = profile.disabledUntil ?? 0;
  if (disabled > 0 && now < disabled) {
    return `disabled until ${formatMs(disabled)}`;
  }
  if (cooldown > 0 && now < cooldown) {
    return `cooldown until ${formatMs(cooldown)}`;
  }
  return "available";
}

function renderProfileRow(
  profile: AuthProfileSummary,
  props: CredentialsProps,
  opts?: { highlight?: boolean },
) {
  const status = profileStatusText(profile);
  const unavailable = isProfileUnavailable(profile);
  const provider = normalizeProviderId(profile.provider);
  const reason =
    typeof profile.disabledReason === "string" && profile.disabledReason.trim()
      ? profile.disabledReason.trim()
      : null;
  const highlight = Boolean(opts?.highlight);
  const encodedId = encodeURIComponent(profile.id);

  return html`
    <div
      class="card"
      id=${`credentials-profile-${encodedId}`}
      style="margin-top: 10px; ${highlight ? "border-color: var(--accent); box-shadow: 0 0 0 1px rgba(99, 102, 241, 0.35), var(--shadow-sm);" : ""}"
    >
      <div class="row" style="justify-content: space-between; gap: 12px;">
        <div style="min-width: 0;">
          <div class="row" style="gap: 10px; flex-wrap: wrap;">
            <span class="chip">${provider}</span>
            <span class="chip">${profile.type}</span>
            <span class="chip ${unavailable ? "chip-warn" : "chip-ok"}">${status}</span>
            <span class="mono" style="opacity: 0.9;">${profile.id}</span>
          </div>
          <div class="muted" style="margin-top: 6px;">
            ${profile.preview ? html`<span class="mono">${profile.preview}</span>` : nothing}
            ${
              profile.preview && profile.email
                ? html`
                    <span style="opacity: 0.6"> · </span>
                  `
                : nothing
            }
            ${profile.email ? html`<span>${profile.email}</span>` : nothing}
            ${profile.expires ? html`<span style="opacity: 0.6;"> · </span><span>expires ${formatMs(profile.expires)}</span>` : nothing}
            ${reason ? html`<span style="opacity: 0.6;"> · </span><span>${reason}</span>` : nothing}
          </div>
        </div>
        <button
          class="btn"
          ?disabled=${props.saving}
          @click=${() => props.onRequestDeleteProfile(profile.id)}
          title="Disconnect (delete) profile"
        >
          Disconnect…
        </button>
      </div>
    </div>
  `;
}

function resolveWizardStepTitle(step: WizardStep): string {
  if (step.title && step.title.trim()) {
    return step.title.trim();
  }
  if (step.type === "select") {
    return "Select";
  }
  if (step.type === "multiselect") {
    return "Select";
  }
  if (step.type === "confirm") {
    return "Confirm";
  }
  if (step.type === "text") {
    return step.sensitive ? "Secret" : "Input";
  }
  if (step.type === "note") {
    return "Note";
  }
  return "Wizard";
}

function resolveAuthFlowStepTitle(step: AuthFlowStep): string {
  if ("title" in step && step.title && step.title.trim()) {
    return step.title.trim();
  }
  if (step.type === "openUrl") {
    return "Open URL";
  }
  if (step.type === "select") {
    return "Select";
  }
  if (step.type === "multiselect") {
    return "Select";
  }
  if (step.type === "confirm") {
    return "Confirm";
  }
  if (step.type === "text") {
    return step.sensitive ? "Secret" : "Input";
  }
  if (step.type === "note") {
    return "Note";
  }
  return "Connect";
}

function renderAuthFlowStep(
  props: CredentialsProps,
  step: AuthFlowStep,
  context?: { providerLabel?: string; methodLabel?: string },
) {
  const title = resolveAuthFlowStepTitle(step);
  const message = "message" in step ? (step.message ?? "") : "";
  const contextProvider = context?.providerLabel?.trim() ? context.providerLabel.trim() : null;
  const contextMethod = context?.methodLabel?.trim() ? context.methodLabel.trim() : null;

  const renderContinue = (label = "Continue") => html`
    <button class="btn primary" ?disabled=${props.authFlowBusy} @click=${props.onAuthFlowContinue}>
      ${props.authFlowBusy ? "Working…" : label}
    </button>
  `;

  const renderNote = () => html`
    ${message ? html`<div class="card-sub" style="margin-top: 8px; white-space: pre-wrap;">${message}</div>` : nothing}
    <div class="row" style="margin-top: 12px; gap: 10px;">
      ${renderContinue()}
      <button class="btn" ?disabled=${props.authFlowBusy} @click=${props.onCancelAuthFlow}>
        Cancel
      </button>
    </div>
  `;

  const renderOpenUrl = (open: Extract<AuthFlowStep, { type: "openUrl" }>) => html`
    ${message ? html`<div class="card-sub" style="margin-top: 8px; white-space: pre-wrap;">${message}</div>` : nothing}
    <div class="card-sub" style="margin-top: 10px;">
      <div class="muted">URL</div>
      <div class="mono" style="white-space: pre-wrap; word-break: break-word;">${open.url}</div>
    </div>
    <div class="row" style="margin-top: 12px; gap: 10px; flex-wrap: wrap;">
      <a class="btn" href=${open.url} target="_blank" rel="noreferrer">Open</a>
      <button
        class="btn"
        @click=${async () => {
          try {
            await navigator.clipboard.writeText(open.url);
          } catch {
            // ignore
          }
        }}
      >
        Copy
      </button>
      ${renderContinue("I opened it")}
      <button class="btn" ?disabled=${props.authFlowBusy} @click=${props.onCancelAuthFlow}>
        Cancel
      </button>
    </div>
  `;

  const renderSelect = (options: AuthFlowStepOption[]) => {
    const idx = options.findIndex((opt) => Object.is(opt.value, props.authFlowAnswer));
    const selected = idx >= 0 ? String(idx) : options.length ? "0" : "";
    return html`
      ${message ? html`<div class="card-sub" style="margin-top: 8px;">${message}</div>` : nothing}
      <label class="field" style="margin-top: 12px;">
        <span>Choice</span>
        <select
          .value=${selected}
          @change=${(e: Event) => {
            const nextIdx = Number((e.target as HTMLSelectElement).value);
            const opt = Number.isFinite(nextIdx) ? options[nextIdx] : undefined;
            props.onAuthFlowAnswerChange(opt?.value ?? null);
          }}
        >
          ${options.map((opt, i) => html`<option value=${String(i)}>${opt.label}</option>`)}
        </select>
      </label>
      <div class="row" style="margin-top: 12px; gap: 10px;">
        ${renderContinue()}
        <button class="btn" ?disabled=${props.authFlowBusy} @click=${props.onCancelAuthFlow}>
          Cancel
        </button>
      </div>
    `;
  };

  const renderMultiSelect = (options: AuthFlowStepOption[]) => {
    const selected = Array.isArray(props.authFlowAnswer) ? props.authFlowAnswer : [];
    const toggle = (optValue: unknown, checked: boolean) => {
      const base = selected.filter((v) => !Object.is(v, optValue));
      const next = checked ? [...base, optValue] : base;
      props.onAuthFlowAnswerChange(next);
    };
    return html`
      ${message ? html`<div class="card-sub" style="margin-top: 8px;">${message}</div>` : nothing}
      <div style="margin-top: 12px;">
        ${options.map((opt) => {
          const checked = selected.some((v) => Object.is(v, opt.value));
          return html`
            <label class="row" style="gap: 8px; margin-top: 8px;">
              <input
                type="checkbox"
                .checked=${checked}
                @change=${(e: Event) => toggle(opt.value, (e.target as HTMLInputElement).checked)}
              />
              <span>${opt.label}</span>
              ${opt.hint ? html`<span class="muted">(${opt.hint})</span>` : nothing}
            </label>
          `;
        })}
      </div>
      <div class="row" style="margin-top: 12px; gap: 10px;">
        ${renderContinue()}
        <button class="btn" ?disabled=${props.authFlowBusy} @click=${props.onCancelAuthFlow}>
          Cancel
        </button>
      </div>
    `;
  };

  const renderText = (textStep: Extract<AuthFlowStep, { type: "text" }>) => html`
    ${message ? html`<div class="card-sub" style="margin-top: 8px;">${message}</div>` : nothing}
    <label class="field" style="margin-top: 12px;">
      <span>${textStep.sensitive ? "Secret" : "Value"}</span>
      <input
        type=${textStep.sensitive ? "password" : "text"}
        autocomplete=${textStep.sensitive ? "new-password" : "off"}
        .value=${typeof props.authFlowAnswer === "string" ? props.authFlowAnswer : ""}
        @input=${(e: Event) => props.onAuthFlowAnswerChange((e.target as HTMLInputElement).value)}
        placeholder=${textStep.placeholder ?? ""}
      />
    </label>
    <div class="row" style="margin-top: 12px; gap: 10px;">
      ${renderContinue()}
      <button class="btn" ?disabled=${props.authFlowBusy} @click=${props.onCancelAuthFlow}>
        Cancel
      </button>
    </div>
  `;

  const renderConfirm = () => html`
    ${message ? html`<div class="card-sub" style="margin-top: 8px;">${message}</div>` : nothing}
    <label class="row" style="gap: 8px; margin-top: 12px;">
      <input
        type="checkbox"
        .checked=${Boolean(props.authFlowAnswer)}
        @change=${(e: Event) => props.onAuthFlowAnswerChange((e.target as HTMLInputElement).checked)}
      />
      <span>Yes</span>
    </label>
    <div class="row" style="margin-top: 12px; gap: 10px;">
      ${renderContinue()}
      <button class="btn" ?disabled=${props.authFlowBusy} @click=${props.onCancelAuthFlow}>
        Cancel
      </button>
    </div>
  `;

  return html`
    <div class="card" style="margin-top: 14px;">
      <div class="row" style="justify-content: space-between;">
        <div>
          <div class="card-title">${title}</div>
          <div class="muted">
            ${
              contextProvider
                ? html`Connecting: <span class="mono">${contextProvider}</span>`
                : html`
                    Connecting
                  `
            }
            ${contextMethod ? html` · ${contextMethod}` : nothing}
            <span style="opacity: 0.6;"> · </span>step: ${step.type}
          </div>
        </div>
      </div>
      ${step.type === "note" ? renderNote() : nothing}
      ${step.type === "openUrl" ? renderOpenUrl(step) : nothing}
      ${step.type === "select" ? renderSelect(step.options ?? []) : nothing}
      ${step.type === "multiselect" ? renderMultiSelect(step.options ?? []) : nothing}
      ${step.type === "text" ? renderText(step) : nothing}
      ${step.type === "confirm" ? renderConfirm() : nothing}
    </div>
  `;
}

function renderWizardStep(props: CredentialsProps, step: WizardStep) {
  const title = resolveWizardStepTitle(step);
  const message = step.message ?? "";
  const unknownStep =
    step.type !== "note" &&
    step.type !== "select" &&
    step.type !== "multiselect" &&
    step.type !== "text" &&
    step.type !== "confirm";

  const renderContinue = (label = "Continue") => html`
    <button
      class="btn primary"
      ?disabled=${props.wizardBusy}
      @click=${props.onWizardContinue}
    >
      ${props.wizardBusy ? "Working…" : label}
    </button>
  `;

  const renderNote = () => html`
    <div class="card-sub" style="margin-top: 8px; white-space: pre-wrap;">${message}</div>
    <div class="row" style="margin-top: 12px; gap: 10px;">
      ${renderContinue()}
      <button class="btn" ?disabled=${props.wizardBusy} @click=${props.onCancelWizard}>
        Cancel
      </button>
    </div>
  `;

  const renderSelect = (options: WizardStepOption[]) => {
    const idx = options.findIndex((opt) => Object.is(opt.value, props.wizardAnswer));
    const selected = idx >= 0 ? String(idx) : options.length ? "0" : "";
    return html`
      ${message ? html`<div class="card-sub" style="margin-top: 8px;">${message}</div>` : nothing}
      <label class="field" style="margin-top: 12px;">
        <span>Choice</span>
        <select
          .value=${selected}
          @change=${(e: Event) => {
            const nextIdx = Number((e.target as HTMLSelectElement).value);
            const opt = Number.isFinite(nextIdx) ? options[nextIdx] : undefined;
            props.onWizardAnswerChange(opt?.value ?? null);
          }}
        >
          ${options.map((opt, i) => html`<option value=${String(i)}>${opt.label}</option>`)}
        </select>
      </label>
      <div class="row" style="margin-top: 12px; gap: 10px;">
        ${renderContinue()}
        <button class="btn" ?disabled=${props.wizardBusy} @click=${props.onCancelWizard}>
          Cancel
        </button>
      </div>
    `;
  };

  const renderMultiSelect = (options: WizardStepOption[]) => {
    const selected = Array.isArray(props.wizardAnswer) ? props.wizardAnswer : [];
    const toggle = (optValue: unknown, checked: boolean) => {
      const base = selected.filter((v) => !Object.is(v, optValue));
      const next = checked ? [...base, optValue] : base;
      props.onWizardAnswerChange(next);
    };
    return html`
      ${message ? html`<div class="card-sub" style="margin-top: 8px;">${message}</div>` : nothing}
      <div style="margin-top: 12px;">
        ${options.map((opt) => {
          const checked = selected.some((v) => Object.is(v, opt.value));
          return html`
            <label class="row" style="gap: 8px; margin-top: 8px;">
              <input
                type="checkbox"
                .checked=${checked}
                @change=${(e: Event) => toggle(opt.value, (e.target as HTMLInputElement).checked)}
              />
              <span>${opt.label}</span>
              ${opt.hint ? html`<span class="muted">(${opt.hint})</span>` : nothing}
            </label>
          `;
        })}
      </div>
      <div class="row" style="margin-top: 12px; gap: 10px;">
        ${renderContinue()}
        <button class="btn" ?disabled=${props.wizardBusy} @click=${props.onCancelWizard}>
          Cancel
        </button>
      </div>
    `;
  };

  const renderText = () => html`
    ${message ? html`<div class="card-sub" style="margin-top: 8px;">${message}</div>` : nothing}
    <label class="field" style="margin-top: 12px;">
      <span>${step.sensitive ? "Secret" : "Value"}</span>
      <input
        type=${step.sensitive ? "password" : "text"}
        autocomplete=${step.sensitive ? "new-password" : "off"}
        .value=${typeof props.wizardAnswer === "string" ? props.wizardAnswer : ""}
        @input=${(e: Event) => props.onWizardAnswerChange((e.target as HTMLInputElement).value)}
        placeholder=${step.placeholder ?? ""}
      />
    </label>
    <div class="row" style="margin-top: 12px; gap: 10px;">
      ${renderContinue()}
      <button class="btn" ?disabled=${props.wizardBusy} @click=${props.onCancelWizard}>
        Cancel
      </button>
    </div>
  `;

  const renderConfirm = () => html`
    ${message ? html`<div class="card-sub" style="margin-top: 8px;">${message}</div>` : nothing}
    <label class="row" style="gap: 8px; margin-top: 12px;">
      <input
        type="checkbox"
        .checked=${Boolean(props.wizardAnswer)}
        @change=${(e: Event) => props.onWizardAnswerChange((e.target as HTMLInputElement).checked)}
      />
      <span>Yes</span>
    </label>
    <div class="row" style="margin-top: 12px; gap: 10px;">
      ${renderContinue()}
      <button class="btn" ?disabled=${props.wizardBusy} @click=${props.onCancelWizard}>
        Cancel
      </button>
    </div>
  `;

  return html`
    <div class="card" style="margin-top: 14px;">
      <div class="row" style="justify-content: space-between;">
        <div>
          <div class="card-title">${title}</div>
          ${step.type ? html`<div class="muted">wizard step: ${step.type}</div>` : nothing}
        </div>
      </div>
      ${
        unknownStep
          ? html`<div class="callout warn" style="margin-top: 12px;">
          Unsupported wizard step type: ${step.type}
        </div>`
          : nothing
      }
      ${step.type === "note" ? renderNote() : nothing}
      ${step.type === "select" ? renderSelect(step.options ?? []) : nothing}
      ${step.type === "multiselect" ? renderMultiSelect(step.options ?? []) : nothing}
      ${step.type === "text" ? renderText() : nothing}
      ${step.type === "confirm" ? renderConfirm() : nothing}
      ${
        unknownStep
          ? html`<div class="row" style="margin-top: 12px; gap: 10px;">
          <button class="btn danger" ?disabled=${props.wizardBusy} @click=${props.onCancelWizard}>
            Cancel wizard
          </button>
        </div>`
          : nothing
      }
    </div>
  `;
}

export function renderCredentials(props: CredentialsProps) {
  const profiles = props.profiles ?? [];
  const gettingStarted = profiles.length === 0;
  const hasWizard = props.wizardRunning;
  const wizardOwned = props.wizardOwned;
  const hasAuthFlow = props.authFlowRunning;
  const authFlowOwned = props.authFlowOwned;
  const mode = inferAuthFlowMode(props.gatewayUrl);
  const now = Date.now();
  const activeSuccess = props.success && props.success.expiresAtMs > now ? props.success : null;

  const profilesByProvider = (() => {
    const map = new Map<string, AuthProfileSummary[]>();
    for (const profile of profiles) {
      const provider = normalizeProviderId(profile.provider);
      const list = map.get(provider);
      if (list) {
        list.push(profile);
      } else {
        map.set(provider, [profile]);
      }
    }
    return map;
  })();

  const providerProfiles = (providerId: string) =>
    profilesByProvider.get(normalizeProviderId(providerId)) ?? [];

  const resolveProviderLabel = (providerId: string) => {
    const list = props.authFlowList?.providers ?? [];
    const normalized = normalizeProviderId(providerId);
    const match = list.find((p) => normalizeProviderId(p.providerId) === normalized);
    return match?.label?.trim() || providerId;
  };

  const resolveMethodLabel = (providerId: string, methodId: string) => {
    const method = resolveAuthFlowMethod(props.authFlowList, providerId, methodId);
    return method?.label?.trim() || methodId;
  };

  const defaultProfileIdForProvider = (providerId: string) => {
    const normalized = normalizeProviderId(providerId);
    return normalized ? `${normalized}:default` : "";
  };

  const scrollToProfiles = () => {
    window.setTimeout(() => {
      scrollToCardWithinContent("credentials-auth-profiles");
    }, 0);
  };

  const scrollToQuickConnect = () => {
    window.setTimeout(() => {
      scrollToCardWithinContent("credentials-quick-connect");
    }, 0);
  };

  const closeAllApiKeyPanels = () => {
    try {
      const panels = document.querySelectorAll('details[data-credentials-api-key-panel="1"]');
      for (const panel of Array.from(panels)) {
        (panel as HTMLDetailsElement).open = false;
      }
    } catch {
      // ignore
    }
  };

  const openApiKeyPanel = (panelId: string, providerId: string) => {
    const provider = normalizeProviderId(providerId);
    const profileId = defaultProfileIdForProvider(providerId);
    props.onApiKeyFormChange({ provider, profileId, email: "", apiKey: "" });
    window.setTimeout(() => {
      const panel = document.getElementById(panelId) as HTMLDetailsElement | null;
      if (panel) {
        closeAllApiKeyPanels();
        panel.open = true;
      }
      scrollToCardWithinContent(panelId);
      try {
        const input = panel?.querySelector('input[type="password"]') as HTMLInputElement | null;
        input?.focus();
      } catch {
        // ignore
      }
    }, 0);
  };

  const openManualApiKeyPanel = (providerId: string) => {
    window.setTimeout(() => {
      const advanced = document.getElementById("credentials-advanced") as HTMLDetailsElement | null;
      if (advanced) {
        advanced.open = true;
      }
      openApiKeyPanel("credentials-manual-api-key-panel", providerId);
    }, 0);
  };

  const startFlow = (providerId: string, methodId: string) => {
    props.onStartAuthFlow(providerId, methodId, mode);
  };

  const methodCodex = resolveAuthFlowMethod(props.authFlowList, "openai-codex", "oauth");
  const methodAnthropicOAuth = resolveAuthFlowMethod(props.authFlowList, "anthropic", "oauth");
  const methodSetupToken = resolveAuthFlowMethod(props.authFlowList, "anthropic", "setup-token");
  const methodGeminiCli = resolveAuthFlowMethod(props.authFlowList, "google-gemini-cli", "oauth");
  const methodAntigravity = resolveAuthFlowMethod(
    props.authFlowList,
    "google-antigravity",
    "oauth",
  );

  const codexProfiles = providerProfiles("openai-codex");
  const anthropicProfiles = providerProfiles("anthropic");
  const googleProfiles = providerProfiles("google");

  const activeAuthProvider = props.authFlowProviderId
    ? normalizeProviderId(props.authFlowProviderId)
    : null;
  const activeAuthProviderLabel = props.authFlowProviderId
    ? resolveProviderLabel(props.authFlowProviderId)
    : null;
  const activeAuthMethodLabel =
    props.authFlowProviderId && props.authFlowMethodId
      ? resolveMethodLabel(props.authFlowProviderId, props.authFlowMethodId)
      : null;

  const renderAuthFlowInline = (providerIds: string[]) => {
    if (!hasAuthFlow) {
      return nothing;
    }
    if (!authFlowOwned) {
      return nothing;
    }
    if (!activeAuthProvider) {
      return nothing;
    }
    const matches = providerIds.some((p) => normalizeProviderId(p) === activeAuthProvider);
    if (!matches) {
      return nothing;
    }

    return html`
      ${
        !props.authFlowStep
          ? html`<div class="callout" style="margin-top: 12px;">
            <div class="row" style="justify-content: space-between; gap: 12px;">
              <div style="min-width: 0;">
                <div>Connect flow running.</div>
                ${
                  activeAuthProviderLabel
                    ? html`<div class="muted" style="margin-top: 6px;">
                      Connecting: <span class="mono">${activeAuthProviderLabel}</span>
                      ${activeAuthMethodLabel ? html` · ${activeAuthMethodLabel}` : nothing}
                    </div>`
                    : nothing
                }
              </div>
              <div class="row" style="gap: 10px; flex-wrap: wrap;">
                <button class="btn primary" ?disabled=${props.authFlowBusy} @click=${props.onResumeAuthFlow}>
                  ${props.authFlowBusy ? "Working…" : "Resume"}
                </button>
                <button class="btn danger" ?disabled=${props.authFlowBusy} @click=${props.onCancelAuthFlow}>
                  Cancel
                </button>
              </div>
            </div>
          </div>`
          : renderAuthFlowStep(props, props.authFlowStep, {
              providerLabel: activeAuthProviderLabel ?? undefined,
              methodLabel: activeAuthMethodLabel ?? undefined,
            })
      }
    `;
  };

  const renderApiKeyFields = (opts: { panelId: string; providerId: string }) => {
    const defaultId = defaultProfileIdForProvider(opts.providerId);
    const normalized = normalizeProviderId(opts.providerId);
    const active = normalizeProviderId(props.apiKeyForm.provider) === normalized;
    const effectiveId = active ? props.apiKeyForm.profileId || defaultId : defaultId;

    return html`
      <div class="muted" style="margin-top: 10px;">
        Saving to credential ID: <span class="mono">${effectiveId}</span>
      </div>

      <div class="row" style="margin-top: 12px; gap: 12px; align-items: flex-start; flex-wrap: wrap;">
        <label class="field" style="flex: 1; min-width: 240px;">
          <span>Email (optional)</span>
          <input
            .value=${active ? props.apiKeyForm.email : ""}
            @input=${(e: Event) =>
              props.onApiKeyFormChange({ email: (e.target as HTMLInputElement).value })}
            placeholder="name@example.com"
            autocomplete="off"
          />
        </label>
        <label class="field" style="flex: 1; min-width: 240px;">
          <span>API key (write-only)</span>
          <input
            type="password"
            autocomplete="new-password"
            .value=${active ? props.apiKeyForm.apiKey : ""}
            @input=${(e: Event) =>
              props.onApiKeyFormChange({ apiKey: (e.target as HTMLInputElement).value })}
            placeholder="••••••••••••••"
          />
        </label>
      </div>

      <details style="margin-top: 10px;">
        <summary class="muted" style="list-style: none; cursor: pointer;">Advanced</summary>
        <div class="row" style="margin-top: 10px; gap: 12px; align-items: flex-start; flex-wrap: wrap;">
          <label class="field" style="flex: 1; min-width: 240px;">
            <span>Credential ID</span>
            <input
              .value=${active ? props.apiKeyForm.profileId : defaultId}
              @input=${(e: Event) =>
                props.onApiKeyFormChange({ profileId: (e.target as HTMLInputElement).value })}
              placeholder=${defaultId || "provider:default"}
            />
          </label>
        </div>
        <div class="muted" style="margin-top: 6px;">
          Most setups use <span class="mono">${defaultId || "provider:default"}</span>. Custom IDs are useful for multiple keys per provider.
        </div>
      </details>

      <div class="row" style="margin-top: 12px; gap: 10px; flex-wrap: wrap;">
        <button
          class="btn primary"
          ?disabled=${!props.connected || props.saving || !active || !props.apiKeyForm.apiKey.trim()}
          @click=${props.onUpsertApiKey}
        >
          ${props.saving ? "Saving…" : "Save credential"}
        </button>
        <button
          class="btn"
          ?disabled=${props.saving}
          @click=${() => {
            props.onApiKeyFormChange({ apiKey: "" });
            const panel = document.getElementById(opts.panelId) as HTMLDetailsElement | null;
            if (panel) {
              panel.open = false;
            }
          }}
        >
          Cancel
        </button>
      </div>
    `;
  };

  const renderManualApiKeyPanel = () => {
    const manualProviders = (props.authFlowList?.providers ?? []).filter((p) =>
      p.methods?.some((m) => m.kind === "api_key_manual"),
    );
    const providerOptions = manualProviders
      .map((p) => ({
        id: normalizeProviderId(p.providerId),
        label: p.label?.trim() || p.providerId,
      }))
      .filter((p) => p.id);

    const currentProvider = normalizeProviderId(props.apiKeyForm.provider);
    const effectiveProvider = providerOptions.some((p) => p.id === currentProvider)
      ? currentProvider
      : providerOptions[0]?.id || "";
    const currentDefaultId = currentProvider ? `${currentProvider}:default` : "";
    const shouldAutoId =
      !props.apiKeyForm.profileId || props.apiKeyForm.profileId === currentDefaultId;

    const onProviderChange = (nextProvider: string) => {
      const normalized = normalizeProviderId(nextProvider);
      const nextDefaultId = normalized ? `${normalized}:default` : "";
      props.onApiKeyFormChange({
        provider: normalized,
        profileId: shouldAutoId ? nextDefaultId : props.apiKeyForm.profileId,
        apiKey: "",
      });
    };

    return html`
      <details
        class="card"
        id="credentials-manual-api-key-panel"
        data-credentials-api-key-panel="1"
        style="margin-top: 12px;"
        @toggle=${(e: Event) => {
          const el = e.currentTarget as HTMLDetailsElement;
          if (!el.open) {
            return;
          }
          const provider = normalizeProviderId(props.apiKeyForm.provider);
          if (provider) {
            return;
          }
          if (!providerOptions.length) {
            return;
          }
          onProviderChange(providerOptions[0]!.id);
        }}
      >
        <summary style="list-style: none; cursor: pointer;">
          <div class="card-title">Manual: API key</div>
          <div class="card-sub">For providers that support API key entry.</div>
        </summary>

        <div style="margin-top: 12px;">
          ${
            providerOptions.length
              ? html`<label class="field" style="max-width: 420px;">
                <span>Provider</span>
                <select
                  .value=${effectiveProvider}
                  @change=${(e: Event) => onProviderChange((e.target as HTMLSelectElement).value)}
                >
                  ${providerOptions.map((p) => html`<option value=${p.id}>${p.label}</option>`)}
                </select>
              </label>`
              : html`
                  <div class="callout warn">
                    Provider list unavailable. You can still use API key entry from Quick Connect cards when
                    available.
                  </div>
                `
          }

          ${
            providerOptions.length
              ? html`
                ${renderApiKeyFields({
                  panelId: "credentials-manual-api-key-panel",
                  providerId: effectiveProvider,
                })}
              `
              : nothing
          }
        </div>
      </details>
    `;
  };

  const renderSavedCredentials = () => {
    const highlightId = activeSuccess?.profileId ?? null;
    if (gettingStarted) {
      return html`
        <details class="card" id="credentials-auth-profiles" style="margin-top: 14px;">
          <summary style="list-style: none; cursor: pointer;">
            <div class="card-title">Saved credentials</div>
            <div class="card-sub">No credentials yet.</div>
          </summary>

          <div class="callout" style="margin-top: 12px;">
            <div>No credentials found.</div>
            <div class="muted" style="margin-top: 6px;">Connect your first provider in Quick Connect.</div>
            <div class="row" style="margin-top: 10px; gap: 10px; flex-wrap: wrap;">
              <button class="btn primary" ?disabled=${props.authFlowBusy} @click=${scrollToQuickConnect}>
                Go to Quick Connect
              </button>
            </div>
          </div>
        </details>
      `;
    }

    return html`
      <div class="card" id="credentials-auth-profiles" style="margin-top: 14px;">
        <div class="card-title">Saved credentials</div>
        <div class="card-sub">Masked inventory only. API keys and tokens are write-only.</div>

        ${
          activeSuccess
            ? html`<div class="callout success" style="margin-top: 12px;">
              ${activeSuccess.message}
              ${activeSuccess.profileId ? html` <span class="mono">${activeSuccess.profileId}</span>` : nothing}
            </div>`
            : nothing
        }

        <div style="margin-top: 12px;">
          ${profiles.map((p) =>
            renderProfileRow(p, props, {
              highlight: Boolean(highlightId && p.id === highlightId),
            }),
          )}
        </div>
      </div>
    `;
  };

  const renderQuickConnect = () => html`
    <div class="card" id="credentials-quick-connect" style="margin-top: 14px;">
      <div class="card-title">Quick Connect</div>
      <div class="card-sub">Recommended for most setups. Remote-safe flows; secrets are write-only.</div>

      ${
        hasAuthFlow && !authFlowOwned
          ? html`<div class="callout warn" style="margin-top: 12px;">
            <div class="row" style="justify-content: space-between; gap: 12px; flex-wrap: wrap;">
              <div style="min-width: 0;">
                <div>A connect flow is running on another device.</div>
                <div class="muted" style="margin-top: 6px;">Complete or cancel it from the owning Control UI session.</div>
              </div>
              <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
                ${props.loading ? "Loading…" : "Refresh"}
              </button>
            </div>
          </div>`
          : nothing
      }

      <div class="row" style="margin-top: 12px; gap: 12px; flex-wrap: wrap; align-items: stretch;">
        <div class="card" style="flex: 1; min-width: 260px;">
          <div class="card-title">OpenAI Codex</div>
          <div class="card-sub">Sign in with OAuth</div>
          ${
            codexProfiles.length
              ? html`<div class="muted" style="margin-top: 10px;">
                Connected · ${codexProfiles.length} profile${codexProfiles.length === 1 ? "" : "s"}
                ${codexProfiles[0]?.id ? html`· <span class="mono">${codexProfiles[0].id}</span>` : nothing}
              </div>`
              : nothing
          }

          <div class="row" style="margin-top: 12px; gap: 10px; flex-wrap: wrap;">
            ${
              methodCodex
                ? html`
                  <button
                    class="btn primary"
                    ?disabled=${!props.connected || props.authFlowBusy}
                    @click=${() => startFlow("openai-codex", "oauth")}
                  >
                    ${codexProfiles.length ? "Connect another" : "Connect"}
                  </button>
                `
                : nothing
            }
            ${
              codexProfiles.length
                ? html`<button class="btn btn--sm" @click=${scrollToProfiles} title="Scroll to saved credentials">
                  View saved credentials
                </button>`
                : nothing
            }
          </div>

          ${renderAuthFlowInline(["openai-codex"])}
          ${
            !methodCodex
              ? html`
                  <div class="muted" style="margin-top: 10px">OAuth not available on this gateway.</div>
                `
              : nothing
          }
        </div>

        <div class="card" style="flex: 1; min-width: 260px;">
          <div class="card-title">Anthropic</div>
          <div class="card-sub">OAuth sign-in (recommended) or API key</div>
          ${
            anthropicProfiles.length
              ? html`<div class="muted" style="margin-top: 10px;">
                Connected · ${anthropicProfiles.length} profile${anthropicProfiles.length === 1 ? "" : "s"}
                ${anthropicProfiles[0]?.id ? html`· <span class="mono">${anthropicProfiles[0].id}</span>` : nothing}
              </div>`
              : nothing
          }

          <div class="row" style="margin-top: 12px; gap: 10px; flex-wrap: wrap;">
            ${
              methodAnthropicOAuth
                ? html`
                  <button
                    class="btn primary"
                    ?disabled=${!props.connected || props.authFlowBusy}
                    @click=${() => startFlow("anthropic", "oauth")}
                  >
                    ${anthropicProfiles.length ? "Connect another" : "Sign in"}
                  </button>
                `
                : nothing
            }
            <button class="btn" ?disabled=${props.saving} @click=${() => openApiKeyPanel("credentials-api-key-anthropic", "anthropic")}>
              Use API key
            </button>
            <details style="margin-top: 8px; width: 100%;">
              <summary class="muted" style="list-style: none; cursor: pointer;">More options</summary>
              <div class="row" style="margin-top: 10px; gap: 10px; flex-wrap: wrap;">
                ${
                  methodSetupToken
                    ? html`
                      <button
                        class="btn"
                        ?disabled=${!props.connected || props.authFlowBusy}
                        @click=${() => startFlow("anthropic", "setup-token")}
                      >
                        Use setup token
                      </button>
                    `
                    : nothing
                }
                ${
                  anthropicProfiles.length
                    ? html`<button class="btn btn--sm" @click=${scrollToProfiles} title="Scroll to saved credentials">
                      View saved credentials
                    </button>`
                    : nothing
                }
              </div>
            </details>

          </div>

          <details
            class="card-sub"
            id="credentials-api-key-anthropic"
            data-credentials-api-key-panel="1"
            style="margin-top: 10px;"
          >
            <summary class="muted" style="list-style: none; cursor: pointer;">API key</summary>
            ${renderApiKeyFields({ panelId: "credentials-api-key-anthropic", providerId: "anthropic" })}
          </details>

          ${renderAuthFlowInline(["anthropic"])}
          ${
            !methodAnthropicOAuth
              ? html`
                  <div class="muted" style="margin-top: 10px">OAuth not available on this gateway.</div>
                `
              : nothing
          }
        </div>

	        <div class="card" style="flex: 1; min-width: 260px;">
	          <div class="card-title">Google</div>
	          <div class="card-sub">
	            ${methodGeminiCli || methodAntigravity ? "OAuth sign-in (recommended) or API key" : "Gemini API key"}
	          </div>

          <div class="row" style="margin-top: 12px; gap: 10px; flex-wrap: wrap;">
            ${
              methodGeminiCli || methodAntigravity
                ? html`
                  <button
                    class="btn primary"
                    ?disabled=${!props.connected || props.authFlowBusy}
                    @click=${() => startFlow(methodGeminiCli ? "google-gemini-cli" : "google-antigravity", "oauth")}
                    title=${methodGeminiCli ? "OAuth via Gemini CLI plugin" : "OAuth via Antigravity plugin"}
                  >
                    Sign in with Google
                  </button>
                `
                : html`
                  <button
                    class="btn primary"
                    ?disabled=${props.saving}
                    @click=${() => openApiKeyPanel("credentials-api-key-google", "google")}
                  >
                    Gemini API key
                  </button>
                `
            }

            <details style="margin-top: 8px; width: 100%;">
              <summary class="muted" style="list-style: none; cursor: pointer;">More options</summary>
              <div class="row" style="margin-top: 10px; gap: 10px; flex-wrap: wrap;">
                ${
                  methodGeminiCli || methodAntigravity
                    ? html`
                      <button
                        class="btn"
                        ?disabled=${props.saving}
                        @click=${() => openApiKeyPanel("credentials-api-key-google", "google")}
                      >
                        Use API key
                      </button>
                    `
                    : nothing
                }
                ${
                  methodGeminiCli && methodAntigravity
                    ? html`
                      <button
                        class="btn"
                        ?disabled=${!props.connected || props.authFlowBusy}
                        @click=${() => startFlow(methodGeminiCli ? "google-antigravity" : "google-gemini-cli", "oauth")}
                        title=${methodGeminiCli ? "Alternate OAuth plugin" : "Alternate OAuth plugin"}
                      >
                        Try alternate OAuth
                      </button>
                    `
                    : nothing
                }
                ${
                  googleProfiles.length
                    ? html`<button class="btn btn--sm" @click=${scrollToProfiles} title="Scroll to saved credentials">
                      View saved credentials
                    </button>`
                    : nothing
                }
              </div>
              ${
                !methodGeminiCli && !methodAntigravity
                  ? html`
                      <div class="muted" style="margin-top: 10px">OAuth plugins not available on this gateway.</div>
                    `
                  : nothing
              }
            </details>
          </div>

          <details
            class="card-sub"
            id="credentials-api-key-google"
            data-credentials-api-key-panel="1"
            style="margin-top: 10px;"
          >
            <summary class="muted" style="list-style: none; cursor: pointer;">API key</summary>
            ${renderApiKeyFields({ panelId: "credentials-api-key-google", providerId: "google" })}
          </details>

          ${renderAuthFlowInline(["google-gemini-cli", "google-antigravity"])}
        </div>
      </div>

      ${
        hasAuthFlow &&
        authFlowOwned &&
        (!activeAuthProvider ||
          !(
            ["openai-codex", "anthropic", "google-gemini-cli", "google-antigravity"].some(
              (p) => normalizeProviderId(p) === activeAuthProvider,
            ) ||
            // Exclude providers rendered inline in the Advanced section.
            (props.authFlowList?.providers ?? []).some(
              (p) => normalizeProviderId(p.providerId) === activeAuthProvider,
            )
          ))
          ? html`
            <div class="callout info" style="margin-top: 12px;">
              <div class="row" style="justify-content: space-between; gap: 12px; flex-wrap: wrap;">
                <div style="min-width: 0;">
                  <div>Connect flow running.</div>
                  ${
                    activeAuthProviderLabel
                      ? html`<div class="muted" style="margin-top: 6px;">
                        Connecting: <span class="mono">${activeAuthProviderLabel}</span>
                        ${activeAuthMethodLabel ? html` · ${activeAuthMethodLabel}` : nothing}
                      </div>`
                      : html`
                          <div class="muted" style="margin-top: 6px">
                            Provider unknown on this device. Refresh to re-check ownership.
                          </div>
                        `
                  }
                </div>
                <div class="row" style="gap: 10px; flex-wrap: wrap;">
                  <button class="btn primary" ?disabled=${props.authFlowBusy} @click=${props.onResumeAuthFlow}>
                    ${props.authFlowBusy ? "Working…" : "Resume"}
                  </button>
                  <button class="btn danger" ?disabled=${props.authFlowBusy} @click=${props.onCancelAuthFlow}>
                    Cancel
                  </button>
                  <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
                    ${props.loading ? "Loading…" : "Refresh"}
                  </button>
                </div>
              </div>
            </div>

            ${
              props.authFlowStep
                ? renderAuthFlowStep(props, props.authFlowStep, {
                    providerLabel: activeAuthProviderLabel ?? undefined,
                    methodLabel: activeAuthMethodLabel ?? undefined,
                  })
                : nothing
            }
          `
          : nothing
      }
    </div>
  `;

  return html`
    <section class="card">
      <div class="row" style="justify-content: space-between;">
        <div>
          <div class="card-title">Provider Credentials</div>
          <div class="card-sub">Manage masked auth profiles and connect new providers.</div>
        </div>
        <div class="row" style="gap: 10px;">
          <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
            ${props.loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      ${
        activeSuccess && gettingStarted
          ? html`<div class="callout success" style="margin-top: 12px;">
            ${activeSuccess.message}
            ${activeSuccess.profileId ? html` <span class="mono">${activeSuccess.profileId}</span>` : nothing}
          </div>`
          : nothing
      }

      ${
        !props.connected
          ? html`
              <div class="callout danger" style="margin-top: 12px">Disconnected from gateway.</div>
            `
          : nothing
      }

      ${
        props.error
          ? html`<div class="callout danger" style="margin-top: 12px;">${props.error}</div>`
          : nothing
      }

      ${
        props.authFlowError
          ? html`<div class="callout danger" style="margin-top: 12px;">${props.authFlowError}</div>`
          : nothing
      }

      ${
        props.authFlowApplyError
          ? html`<div class="callout warn" style="margin-top: 12px;">
            Defaults patch failed: ${props.authFlowApplyError}
          </div>`
          : nothing
      }

      ${
        props.authFlowResult
          ? html`<div class="callout" style="margin-top: 12px;">
            <div style="min-width: 0;">
              <div>Connected.</div>
              ${
                props.authFlowResult.defaultModel
                  ? props.authFlowPendingDefaultModel
                    ? html`<div class="row" style="margin-top: 6px; gap: 10px; flex-wrap: wrap;">
                      <div class="muted">
                        Recommended default model:
                        <span class="mono">${props.authFlowResult.defaultModel}</span>
                        <span style="opacity: 0.7;">(not applied)</span>
                      </div>
                      <div class="muted" style="opacity: 0.85;">
                        You already had credentials for this provider, so defaults were not changed automatically.
                      </div>
                      <button
                        class="btn"
                        ?disabled=${props.authFlowBusy}
                        @click=${props.onApplyAuthFlowDefaults}
                        title="Apply the recommended default model"
                      >
                        Set as default
                      </button>
                    </div>`
                    : html`<div class="muted">Default model: <span class="mono">${props.authFlowResult.defaultModel}</span></div>`
                  : nothing
              }
              ${
                props.authFlowResult.profiles?.length
                  ? html`<div class="muted" style="margin-top: 6px;">
                    Profiles:
                    ${props.authFlowResult.profiles.map((p) => html`<span class="mono">${p.id}</span>`).reduce((a, b) => html`${a}, ${b}`)}
                  </div>`
                  : nothing
              }
              ${
                props.authFlowResult.notes?.length
                  ? html`<div class="muted" style="margin-top: 6px; white-space: pre-wrap;">${props.authFlowResult.notes.join("\n")}</div>`
                  : nothing
              }

              <div class="row" style="margin-top: 10px; gap: 10px; flex-wrap: wrap;">
                <button class="btn primary" @click=${props.onOpenChat} title="Send a test message using the connected provider">
                  Send a test message
                </button>
                <button class="btn" @click=${props.onOpenAgentProfile} title="Configure models and locked credentials per agent">
                  Configure agents
                </button>
                <button class="btn" @click=${scrollToProfiles} title="View saved credentials">
                  View saved credentials
                </button>
              </div>
            </div>
          </div>`
          : nothing
      }

      ${gettingStarted ? html`${renderQuickConnect()}${renderSavedCredentials()}` : html`${renderSavedCredentials()}${renderQuickConnect()}`}

      <details class="card" id="credentials-advanced" style="margin-top: 14px;" ?open=${hasWizard}>
        <summary style="list-style: none; cursor: pointer;">
          <div class="card-title">Manual / Advanced</div>
          <div class="card-sub">Fallback options if Quick Connect doesn't cover your provider.</div>
        </summary>

        ${
          props.authFlowLoading
            ? html`
                <div class="muted" style="margin-top: 12px">Loading providers…</div>
              `
            : nothing
        }

        ${renderManualApiKeyPanel()}

        ${
          props.authFlowList?.providers?.length
            ? html`<div style="margin-top: 12px;">
              ${props.authFlowList.providers.map(
                (provider) => html`
                <div class="card" style="margin-top: 10px;">
                  <div class="row" style="justify-content: space-between; gap: 12px;">
                    <div style="min-width: 0;">
                      <div class="card-title">${provider.label}</div>
                      <div class="muted">provider ID: <span class="mono">${provider.providerId}</span></div>
                    </div>
                    ${
                      providerProfiles(provider.providerId).length
                        ? html`
                            <span class="chip chip-ok">connected</span>
                          `
                        : nothing
                    }
                  </div>
                  <div style="margin-top: 10px;">
                    ${provider.methods.map((method) => {
                      const isManual = method.kind === "api_key_manual";
                      const connected = providerProfiles(provider.providerId).length > 0;
                      const btnLabel = isManual
                        ? "Enter API key"
                        : connected
                          ? "Connect another"
                          : "Connect";
                      const disabled =
                        !props.connected || (isManual ? props.saving : props.authFlowBusy);
                      return html`
                        <div class="row" style="justify-content: space-between; gap: 12px; margin-top: 8px;">
                          <div style="min-width: 0;">
                            <div class="row" style="gap: 10px; flex-wrap: wrap;">
                              <span class="chip">${method.kind}</span>
                              <span class="mono">${method.methodId}</span>
                              <span>${method.label}</span>
                            </div>
                            ${method.hint ? html`<div class="muted" style="margin-top: 4px;">${method.hint}</div>` : nothing}
                          </div>
                          <button
                            class="btn ${isManual ? "" : "primary"}"
                            ?disabled=${disabled}
                            @click=${() => {
                              if (isManual) {
                                openManualApiKeyPanel(provider.providerId);
                                return;
                              }
                              startFlow(provider.providerId, method.methodId);
                            }}
                          >
                            ${btnLabel}
                          </button>
                        </div>
                      `;
                    })}
                  </div>
                  ${renderAuthFlowInline([provider.providerId])}
                </div>
              `,
              )}
            </div>`
            : props.authFlowError
              ? nothing
              : html`
                  <div class="muted" style="margin-top: 12px">No providers reported by gateway.</div>
                `
        }
        <details class="card" style="margin-top: 14px;" ?open=${hasWizard}>
          <summary style="list-style: none; cursor: pointer;">
            <div class="card-title">Legacy: full onboarding wizard</div>
            <div class="card-sub">Rarely needed. Runs full onboarding (config, channels, skills, credentials).</div>
          </summary>

          ${
            props.wizardError
              ? html`<div class="callout danger" style="margin-top: 12px;">${props.wizardError}</div>`
              : nothing
          }

          ${
            hasWizard && !wizardOwned
              ? html`<div class="callout warn" style="margin-top: 12px;">
                <div class="row" style="justify-content: space-between; gap: 12px; flex-wrap: wrap;">
                  <div style="min-width: 0;">
                    <div>A wizard is running on another device.</div>
                    <div class="muted" style="margin-top: 6px;">Complete or cancel it from the owning Control UI session.</div>
                  </div>
                  <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
                    ${props.loading ? "Loading…" : "Refresh"}
                  </button>
                </div>
              </div>`
              : nothing
          }

          ${
            hasWizard && wizardOwned && !props.wizardStep
              ? html`<div class="callout" style="margin-top: 12px;">
                <div class="row" style="justify-content: space-between; gap: 12px;">
                  <div>Wizard running. Resume to continue.</div>
                  <button class="btn primary" ?disabled=${props.wizardBusy} @click=${props.onResumeWizard}>
                    ${props.wizardBusy ? "Working…" : "Resume wizard"}
                  </button>
                </div>
              </div>`
              : nothing
          }

          ${hasWizard && wizardOwned && props.wizardStep ? renderWizardStep(props, props.wizardStep) : nothing}

          <div class="row" style="margin-top: 12px; gap: 10px; flex-wrap: wrap;">
            <button
              class="btn"
              ?disabled=${!props.connected || props.wizardBusy}
              @click=${props.onStartWizard}
              title="Start the onboarding wizard"
            >
              Run onboarding wizard
            </button>
            ${
              hasWizard && wizardOwned
                ? html`
                  <button
                    class="btn"
                    ?disabled=${!props.connected || props.wizardBusy}
                    @click=${props.onCancelWizard}
                    title="Cancel the running wizard"
                  >
                    Cancel wizard
                  </button>
                `
                : nothing
            }
          </div>
        </details>
      </details>

      ${
        props.disconnectDialog?.open
          ? html`<div
            class="exec-approval-overlay"
            role="dialog"
            aria-modal="true"
            aria-live="polite"
            @click=${() => props.onCancelDeleteProfile()}
          >
            <div class="exec-approval-card" @click=${(e: Event) => e.stopPropagation()}>
              <div class="exec-approval-header">
                <div>
                  <div class="exec-approval-title">Disconnect credential</div>
                  <div class="exec-approval-sub">
                    <span class="mono">${props.disconnectDialog.profileId}</span>
                  </div>
                </div>
              </div>

              <div class="callout warn" style="margin-top: 12px;">
                This deletes the stored credential material from the gateway.
              </div>

              ${
                props.error
                  ? html`<div class="callout danger" style="margin-top: 10px;">${props.error}</div>`
                  : nothing
              }

              ${
                props.disconnectDialog.provider &&
                props.disconnectDialog.providerCount &&
                props.disconnectDialog.providerCount > 1
                  ? html`<div class="muted" style="margin-top: 10px;">
                    You have ${props.disconnectDialog.providerCount} credentials for <span class="mono">${props.disconnectDialog.provider}</span>. This removes 1.
                  </div>`
                  : nothing
              }

              ${
                props.disconnectDialog.impactsLoading
                  ? html`
                      <div class="muted" style="margin-top: 10px">Checking where this credential is used…</div>
                    `
                  : nothing
              }

              ${
                props.disconnectDialog.impactsError
                  ? html`<div class="callout warn" style="margin-top: 10px;">
                    Usage check failed: ${props.disconnectDialog.impactsError}
                  </div>`
                  : nothing
              }

              ${
                props.disconnectDialog.impacts
                  ? (() => {
                      const impacts = props.disconnectDialog.impacts!;
                      const usedByAgents = Array.from(
                        new Set([...impacts.lockedTextAgents, ...impacts.lockedImageAgents]),
                      );
                      return html`
                      ${
                        impacts.referencedByConfigAuthProfiles
                          ? html`
                              <div class="muted" style="margin-top: 10px">Referenced in gateway config.</div>
                            `
                          : nothing
                      }
                      ${
                        usedByAgents.length
                          ? html`<div class="muted" style="margin-top: 10px;">
                            Used by ${usedByAgents.length} agent${usedByAgents.length === 1 ? "" : "s"}:
                            ${usedByAgents.map((id) => html`<span class="mono">${id}</span>`).reduce((a, b) => html`${a}, ${b}`)}
                          </div>`
                          : html`
                              <div class="muted" style="margin-top: 10px">Not locked to any agents.</div>
                            `
                      }
                    `;
                    })()
                  : nothing
              }

              <div class="exec-approval-actions">
                <button class="btn" ?disabled=${props.saving} @click=${() => props.onCancelDeleteProfile()}>
                  Cancel
                </button>
                <button
                  class="btn danger"
                  ?disabled=${props.saving}
                  @click=${() => props.onConfirmDeleteProfile(props.disconnectDialog!.profileId)}
                >
                  ${props.saving ? "Disconnecting…" : "Disconnect"}
                </button>
              </div>
            </div>
          </div>`
          : nothing
      }
    </section>
  `;
}
