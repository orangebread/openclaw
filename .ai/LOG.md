# SESSION LOG

Append new entries at the top. Each entry records what happened, whether it stuck, and what was learned.

---

## 2026-02-08 — Scaffold `.ai/` directory + fix model dropdown bug

- **Action:** Fixed Lit `<select>` `.value` deduplication bug in `ui/src/ui/views/agents.ts`. Added `live()` directive to 6 catalog-dependent `<select>` elements (text model provider/model, image model provider/model, sub-agent provider/model).
- **Result:** Pass (type-check clean)
- **Reverted:** No
- **Learning:** When `<select>` options depend on async data (e.g., model catalog loads after config), Lit's property binding skips re-applying `.value` if the bound string hasn't changed between renders. The browser resets the selection when the previously-selected `<option>` is removed from DOM, but Lit doesn't notice. Always use `live()` on `.value` for `<select>` elements with dynamic options.

- **Action:** Created `.ai/` directory with Agent Protocol (README.md), operational files (CONTEXT.md, TASKS.md, LOG.md, DECISIONS.md, STATE.md, COMPACTION.md), and reference docs (overview.md, codemap.md, patterns.md, agents.md, ui.md, config.md, testing.md).
- **Result:** Complete — 15 files, protocol + reference material
- **Reverted:** No
- **Learning:** N/A (initial scaffolding)
