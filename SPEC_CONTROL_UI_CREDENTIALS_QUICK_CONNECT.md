# Control UI Credentials — Quick Connect + Advanced Providers (Spec)

Status: draft (active)
Date: 2026-02-04

Related:
- `SPEC_CONTROL_UI_PROVIDER_CREDENTIALS.md` (current Credentials tab behavior)
- `DECISION_CONTROL_UI_PROVIDER_CREDENTIALS.md` (domain separation + storage goals)
- `SPEC_CONTROL_UI_AGENT_PROFILE.md` (agent model/profile binding)

## 0) Goal

Improve the Control UI Credentials experience by adding:

1) **Quick Connect** flows for popular providers (OpenAI Codex OAuth, Anthropic, Google variants)
2) An **Advanced: All providers** list that exposes every available auth method without duplicating UI surfaces
3) **Safe default configuration patching** after successful connect
4) **Disconnect/Revoke** actions with clear semantics and safe UX

Key constraints:
- Support **remote gateways** (cloud/VPS) where localhost callbacks cannot complete automatically.
- Keep secrets **write-only** in UI; never render raw token material after submit.
- Preserve **idempotency + concurrency safety** via existing optimistic concurrency primitives (`baseHash`).
- Respect domain separation:
  - Credentials live in **auth profiles** (masked inventory + write-only mutations).
  - Config references profiles via `auth.profiles[...]` and selects models via agent defaults/profiles.

## 1) Non-goals

- Replacing the existing onboarding wizard implementation or removing wizard support entirely.
- Provider-specific polish beyond core flows (icons, deep docs links, provider cards artwork).
- Guaranteeing “revoke at provider” for every provider (only where supported).
- Adding new provider integrations (this spec focuses on UX + protocol around existing provider implementations).

## 2) Storage + references (source of truth)

### 2.1 Auth profiles (credentials)

- Credential material (API keys, tokens, OAuth creds) is stored in `auth-profiles.json`.
- The UI inventory renders **masked summaries only** from `auth.profiles.get`.
- Mutations use `auth.profiles.*` with `baseHash` concurrency.

Rationale:
- Avoid secrets in `openclaw.json`, which is routinely viewed/edited/exported.
- Support multiple profiles per provider and future ordering/rotation semantics.

### 2.2 Config (references + defaults)

Config stores references and defaults:
- `auth.profiles[profileId] = { provider, mode, email? }` (reference + mode)
- `agents.defaults.model` (and optionally image defaults)
- Optional: agent profile defaults if the product chooses to set them immediately

Config writes must use config concurrency semantics (`config.patch` with `baseHash`).

## 3) UI Overview

The Credentials tab is composed of four sections:

1) **Auth profiles** (existing masked inventory)
2) **Quick Connect** (new curated provider cards)
3) **Advanced: All providers** (new discoverability list)
4) **Manual: Add/update API key profile** (existing form; remains the only API-key entry UI)

The existing “Run onboarding wizard” action remains available but is not the default path.

## 4) Quick Connect (curated)

Quick Connect is optimized for “get to working defaults” in ≤ 1–2 minutes.

### 4.1 Curated providers in v1

- **OpenAI Codex OAuth** (`openai-codex`)
  - Remote-safe: open URL in local browser; paste redirect URL back if callback cannot complete.
- **Anthropic**
  - Option A: API key (routes to Manual form, prefilled).
  - Option B: setup-token (guided token paste flow; see 6.3).
- **Google**
  - Gemini API key (routes to Manual form, prefilled).
  - Gemini CLI OAuth (guided OAuth flow; see 6.2).
  - Antigravity OAuth (guided OAuth flow; see 6.2).

Each card has:
- Primary CTA: “Connect”
- Secondary CTA (if applicable): “Use API key instead” (routes to manual form)
- Optional: “What is this?” help (short inline note; no long docs content required in v1)

### 4.2 Success behavior (safe defaults)

On successful connect:
- Persist/refresh auth profile inventory
- Apply a safe config patch:
  - Ensure `auth.profiles[profileId]` references the created profile and mode
  - Set `agents.defaults.model` to the provider’s recommended default
  - If the provider supports images and a default is known, optionally set `agents.defaults.imageModel`
- Show a success callout including:
  - Provider name
  - Created profile id (masked inventory already shows it)
  - Which defaults were set (“Default model set to …”)
  - A “View Agent Profile” link (optional v1)

## 5) Advanced: All providers

The All providers list is a discoverability surface and must not duplicate credential entry UIs.

### 5.1 What appears in the list

The list includes:
- All plugin-registered provider auth methods (OAuth/custom/token), grouped by provider.
- Built-in “manual” options that route to existing UI:
  - “Use API key” routes to the Manual API key form with prefilled provider/profile id.
  - “Paste token / setup-token” routes to a dedicated guided token flow (no wizard UX).

