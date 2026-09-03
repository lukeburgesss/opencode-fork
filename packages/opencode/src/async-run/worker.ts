import { Effect, Schema } from "effect"
import * as FileSystem from "effect/FileSystem"
import { RunID, RunInfo, RunTask, runSerial, taskRounds } from "./schema"
import { add, baseCommit, commitAll, merge, remove } from "./worktree"
import { append } from "./log"
import { estimateFanOut, workerCount } from "./estimate"
import { ManagerError, runFile, runsDirectory } from "./manager"

const save = Effect.fn("AsyncRunWorker.save")(function* (info: typeof RunInfo.Type) {
  const fs = yield* FileSystem.FileSystem
  const encoded = yield* Schema.encodeEffect(RunInfo)(info).pipe(
    Effect.mapError((cause) => new ManagerError({ message: String(cause) })),
  )
  yield* fs.writeFileString(yield* runFile(info.directory, info.id), JSON.stringify(encoded, null, 2)).pipe(
    Effect.mapError((cause) => new ManagerError({ message: String(cause) })),
  )
})

const withTask = Effect.fn("AsyncRunWorker.withTask")(function* (input: {
  info: typeof RunInfo.Type
  title: string
  status: (typeof RunInfo.Type)["tasks"][number]["status"]
}) {
  const tasks = input.info.tasks.map((task) =>
    task.title === input.title
      ? new RunTask({
          title: task.title,
          branch: task.branch,
          directory: task.directory,
          sessionID: task.sessionID,
          status: input.status,
          rounds: input.status === "review" ? taskRounds(task) + 1 : taskRounds(task),
        })
      : task,
  )
  const next = new RunInfo({
    id: input.info.id,
    baseCommit: input.info.baseCommit,
    directory: input.info.directory,
    tasks,
    review: input.info.review,
    createdAt: input.info.createdAt,
    mode: input.info.mode,
    serial: input.info.serial,
  })
  yield* save(next)
  return next
})

// Spawn a persistent worker: intent is logged BEFORE touching the worktree.
// manager.create builds worktrees eagerly, so spawn adopts the existing
// checkout; after a crash (missing checkout) it recreates it. Either way a
// missing completion shows up in pendingIntents and only that worker resumes.
export const spawn = Effect.fn("AsyncRunWorker.spawn")(function* (input: {
  info: typeof RunInfo.Type
  title: string
  base: string
}) {
  const task = input.info.tasks.find((t) => t.title === input.title)
  if (!task) return yield* new ManagerError({ message: `Unknown task ${input.title}` })
  if (runSerial(input.info)) return yield* new ManagerError({ message: "Serial runs execute in-process, no workers" })
  yield* append({
    directory: input.info.directory,
    runID: RunID.make(input.info.id),
    kind: "intent",
    action: "spawn",
    task: task.title,
    detail: task.branch,
  }).pipe(Effect.mapError((cause) => new ManagerError({ message: cause.message })))
  const checkout = yield* baseCommit(task.directory).pipe(
    Effect.map((commit) => commit === input.base),
    Effect.orElseSucceed(() => false),
  )
  if (!checkout) {
    yield* add({ repo: input.info.directory, path: task.directory, branch: task.branch, base: input.base }).pipe(
      Effect.mapError((cause) => new ManagerError({ message: cause.message })),
    )
  }
  const next = yield* withTask({ info: input.info, title: task.title, status: "running" })
  yield* append({
    directory: input.info.directory,
    runID: RunID.make(input.info.id),
    kind: "complete",
    action: "spawn",
    task: task.title,
  }).pipe(Effect.mapError((cause) => new ManagerError({ message: cause.message })))
  return next
})

export const finish = Effect.fn("AsyncRunWorker.finish")(function* (input: {
  info: typeof RunInfo.Type
  title: string
  ok: boolean
  commitMessage?: string
}) {
  const task = input.info.tasks.find((t) => t.title === input.title)
  if (!task) return yield* new ManagerError({ message: `Unknown task ${input.title}` })
  if (input.ok) {
    const committed = yield* commitAll({
      dir: task.directory,
      message: input.commitMessage ?? `async: ${task.title}`,
    }).pipe(Effect.mapError((cause) => new ManagerError({ message: cause.message })))
    yield* append({
      directory: input.info.directory,
      runID: RunID.make(input.info.id),
      kind: "complete",
      action: "work",
      task: task.title,
      detail: committed ? "committed" : "no changes",
    }).pipe(Effect.mapError((cause) => new ManagerError({ message: cause.message })))
    return yield* withTask({ info: input.info, title: task.title, status: "review" })
  }
  return yield* withTask({ info: input.info, title: task.title, status: "failed" })
})

// Sequential merge: one worker at a time, intent logged first. A conflict
// fails the worker (repo left clean) for human escalation.
export const mergeTask = Effect.fn("AsyncRunWorker.merge")(function* (input: {
  info: typeof RunInfo.Type
  title: string
}) {
  const task = input.info.tasks.find((t) => t.title === input.title)
  if (!task) return yield* new ManagerError({ message: `Unknown task ${input.title}` })
  const merging = yield* withTask({ info: input.info, title: task.title, status: "merging" })
  yield* append({
    directory: input.info.directory,
    runID: RunID.make(input.info.id),
    kind: "intent",
    action: "merge",
    task: task.title,
    detail: task.branch,
  }).pipe(Effect.mapError((cause) => new ManagerError({ message: cause.message })))
  const merged = yield* merge({ repo: input.info.directory, branch: task.branch }).pipe(
    Effect.catchTag("AsyncRunMergeConflict", (cause) =>
      withTask({ info: merging, title: task.title, status: "failed" }).pipe(
        Effect.flatMap(() => Effect.fail(new ManagerError({ message: `Conflict merging ${cause.branch}` }))),
      ),
    ),
    Effect.mapError((cause) =>
      cause instanceof ManagerError ? cause : new ManagerError({ message: String(cause) }),
    ),
  )
  void merged
  yield* append({
    directory: input.info.directory,
    runID: RunID.make(input.info.id),
    kind: "complete",
    action: "merge",
    task: task.title,
  }).pipe(Effect.mapError((cause) => new ManagerError({ message: cause.message })))
  const done = yield* withTask({ info: merging, title: task.title, status: "done" })
  yield* remove({ repo: input.info.directory, path: task.directory }).pipe(
    Effect.mapError((cause) => new ManagerError({ message: cause.message })),
  )
  return done
})

export const guard = (input: { tasks: number; cpuCount?: number; usdCap?: number; usdPerMTok?: number }) => {
  const workers = workerCount({ tasks: input.tasks, cpuCount: input.cpuCount })
  const estimate = estimateFanOut({ tasks: input.tasks, cpuCount: input.cpuCount, usdPerMTok: input.usdPerMTok })
  const overCap = input.usdCap !== undefined && estimate.usd > input.usdCap
  return { workers, estimate, overCap }
}

export { runsDirectory }

export * as AsyncRunWorker from "./worker"
