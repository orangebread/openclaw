# OpenClaw Planning Index (Internal)

Date: 2026-02-03

This file is the single entrypoint for internal planning/spec work in this repo.
If a spec/decision is not linked from here, it is not considered active.

## Operating rules (clarity + linear progression)

- One active workstream at a time. Everything else is explicitly parked.
- One spec per feature. Specs are the only place requirements live.
- Decision records are append-only (add dated updates; do not rewrite history).
- `UX_ENHANCEMENTS.md` is an umbrella spec. It does not define new requirements for individual features.
- Code changes should map to a checkbox in the relevant spec’s “Acceptance criteria”.

## Current workstream (NOW)

### Control UI: Provider Credentials + Agent Profile editor

Goal: a dedicated Control UI “Agent Profile” editor that sets per-agent keys and binds credentials via `auth.profiles.*`, matching the Option A strict-lock contract for text + image.

- Decision record: `DECISION_CONTROL_UI_PROVIDER_CREDENTIALS.md`
- Spec: `SPEC_CONTROL_UI_AGENT_PROFILE.md`
- Spec: `SPEC_CONTROL_UI_PROVIDER_CREDENTIALS.md`

## Next

- Limitless inbound channel (wake phrase): `SPEC_LIMITLESS_CHANNEL.md`
- Control UI KB viewer (read-only): `SPEC_CONTROL_UI_KB_VIEWER.md`
- Preview workflow (PR preview + tunnel fallback): `SPEC_PREVIEW_WORKFLOW.md`

## Parked / backlog

If an item is not in “NOW” or “Next”, keep it in `UX_ENHANCEMENTS.md` as backlog notes and link it here only when promoted.
