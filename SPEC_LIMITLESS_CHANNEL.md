# Limitless Integration — “hey butch” Wake Phrase Channel Spec

Status: draft  
Scope: OpenClaw enhancement (Phase 1) + Phase 0 compatibility

## 0) Problem statement

We want Limitless to behave like a channel of communication for issuing instructions:

- A device button starts recording speech-to-text (STT) into Limitless.
- The user says: `hey butch <instruction>`.
- OpenClaw reacts quickly and replies to the **last active chat channel**, falling back to **Discord**.

Because Limitless is not a guaranteed bidirectional transport, we treat it as an **inbound trigger source**.

## 1) Integration options

### Option A (Phase 0): external poller → OpenClaw hooks

- A small service polls Limitless and calls OpenClaw `/hooks/agent` on triggers.
- Pros: fastest, no OpenClaw code changes.
- Cons: not visible as a “channel” in OpenClaw status/UI; separate lifecycle/logging.

### Option B (Phase 1, recommended): `extensions/limitless` inbound-only channel plugin

- Implement Limitless as a ChannelPlugin with `gateway.startAccount()` running the poll loop.
- Pros: first-class status, lifecycle, config schema, consistent logs and troubleshooting.
- Cons: requires new extension package.

### Option C (future): event/webhook-driven

- If Limitless provides official webhook/events, switch from polling to push.
- Keep the same internal dispatch semantics.

## 2) Functional requirements

### 2.1 Wake phrase detection

Wake phrase: `"hey butch"` (case-insensitive).

Accepted forms:

- `hey butch <text>`
- `hey butch, <text>`
- `hey butch: <text>`

Parsing rules:

- Strip the wake phrase and optional punctuation.
- Remaining text is the `instruction`.
- Ignore triggers with empty/too-short instruction (configurable min length; default 10 chars).

### 2.2 Interrupt / priority controls (instruction-dependent)

Default behavior:

- Do **not** interrupt active work; enqueue/queue the instruction.
- The “queue” behavior must be enforceable (see **2.2.1 Concurrency + queue semantics**). Without explicit serialization, multiple Limitless triggers may execute concurrently.

Interrupt keywords (case-insensitive) immediately following wake phrase:

- `stop`
- `interrupt`
- `urgent`

Examples:

- `hey butch stop open the PR and revert it`
- `hey butch urgent message me the status`

Semantics:

- If interrupt keyword is present, abort current active run for the orchestrator session, then run the new instruction.

Optional “force queue” keyword:

- `queue`

Precedence:

- If `queue` is present immediately after the wake phrase, treat the instruction as `priority="queue"` even if an interrupt keyword also appears later.
- Else if an interrupt keyword is present immediately after the wake phrase, treat the instruction as `priority="interrupt"`.

#### 2.2.1 Concurrency + queue semantics (required)

OpenClaw can run multiple agent sessions concurrently (default concurrency is > 1). To make “queue by default” real for the single-user assistant session, the Limitless integration must enforce _per-target-session_ serialization via one (or both) of:

1. **Config (recommended for single-user assistant):** set `agents.defaults.maxConcurrent=1` (and keep the orchestrator on the main session key).
2. **Plugin-level serialization:** implement a per-session mutex/queue so only one instruction dispatch is in-flight at a time for the target session key (e.g., `agent:orchestrator:main`), even if global concurrency is higher.

If neither is done, Limitless triggers can overlap and interleave outputs, breaking user expectations and complicating safe approvals.

### 2.3 Delivery routing (last active channel + fallback)

Primary:

- deliver to the session’s last-route (last active channel/to).

Fallback:

- Discord target (configured) when last-route is absent.

The Limitless integration must **not** overwrite last-route with `limitless`.

Definition: “last active channel”

- Use the session store’s last-route fields (`lastChannel`, `lastTo`, `lastAccountId`, `lastThreadId` when supported).
- Only treat **deliverable channels** as valid last-routes.
- If the last-route is `webchat` (internal surface), treat it as _absent_ and use the fallback. (Rationale: internal/control UI should not become the sink for automation-triggered replies.)

### 2.4 Dedupe, replay protection, and debounce

Must prevent repeated triggers due to:

- repeated polling windows
- transcript updates
- transient errors followed by retry

Mechanisms:

- Persist a cursor (when supported) or a monotonic watermark (timestamp + id).
- Maintain a bounded seen-set of recently processed event ids/hashes.
- Ignore events older than watermark.

Final-transcript gating (required)

- If Limitless provides an explicit “final transcript” indicator, only trigger on final items.
- Otherwise, approximate finality by debouncing: require the normalized transcript text to remain unchanged for `finalityDebounceMs` (e.g., 2000–5000ms) before triggering.

