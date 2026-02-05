import { html, nothing } from "lit";
import { formatMs } from "../format";
import type { AgentProfileEntry, AuthProfileSummary, ModelChoice } from "../types";
import type { AgentProfileFormState } from "../controllers/agent-profile";

const DEFAULT_PROVIDER = "openai";

function normalizeProviderId(provider?: string | null): string {
  if (!provider) return "";
  const normalized = provider.trim().toLowerCase();
  if (normalized === "z.ai" || normalized === "z-ai") return "zai";
  return normalized;
}

function parseModelRef(raw: string, defaultProvider: string): { provider: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const slash = trimmed.indexOf("/");
  if (slash < 0) {
    const provider = normalizeProviderId(defaultProvider);
    return provider ? { provider } : null;
  }
  const provider = normalizeProviderId(trimmed.slice(0, slash));
  return provider ? { provider } : null;
}

export type AgentProfileProps = {
  connected: boolean;
  loading: boolean;
  saving: boolean;
  dirty: boolean;
  error: string | null;
  agents: AgentProfileEntry[];
  selectedAgentId: string | null;
  form: AgentProfileFormState | null;
  authProfiles: AuthProfileSummary[];
  models: ModelChoice[];
  onRefresh: () => void;
  onSelectAgent: (agentId: string) => void;
  onFormChange: (patch: Partial<AgentProfileFormState>) => void;
  onSave: () => void;
  onOpenCredentials: () => void;
  onRunOnboardingWizard: () => void;
};

type Validation = { ok: true } | { ok: false; issues: string[] };

function resolveSelectedAgent(props: AgentProfileProps): AgentProfileEntry | null {
  const id = props.selectedAgentId?.trim();
  if (!id) return null;
  return props.agents.find((a) => a.id === id) ?? null;
}

function resolvePrimaryProvider(raw: string): string | null {
  const parsed = parseModelRef(raw, DEFAULT_PROVIDER);
  return parsed?.provider ?? null;
}

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

function validate(props: AgentProfileProps, selected: AgentProfileEntry | null): Validation {
  const form = props.form;
  const issues: string[] = [];
  if (!form || !selected) {
    return { ok: false, issues: ["Select an agent to edit."] };
  }

  const textProvider =
    form.textModelMode === "inherit"
      ? selected.effectiveTextProvider
      : resolvePrimaryProvider(form.textModelPrimary);
  const imageProvider =
    form.imageModelMode === "inherit"
      ? selected.effectiveImageProvider ?? null
      : resolvePrimaryProvider(form.imageModelPrimary);

  if (form.textModelMode === "override" && !form.textModelPrimary.trim()) {
    issues.push("Text model is required when overriding.");
  }
  if (form.imageModelMode === "override" && !form.imageModelPrimary.trim()) {
    issues.push("Image model is required when overriding.");
  }

  if (form.textCredMode === "locked") {
    const profileId = form.textAuthProfileId.trim();
    if (!profileId) {
      issues.push("Text auth profile is required when locked.");
    } else {
      const profile = props.authProfiles.find((p) => p.id === profileId) ?? null;
      if (!profile) {
        issues.push(
          `Auth profile "${profileId}" not found. Unlock/change the profile or select a valid profile.`,
        );
      } else if (isProfileUnavailable(profile)) {
        issues.push(
          `Auth profile "${profileId}" is currently unavailable (cooldown/disabled). Unlock/change the profile or wait until the cooldown expires.`,
        );
      } else if (textProvider && normalizeProviderId(profile.provider) !== normalizeProviderId(textProvider)) {
        issues.push(
          `Auth profile "${profileId}" is for provider "${normalizeProviderId(profile.provider)}", not "${normalizeProviderId(textProvider)}".`,
        );
      }
    }
  }

  if (form.imageCredMode === "locked") {
    const profileId = form.imageAuthProfileId.trim();
    if (!profileId) {
      issues.push("Image auth profile is required when locked.");
    } else if (!imageProvider) {
      issues.push("Image provider is unknown; set an Image model override or unlock Image credentials.");
    } else {
      const profile = props.authProfiles.find((p) => p.id === profileId) ?? null;
      if (!profile) {
        issues.push(
          `Auth profile "${profileId}" not found. Unlock/change the profile or select a valid profile.`,
        );
      } else if (isProfileUnavailable(profile)) {
        issues.push(
          `Auth profile "${profileId}" is currently unavailable (cooldown/disabled). Unlock/change the profile or wait until the cooldown expires.`,
        );
      } else if (normalizeProviderId(profile.provider) !== normalizeProviderId(imageProvider)) {
        issues.push(
          `Auth profile "${profileId}" is for provider "${normalizeProviderId(profile.provider)}", not "${normalizeProviderId(imageProvider)}".`,
        );
      }
    }
  }

  return issues.length > 0 ? { ok: false, issues } : { ok: true };
}

