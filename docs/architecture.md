# Fork Architecture

`lukeburgesss/opencode-fork` (`fork-features` branch): OpenCode with remote
control, async multi-agent runs, and cost guardrails. Principles:

## CLI-first, UI-optional

Every feature works headless. The server (`opencode serve`) is the single
source of truth; TUI, desktop, web, mobile and `opencode run --attach` are
thin clients over the same HttpApi (`packages/protocol`, `packages/server`).
No feature may require the TUI. This keeps the door open to tuck the whole
thing onto a server later (Claude Code / Codex style) with zero redesign:
`serve --hostname 0.0.0.0` + reverse proxy today, relay later.

Existing entry points (`packages/opencode/src/cli/cmd/`):
`serve` (headless + `Effect.never`), `web` (serve + open browser, LAN IPs +
mDNS), `run [message..]` (headless prompt, `--attach <url>` for remote),
`attach <url>` (remote TUI), `async-run` / `replay` (fork addition).

## Remote control (F1, shipped)

Device pairing over the existing HttpApi: `POST /api/device/pair`
(authenticated, 10-min code) + `POST /api/device/claim` (public, single-use
-> long-lived `dev_` token), per-device revoke (`packages/server/src/
device.ts`, protocol `packages/protocol/src/groups/device.ts`). Bearer
tokens work for sessions, prompts, interrupts and permission decisions;
EventSource takes `?auth_token=`. Mobile app (`packages/mobile/`, Expo)
and PWA slice (`packages/app/src/pages/remote.tsx`) share the SDK client.

## Async runs (F2, shipped; promoted to default in slice 1)

`packages/opencode/src/async-run/`: `schema.ts` (RunID/RunTask/RunInfo),
`worktree.ts` (git ops via ChildProcessSpawner), `manager.ts` (run.json +
worktree fan-out), `reviewer.ts` (review prompt), `replay.ts` (durable
event replay), CLI `async-run`/`replay`. Protocol group `async-run.ts`;
server handler currently stubbed (per-location run storage pending).
Slice 1 adds: planner, persistent worker lifecycle, intent-ahead log,
reviewer gate, merge sequencing — see `docs/multi-agent-default.md`.

## Context and cost (F3+F5, shipped)

- `GET /api/session/:id/context-usage` (`session.contextUsage`):
  `used/usable/pct/cacheRead/cacheWrite/preserveBudget/etaTurns` computed
  from last-assistant tokens and `overflow.usable()` — the caching
  read/write data providers already report (`packages/llm` usage mappers).
  Live meter in TUI footer + app component, green<60 / yellow<85 / red.
- Spend: `GET /api/session/:id/spend`, `/api/spend/summary`
  (`SpendSummary`), daily cap -> 402, kill-switch -> 429 enforced at HTTP
  prompt admission and in the schedule runner (`packages/opencode/src/
  spend/`, protocol `groups/spend.ts`, errors in `protocol/errors.ts`).
- Schedules: `packages/opencode/src/schedules/` (Effect.repeat 30s loop,
  `every 30s/15m/2h` + `daily HH:MM` parser), CRUD at `/api/schedules`.

## Approvals (F4, shipped)

Unified queue (`packages/core/src/approvals/queue.ts`, instance wrapper in
`packages/opencode/src/approvals/`): 10-min default timeout, once/always/
deny + device-attributed audit, expiry auto-denies. Endpoints on
`server.permission` (`/api/approval*`, global auth so device tokens work);
dashboards in TUI (`routes/session/approvals.tsx`), app
(`components/approvals-dashboard.tsx`) and mobile.

## Planned (slices 2-5)

- Caching strategy: prefix-stability refactor + 1-hr TTL + hit-rate in
  meter (`transform.ts:358-407` breakpoint injector is the seam).
- Blueprints: `.opencode/blueprint.yaml` + `opencode setup` with
  fingerprint cache (Devin pattern, local).
- Secrets: OS-keychain backend behind `Credential`/`auth` interfaces
  (macOS Keychain / libsecret / wincred); sqlite stays as fallback.
- Memory: `MEMORY.md` global + per-project, auto-appended summaries,
  grep retrieval.
- Browser: hidden Chromium `BrowserView` in desktop main process, CDP,
  a11y-snapshot-first agent tools; headless-chromium path for CLI-only
  hosts. Trace/video persisted on failure only.

## Conventions (from AGENTS.md)

Short hyphen branch names, `type(scope): summary` commits, Effect style
(`Effect.gen`, `Effect.fn`, no try/catch/any/else), Schema.Class +
branded IDs, flat module exports (`export * as X`), tests from package
dirs with real implementations (no mocks), `bun run generate` from
`packages/client` after any HttpApi change + `./packages/sdk/js/script/
build.ts`.
