# Slice 1: Multi-Agent by Default (Muse-style)

Promote the F2 async-run skeleton to the default execution path, following
the researched Muse pattern (persistent workers, worktree isolation,
intent-ahead log, background reviewer).

## Behaviour

- `opencode run "task"` plans first: the lead decomposes the task into
  subtasks with file domains. 0-1 actionable subtasks -> existing
  single-agent path, zero overhead. 2+ independent subtasks -> fan-out.
- Each worker gets its own git worktree + branch (from base commit),
  commits on its branch, reports back. Parent merges sequentially after
  the reviewer approves each diff; conflicts escalate to the user.
- `--serial` forces single-agent (escape hatch for trivial tasks).
- Cost guard: pre-spawn estimate (workers x observed per-turn tokens x
  review pass), cap `min(cpu-2, 8)` workers, one level deep. Expected
  1.5-2x tokens vs single-agent; elapsed time wins on parallelisable work.

## Components (`packages/opencode/src/async-run/`)

| File (new)   | Role |
|---|---|
| `planner.ts`   | Pure decomposition helpers: `splitByDomains` (group file hints into disjoint domains), `decompositionPrompt` (model prompt builder emitting JSON subtasks), `parseDecomposition` (strict JSON parse -> subtask list). Model call itself stays in the session loop. |
| `worker.ts`    | Persistent worker lifecycle over `manager` + `worktree`: `spawn` (worktree+branch+record status=running), `complete`/`fail` (status + commit check), `merge` (sequential `git merge --no-ff`, conflict -> failed with marker), `cleanup` (remove worktree). Intent-ahead: every transition appended to the run log *before* executing. |
| `log.ts`       | Append-only JSONL run log (`events.log` beside `run.json`): `append` (intent first), `read` (ordered), `pendingIntents` (crash recovery: intents without matching completion), `formatReplay` (human `replay` output). |
| `gate.ts`        | Reviewer gate: `decide` (approve / retry capped at 2 rounds / escalate), `parseVerdict`, `reviewPromptWithDiff`, `recordDecision` (logged before acting). |
| `estimate.ts`  | `estimateFanOut` (workers, avg tokens/turn, review passes -> {tokens, usd, seconds}) used for pre-spawn guard + spend-cap check. |

Schema additions (`schema.ts`): worker `status` gains `review` + `merging`;
`RunInfo` gains `mode: "single" | "parallel"`, `logPath`, `rounds`.

CLI (`cli/cmd/async-run.ts`): `async-run --tasks a,b --review` (existing)
plus `run --parallel --tasks ...` wiring and `--serial` passthrough; `replay`
reads the JSONL log (falls back to run/task lines).

## Crash recovery (write-ahead)

`worker.spawn/merge`, reviewer decisions and completions are logged as
intents first. After a kill, `replay <runID>` shows completed steps and
`pendingIntents` lists what never finished; re-running the command resumes
only pending workers. Durable `SessionEvent` history remains the per-session
source of truth; the run log is the cross-worker source of truth.

## Tests (all real, no mocks)

- `planner.test.ts`: domain splitting (overlapping -> one group,
  disjoint -> N groups), decomposition JSON parsing (valid/invalid/
  adversarial), prompt builder contains file domains + JSON schema.
- `log.test.ts`: append/read ordering, pending-intent detection after
  simulated crash (write intents, no completions), replay formatting.
- `worker.test.ts`: full lifecycle in temp git repos (spawn -> edit ->
  commit -> merge -> cleanup), conflict path (two workers same file ->
  second merge fails cleanly), reviewer gate round-cap.
- `estimate.test.ts`: estimate math + cap enforcement.

## Acceptance

`bun test test/async-run` green; `replay` after `kill -9` shows pending
work; overlapping-file tasks refuse to fan out (single path); spend cap
trips mid-fan-out and halts spawning.
