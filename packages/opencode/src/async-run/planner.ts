import { Effect, Schema } from "effect"

export class DecompositionError extends Schema.TaggedErrorClass<DecompositionError>()(
  "AsyncRunDecompositionError",
  {
    message: Schema.String,
  },
) {}

export interface TaskHint {
  readonly title: string
  readonly files: ReadonlyArray<string>
}

export interface Subtask {
  readonly title: string
  readonly files: ReadonlyArray<string>
}

const normalize = (file: string) => file.trim().replace(/^\.\//, "").toLowerCase()

// Group hints so each group owns disjoint file domains. Hints whose files
// overlap are merged into one subtask: parallel workers must never share
// files, otherwise fan-out produces conflicting edits.
export function splitByDomains(hints: ReadonlyArray<TaskHint>): Subtask[] {
  const groups: Array<{ titles: Array<string>; files: Set<string> }> = []
  for (const hint of hints) {
    const files = new Set(hint.files.map(normalize).filter(Boolean))
    const target = groups.find((group) => [...files].some((file) => group.files.has(file)))
    if (!target) {
      groups.push({ titles: [hint.title], files })
      continue
    }
    target.titles.push(hint.title)
    for (const file of files) target.files.add(file)
  }
  return groups.map((group) => ({ title: group.titles.join(" + "), files: [...group.files].sort() }))
}

// True when fan-out is worthwhile: at least two subtasks with disjoint,
// non-empty file domains. Single-file or overlapping work stays serial.
export function shouldFanOut(subtasks: ReadonlyArray<Subtask>): boolean {
  const actionable = subtasks.filter((task) => task.files.length > 0)
  if (actionable.length < 2) return false
  const seen = new Set<string>()
  for (const task of actionable) {
    for (const file of task.files.map(normalize)) {
      if (seen.has(file)) return false
      seen.add(file)
    }
  }
  return true
}

export function decompositionPrompt(input: { task: string; files: ReadonlyArray<string> }): string {
  return [
    `Decompose this task into independent subtasks that can run in parallel: "${input.task}"`,
    "",
    "Rules:",
    "- Each subtask must own disjoint files. Never assign the same file to two subtasks.",
    "- Keep subtasks that touch the same file in ONE subtask.",
    "- Reply with a JSON array only, no prose:",
    '[{"title": "...", "files": ["path/one.ts"]}]',
    "",
    "Repository files (paths relative to repo root):",
    ...input.files.map((file) => `- ${file}`),
  ].join("\n")
}

const RawSubtask = Schema.Struct({
  title: Schema.NonEmptyString,
  files: Schema.Array(Schema.String),
})

export const parseDecomposition = Effect.fn("AsyncRunPlanner.parse")(function* (raw: string) {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = (fenced?.[1] ?? raw).trim()
  const start = candidate.indexOf("[")
  const end = candidate.lastIndexOf("]")
  if (start === -1 || end <= start)
    return yield* new DecompositionError({ message: "Model reply contained no JSON array" })
  const parsed: unknown = yield* Effect.try({
    try: () => JSON.parse(candidate.slice(start, end + 1)),
    catch: () => new DecompositionError({ message: "Model reply was not valid JSON" }),
  })
  const decoded = yield* Schema.decodeUnknownEffect(Schema.Array(RawSubtask))(parsed).pipe(
    Effect.mapError(() => new DecompositionError({ message: "Model reply did not match [{title, files}]" })),
  )
  return decoded.map((item) => ({ title: item.title, files: item.files.map(normalize).filter(Boolean) }))
})

export * as AsyncRunPlanner from "./planner"
