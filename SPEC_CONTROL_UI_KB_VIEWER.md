# Control UI Knowledge Base Viewer — Spec (Read-only v1)

Status: draft  
Goal: allow manual review of notes/links/review queue without SSH or GitHub navigation.

## 0) Summary

Add a read-only “Knowledge Base” panel to the Control UI backed by new Gateway WS methods.
This panel browses and previews a strictly allowlisted subset of the orchestrator’s workspace (or a configured KB path).

This is deliberately **read-only** in v1.

## 1) UX requirements

- Browse a tree of folders/files:
  - `notes/`
  - `links/`
  - `review/`
- View a markdown preview for `.md`.
- View raw text for `.txt`/`.json` (optional).
- Provide a quick “Review Queue” view:
  - show `review/QUEUE.md` (if exists), else show list of `review/*.md`.

## 2) Security requirements

Hard constraints:

- No arbitrary filesystem reads.
- No symlink traversal.
- No `..` traversal.
- Cap bytes returned per read.
- Require authenticated operator scope.

Recommended default allowlist (workspace-relative):

- `notes/`
- `links/`
- `review/`

Optional allowlist additions (explicit):

- `memory/` (if desired)

## 3) Backend API design (Gateway WS)

### 3.1 New methods

#### `workspace.list`

Params:

```jsonc
{
  "agentId": "orchestrator",
  "dir": "notes", // workspace-relative
  "maxDepth": 4,
  "includeHidden": false,
  "maxEntries": 500, // safety cap (server may clamp)
  "cursor": null, // optional pagination cursor (v1 optional)
}
```

Response:

```jsonc
{
  "dir": "notes",
  "cursor": null,
  "entries": [
    { "path": "notes/project-a.md", "kind": "file", "sizeBytes": 1234, "modifiedAtMs": 0 },
    { "path": "notes/projects", "kind": "dir", "modifiedAtMs": 0 },
  ],
}
```

#### `workspace.read`

Params:

```jsonc
{
  "agentId": "orchestrator",
  "path": "notes/project-a.md",
  "maxBytes": 200000,
}
```

Response:

```jsonc
{
  "path": "notes/project-a.md",
  "contentType": "text/markdown",
  "truncated": false,
  "content": "...",
}
```

### 3.2 Authorization

V1 recommendation (lowest integration friction):

- Require `operator.read` (or `operator.admin`) for `workspace.list` and `workspace.read`.

Optional future hardening:

- Introduce a dedicated scope (e.g., `operator.workspace`) once scopes are plumbed end-to-end (pairing UI, token issuance, and gateway method authorization).

Implementation approach:

- Enforce scope inside the `workspace.*` handlers (deny with `NOT_AUTHORIZED`).

## 4) Backend implementation notes

- Implement in `src/gateway/server-methods/` as new handler file(s), registering methods alongside existing ones.
- Resolve agent workspace via existing agent scope helpers (agentId → workspace dir).
- Resolve a KB root:
  - v1: use the agent workspace dir as the root and keep all paths workspace-relative.
  - optional: allow a configured KB subdir (still under the workspace root), but do not accept arbitrary host paths in v1.
- Allowlist enforcement:
  - Validate that requested `dir/path` is under one of the approved prefixes.
  - Use `path.resolve(workspaceDir, input)` and verify it stays within workspaceDir.
  - Reject symlinks using `lstat` checks (and/or “ignore symlinks” strategy).
- Resource controls (required):
  - Clamp `maxDepth`, `maxEntries`, and `maxBytes` to safe server-side limits.
  - Sort entries deterministically (e.g., dirs first, then files; lexicographic by path) so UI diffs are stable.
- File type allowlist:
  - v1: `.md`, `.txt`, `.json`
  - return `UNSUPPORTED` for others.

## 5) Control UI implementation notes

- Add a new nav item “Knowledge Base”.
- UI states:
  - disconnected / unauthorized (prompt for auth)
  - loading tree
  - viewing file
- Render markdown with existing client-side markdown renderer (or a minimal safe renderer).
- Avoid embedding raw HTML from markdown; sanitize.

## 6) Testing strategy

- Unit tests for path allowlist and traversal rejection.
- Unit tests for `maxEntries` clamping and deterministic sorting.
- WS-level tests:
  - unauthorized client cannot call `workspace.read`
  - allowed prefixes work
  - disallowed prefix fails
  - large files truncate correctly

## 7) Acceptance criteria

- Operator can open Control UI → Knowledge Base and browse `notes/`, `links/`, `review/`.
- “Review Queue” is accessible without GitHub.
- No access is possible outside allowlisted prefixes.
