# Control UI Provider Credentials — Spec (Auth Profiles + Wizard)

Status: draft (active)
Date: 2026-02-03

Related:
- Decision record: `DECISION_CONTROL_UI_PROVIDER_CREDENTIALS.md`
- Planning index: `PLANNING.md`
- Agent Profile editor: `SPEC_CONTROL_UI_AGENT_PROFILE.md` (Phase C remediation)

## 0) Goal

Provide a dedicated Control UI surface to manage provider credentials safely:

- Show a **masked inventory** of existing credential profiles (“auth profiles”).
- Allow **API-key profile** add/update and delete with optimistic concurrency (`baseHash`).
- Drive OAuth and other complex onboarding flows via the existing gateway **wizard** (`wizard.*`).
- Be resilient to refreshes/crashes: deterministic resume/cancel via `wizard.current` and `wizard.cancelCurrent`.

Primary audience: single-operator deployments (one human operator controlling one gateway).

## 1) Scope

### In scope (v1)

- “Credentials” tab under the Control group.
- Masked `auth.profiles.get` list rendering (provider + profile id + availability).
- API-key profile upsert (`auth.profiles.upsertApiKey`):
  - write-only API key input (password input)
  - optional email metadata
  - clears secrets from UI state after submit
- Profile delete (`auth.profiles.delete`) with confirmation.
- Wizard-driven onboarding (`wizard.*`):
  - start (`wizard.start`)
  - step rendering + answering (`wizard.next`)
  - deterministic resume (`wizard.current` + `wizard.next` without an answer)
  - cancel current (`wizard.cancelCurrent`)
  - status/ownership UX (owned vs not-owned)
- Crash / multi-tab safety:
  - auth profile mutations require `baseHash` when the store exists
  - wizard resume/cancel must not depend on local `sessionId` persistence

### Not in scope (v1)

- Editing OAuth token material directly in the UI (always wizard-driven; secrets remain write-only).
- Provider-specific UX polish (icons, per-provider docs links).
- Credential rotation rules (these remain runtime behavior and are surfaced elsewhere).

## 2) Gateway protocol surface (UI ↔ Gateway)

### 2.1 Auth profiles (masked inventory + write-only mutations)

- `auth.profiles.get` → list masked profiles + availability + `baseHash`
- `auth.profiles.upsertApiKey` → upsert a profile’s API key (write-only) with optimistic concurrency
- `auth.profiles.delete` → delete a profile with optimistic concurrency

UI must treat:
- `preview` as **masked only** (safe to render).
- keys/tokens as **write-only** (never fetch, never render, never log).

### 2.2 Wizard (reuse onboarding)

- `wizard.start` starts the existing onboarding wizard.
- `wizard.current` enables deterministic “is anything running?” detection and sessionId recovery:
  - if running + owned → includes `sessionId`
  - if running but not owned → sessionId is not revealed
- `wizard.next` advances the wizard or returns the current step (when called without `answer`).
- `wizard.cancelCurrent` cancels the running wizard if owned.

## 3) UI — Credentials tab

### 3.1 Placement + naming

- Navigation: Control group → “Credentials” tab.
- Page title: “Provider Credentials”.

### 3.2 Masked inventory

Show a list of `auth.profiles.get.profiles[]` entries:

- profile id (`id`)
- provider (`provider`)
- type (`type`)
- masked preview (`preview`, when present)
- availability (derived from `cooldownUntil` / `disabledUntil` + timestamps)
- optional metadata (email, expires)

Availability display rules:

- If `disabledUntil` is in the future: “disabled until …”
- Else if `cooldownUntil` is in the future: “cooldown until …”
- Else: “available”

### 3.3 API key profile upsert

Provide a small “Add / update API key profile” form:

- `profileId` (text)
- `provider` (text; normalized by gateway)
- `email` (optional text)
- `apiKey` (password input; write-only)

Rules:

- Never display submitted API keys in UI after submit.
- Clear the `apiKey` input immediately after submit (success or failure).
- Use `baseHash` when the auth store exists.
- After success: refresh the inventory (`auth.profiles.get`).

### 3.4 Profile delete

- Delete is explicit and requires user confirmation.
- Uses optimistic concurrency (`baseHash`) when the auth store exists.
- After success: refresh the inventory (`auth.profiles.get`).

### 3.5 Wizard-driven onboarding (OAuth + complex flows)

Provide a “Run onboarding wizard” flow.

#### Resume / cancel semantics

- On entering the tab (and on Refresh), call `wizard.current`.
- If `wizard.current.running=false`: show “No wizard running.”
- If `running=true` and `owned=true`:
  - show “Resume wizard” (fetch the current step via `wizard.next` without an answer)
  - show “Cancel wizard” (`wizard.cancelCurrent`)
- If `running=true` and `owned=false`:
  - show a non-blocking warning: wizard is running on another device; it must be completed/cancelled from the owner
  - do not show `sessionId`

#### Prompt rendering requirements (v1)

Render wizard steps with first-class sensitive prompt support:

- `note`: show title/message + “Continue”
- `select`: show select list + “Continue”
- `multiselect`: show multi-select UI + “Continue”
- `text`: show input + “Continue”
  - if `sensitive=true`: password input
- `confirm`: show checkbox/toggle + “Continue”
- unknown step types: show a safe fallback message and “Cancel wizard”

Secrets:
- Never log prompt answers.
- Sensitive text values must not be echoed back in UI after submit.

## 4) Agent Profile remediation (Phase C)

When Agent Profile validation blocks saving due to credential issues (missing/mismatch/unavailable), the UI must provide actionable remediation:

- “Go to Credentials” (navigates to the Credentials tab).
- Optional: “Run onboarding wizard” shortcut (navigates + starts wizard).

This is an affordance only: it does not change Agent Profile semantics or validation rules.

## 5) Error copy (user-facing; reuse gateway wording when possible)

### 5.1 Auth profiles concurrency / mutation failures

Use gateway error messages verbatim where applicable:

- `auth base hash required; re-run auth.profiles.get and retry`
- `auth store changed since last load; re-run auth.profiles.get and retry`

UI should also offer a “Refresh” action on these errors.

### 5.2 Wizard errors

Use gateway error messages verbatim where applicable:

- `wizard already running`
- `wizard not found`
- `wizard not owned by client`

## 6) Acceptance criteria (v1)

- Control UI has a “Credentials” tab under Control.
- Credentials tab renders a masked auth profile inventory with availability status.
- Credentials tab can upsert an API-key profile and delete a profile using `baseHash` semantics.
- Credentials tab can start, resume, and cancel the onboarding wizard via `wizard.*`.
- Wizard steps render sensitive prompts as password inputs and never echo secrets.
- Agent Profile view includes remediation affordances that navigate to Credentials (and optionally start the wizard).