function renderModelDatalist(models: ModelChoice[]) {
  const keys = models
    .map((m) => `${m.provider}/${m.id}`)
    .filter(Boolean);
  const unique = Array.from(new Set(keys)).slice(0, 600);
  return html`
    <datalist id="agent-profile-models">
      ${unique.map((key) => html`<option value=${key}></option>`)}
    </datalist>
  `;
}

function renderAuthProfileOptions(params: {
  profiles: AuthProfileSummary[];
  expectedProvider: string | null;
  selectedId: string;
}) {
  const expected = params.expectedProvider ? normalizeProviderId(params.expectedProvider) : null;
  const selected = params.selectedId.trim();
  const rows = params.profiles
    .map((p) => ({
      ...p,
      providerNorm: normalizeProviderId(p.provider),
      unavailable: isProfileUnavailable(p),
      statusText: profileStatusText(p),
    }))
    .toSorted((a, b) =>
      a.providerNorm === b.providerNorm ? a.id.localeCompare(b.id) : a.providerNorm.localeCompare(b.providerNorm),
    );

  const visible = expected ? rows.filter((p) => p.providerNorm === expected) : rows;
  const ensureSelected = selected && !visible.some((p) => p.id === selected) ? rows.find((p) => p.id === selected) : null;
  const final = ensureSelected ? [ensureSelected, ...visible] : visible;

  if (final.length === 0) {
    return html`<option value="">(no profiles)</option>`;
  }

  return html`
    <option value="">Select a profile</option>
    ${final.map((p) => {
      const label = `${p.id} (${p.providerNorm}) — ${p.unavailable ? p.statusText : "available"}`;
      return html`<option value=${p.id}>${label}</option>`;
    })}
  `;
}

function resolveInheritedImageStatus(params: {
  form: AgentProfileFormState;
  selected: AgentProfileEntry;
}): { active: boolean; provider: string | null } {
  if (params.form.imageCredMode !== "auto") return { active: false, provider: null };
  if (params.form.textCredMode !== "locked") return { active: false, provider: null };
  const textProvider =
    params.form.textModelMode === "inherit"
      ? params.selected.effectiveTextProvider
      : resolvePrimaryProvider(params.form.textModelPrimary) ?? params.selected.effectiveTextProvider;
  const imageProvider =
    params.form.imageModelMode === "inherit"
      ? params.selected.effectiveImageProvider ?? null
      : resolvePrimaryProvider(params.form.imageModelPrimary);
  if (!imageProvider) return { active: false, provider: null };
  const ok = normalizeProviderId(imageProvider) === normalizeProviderId(textProvider);
  return { active: ok, provider: imageProvider };
}

