# Provider Patterns Research

How the major providers implement the features this fork adopts, and what we
copy. Researched Sept 2026 from official docs, changelogs and press.

## 1. Prompt caching (Anthropic / OpenAI / Google)

- Anthropic: explicit `cache_control: {type: ephemeral}` breakpoints, max 4
  per request. Writes cost 1.25x (5-min TTL) or 2x (1-hr TTL) input price;
  reads cost 0.10x. Minimum ~1,024 tokens. Stable prefix ordering is
  mandatory: system, tools, static context first; dynamic content last.
  Automatic caching also exists on current models.
  Source: `platform.claude.com/docs/en/build-with-claude/prompt-caching`.
- OpenAI: automatic server-side caching, no code changes, 1,024-token
  minimum growing in 128-token increments; reads ~0.5x (0.25x on newer
  models). Source: `platform.openai.com/docs/guides/prompt-caching`.
- Google Gemini: implicit caching, zero config, ~3-5 min TTL, reads 0.25x,
  1,024 (Flash) / 4,096 (Pro) token minimums. Keep the head of the message
  array stable. Source: Google Developers Blog, May 2025.
- Economics: a stable 100K system prompt read 10x costs ~78% less than
  uncached; at 100 reads it approaches the 90% floor. Latency drops up to
  85%. Implication for us: caching is architecture, not model selection.

What we adopt: stable prefix discipline (system, skills, AGENTS.md, then
history tail), 5-min vs 1-hr TTL by expected session length, cache hit-rate
surfaced per session, breakpoint placement covered by unit tests. OpenCode
already injects up to 4 breakpoints (`transform.ts`) and tracks
`cache.read/write` tokens end to end — see `docs/architecture.md`.

## 2. Headless / tucked-away operation (Claude Code)

- `claude -p "prompt"` runs the full agent loop non-interactively, exit code
  signals success; `--bare` skips hooks/skills/MCP/CLAUDE.md discovery for
  fast deterministic CI runs; `--allowedTools` pre-approves tools;
  `--mcp-config` waits for servers up to `MCP_TIMEOUT`.
- `claude remote-control --spawn worktree|same-dir|session --capacity N`
  turns remote control into a persistent multi-session server; each session
  isolated per `--spawn` mode. Outbound HTTPS relay: no inbound ports, no
  firewall/VPN changes. Channels push Telegram/Discord/iMessage into a
  running session. `--teleport` resumes a cloud session locally.
  Source: `code.claude.com/docs/en/headless`, remote-control guide (2026).
- Agent SDK exposes the same engine programmatically (streaming, hooks as
  callbacks, session resume/fork).

What we adopt: every feature must work headless (`serve`/`run --attach`),
desktop is a thin client over the same HttpApi, worktree-per-session spawn
modes, device-token auth for phones. No feature may require the TUI.

## 3. Multi-agent by default (Muse Code, Meta)

- Persistent async subagents live for the whole session (not
  spawn-per-task); workers run in parallel, a reviewer critiques in the
  background; each child gets its own `git worktree` under
  `.muse/worktrees/` (detached HEAD from parent HEAD), commits on its own
  branch, results drain back and merge one at a time.
- Write-ahead event log: every model call, tool run, approval and edit is
  appended *before* executing. Crash-safe resume and step-by-step replay
  (`muse replay`) fall out of the log; it doubles as a SOC2/HIPAA-grade
  audit trail. Cost: budget 1.5-2x tokens vs single-agent; only wins on
  decomposable work (refactors, feature slices, migrations), loses on
  one-file edits. Sources: `musecodes.io/docs`, Meta launch (Aug 2026),
  Layer3/TechPlained reviews.
- Convergent pattern: Cursor Aug 2026 runs subagents on separate isolated
  VMs with event subscriptions (PR/Slack/cron); Claude Code has session
  tasks panel + `--spawn worktree`. Worktree isolation + intent-ahead log
  are portable to any harness — we implement both.

What we adopt: see `docs/multi-agent-default.md`.

## 4. Secrets and environments (Devin/Cognition)

- Blueprints (org + repo tiers): `initialize` / `maintenance` / `knowledge`
  steps, secrets referenced as `$VAR`, injected during builds and sessions,
  stripped before snapshot save; credential-writing steps belong in
  `maintenance` so they refresh. Git-backed `.devin/blueprint.yaml`,
  snapshot pinning, per-workspace blueprints for monorepos.
  Source: `docs.devin.ai/onboard-devin/environment/blueprints`.
- Knowledge (retrieval memory, org-wide tips) vs Playbooks (ordered
  multi-step job shapes with postconditions) vs secrets manager: three
  separate control planes, never mixed.

What we adopt: `.opencode/blueprint.yaml` (`setup`/`maintain`/`knowledge`/
`verify`), fingerprinted so `opencode setup` is a no-op when nothing
changed; OS-keychain secret backend; model never pays setup tokens twice.

## 5. Memory and skills

- Instruction hierarchy: `CLAUDE.md` (always-on, <100 lines) > `AGENTS.md`
  (universal law) > skill (task-scoped override) > `CONTEXT.md` (session
  state) > `MEMORY.md` (append-only log, reference only).
- Agent Skills open standard (`agentskills.io/specification`, Dec 2025):
  `SKILL.md` + frontmatter, median skill ~1.4k tokens, 32 adopters;
  skills cost 0 tokens unless triggered. MCP answers "what can the agent
  access", skills answer "how should it work".
- Anthropic is productising API-side agent memory (SDK beta header
  `agent-memory-2026-07-22`).

What we adopt: `MEMORY.md` per-project + global with auto-appended
summaries and grep retrieval (no vectors); keep SKILL.md compat; never
duplicate house style across files.

## 6. Token-efficient browser testing (Microsoft Playwright)

- `microsoft/playwright-mcp` returns accessibility-tree snapshots
  (~200-400 tokens each) with `ref` handles instead of screenshots; vision
  mode (screenshots + coordinates) is fallback only.
- Microsoft's own guidance for coding agents: **CLI+SKILLs over MCP**
  (~27K vs ~114K tokens/test, 4x) — persistent MCP servers load huge tool
  schemas and verbose trees into context; concise purpose-built commands
  win for high-throughput agents. `browser_snapshot` supports saving to
  file instead of inline return.
  Sources: `github.com/microsoft/playwright-mcp`,
  `playwright.dev/mcp/vision-mode`, TestQuality 2026 guide.

What we adopt: built-in hidden Chromium view in desktop (Electron already
embeds it), CDP-driven, a11y-snapshot-first tool surface, trace/video
persisted on failure only. See `docs/architecture.md`.
