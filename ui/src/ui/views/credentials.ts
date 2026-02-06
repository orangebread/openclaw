import { html, nothing } from "lit";
import { formatMs } from "../format.ts";
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
import type { CredentialsApiKeyFormState } from "../controllers/credentials.ts";

function normalizeProviderId(provider?: string | null): string {
  if (!provider) return "";
  const normalized = provider.trim().toLowerCase();
  if (normalized === "z.ai" || normalized === "z-ai") return "zai";
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
  if (!el) return;

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
    if (normalizeProviderId(provider.providerId) !== normalizeProviderId(providerId)) continue;
    const method = provider.methods.find((m) => m.methodId.toLowerCase() === methodId.toLowerCase());
    if (method) return method;
  }
  return null;
}

export type CredentialsProps = {
  connected: boolean;
  gatewayUrl: string;
  loading: boolean;
  saving: boolean;
  error: string | null;

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
  onDeleteProfile: (profileId: string) => void;

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

function renderProfileRow(profile: AuthProfileSummary, props: CredentialsProps) {
  const status = profileStatusText(profile);
  const unavailable = isProfileUnavailable(profile);
  const provider = normalizeProviderId(profile.provider);
  const reason =
    typeof profile.disabledReason === "string" && profile.disabledReason.trim()
      ? profile.disabledReason.trim()
      : null;

  return html`
    <div class="card" style="margin-top: 10px;">
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
            ${profile.preview && profile.email ? html`<span style="opacity: 0.6;"> · </span>` : nothing}
            ${profile.email ? html`<span>${profile.email}</span>` : nothing}
            ${profile.expires ? html`<span style="opacity: 0.6;"> · </span><span>expires ${formatMs(profile.expires)}</span>` : nothing}
            ${reason ? html`<span style="opacity: 0.6;"> · </span><span>${reason}</span>` : nothing}
          </div>
        </div>
        <button
          class="btn"
          ?disabled=${props.saving}
          @click=${() => props.onDeleteProfile(profile.id)}
          title="Disconnect (delete) profile"
        >
          Disconnect…
        </button>
      </div>
    </div>
  `;
}

function resolveWizardStepTitle(step: WizardStep): string {
  if (step.title && step.title.trim()) return step.title.trim();
  if (step.type === "select") return "Select";
  if (step.type === "multiselect") return "Select";
  if (step.type === "confirm") return "Confirm";
  if (step.type === "text") return step.sensitive ? "Secret" : "Input";
  if (step.type === "note") return "Note";
  return "Wizard";
}

function resolveAuthFlowStepTitle(step: AuthFlowStep): string {
  if ("title" in step && step.title && step.title.trim()) return step.title.trim();
  if (step.type === "openUrl") return "Open URL";
  if (step.type === "select") return "Select";
  if (step.type === "multiselect") return "Select";
  if (step.type === "confirm") return "Confirm";
  if (step.type === "text") return step.sensitive ? "Secret" : "Input";
  if (step.type === "note") return "Note";
  return "Connect";
}

function renderAuthFlowStep(props: CredentialsProps, step: AuthFlowStep) {
  const title = resolveAuthFlowStepTitle(step);
  const message = "message" in step ? (step.message ?? "") : "";

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
          <div class="muted">connect step: ${step.type}</div>
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
  const unknownStep = step.type !== "note" &&
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
      ${unknownStep ? html`<div class="callout warn" style="margin-top: 12px;">
          Unsupported wizard step type: ${step.type}
        </div>` : nothing}
      ${step.type === "note" ? renderNote() : nothing}
      ${step.type === "select" ? renderSelect(step.options ?? []) : nothing}
      ${step.type === "multiselect" ? renderMultiSelect(step.options ?? []) : nothing}
      ${step.type === "text" ? renderText() : nothing}
      ${step.type === "confirm" ? renderConfirm() : nothing}
      ${unknownStep ? html`<div class="row" style="margin-top: 12px; gap: 10px;">
          <button class="btn danger" ?disabled=${props.wizardBusy} @click=${props.onCancelWizard}>
            Cancel wizard
          </button>
        </div>` : nothing}
    </div>
  `;
}

export function renderCredentials(props: CredentialsProps) {
  const profiles = props.profiles ?? [];
  const hasWizard = props.wizardRunning;
  const wizardOwned = props.wizardOwned;
  const hasAuthFlow = props.authFlowRunning;
  const authFlowOwned = props.authFlowOwned;
  const mode = inferAuthFlowMode(props.gatewayUrl);

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

  const prefillApiKey = (provider: string, profileId: string) => {
    props.onApiKeyFormChange({ provider, profileId });
    window.setTimeout(() => {
      scrollToCardWithinContent("credentials-api-key-form");
    }, 0);
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

  const startFlow = (providerId: string, methodId: string) => {
    props.onStartAuthFlow(providerId, methodId, mode);
  };

  const methodCodex = resolveAuthFlowMethod(props.authFlowList, "openai-codex", "oauth");
  const methodAnthropicOAuth = resolveAuthFlowMethod(props.authFlowList, "anthropic", "oauth");
  const methodSetupToken = resolveAuthFlowMethod(props.authFlowList, "anthropic", "setup-token");
  const methodGeminiCli = resolveAuthFlowMethod(props.authFlowList, "google-gemini-cli", "oauth");
  const methodAntigravity = resolveAuthFlowMethod(props.authFlowList, "google-antigravity", "oauth");

  const codexProfiles = providerProfiles("openai-codex");
  const anthropicProfiles = providerProfiles("anthropic");
  const googleProfiles = providerProfiles("google");
  const anthropicApiKeyProfile = anthropicProfiles.find((p) => p.id === "anthropic:default" && p.type === "api_key");
  const googleApiKeyProfile = googleProfiles.find((p) => p.id === "google:default" && p.type === "api_key");

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

      ${!props.connected
        ? html`<div class="callout danger" style="margin-top: 12px;">Disconnected from gateway.</div>`
        : nothing}

      ${props.error
        ? html`<div class="callout danger" style="margin-top: 12px;">${props.error}</div>`
        : nothing}

      ${props.authFlowError
        ? html`<div class="callout danger" style="margin-top: 12px;">${props.authFlowError}</div>`
        : nothing}

      ${props.authFlowApplyError
        ? html`<div class="callout warn" style="margin-top: 12px;">
            Defaults patch failed: ${props.authFlowApplyError}
          </div>`
        : nothing}

      ${props.authFlowResult
        ? html`<div class="callout" style="margin-top: 12px;">
            <div style="min-width: 0;">
              <div>Connected.</div>
              ${props.authFlowResult.defaultModel
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
                : nothing}
              ${props.authFlowResult.profiles?.length
                ? html`<div class="muted" style="margin-top: 6px;">
                    Profiles:
                    ${props.authFlowResult.profiles.map((p) => html`<span class="mono">${p.id}</span>`).reduce((a, b) => html`${a}, ${b}`)}
                  </div>`
                : nothing}
              ${props.authFlowResult.notes?.length
                ? html`<div class="muted" style="margin-top: 6px; white-space: pre-wrap;">${props.authFlowResult.notes.join("\n")}</div>`
                : nothing}

              <div class="row" style="margin-top: 10px; gap: 10px; flex-wrap: wrap;">
                <button class="btn primary" @click=${props.onOpenChat} title="Start using the connected provider">
                  Open chat
                </button>
                <button class="btn" @click=${props.onOpenAgentProfile} title="Configure models and locked credentials per agent">
                  Configure agent profile
                </button>
              </div>
            </div>
          </div>`
        : nothing}

      <div class="card" id="credentials-auth-profiles" style="margin-top: 14px;">
        <div class="card-title">Saved credentials</div>
        <div class="card-sub">
          Masked inventory only. API keys and tokens are write-only.
        </div>

        ${profiles.length === 0
          ? html`
              <div class="callout" style="margin-top: 12px;">
                <div>No credentials found.</div>
                <div class="muted" style="margin-top: 6px;">Get started by connecting your first provider below.</div>
                <div class="row" style="margin-top: 10px; gap: 10px;">
                  <button class="btn primary" ?disabled=${props.authFlowBusy} @click=${scrollToQuickConnect}>
                    Go to Quick Connect
                  </button>
                </div>
              </div>
            `
          : html`<div style="margin-top: 12px;">
              ${profiles.map((p) => renderProfileRow(p, props))}
            </div>`}
      </div>

      <div class="card" id="credentials-quick-connect" style="margin-top: 14px;">
        <div class="card-title">Quick Connect</div>
        <div class="card-sub">Remote-safe flows; secrets are write-only.</div>

        <div class="row" style="margin-top: 12px; gap: 12px; flex-wrap: wrap;">
          <div class="card" style="flex: 1; min-width: 260px;">
            <div class="card-title">OpenAI Codex</div>
            <div class="card-sub">OAuth sign-in (Codex)</div>
            ${codexProfiles.length
              ? html`<div class="muted" style="margin-top: 10px;">
                  Connected · ${codexProfiles.length} profile${codexProfiles.length === 1 ? "" : "s"}
                  ${codexProfiles[0]?.id ? html`· <span class="mono">${codexProfiles[0].id}</span>` : nothing}
                </div>`
              : nothing}
            <div class="row" style="margin-top: 12px; gap: 10px; flex-wrap: wrap;">
              ${methodCodex
                ? html`
                    <button
                      class="btn primary"
                      ?disabled=${!props.connected || props.authFlowBusy}
                      @click=${() => startFlow("openai-codex", "oauth")}
                    >
                      ${codexProfiles.length ? "Connect another" : "Connect"}
                    </button>
                  `
                : nothing}
              ${codexProfiles.length
                ? html`
                    <button class="btn" @click=${scrollToProfiles}>
                      Manage profiles
                    </button>
                  `
                : nothing}
            </div>
            ${!methodCodex ? html`<div class="muted" style="margin-top: 10px;">OAuth not available on this gateway.</div>` : nothing}
          </div>

          <div class="card" style="flex: 1; min-width: 260px;">
            <div class="card-title">Anthropic</div>
            <div class="card-sub">OAuth sign-in (recommended) · setup-token · API key</div>
            ${anthropicProfiles.length
              ? html`<div class="muted" style="margin-top: 10px;">
                  Connected · ${anthropicProfiles.length} profile${anthropicProfiles.length === 1 ? "" : "s"}
                  ${anthropicProfiles[0]?.id ? html`· <span class="mono">${anthropicProfiles[0].id}</span>` : nothing}
                </div>`
              : nothing}
            <div class="row" style="margin-top: 12px; gap: 10px; flex-wrap: wrap;">
              ${methodAnthropicOAuth
                ? html`
                    <button
                      class="btn primary"
                      ?disabled=${!props.connected || props.authFlowBusy}
                      @click=${() => startFlow("anthropic", "oauth")}
                    >
                      ${anthropicProfiles.length ? "Connect another" : "Sign in"}
                    </button>
                  `
                : nothing}
              ${methodSetupToken
                ? html`
                    <button
                      class="btn"
                      ?disabled=${!props.connected || props.authFlowBusy}
                      @click=${() => startFlow("anthropic", "setup-token")}
                    >
                      ${anthropicProfiles.length ? "Add setup-token" : "Use setup-token"}
                    </button>
                  `
                : nothing}
              <button
                class="btn"
                ?disabled=${props.saving}
                @click=${() => prefillApiKey("anthropic", "anthropic:default")}
              >
                ${anthropicApiKeyProfile ? "Update API key" : "Use API key"}
              </button>
              ${anthropicProfiles.length ? html`<button class="btn" @click=${scrollToProfiles}>Manage profiles</button>` : nothing}
            </div>
            ${!methodAnthropicOAuth ? html`<div class="muted" style="margin-top: 10px;">OAuth not available on this gateway.</div>` : nothing}
          </div>

          <div class="card" style="flex: 1; min-width: 260px;">
            <div class="card-title">Google</div>
            <div class="card-sub">Gemini API key or OAuth variants</div>
            <div class="row" style="margin-top: 12px; gap: 10px; flex-wrap: wrap;">
              <button
                class="btn"
                ?disabled=${props.saving}
                @click=${() => prefillApiKey("google", "google:default")}
              >
                ${googleApiKeyProfile ? "Update API key" : "Gemini API key"}
              </button>
              ${methodGeminiCli
                ? html`
                    <button
                      class="btn primary"
                      ?disabled=${!props.connected || props.authFlowBusy}
                      @click=${() => startFlow("google-gemini-cli", "oauth")}
                    >
                      Gemini CLI OAuth
                    </button>
                  `
                : nothing}
              ${methodAntigravity
                ? html`
                    <button
                      class="btn primary"
                      ?disabled=${!props.connected || props.authFlowBusy}
                      @click=${() => startFlow("google-antigravity", "oauth")}
                    >
                      Antigravity OAuth
                    </button>
                  `
                : nothing}
            </div>
            ${!methodGeminiCli && !methodAntigravity
              ? html`<div class="muted" style="margin-top: 10px;">OAuth plugins not available on this gateway.</div>`
              : nothing}
          </div>
        </div>
      </div>

      ${hasAuthFlow && !authFlowOwned
        ? html`<div class="callout warn" style="margin-top: 12px;">
            A connect flow is currently running on another device. Complete or cancel it from the owning Control UI session.
          </div>`
        : nothing}

      ${hasAuthFlow && authFlowOwned && !props.authFlowStep
        ? html`<div class="callout" style="margin-top: 12px;">
            <div class="row" style="justify-content: space-between; gap: 12px;">
              <div>Connect flow running. Resume to continue.</div>
              <div class="row" style="gap: 10px;">
                <button class="btn primary" ?disabled=${props.authFlowBusy} @click=${props.onResumeAuthFlow}>
                  ${props.authFlowBusy ? "Working…" : "Resume"}
                </button>
                <button class="btn danger" ?disabled=${props.authFlowBusy} @click=${props.onCancelAuthFlow}>
                  Cancel
                </button>
              </div>
            </div>
          </div>`
        : nothing}

      ${hasAuthFlow && authFlowOwned && props.authFlowStep ? renderAuthFlowStep(props, props.authFlowStep) : nothing}

      <details class="card" style="margin-top: 14px;">
        <summary style="list-style: none; cursor: pointer;">
          <div class="card-title">Advanced: All providers</div>
          <div class="card-sub">Only needed if your provider isn't in Quick Connect.</div>
        </summary>

        ${props.authFlowLoading
          ? html`<div class="muted" style="margin-top: 12px;">Loading providers…</div>`
          : nothing}

        ${props.authFlowList?.providers?.length
          ? html`<div style="margin-top: 12px;">
              ${props.authFlowList.providers.map((provider) => html`
                <div class="card" style="margin-top: 10px;">
                  <div class="row" style="justify-content: space-between; gap: 12px;">
                    <div style="min-width: 0;">
                      <div class="card-title">${provider.label}</div>
                      <div class="muted">id: <span class="mono">${provider.providerId}</span></div>
                    </div>
                    ${providerProfiles(provider.providerId).length
                      ? html`<span class="chip chip-ok">connected</span>`
                      : nothing}
                  </div>
                  <div style="margin-top: 10px;">
                    ${provider.methods.map((method) => {
                      const isManual = method.kind === "api_key_manual";
                      const connected = providerProfiles(provider.providerId).length > 0;
                      const btnLabel = isManual ? "Use API key" : connected ? "Connect another" : "Connect";
                      const disabled = !props.connected || (isManual ? props.saving : props.authFlowBusy);
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
                                prefillApiKey(provider.providerId, `${normalizeProviderId(provider.providerId)}:default`);
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
                </div>
              `)}
            </div>`
          : props.authFlowError
            ? nothing
            : html`<div class="muted" style="margin-top: 12px;">No providers reported by gateway.</div>`}
      </details>

      <div class="card" id="credentials-api-key-form" style="margin-top: 14px;">
        <div class="card-title">Add / update API key profile</div>
        <div class="card-sub">The API key is never displayed after you submit it.</div>

        <div class="row" style="margin-top: 12px; gap: 12px; align-items: flex-start;">
          <label class="field" style="flex: 1;">
            <span>Credential ID</span>
            <input
              .value=${props.apiKeyForm.profileId}
              @input=${(e: Event) =>
                props.onApiKeyFormChange({ profileId: (e.target as HTMLInputElement).value })}
              placeholder="openai:default"
            />
          </label>
          <label class="field" style="flex: 1;">
            <span>Provider</span>
            <input
              .value=${props.apiKeyForm.provider}
              @input=${(e: Event) =>
                props.onApiKeyFormChange({ provider: (e.target as HTMLInputElement).value })}
              placeholder="openai"
            />
          </label>
        </div>
        <div class="muted" style="margin-top: 6px;">
          Suggestion: <span class="mono">${normalizeProviderId(props.apiKeyForm.provider || "provider")}:default</span>.
          Custom IDs are useful if you want multiple keys/tokens per provider.
        </div>

        <div class="row" style="margin-top: 12px; gap: 12px; align-items: flex-start;">
          <label class="field" style="flex: 1;">
            <span>Email (optional)</span>
            <input
              .value=${props.apiKeyForm.email}
              @input=${(e: Event) =>
                props.onApiKeyFormChange({ email: (e.target as HTMLInputElement).value })}
              placeholder="name@example.com"
              autocomplete="off"
            />
          </label>
          <label class="field" style="flex: 1;">
            <span>API key (write-only)</span>
            <input
              type="password"
              autocomplete="new-password"
              .value=${props.apiKeyForm.apiKey}
              @input=${(e: Event) =>
                props.onApiKeyFormChange({ apiKey: (e.target as HTMLInputElement).value })}
              placeholder="••••••••••••••"
            />
          </label>
        </div>

        <div class="row" style="margin-top: 12px; gap: 10px;">
          <button
            class="btn primary"
            ?disabled=${!props.connected || props.saving}
            @click=${props.onUpsertApiKey}
          >
            ${props.saving ? "Saving…" : "Save profile"}
          </button>
        </div>
      </div>

      <details class="card" style="margin-top: 14px;" ?open=${hasWizard}>
        <summary style="list-style: none; cursor: pointer;">
          <div class="card-title">Full setup wizard (legacy)</div>
          <div class="card-sub">Runs the full onboarding wizard (OAuth + config). Prefer Quick Connect for most setups.</div>
        </summary>

        ${props.wizardError
          ? html`<div class="callout danger" style="margin-top: 12px;">${props.wizardError}</div>`
          : nothing}

        ${hasWizard && !wizardOwned
          ? html`<div class="callout warn" style="margin-top: 12px;">
              A wizard is currently running on another device. Complete or cancel it from the owning Control UI session.
            </div>`
          : nothing}

        ${hasWizard && wizardOwned && !props.wizardStep
          ? html`<div class="callout" style="margin-top: 12px;">
              <div class="row" style="justify-content: space-between; gap: 12px;">
                <div>Wizard running. Resume to continue.</div>
                <button class="btn primary" ?disabled=${props.wizardBusy} @click=${props.onResumeWizard}>
                  ${props.wizardBusy ? "Working…" : "Resume wizard"}
                </button>
              </div>
            </div>`
          : nothing}

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
          ${hasWizard && wizardOwned
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
            : nothing}
        </div>
      </details>
    </section>
  `;
}