export function renderAgentProfile(props: AgentProfileProps) {
  const selected = resolveSelectedAgent(props);
  const validation = validate(props, selected);
  const canSave =
    props.connected &&
    !props.loading &&
    !props.saving &&
    props.dirty &&
    validation.ok &&
    Boolean(props.form);

  return html`
    <section class="card">
      <div class="row" style="justify-content: space-between;">
        <div>
          <div class="card-title">Agent Profile</div>
          <div class="card-sub">Set per-agent model overrides and credential locks.</div>
        </div>
        <div class="row">
          <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
            ${props.loading ? "Loading…" : "Refresh"}
          </button>
          <button class="btn primary" ?disabled=${!canSave} @click=${props.onSave}>
            ${props.saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      ${
        !props.connected
          ? html`<div class="callout danger" style="margin-top: 12px;">
              Disconnected from gateway.
            </div>`
          : nothing
      }

      ${
        props.error
          ? html`<div class="callout danger" style="margin-top: 12px;">
              ${props.error}
            </div>`
          : nothing
      }

      ${
        !validation.ok
          ? html`<div class="callout warn" style="margin-top: 12px;">
              <div style="font-weight: 600;">Fix before saving</div>
              <ul style="margin: 8px 0 0 18px;">
                ${validation.issues.map((issue) => html`<li>${issue}</li>`)}
              </ul>
              ${
                validation.issues.some((issue) => issue.toLowerCase().includes("auth profile"))
                  ? html`
                      <div class="row" style="margin-top: 10px; gap: 10px; flex-wrap: wrap;">
                        <button class="btn" @click=${props.onOpenCredentials}>
                          Go to Credentials
                        </button>
                        <button class="btn" @click=${props.onRunOnboardingWizard}>
                          Run onboarding wizard
                        </button>
                      </div>
                    `
                  : nothing
              }
            </div>`
          : nothing
      }

      <div class="filters" style="margin-top: 14px;">
        <label class="field" style="flex: 1;">
          <span>Agent</span>
          <select
            .value=${props.selectedAgentId ?? ""}
            @change=${(e: Event) =>
              props.onSelectAgent((e.target as HTMLSelectElement).value)}
          >
            ${props.agents.map((agent) => {
              const label = agent.name ? `${agent.id} — ${agent.name}` : agent.id;
              return html`<option value=${agent.id}>${label}</option>`;
            })}
          </select>
        </label>
        <div class="muted">${props.agents.length} agents</div>
      </div>

      ${
        !selected || !props.form
          ? html`<div class="muted" style="margin-top: 14px;">Select an agent to edit.</div>`
          : html`
              ${renderModelDatalist(props.models)}
              ${renderEffectiveSummary(selected)}
              ${renderTextSection(props, selected)}
              ${renderImageSection(props, selected)}
            `
      }
    </section>
  `;
}

function renderEffectiveSummary(selected: AgentProfileEntry) {
  return html`
    <div class="card-sub" style="margin-top: 14px;">
      <div class="chip-row">
        <span class="chip">text: ${selected.effectiveTextModel}</span>
        ${
          selected.effectiveImageModel
            ? html`<span class="chip">image: ${selected.effectiveImageModel}</span>`
            : html`<span class="chip chip-warn">image: unavailable</span>`
        }
        <span class="chip">${selected.effectiveImageAuthMode === "inherited" ? "image creds: inherited" : `image creds: ${selected.effectiveImageAuthMode}`}</span>
      </div>
    </div>
  `;
}

