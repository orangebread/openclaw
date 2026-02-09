# COMPACTION RULES

When an operational `.ai/` file exceeds its budget (see README.md), compact it using these rules.

## When to Compact

Check file sizes at the end of each session (PHASE 3). If any file exceeds its budget:

| File           | Budget     | Action                                                                                         |
| -------------- | ---------- | ---------------------------------------------------------------------------------------------- |
| `LOG.md`       | ~100 lines | Archive entries older than 30 days to `.ai/archive/YYYY-MM/LOG.md`                             |
| `TASKS.md`     | ~80 lines  | Move `DONE` tasks older than 14 days to `.ai/archive/YYYY-MM/TASKS.md`                         |
| `DECISIONS.md` | ~80 lines  | Keep all decisions (they're permanent); if truly over budget, summarize older entries in-place |
| `STATE.md`     | ~40 lines  | Reset to template — old state is captured in LOG.md entries                                    |

## Archive Directory

```
.ai/archive/
  2026-01/
    LOG.md        # Archived log entries from January 2026
    TASKS.md      # Archived completed tasks from January 2026
  2026-02/
    ...
```

## Compaction Process

1. Create the archive directory if needed: `.ai/archive/YYYY-MM/`
2. Move the excess content (oldest first) to the archive file, appending if it already exists.
3. Add a summary line at the compaction point: `<!-- Compacted YYYY-MM-DD: N entries archived to .ai/archive/YYYY-MM/ -->`
4. Verify the operational file is within budget.