Atomic state updates (required)

- State must be written via temp file + rename to avoid corruption on crash.
- If multiple OpenClaw instances could run on the same state dir, the poller should take a best-effort lock (e.g., lock file) so two poll loops do not process the same events concurrently.

### 2.5 Safety defaults

Limitless-triggered runs should default to a “safe” tool posture:

- No host exec / deploy without explicit confirmation and approvals.
- If a tool requires approval, it should surface an approval request routed to last active channel.

## 3) Data model (internal)

### 3.1 Normalized inbound event

```ts
type LimitlessInboundEvent = {
  provider: "limitless";
  eventId: string;
  occurredAtMs: number;
  rawText: string;
  instruction?: {
    priority: "queue" | "interrupt";
    body: string;
  };
  source?: {
    kind: "lifelog" | "chat" | "unknown";
    id?: string;
    url?: string;
  };
};
```

### 3.2 Persistent state

Store under the OpenClaw state dir (default `~/.openclaw`, overridable via `OPENCLAW_STATE_DIR`).

Recommended per-account file naming:

- `~/.openclaw/limitless/state-<accountId>.json`

Suggested contents:

```jsonc
{
  "version": 1,
  "cursor": "opaque-or-null",
  "lastOccurredAtMs": 0,
  "seen": [{ "id": "evt_...", "atMs": 0 }],
}
```

## 4) Channel plugin design (Phase 1)

### 4.1 Package

Create:

- `extensions/limitless/`
  - `openclaw.plugin.json` with `channels:["limitless"]`
  - `index.ts` registering the channel plugin

### 4.2 Config schema (high-level)

Add `channels.limitless` config with:

- `enabled` (bool)
- `apiKey` (string, sensitive)
- `pollIntervalMs` (default 15000–60000)
- `finalityDebounceMs` (default 2000–5000; used when provider has no “final” signal)
- `wakePhrase` (default `"hey butch"`)
- `interruptKeywords` (default `["stop","interrupt","urgent"]`)
- `minInstructionChars` (default 10)
- `deliver`:
  - `mode: "last"`
  - `fallback: { channel: "discord", to: "user:<id>" | "channel:<id>" }`

### 4.3 Runtime lifecycle

Implement `gateway.startAccount(ctx)`:

- Validate config + api key.
- Start poll loop:
  - `while !abortSignal.aborted`:
    - fetch new items
    - normalize + dedupe
    - if instruction trigger: dispatch
    - sleep poll interval (jittered)

Operational notes:

- Add jitter to reduce thundering herd when multiple services start at once.
- On transient errors, use exponential backoff capped to a sane maximum, but keep the poll loop alive.

Update channel runtime snapshot via `ctx.setStatus({ connected, lastInboundAt, lastError, ... })`.

### 4.4 Dispatch into OpenClaw

Two acceptable dispatch strategies:

**Strategy 1 (preferred): dispatch through the same inbound pipeline as other channels**

- Construct a `FinalizedMsgContext`-compatible payload and call the existing dispatch layer.
- Set:
  - `Provider/Surface = "limitless"`
  - `Body = "<instruction>"`
  - `OriginatingChannel/OriginatingTo` = last-route channel/to
  - `SessionKey` = orchestrator main session key (`agent:orchestrator:main`)
- Ensure last-route is not updated to limitless.

**Strategy 2: call the gateway server method `agent`**

- Read last-route and pass `deliver=true` + `channel:"last"` with fallback logic.
- This is less ideal because it bypasses some inbound normalization, but is simpler to wire.

Idempotency (required)

- Use a deterministic idempotency key derived from the inbound event identity (e.g., `limitless:<eventId>`). This should be used both for in-memory dedupe and, where possible, for any downstream RPC idempotency key.

### 4.5 Interrupt behavior

If priority is `"interrupt"`:

- Abort the active run for `agent:orchestrator:main` (same semantics as a user sending `/stop`).
- Then run the new instruction.

## 5) Testing strategy

### Unit tests

- Wake phrase parsing (punctuation, casing, min length).
- Interrupt keyword parsing.
- Dedupe logic with cursor + seen-set.
- Fallback delivery selection when last-route missing.

### Integration tests

- Simulate “last route = discord”, then ingest a Limitless instruction and assert:
  - agent run is started
  - reply routes to OriginatingChannel=discord
  - last-route remains discord (not overwritten by limitless)

## 6) Observability

Must log structured events:

- `limitless.poll.ok` / `.error`
- `limitless.triggered` (eventId, instruction preview, priority)
- `limitless.dispatched` (runId, deliver target, fallback used)

Expose in channel status snapshot:

- `connected`/`running`
- `lastInboundAt`
- `lastError`
