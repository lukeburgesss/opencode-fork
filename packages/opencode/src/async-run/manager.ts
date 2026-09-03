import { Effect, Schema } from "effect"
import * as FileSystem from "effect/FileSystem"
import * as Path from "effect/Path"
import { RunID, RunInfo, RunTask } from "./schema"
import { add, baseCommit } from "./worktree"

export class ManagerError extends Schema.TaggedErrorClass<ManagerError>()("AsyncRunManagerError", {
  message: Schema.String,
}) {}

export const runsDirectory = Effect.fn("AsyncRunManager.runsDirectory")(function* (directory: string) {
  const path = yield* Path.Path
  return path.join(directory, ".opencode", "async-runs")
})

export const runFile = Effect.fn("AsyncRunManager.runFile")(function* (directory: string, id: typeof RunID.Type) {
  const path = yield* Path.Path
  return path.join(yield* runsDirectory(directory), `${id}.json`)
})

const slugify = (input: string) =>
  input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .slice(0, 40) || "task"

export const create = Effect.fn("AsyncRunManager.create")(function* (input: {
  directory: string
  tasks: ReadonlyArray<string>
  review: boolean
  serial?: boolean
}) {
  if (input.tasks.length === 0) return yield* new ManagerError({ message: "At least one task is required" })
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const base = yield* baseCommit(input.directory).pipe(
    Effect.mapError((cause) => new ManagerError({ message: cause.message })),
  )
  const id = RunID.create()
  const created = input.tasks.map((title, index) => {
    const slug = slugify(title)
    return new RunTask({
      title,
      branch: `async/${slug}-${index}`,
      directory: path.join(input.directory, ".opencode", "async-runs", id, slug),
      status: "pending" as const,
    })
  })
  const info = new RunInfo({
    id,
    baseCommit: base,
    directory: input.directory,
    tasks: created,
    review: input.review,
    createdAt: Date.now(),
    mode: input.serial === true || created.length < 2 ? "single" : "parallel",
    serial: input.serial ?? false,
  })
  yield* fs.makeDirectory(yield* runsDirectory(input.directory), { recursive: true }).pipe(
    Effect.mapError((cause) => new ManagerError({ message: String(cause) })),
  )
  const encoded = yield* Schema.encodeEffect(RunInfo)(info).pipe(
    Effect.mapError((cause) => new ManagerError({ message: String(cause) })),
  )
  yield* fs.writeFileString(yield* runFile(input.directory, id), JSON.stringify(encoded, null, 2)).pipe(
    Effect.mapError((cause) => new ManagerError({ message: String(cause) })),
  )
  if (info.serial) return { info, worktrees: [] as Array<string> }
  const tasks = yield* Effect.forEach(created, (task) =>
    add({ repo: input.directory, path: task.directory, branch: task.branch, base }).pipe(
      Effect.mapError((cause) => new ManagerError({ message: cause.message })),
    ),
  )
  return { info, worktrees: tasks }
})

export const get = Effect.fn("AsyncRunManager.get")(function* (input: { directory: string; id: string }) {
  const fs = yield* FileSystem.FileSystem
  const raw = yield* fs.readFileString(yield* runFile(input.directory, RunID.make(input.id))).pipe(
    Effect.mapError((cause) => new ManagerError({ message: String(cause) })),
  )
  return yield* Schema.decodeEffect(Schema.fromJsonString(RunInfo))(raw).pipe(
    Effect.mapError((cause) => new ManagerError({ message: String(cause) })),
  )
})

export const list = Effect.fn("AsyncRunManager.list")(function* (directory: string) {
  const fs = yield* FileSystem.FileSystem
  const dir = yield* runsDirectory(directory)
  const entries = yield* fs.readDirectory(dir).pipe(Effect.orElseSucceed(() => []))
  const files = entries.filter((entry) => entry.endsWith(".json"))
  return yield* Effect.forEach(files, (entry) =>
    get({ directory, id: entry.slice(0, -".json".length) }).pipe(Effect.orElseSucceed(() => undefined)),
  ).pipe(Effect.map((runs) => runs.filter((run) => run !== undefined)))
})

export * as AsyncRunManager from "./manager"