function renderTextSection(props: AgentProfileProps, selected: AgentProfileEntry) {
  const form = props.form!;
  const provider =
    form.textModelMode === "inherit"
      ? selected.effectiveTextProvider
      : resolvePrimaryProvider(form.textModelPrimary);
  const expectedProvider = provider ? normalizeProviderId(provider) : null;
  const locked = form.textCredMode === "locked";

  return html`
    <div class="card" style="margin-top: 14px;">
      <div class="card-title">Text</div>

      <div class="row" style="margin-top: 10px; gap: 18px;">
        <label class="row" style="gap: 8px;">
          <input
            type="radio"
            name="text-model-mode"
            .checked=${form.textModelMode === "inherit"}
            @change=${() => props.onFormChange({ textModelMode: "inherit" })}
          />
          <span>Inherit model</span>
        </label>
        <label class="row" style="gap: 8px;">
          <input
            type="radio"
            name="text-model-mode"
            .checked=${form.textModelMode === "override"}
            @change=${() => props.onFormChange({ textModelMode: "override" })}
          />
          <span>Override model</span>
        </label>
        ${
          expectedProvider
            ? html`<span class="chip">provider: ${expectedProvider}</span>`
            : html`<span class="chip chip-warn">provider: unknown</span>`
        }
      </div>

      ${
        form.textModelMode === "override"
          ? html`
              <div class="row" style="margin-top: 10px; gap: 12px; align-items: flex-start;">
                <label class="field" style="flex: 1;">
                  <span>Model (primary)</span>
                  <input
                    list="agent-profile-models"
                    .value=${form.textModelPrimary}
                    @input=${(e: Event) =>
                      props.onFormChange({ textModelPrimary: (e.target as HTMLInputElement).value })}
                    placeholder="openai/gpt-5-mini"
                  />
                </label>
                <label class="field" style="flex: 1;">
                  <span>Fallbacks (one per line)</span>
                  <textarea
                    rows="3"
                    .value=${form.textModelFallbacks}
                    @input=${(e: Event) =>
                      props.onFormChange({ textModelFallbacks: (e.target as HTMLTextAreaElement).value })}
                    placeholder="openai/gpt-5-mini\nopenai/gpt-5"
                  ></textarea>
                </label>
              </div>
            `
          : nothing
      }

      <div class="row" style="margin-top: 12px; gap: 18px;">
        <label class="row" style="gap: 8px;">
          <input
            type="radio"
            name="text-cred-mode"
            .checked=${form.textCredMode === "auto"}
            @change=${() => props.onFormChange({ textCredMode: "auto" })}
          />
          <span>Credentials: Auto</span>
        </label>
        <label class="row" style="gap: 8px;">
          <input
            type="radio"
            name="text-cred-mode"
            .checked=${locked}
            @change=${() => props.onFormChange({ textCredMode: "locked" })}
          />
          <span>Credentials: Locked</span>
        </label>
      </div>

      ${
        locked
          ? html`
              <div class="row" style="margin-top: 10px; gap: 12px; align-items: flex-start;">
                <label class="field" style="flex: 1;">
                  <span>Auth profile</span>
                  <select
                    .value=${form.textAuthProfileId}
                    @change=${(e: Event) =>
                      props.onFormChange({ textAuthProfileId: (e.target as HTMLSelectElement).value })}
                  >
                    ${renderAuthProfileOptions({
                      profiles: props.authProfiles,
                      expectedProvider,
                      selectedId: form.textAuthProfileId,
                    })}
                  </select>
                </label>
                ${
                  form.textAuthProfileId.trim()
                    ? renderProfileMeta(props.authProfiles, form.textAuthProfileId)
                    : html`<div class="muted" style="padding-top: 28px;">Select a profile.</div>`
                }
              </div>
            `
          : nothing
      }
    </div>
  `;
}

