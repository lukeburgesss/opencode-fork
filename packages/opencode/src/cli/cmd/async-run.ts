import type { Argv } from "yargs"
import { Effect } from "effect"
import { effectCmd, fail } from "../effect-cmd"
import { UI } from "../ui"

const platform = Effect.gen(function* () {
  const { LayerNode } = yield* Effect.promise(() => import("@opencode-ai/core/effect/layer-node"))
  const { AppNodeBuilder } = yield* Effect.promise(() => import("@opencode-ai/core/effect/app-node-builder"))
  const { CrossSpawnSpawner } = yield* Effect.promise(() => import("@opencode-ai/core/cross-spawn-spawner"))
  const { LayerNodePlatform } = yield* Effect.promise(() => import("@opencode-ai/core/effect/app-node-platform"))
  return AppNodeBuilder.build(
    LayerNode.group([CrossSpawnSpawner.node, LayerNodePlatform.filesystem, LayerNodePlatform.path]),
  )
})

// `run` is already taken by the session runner, so async runs live under
// `async-run`: `opencode async-run --tasks t1,t2 --review`.
export const AsyncRunCommand = effectCmd({
  command: "async-run",
  describe: "create a Muse-style async run with one worktree per task",
  instance: false,
  builder: (yargs: Argv) =>
    yargs
      .option("tasks", {
        describe: "comma-separated task titles, one worktree per task",
        type: "string",
        demandOption: true,
      })
      .option("review", {
        describe: "attach a background reviewer agent to each task",
        type: "boolean",
        default: false,
      })
      .option("serial", {
        describe: "force single-agent mode: no worktrees, no fan-out",
        type: "boolean",
        default: false,
      }),
  handler: Effect.fn("Cli.asyncRun")(function* (args: { tasks: string; review: boolean; serial: boolean }) {
    const { create } = yield* Effect.promise(() => import("@/async-run/manager"))
    const { estimateFanOut } = yield* Effect.promise(() => import("@/async-run/estimate"))
    const layers = yield* platform
    const tasks = args.tasks
      .split(",")
      .map((task) => task.trim())
      .filter(Boolean)
    if (!args.serial && tasks.length > 1) {
      const estimate = estimateFanOut({ tasks: tasks.length })
      UI.println(
        `fan-out ${estimate.workers} workers ~${estimate.tokens.toLocaleString()} tokens (~$${estimate.usd})`,
      )
    }
    const result = yield* create({ directory: process.cwd(), tasks, review: args.review, serial: args.serial }).pipe(
      Effect.provide(layers),
      Effect.catchTag("AsyncRunManagerError", (cause) => fail(cause.message)),
    )
    UI.println(UI.Style.TEXT_SUCCESS_BOLD + `run ${result.info.id}` + UI.Style.TEXT_NORMAL)
    for (const task of result.info.tasks) UI.println(`task ${task.title} [${task.status}] ${task.directory}`)
  }),
})

export const AsyncReplayCommand = effectCmd({
  command: "replay <runID>",
  describe: "print the step log for an async run",
  instance: false,
  builder: (yargs: Argv) =>
    yargs.positional("runID", {
      describe: "async run ID to replay",
      type: "string",
      demandOption: true,
    }),
  handler: Effect.fn("Cli.asyncReplay")(function* (args: { runID: string }) {
    const { get } = yield* Effect.promise(() => import("@/async-run/manager"))
    const { formatRunLines } = yield* Effect.promise(() => import("@/async-run/replay"))
    const { formatReplay, pendingIntents, read } = yield* Effect.promise(() => import("@/async-run/log"))
    const layers = yield* platform
    const run = Effect.gen(function* () {
      const info = yield* get({ directory: process.cwd(), id: args.runID })
      const events = yield* read({ directory: process.cwd(), runID: args.runID }).pipe(
        Effect.orElseSucceed(() => []),
      )
      const lines = formatRunLines(info)
      for (const line of formatReplay(events)) lines.push(`  ${line}`)
      for (const event of pendingIntents(events))
        lines.push(`  ! ${event.action}${event.task ? ` [${event.task}]` : ""} (pending)`)
      return lines
    })
    const lines = yield* run.pipe(
      Effect.provide(layers),
      Effect.catchTag("AsyncRunManagerError", (cause) => fail(cause.message)),
    )
    for (const line of lines) UI.println(line)
  }),
})
