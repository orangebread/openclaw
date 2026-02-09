# ARCHITECTURAL DECISIONS

Record decisions that constrain future work. Format: date, decision, rationale.

---

### AD-001: Config is JSON5, not YAML (established)

- **Date:** Pre-2026
- **Decision:** Configuration uses JSON5 format (`openclaw.json`), parsed via the `json5` npm package.
- **Rationale:** JSON5 supports comments, trailing commas, and unquoted keys while remaining close to JSON. YAML was never adopted.
- **Constraint:** Never introduce YAML config parsing. Config path: `src/config/io.ts`.

### AD-002: No `systemPrompt` field in agent config (established)

- **Date:** Pre-2026
- **Decision:** The system prompt is OpenClaw-owned. Agent customization happens via workspace files (AGENTS.md, SOUL.md, TOOLS.md, IDENTITY.md, USER.md, HEARTBEAT.md) in the agent's workspace directory.
- **Rationale:** Workspace files provide a structured, composable seam without exposing raw prompt engineering to users. Each file has a clear role.
- **Constraint:** Do NOT add a `systemPrompt` field to `AgentConfig`. Use workspace files for all prompt customization.

### AD-003: Single Agents view, no parallel UI surfaces (2026-02-07)

- **Date:** 2026-02-07
- **Decision:** The Agents view (`ui/src/ui/views/agents.ts`) with its 6-tab layout is the canonical agent management UI. A separate "Agent Profile" tab was created and reverted.
- **Rationale:** Parallel UI surfaces create sync issues and confuse the config-form save path vs the profile RPC path. One surface, one data flow.
- **Constraint:** All agent management features go into the existing Agents view tabs.

### AD-004: Model references use provider/model format (established)

- **Date:** Pre-2026
- **Decision:** Model IDs are `provider/model` strings (e.g., `anthropic/claude-opus-4-6`). Aliases (e.g., `opus`) resolve via `src/config/defaults.ts`.
- **Rationale:** The slash format makes the provider explicit, enabling provider-first UI selection and auth profile association.
- **Constraint:** Always store and transmit full `provider/model` IDs. Alias resolution happens at the edges (config loading, UI display).

### AD-005: Lit `live()` directive required for async-option selects (2026-02-08)

- **Date:** 2026-02-08
- **Decision:** All `<select>` elements in the Lit UI whose options depend on async data (e.g., model catalog) must use `live()` on their `.value` binding.
- **Rationale:** Lit deduplicates `.value` property assignments. When options change but the bound value string stays the same, Lit skips re-applying, causing the browser to show a stale selection.
- **Constraint:** Import `live` from `lit/directives/live.js` and wrap `.value=${live(value)}` on any `<select>` with dynamically-loaded options.