function renderImageSection(props: AgentProfileProps, selected: AgentProfileEntry) {
  const form = props.form!;
  const provider =
    form.imageModelMode === "inherit"
      ? selected.effectiveImageProvider ?? null
      : resolvePrimaryProvider(form.imageModelPrimary);
  const expectedProvider = provider ? normalizeProviderId(provider) : null;
  const locked = form.imageCredMode === "locked";
  const inherited = resolveInheritedImageStatus({ form, selected });

  return html`
    <div class="card" style="margin-top: 14px;">
      <div class="card-title">Image</div>

      <div class="row" style="margin-top: 10px; gap: 18px;">
        <label class="row" style="gap: 8px;">
          <input
            type="radio"
            name="image-model-mode"
            .checked=${form.imageModelMode === "inherit"}
            @change=${() => props.onFormChange({ imageModelMode: "inherit" })}
          />
          <span>Inherit model</span>
        </label>
        <label class="row" style="gap: 8px;">
          <input
            type="radio"
            name="image-model-mode"
            .checked=${form.imageModelMode === "override"}
            @change=${() => props.onFormChange({ imageModelMode: "override" })}
          />
          <span>Override model</span>
        </label>
        ${
          expectedProvider
            ? html`<span class="chip">provider: ${expectedProvider}</span>`
            : html`<span class="chip chip-warn">provider: unknown</span>`
        }
      </div>

      ${
        form.imageModelMode === "override"
          ? html`
              <div class="row" style="margin-top: 10px; gap: 12px; align-items: flex-start;">
                <label class="field" style="flex: 1;">
                  <span>Model (primary)</span>
                  <input
                    list="agent-profile-models"
                    .value=${form.imageModelPrimary}
                    @input=${(e: Event) =>
                      props.onFormChange({ imageModelPrimary: (e.target as HTMLInputElement).value })}
                    placeholder="openai/gpt-5-mini"
                  />
                </label>
                <label class="field" style="flex: 1;">
                  <span>Fallbacks (one per line)</span>
                  <textarea
                    rows="3"
                    .value=${form.imageModelFallbacks}
                    @input=${(e: Event) =>
                      props.onFormChange({ imageModelFallbacks: (e.target as HTMLTextAreaElement).value })}
                    placeholder="openai/gpt-5-mini\nopenai/gpt-5"
                  ></textarea>
                </label>
              </div>
            `
          : nothing
      }

      <div class="row" style="margin-top: 12px; gap: 18px; align-items: center;">
        <label class="row" style="gap: 8px;">
          <input
            type="radio"
            name="image-cred-mode"
            .checked=${form.imageCredMode === "auto"}
            @change=${() => props.onFormChange({ imageCredMode: "auto" })}
          />
          <span>Credentials: Auto</span>
        </label>
        <label class="row" style="gap: 8px;">
          <input
            type="radio"
            name="image-cred-mode"
            .checked=${locked}
            @change=${() => props.onFormChange({ imageCredMode: "locked" })}
          />
          <span>Credentials: Locked</span>
        </label>
        ${
          !locked && inherited.active
            ? html`<span class="chip chip-ok">Inherited (from text)</span>`
            : nothing
        }
      </div>

      ${
        !locked && inherited.active && inherited.provider
          ? html`<div class="muted" style="margin-top: 8px;">
              Image credentials are Auto, but currently inherited from locked Text credentials
              (provider: <span class="mono">${normalizeProviderId(inherited.provider)}</span>).
            </div>`
          : nothing
      }

      ${
        locked
          ? html`
              <div class="row" style="margin-top: 10px; gap: 12px; align-items: flex-start;">
                <label class="field" style="flex: 1;">
                  <span>Auth profile</span>
                  <select
                    .value=${form.imageAuthProfileId}
                    @change=${(e: Event) =>
                      props.onFormChange({ imageAuthProfileId: (e.target as HTMLSelectElement).value })}
                  >
                    ${renderAuthProfileOptions({
                      profiles: props.authProfiles,
                      expectedProvider,
                      selectedId: form.imageAuthProfileId,
                    })}
                  </select>
                </label>
                ${
                  form.imageAuthProfileId.trim()
                    ? renderProfileMeta(props.authProfiles, form.imageAuthProfileId)
                    : html`<div class="muted" style="padding-top: 28px;">Select a profile.</div>`
                }
              </div>
            `
          : nothing
      }
    </div>
  `;
}

function renderProfileMeta(profiles: AuthProfileSummary[], id: string) {
  const profile = profiles.find((p) => p.id === id) ?? null;
  if (!profile) {
    return html`<div class="muted" style="padding-top: 28px;">Unknown profile.</div>`;
  }
  const unavailable = isProfileUnavailable(profile);
  const status = profileStatusText(profile);
  return html`
    <div class="muted" style="padding-top: 28px;">
      <div class="chip-row">
        <span class="chip">${normalizeProviderId(profile.provider)}</span>
        <span class="chip ${unavailable ? "chip-warn" : "chip-ok"}">${status}</span>
      </div>
    </div>
  `;
}
