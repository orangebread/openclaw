# OpenClaw Unified Assistant — Umbrella UX Spec

Status: draft (approved direction)
Audience: OpenClaw contributors / AI agents building features

This is an umbrella spec. For active ordering and “what’s next”, see `PLANNING.md`.

## 0) Executive summary

We are building a single-user, multi-channel personal assistant UX:

- You can message the assistant from **WhatsApp** or **Discord** and get one continuous conversation.
- You can speak into **Limitless** using a wake phrase (`"hey butch"`) and have OpenClaw react quickly and reply to your **last active chat surface** (fallback: Discord).
- “Last active chat surface” means the last *deliverable* route (do not treat internal `webchat` as a valid destination for automation-triggered replies).
- OpenClaw runs remotely (Linux VPS) with safe remote access (Tailscale Serve preferred).
- An **orchestrator agent** receives all inbound messages and delegates to specialist agents (`coding`, `research`, `librarian`) while enforcing confirmations for risky actions.
- A git-backed Knowledge Base (private GitHub repo) is the source of truth for notes/links/review items.

This document defines scope, phases, and implementation boundaries. Detailed specs are split into:

- `SPEC_LIMITLESS_CHANNEL.md`
- `SPEC_CONTROL_UI_KB_VIEWER.md`
- `SPEC_PREVIEW_WORKFLOW.md`
- `SPEC_CONTROL_UI_AGENT_PROFILE.md` (Control UI: agent model + credential bindings)

## 1) Goals

### 1.1 Unified chat experience
- Single-user only.
- A single DM session across WhatsApp + Discord.
- Default reply routing for automation-triggered work is **last active channel**.

### 1.2 Limitless “wake phrase” reactive UX
- You speak → Limitless produces STT text.
- If STT contains wake phrase `"hey butch"` (case-insensitive), OpenClaw treats the remainder as an instruction.
- OpenClaw responds quickly and delivers the response to:
  - primary: last active surface (`channel: "last"`)
  - fallback: Discord

### 1.3 Multi-agent responsibilities (orchestrator + specialists)
- Orchestrator agent id: `orchestrator`.
- Orchestrator receives inbound across all channels and delegates to specialists.
- Specialists have explicit responsibilities and tool constraints.

### 1.4 Safety
- “Risky” actions require explicit confirmation (human ack) and technical guardrails (approvals/allowlists).

### 1.5 Manual review UX
- Provide a clean workflow for reviewing notes/links/research outputs:
  - Minimum viable: PR-based review in GitHub.
  - Enhancement: a read-only Knowledge Base viewer in Control UI.

## 2) Non-goals

- “Limitless as bidirectional chat”: Unless Limitless provides a supported send-message or webhook/event mechanism, Limitless is treated as an **inbound trigger source** only. Replies go to a real chat surface (Discord/WhatsApp/WebChat).
- Build a full in-browser editor/IDE inside Control UI (read-only first).
- Replace OpenClaw’s existing channel routing model; we reuse existing last-route/session mechanisms.

## 3) Baseline runtime design (no new code)

This system can be bootstrapped without any OpenClaw core changes:

- Configure `session.dmScope = "main"` for a single DM session across channels.
- Use `hooks` + an external Limitless poller to POST to `/hooks/agent` with:
  - `deliver: true`
  - `channel: "last"`
  - `wakeMode: "now"`
  - `to`: omitted (last-route), fallback configured in mapping/poller

This “Phase 0” is supported by current capabilities.

Recommended for predictable single-user behavior:
- Set `agents.defaults.maxConcurrent=1` so “queue by default” semantics match user expectations and reduce approval interleaving.

## 4) Enhancements to implement

### 4.1 Limitless inbound-only channel plugin (recommended enhancement)
Implement `extensions/limitless` as a first-class channel extension:

- Runs as a long-lived monitor under the Gateway (`ChannelPlugin.gateway.startAccount()`).
- Polls Limitless for new STT entries (lifelogs/chats).
- Detects wake phrase and dispatches an agent run.
- Delivers output to last-route (fallback: Discord).

See `SPEC_LIMITLESS_CHANNEL.md`.

### 4.2 Control UI Knowledge Base viewer (recommended UX enhancement)
Add a read-only viewer for a small allowlist of directories:

- `notes/`
- `links/`
- `review/`

Backed by new Gateway WS methods and a small Control UI panel.

See `SPEC_CONTROL_UI_KB_VIEWER.md`.

### 4.3 Preview workflow skill(s)
Standardize “preview link” behavior for coding runs:

1) Preferred: PR-based preview deployments
2) Fallback: tunnel-based preview behind approvals

See `SPEC_PREVIEW_WORKFLOW.md`.

## 5) Agent roles (behavioral contract)

### 5.1 Orchestrator (`orchestrator`)
Responsibilities:
- Intake + clarification + scoping.
- Delegation to specialists.
- Risk gating: must ask for explicit confirmation when required.
- Final reporting to the user (reply to originating/last route).

### 5.2 Specialists
Recommended specialists:
- `coding`: repo work, PRs, previews.
- `research`: research synthesis, structured outputs.
- `librarian`: knowledge base writes, review queue maintenance.

Delegation mechanism:
- Use sub-agents (`sessions_spawn`) or separate agent runs, but always preserve:
  - clear provenance (which agent did what)
  - human confirmation for risky actions

## 6) Routing defaults

Single-user mode:
- `session.dmScope = "main"`
- Inbound from WhatsApp/Discord feeds `agent:orchestrator:main`

Automation-triggered delivery:
- Primary: last-route (“last active channel”)
- Fallback: Discord

## 7) Phased rollout plan

### Phase 0 (fast start)
- External Limitless poller + OpenClaw hooks.
- GitHub knowledge base + PR review.

### Phase 1 (productize)
- `extensions/limitless` inbound-only channel plugin.

### Phase 2 (UX)
- Control UI KB viewer (read-only).
- Preview workflow skill(s).

## 8) Acceptance criteria (high-level)

- Saying “hey butch …” into Limitless triggers the orchestrator within one polling interval and returns a response to last-route (fallback Discord).
- Orchestrator can delegate to `coding` and `research` agents and report back deterministically.
- Risky actions always require explicit confirmation + approvals enforcement for host exec/deploy.
- Knowledge base review is possible without SSHing into the server (GitHub PRs minimum; Control UI viewer optional).
