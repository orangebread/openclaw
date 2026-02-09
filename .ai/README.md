# AGENT PROTOCOL

You are a stateless worker. Your memory is the `.ai/` directory. You have no recall of previous sessions except what is written here.

## PHASE 1: ORIENT (Mandatory before any code generation)

0. Read `.ai/README.md` (this file) — understand file roles, budgets, and compaction rules.
1. Read `.ai/CONTEXT.md` — acknowledge the tech stack and conventions.
2. Read `.ai/TASKS.md` — identify the active task by status.
   - If multiple tasks are marked active, prefer the first task that is **IN PROGRESS**; if none are in progress, ask before choosing.
3. Read `.ai/LOG.md` (last 5 entries) — note recent failures and learnings.
4. Read `.ai/DECISIONS.md` — confirm no architectural constraints block your approach.
5. Read `.ai/STATE.md` (if present) — resume the current working set; update it with today's session goal.
6. State your plan in 3 sentences or fewer. Wait for approval before proceeding.
   - If the user asked for review/advice only and you will not modify any files, stop after PHASE 1 and provide the review (PHASE 2/3 are not required).

## PHASE 2: EXECUTE

- Touch only files relevant to the active task.
- If you encounter an architectural question not covered by DECISIONS.md, STOP and ask.
- Run the specified test command after changes.
  - If the active task includes a `Test:` command, run that.
  - If no `Test:` command is specified, run `pnpm build && pnpm check && pnpm test` (or ask if unclear).

## PHASE 3: UPDATE (Mandatory before session ends)

You may not consider a task complete until:

1. Test output is shown and passes.
2. `TASKS.md` status is updated.
3. `LOG.md` has a new entry with: action, result, reverted (y/n), learning.
4. If you made an architectural choice, append to `DECISIONS.md`.
5. If any `.ai/` file exceeds its budget, compact per `COMPACTION.md` and archive to `.ai/archive/YYYY-MM/`.
6. Update `STATE.md` to reflect the handoff (or reset it to the template for the next session).

## FAILURE MODE

If tests fail after 2 attempts on the same approach:

1. Revert to last working state.
2. Log the failure with root cause hypothesis.
3. Mark task as BLOCKED with reason.
4. Stop and surface the blocker to the user.

---

## File Roles and Budgets

| File            | Role                                            | Budget     |
| --------------- | ----------------------------------------------- | ---------- |
| `README.md`     | Agent protocol (this file)                      | ~100 lines |
| `CONTEXT.md`    | Tech stack, conventions, source layout          | ~60 lines  |
| `TASKS.md`      | Active and queued tasks with status             | ~80 lines  |
| `LOG.md`        | Session log: action, result, reverted, learning | ~100 lines |
| `DECISIONS.md`  | Architectural decisions and constraints         | ~80 lines  |
| `STATE.md`      | Current working set and session handoff state   | ~40 lines  |
| `COMPACTION.md` | Compaction and archival rules                   | ~30 lines  |

## Relationship to AGENTS.md

`AGENTS.md` (symlinked as `CLAUDE.md`) is the **operational playbook** — build commands, commit conventions, PR flow, deploy procedures. Always follow it for git/commit/PR workflows.

This `.ai/` directory is the **session state** — decisions, task tracking, and session continuity.

## PROJECT PATTERN RULES (OpenClaw)

- Config is **JSON5** (`openclaw.json`), parsed via `json5` in `src/config/io.ts`. Never assume YAML.
- Model references use `provider/model` format (e.g., `anthropic/claude-opus-4-6`). Aliases resolve in `src/config/defaults.ts`.
- Config resolution cascades: per-agent override -> `agents.defaults` -> hardcoded default.
- The **Agents view** (`ui/src/ui/views/agents.ts`) is the canonical agent management UI. Do NOT create parallel UI surfaces.
- System prompt customization uses workspace files (AGENTS.md, SOUL.md, TOOLS.md, IDENTITY.md, USER.md, HEARTBEAT.md). Do NOT add a `systemPrompt` field to agent config.
- Sub-agent spawning via `sessions_spawn` tool (`src/agents/tools/sessions-spawn-tool.ts`).
- Gateway restarts after `config.set`; the UI handles WebSocket drops (code 1012) with optimistic dirty-flag clearing.
- Lit `<select>` elements with async options require `live()` directive on `.value` bindings to prevent stale selections.
- Tool input schemas: no `Type.Union`, no `anyOf`/`oneOf`/`allOf`, no raw `format` property name.
- Commits via `scripts/committer "<msg>" <file...>` — avoid manual `git add`/`git commit`.
