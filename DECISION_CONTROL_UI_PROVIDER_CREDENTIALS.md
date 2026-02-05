# Decision Record: Control UI Provider Credentials + Agent Model Selection

Date: 2026-02-01

## Context

Control UI currently authenticates to the gateway using the gateway token/password plus device identity (secure-context) rules, but does **not** provide a “manage model API keys” experience.

The CLI already has robust onboarding logic for providers (API keys + OAuth) and model defaults, implemented as a reusable onboarding wizard. The gateway can run this same wizard via `wizard.*` RPC methods.

We want a robust, maintainable UI/UX that supports:

- Post-onboarding: add providers/credentials as needed.
- Multiple credential profiles per provider.
- Per-agent selection of provider + model + credential profile (“agent profiles/presets”).
- OAuth support (not just API keys).
- Safe handling of secrets (write-only; masked preview in UI).
- Idempotency, concurrency safety, and crash-safe persistence.

## Decisions

### 1) Reuse onboarding via `wizard.*` (UI drives the existing wizard)

- Control UI should drive onboarding through gateway RPCs (`wizard.start/next/status/cancel`) rather than re-implementing provider onboarding flows in the UI.
- Control UI needs reliability primitives:
  - Deterministic resume/cancel even if the browser loses the `sessionId`.
  - First-class “secret input” prompt rendering in the wizard protocol (no UI heuristics).

### 2) Treat credentials and per-agent model selection as separate domains

We explicitly separate:

- **Credentials domain** (“auth profiles”): credential material + provider-level metadata (ordering, last-good, usage/cooldown, expiry).
- **Agent model/provider binding domain** (“agent profiles/presets”): named presets that reference `{ provider, modelRef, authProfileId }` and can be applied to an agent.

This prevents conflating “keys” with “agent config”, and supports multiple agents (research vs orchestration) without abusing provider-global ordering.

### 3) Centralize auth store mutation behind one locked + atomic path

The auth store is currently mutated in multiple places with inconsistent concurrency/durability characteristics. To make Control UI safe:

- All auth store writes must go through a single mutation API:
  - lock (`proper-lockfile`)
  - atomic write (temp + rename; avoid direct writes)
  - structured errors (no silent `null` result)
  - optional optimistic concurrency (`revision`) for multi-tab safety

This includes “sync on load” and legacy migration/inheritance write paths: they must either be locked+atomic too, or no longer write implicitly during reads.

### 4) OAuth is in-scope and must be first-class

OAuth support requires explicit UX and protocol support:

- device-code or redirect flows
- expiry/refresh behavior
- safe-at-rest storage
- status reporting and remediation (“re-auth required”) without exposing token material

### 5) Use gateway model catalog as the UI source of truth

Control UI should source models from the gateway catalog (`models.list`) and provide:

- provider filtering/search in UI
- “custom model” override when enumeration is incomplete or fails

## Phase 1 (design intent)

Phase 1 should deliver backend protocol primitives and storage hardening that unblock a reliable UI implementation:

- Wizard reliability: `wizard.current` (+ cancel-current) and `sensitive` prompt support.
- Credentials RPC: `authProfiles.*` for masked listing and write-only mutations, with idempotency and optimistic concurrency.
- Agent binding primitives: “agent profile/preset” CRUD and apply-to-agent, referencing `authProfileId` explicitly (not via global provider order).
- Auth store: one locked+atomic mutation path and removal/refactor of unlocked writers.

## Non-goals (explicitly deferred)

- Full UI implementation (screens, navigation, forms) beyond minimal scaffolding.
- Provider-specific OAuth UX polish (e.g., per-provider icons, deep docs links).
- Provider model enumeration that requires credentials for every provider (UI must support custom model strings regardless).

## Open Questions

- Wizard session ownership model for `wizard.current`: per-device vs per-connection vs per-operator.
- Where to persist “agent profile/preset” data (config vs separate store) and its revisioning.
- Whether per-agent `authProfileId` should be added to `AgentConfig` explicitly vs stored elsewhere and injected at run time.

## Updates

### 2026-02-03

- Added per-agent capability keys to config to support “Agent Profile” editing:
  - `agents.list[].authProfileId`
  - `agents.list[].imageModel`
  - `agents.list[].imageAuthProfileId`
- Codified Option A strict-lock runtime behavior:
  - locked text profile fails fast on missing/mismatch/cooldown (no rotation)
  - model fallback restricted to the same provider when locked
  - image tool inherits text lock only when provider matches, and blocks provider-changing `image.model` overrides when locked credentials are in effect
- Created `SPEC_CONTROL_UI_AGENT_PROFILE.md` as the v1 implementation spec for the Control UI Agent Profile editor.

## Key Code References

- Wizard runner: `src/wizard/onboarding.ts`
- Gateway wizard RPC: `src/gateway/server-methods/wizard.ts`
- Wizard session protocol types: `src/wizard/session.ts`, `src/wizard/prompts.ts`
- Auth profiles storage: `src/agents/auth-profiles/*`
- Gateway auth/scopes: `src/gateway/server-methods.ts`, `ui/src/ui/gateway.ts`
