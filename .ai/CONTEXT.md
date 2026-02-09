# CONTEXT

## What is OpenClaw?

Multi-agent AI platform: local gateway + CLI + web UI + native apps (macOS/iOS/Android) orchestrating LLM agents across messaging channels (Slack, Discord, Telegram, Signal, iMessage, WhatsApp, web).

## Tech Stack

| Layer           | Technology                                  |
| --------------- | ------------------------------------------- |
| Language        | TypeScript (ESM, strict mode)               |
| Runtime         | Node 22+ (Bun supported for dev/test)       |
| Package manager | pnpm (pnpm-lock.yaml committed)             |
| Gateway server  | Hono (HTTP + WebSocket)                     |
| Web UI          | Lit (lit-html templates, no framework SPA)  |
| Config format   | JSON5 (`openclaw.json`, parsed via `json5`) |
| Test framework  | Vitest + V8 coverage (70% threshold)        |
| Lint/format     | Oxlint + Oxfmt (`pnpm check`)               |
| Native apps     | SwiftUI (macOS/iOS), Kotlin (Android)       |

## Key Commands

```bash
pnpm install          # Install deps
pnpm build            # Type-check + compile
pnpm check            # Lint + format
pnpm test             # Run tests (vitest)
pnpm test:coverage    # With coverage
pnpm tsgo             # TypeScript check only
pnpm ui:dev           # UI dev server
pnpm gateway:dev      # Gateway dev mode
```

## Source Layout

```
src/agents/      Agent runtime, model selection, workspace, tools
src/config/      JSON5 config loading, types, schema, defaults
src/gateway/     Hono gateway server, RPC methods
src/sessions/    Session management
src/routing/     Message routing
src/channels/    Channel abstractions
src/skills/      Skill loading and runtime
src/memory/      QMD-based memory system
src/cli/         CLI entry points
src/commands/    CLI command implementations
ui/src/ui/       Lit web UI (app, controllers, views)
extensions/      Channel plugins (msteams, matrix, zalo, voice-call)
apps/            Native apps (macos, ios, android)
```

## Further Reading

- `AGENTS.md` (repo root) — full operational playbook: build, commit, PR, deploy conventions
- `DECISIONS.md` (this directory) — architectural constraints that affect implementation choices
