import { Effect, Schema } from "effect"
import * as FileSystem from "effect/FileSystem"
import * as Path from "effect/Path"

export class RunLogError extends Schema.TaggedErrorClass<RunLogError>()("AsyncRunLogError", {
  message: Schema.String,
}) {}

// Write-ahead log: intents are appended BEFORE the action executes, so a
// killed run can resume exactly the pending work. Completions reference the
// same action+task pair.
export const RunEventKind = Schema.Literals(["intent", "complete"])
export type RunEventKind = typeof RunEventKind.Type

export class RunEvent extends Schema.Class<RunEvent>("AsyncRunEvent")({
  seq: Schema.Number,
  at: Schema.Number,
  kind: RunEventKind,
  action: Schema.String,
  task: Schema.optional(Schema.String),
  detail: Schema.optional(Schema.String),
}) {}

const logFile = Effect.fn("AsyncRunLog.file")(function* (directory: string, runID: string) {
  const path = yield* Path.Path
  return path.join(directory, ".opencode", "async-runs", runID, "events.log")
})

export const append = Effect.fn("AsyncRunLog.append")(function* (input: {
  directory: string
  runID: string
  kind: typeof RunEventKind.Type
  action: string
  task?: string
  detail?: string
}) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const file = yield* logFile(input.directory, input.runID)
  yield* fs.makeDirectory(path.dirname(file), { recursive: true }).pipe(
    Effect.mapError((cause) => new RunLogError({ message: String(cause) })),
  )
  const existing = yield* read({ directory: input.directory, runID: input.runID })
  const event = new RunEvent({
    seq: existing.length,
    at: Date.now(),
    kind: input.kind,
    action: input.action,
    task: input.task,
    detail: input.detail,
  })
  yield* fs
    .writeFileString(file, JSON.stringify(event) + "\n", { flag: "a" })
    .pipe(Effect.mapError((cause) => new RunLogError({ message: String(cause) })))
  return event
})

export const read = Effect.fn("AsyncRunLog.read")(function* (input: { directory: string; runID: string }) {
  const fs = yield* FileSystem.FileSystem
  const raw = yield* fs.readFileString(yield* logFile(input.directory, input.runID)).pipe(
    Effect.orElseSucceed(() => ""),
  )
  const lines = raw.split("\n").filter(Boolean)
  return yield* Effect.forEach(lines, (line) =>
    Schema.decodeEffect(Schema.fromJsonString(RunEvent))(line).pipe(
      Effect.mapError((cause) => new RunLogError({ message: String(cause) })),
    ),
  )
})

// Intents with no matching completion: the exact resume set after a crash.
export function pendingIntents(events: ReadonlyArray<typeof RunEvent.Type>): Array<typeof RunEvent.Type> {
  const done = new Set(events.filter((e) => e.kind === "complete").map((e) => `${e.action}::${e.task ?? ""}`))
  return events.filter((e) => e.kind === "intent" && !done.has(`${e.action}::${e.task ?? ""}`))
}

export function formatReplay(events: ReadonlyArray<typeof RunEvent.Type>): Array<string> {
  return events.map((e) => {
    const mark = e.kind === "intent" ? "…" : "✓"
    const task = e.task ? ` [${e.task}]` : ""
    const detail = e.detail ? ` — ${e.detail}` : ""
    return `${mark} ${e.action}${task}${detail}`
  })
}

export * as AsyncRunLog from "./log"
