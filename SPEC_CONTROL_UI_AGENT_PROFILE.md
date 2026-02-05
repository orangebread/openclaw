# Control UI Agent Profile — Spec (Auto vs Locked, Inherit vs Override)

Status: draft (active)
Date: 2026-02-03

Related:
- Decision record: `DECISION_CONTROL_UI_PROVIDER_CREDENTIALS.md`
- Planning index: `PLANNING.md`

## 0) Goal

Provide a dedicated Control UI editor that:

- Sets per-agent model and credential bindings in config.
- Clearly expresses “Auto vs Locked” credentials per capability.
- Clearly expresses “Inherit vs Override” for non-text capabilities (initially: image).
- Matches the Option A strict-lock runtime contract (fail-fast, no transparent fallback on cooldown).

Primary audience: single-operator deployments (one human operator controlling a gateway).

## 1) Scope

### In scope (v1)

- Per-agent text capability:
  - model: inherit vs override
  - credentials: auto vs locked (profile id)
- Per-agent image capability:
  - model: inherit vs override
  - credentials: auto vs locked (profile id)
  - inheritance rule: inherit the text lock only when the image provider matches the text provider
- Safe UI behaviors:
  - write-only secret handling is done via the existing wizard/credentials surfaces (not in this editor)
  - clear validation + user-facing errors for mismatch/cooldown/missing profiles

### Not in scope (v1)

- Creating/editing credential material (API keys/OAuth) directly in the Agent Profile editor
  - this remains in the Credentials domain (wizard + `authProfiles.*`)
- Structured per-capability policy beyond text+image (audio/tools/etc.)
- Multi-user / per-device agent profiles

## 2) Config mapping (source of truth)

Agent Profile editor writes to `agents.list[]` entries.

### 2.1 Text

- Model override:
  - `agents.list[].model` (string or `{ primary, fallbacks }`)
  - Absence means inherit from `agents.defaults.model`
- Credential lock:
  - `agents.list[].authProfileId` (string)
  - Absence means “auto” (use `auth.order` / last-good / session overrides)

### 2.2 Image

- Model override:
  - `agents.list[].imageModel` (string or `{ primary, fallbacks }`)
  - Absence means inherit/infer (see runtime behavior below)
- Credential lock:
  - `agents.list[].imageAuthProfileId` (string)
  - Absence means:
    - inherit the text lock only if the image provider matches the text provider
    - otherwise treat credentials as auto

### 2.3 Important: omit-on-inherit

The UI must not write sentinel values like `"inherit"`.
Absence of the key means inherit.

## 3) Runtime contract (Option A strict/locked)

This spec is aligned to the following runtime semantics:

### 3.1 Text: locked auth profile behavior

When `agents.list[].authProfileId` is set:

- Missing profile id → fail fast.
- Provider mismatch → fail fast.
- Cooldown/disabled → fail fast with user-facing guidance:
  - “unlock/change profile or wait until cooldown expires”
- No auth profile rotation.
- Model fallback is allowed only when the fallback stays on the same provider as the locked profile.
  - If fallback would switch provider: fail outright (no transparent fallback).

### 3.2 Image: locked credential behavior + model override restrictions

When a locked image credential is in effect (either explicit `imageAuthProfileId`, or inherited text lock with provider match):

- Reject `image.model` tool-call overrides that change provider.
- Allow same-provider overrides only if the locked credential still matches and is not in cooldown/disabled.

If image provider differs from the text lock provider and no explicit `imageAuthProfileId` is set:

- Treat image credentials as auto (do not inherit text lock).

## 4) UI state model

### 4.1 Text section

- Model:
  - Inherit (default) → omit `agents.list[].model`
  - Override → set `agents.list[].model`
- Credentials:
  - Auto (default) → omit `agents.list[].authProfileId`
  - Locked → set `agents.list[].authProfileId`

### 4.2 Image section

- Model:
  - Inherit (default) → omit `agents.list[].imageModel`
  - Override → set `agents.list[].imageModel`
- Credentials:
  - Auto (default) → omit `agents.list[].imageAuthProfileId`
  - Locked → set `agents.list[].imageAuthProfileId`
  - Inherited lock visibility:
    - UI should display “Inherited (from text)” only when the current effective image provider matches the locked text provider.
    - Otherwise display “Auto”.

## 5) Validation + error copy

### 5.1 Validation rules (client-side + server-side)

- If Locked credentials selected, profile id must exist in `authProfiles.list` (masked listing).
- Provider mismatch (selected model provider vs locked profile provider) must be blocked at save-time.
- Cooldown/disabled should be surfaced as a blocking state for “Locked” selection (and must still be enforced server-side at run time).

### 5.2 Error messages (must be user-facing)

- Locked profile missing:
  - `Auth profile "<id>" not found. Unlock/change the profile or select a valid profile.`
- Locked profile in cooldown/disabled:
  - `Auth profile "<id>" is currently unavailable (cooldown/disabled). Unlock/change the profile or wait until the cooldown expires.`
- Provider mismatch:
  - `Auth profile "<id>" is for provider "<provider>", not "<expected>".`
- Locked fallback blocked:
  - `Agent is locked to provider "<provider>" via authProfileId; fallback to "<other>" is not allowed (unlock/change the profile or wait for cooldown to expire).`
- Image tool override blocked:
  - `Locked image credentials are in effect for provider "<provider>" (image|inherited). image.model overrides that change provider are not allowed.`

## 6) Backend / protocol surface (Control UI ↔ Gateway)

V1 strategy:
- Reuse wizard + `authProfiles.*` for credential creation.
- Add “Agent Profile editor” UI that:
  - reads config agent list
  - reads masked auth profile inventory + provider per profile
  - writes config updates for agent entries

Required backend capabilities (if not already present):
- List agents and current effective settings for each (config-derived).
- List auth profiles (masked), including:
  - `profileId`
  - `provider`
  - “availability” status (cooldown/disabled + timestamps)

## 7) Acceptance criteria (v1)

- UI can set/unset `agents.list[].authProfileId` and `agents.list[].imageAuthProfileId`.
- UI can set/unset `agents.list[].model` and `agents.list[].imageModel` without writing sentinel “inherit” values.
- UI prevents saving provider mismatches for locked credentials.
- UI clearly surfaces cooldown/disabled as blocking for locked selection and shows the exact user-facing guidance.
- Runtime matches Option A:
  - locked profile cooldown → fail fast
  - locked model fallback stays same provider only
  - locked image creds prevent provider-changing `image.model` overrides

## 8) Implementation plan (phased)

### Phase A: schema + runtime correctness (done)

- Per-agent keys + strict-lock runtime enforcement for text + image.

### Phase B: protocol + UI scaffolding

- Add gateway methods needed to list masked profiles + availability and to update agent settings.
- Add Control UI panel + forms (read-only → editable).

### Phase C: polish

- Better affordances for “Inherited” vs “Auto”.
- Inline status and remediation links (launch wizard to add credentials).