### 5.2 Action behavior

Each list entry triggers exactly one of:

1) **Start guided flow** (OAuth/device-code/paste-token)
2) **Route to manual API key form** (prefill + scroll/focus)

The list entry must clearly state which it is (e.g., “OAuth (opens browser)”, “API key (manual)”, “Token (paste)”).

## 6) Auth flow UX primitives (remote-safe)

### 6.1 UX step types

Guided flows in the Control UI are expressed as a small set of step types:
- `note`: informational copy, with Continue/Cancel
- `action.openUrl`: show a URL with “Open” and “Copy” affordances
- `text.sensitive`: token/secret input (write-only)
- `text.url`: “paste redirect URL” input (treated as sensitive; do not log/store the raw URL)
- `progress`: shows “Working…” and disables duplicate submissions
- `done`: success summary + next actions (apply defaults, view profiles)

### 6.2 OAuth flows (OpenAI Codex, Google Gemini CLI, Google Antigravity)

Remote-first UX:
- Step 1: note explaining what will happen, including remote caveat (“Open this URL locally; you may need to paste the redirect URL.”)
- Step 2: action.openUrl with the provider auth URL
- Step 3: either:
  - Auto-complete callback (local-only case), OR
  - text.url prompt to paste redirect URL (remote-safe fallback)
- Step 4: progress while exchanging tokens
- Step 5: done

Implementation note:
- The gateway performs token exchange and stores the result as an auth profile.
- The UI never receives raw token material; only masked summaries and metadata.

### 6.3 Anthropic setup-token flow (token paste)

Flow:
- Step 1: note: “Run `claude setup-token` in your terminal, then paste the result”
- Step 2: text.sensitive token paste
- Step 3: optional “Token name” (default to `default`)
- Step 4: progress (store)
- Step 5: done

### 6.4 Manual API key flow

Manual API key entry remains a single UI surface:
- The All providers list and Quick Connect cards may prefill and route to it.
- The UI must not create second API-key forms elsewhere.

## 7) Disconnect and Revoke

### 7.1 Disconnect (recommended default)

Disconnect means:
- Delete local credential material (auth profile), using `auth.profiles.delete`.
- Also clean up derived state (usage stats, last-good, order) as appropriate.
- For “imported” profiles (synced from external CLIs), disconnect must also disable re-import (persisted user intent).

UI rules:
- If the profile is referenced by current defaults or an agent profile:
  - Warn and show impact summary
  - Provide a remediation link (“Choose another profile/model”)
  - Still allow disconnect (explicit confirmation)

### 7.2 Revoke at provider (advanced)

Revoke is optional and provider-specific:
- Only show if the gateway can perform revocation reliably for that provider/method.
- Copy must be explicit: revocation can impact other apps using the token.
- Revocation failure must not prevent local disconnect.

## 8) Protocol surface (Gateway RPC)

This spec introduces a dedicated session-based API for auth flows.

### 8.1 List auth methods

`auth.flow.list` → returns:
- curated list for Quick Connect
- full provider/method list for Advanced
- per-method flags:
  - `supportsRemote` (true if paste-url/device-code is supported)
  - `supportsRevoke` (true if provider revocation is implemented)
  - `kind`: `oauth` | `api_key_manual` | `token_paste` | `custom`

### 8.2 Start / advance / cancel

`auth.flow.start`:
- params: `{ providerId, methodId, mode: "local" | "remote" }`
- result: `{ sessionId, step }`

`auth.flow.next`:
- params: `{ sessionId, answer? }`
- result: `{ done, step?, status?, error?, result? }`

`auth.flow.current`:
- indicates whether a flow is running and whether it is owned by the requesting Control UI session

`auth.flow.cancelCurrent`:
- cancels the running flow if owned

### 8.3 Completion payload

On completion, the gateway returns:
- `profiles`: list of created/updated auth profiles (ids + provider + type + masked preview metadata only)
- `configPatch`: a safe config patch (object) suitable for `config.patch`
- `defaultModel`: recommended default model (string)
- `notes`: optional safe notes for the user

## 9) Acceptance criteria (v1)

- Credentials tab shows Quick Connect cards for:
  - OpenAI Codex OAuth
  - Anthropic (API key route + setup-token)
  - Google Gemini API key route + Gemini CLI OAuth + Antigravity OAuth
- Credentials tab has Advanced: All providers list that:
  - contains curated + full provider/methods
  - routes API-key providers to the existing manual form (prefilled)
  - starts guided flows for OAuth/token paste without exposing the onboarding wizard UX
- Successful connect:
  - creates an auth profile
  - refreshes inventory
  - applies safe config defaults (model + auth profile reference) via config baseHash
- Disconnect removes credentials locally and does not allow imported profiles to reappear unless explicitly re-enabled.
- Remote gateways are supported for OAuth flows via paste-url or equivalent remote-safe fallback.

