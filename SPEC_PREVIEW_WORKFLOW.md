# Preview Workflow — Spec (PR preview + tunnel fallback)

Status: draft  
Goal: when the coding agent completes work, it can reliably produce a preview link when applicable.

## 0) Principles

- Prefer stable preview links produced by CI/CD (PR previews) over ephemeral tunnels.
- Any action that exposes a public URL, deploys code, or runs host commands must be gated by approvals.
- The user must be able to say “don’t deploy” and still get a PR.
- Clarification: “don’t deploy” can reliably mean “no tunnel / no manual deploy step.” It may _not_ prevent CI systems from auto-creating PR previews unless the repo’s CI explicitly supports that.

## 1) Primary path: PR-based preview deployments

### 1.1 Expected workflow

1. Coding agent creates a branch and commits changes.
2. Opens a PR via `gh`.
3. CI runs and posts a preview URL (Vercel/Netlify/Fly/etc).
4. Agent reports back:
   - PR URL
   - Preview URL (if detected)

### 1.2 Implementation requirements

- Skill support:
  - Use existing `skills/github` (`gh`) for PR creation and CI status checks.
- Preview URL extraction:
  - If provider posts a comment/check with a URL, detect it via `gh pr view --json ...` or `gh pr checks`.
  - Store the discovered URL in a stable file under workspace (optional): `preview/last.json`.
- “Don’t deploy” behavior:
  - If the user says “don’t deploy,” still open the PR, but do not attempt tunnel-based previews and do not run any explicit deploy commands.
  - If the repo auto-creates PR previews anyway, report the preview URL if it appears; do not treat that as a violation of “don’t deploy.”

### 1.3 Acceptance criteria

- For repos with PR preview configured, agent consistently returns the preview link after PR is opened.

## 2) Fallback path: tunnel-based preview (optional)

Use only when:

- the repo has no preview deployments, or
- the user explicitly requests a tunnel-based preview.

### 2.1 Proposed skill: `preview-tunnel`

Responsibilities:

- Start the app (e.g. `pnpm dev` or repo-specific command).
- Start a tunnel (recommended order):
  - `cloudflared tunnel --url http://127.0.0.1:<port>` (preferred for simplicity)
  - `ngrok http <port>` (if configured)
- Parse the public URL from output.
- Return the URL and store metadata in `preview/current.json`.

### 2.2 Safety requirements

- Must be gated by exec approvals / allowlists:
  - starting servers
  - starting tunnels
- Must require explicit user confirmation before exposing a public URL.
- Provide a stop command:
  - `preview stop` should terminate both the server and tunnel processes.

### 2.3 Operational constraints

- Tunnels require the gateway host to remain online.
- Prefer tailnet-only exposure when possible (Tailscale Serve on a dedicated port) rather than public tunnels.

## 3) Orchestrator behavior (how to decide preview path)

Default:

- PR-only (no tunnel) unless the repo is known to have PR previews configured.

Decision flow:

1. If repo has a known preview system (configured list), use PR preview flow.
2. Else ask: “Do you want a tunnel preview?” (default no).
3. If yes, run tunnel skill with approvals.

## 4) Testing strategy

- Unit tests for “extract preview URL from PR metadata” helper.
- Integration test (mocked) that validates:
  - PR created → preview URL detected → returned.

## 5) Acceptance criteria

- Every coding completion returns at least a PR link when a PR makes sense.
- Preview link is returned when available, without manual digging.
- Public exposure is never done silently; it requires confirmation + approvals.
