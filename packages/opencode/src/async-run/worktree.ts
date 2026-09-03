import { Effect, Schema, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import * as FileSystem from "effect/FileSystem"
import * as Path from "effect/Path"

export class WorktreeError extends Schema.TaggedErrorClass<WorktreeError>()("AsyncRunWorktreeError", {
  message: Schema.String,
}) {}

type GitResult = { code: number; text: string; stderr: string }

const git = Effect.fnUntraced(
  function* (args: Array<string>, cwd: string) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const handle = yield* spawner.spawn(ChildProcess.make("git", args, { cwd, extendEnv: true, stdin: "ignore" }))
    const [text, stderr] = yield* Effect.all(
      [Stream.mkString(Stream.decodeText(handle.stdout)), Stream.mkString(Stream.decodeText(handle.stderr))],
      { concurrency: 2 },
    )
    const code = yield* handle.exitCode
    return { code, text, stderr } satisfies GitResult
  },
  Effect.scoped,
  Effect.catch(() => Effect.succeed({ code: 1, text: "", stderr: "" } satisfies GitResult)),
)

export const baseCommit = Effect.fn("AsyncRunWorktree.baseCommit")(function* (directory: string) {
  const result = yield* git(["rev-parse", "HEAD"], directory)
  const commit = result.text.trim()
  if (result.code !== 0 || !commit) return yield* new WorktreeError({ message: `Failed to read base commit in ${directory}` })
  return commit
})

export const add = Effect.fn("AsyncRunWorktree.add")(function* (input: {
  repo: string
  path: string
  branch: string
  base: string
}) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  yield* fs.makeDirectory(path.dirname(input.path), { recursive: true }).pipe(
    Effect.mapError((cause) => new WorktreeError({ message: String(cause) })),
  )
  const result = yield* git(["worktree", "add", "-b", input.branch, input.path, input.base], input.repo)
  if (result.code !== 0)
    return yield* new WorktreeError({
      message: result.stderr.trim() || result.text.trim() || `git worktree add failed for ${input.path}`,
    })
  return input.path
})

export const remove = Effect.fn("AsyncRunWorktree.remove")(function* (input: { repo: string; path: string }) {
  const result = yield* git(["worktree", "remove", "--force", input.path], input.repo)
  if (result.code !== 0)
    return yield* new WorktreeError({
      message: result.stderr.trim() || result.text.trim() || `git worktree remove failed for ${input.path}`,
    })
})

export class MergeConflict extends Schema.TaggedErrorClass<MergeConflict>()("AsyncRunMergeConflict", {
  branch: Schema.String,
  output: Schema.String,
}) {}

// Stage everything and commit inside a worker worktree. No-op when clean.
export const commitAll = Effect.fn("AsyncRunWorktree.commitAll")(function* (input: {
  dir: string
  message: string
}) {
  const status = yield* git(["status", "--porcelain"], input.dir)
  if (status.code !== 0) return yield* new WorktreeError({ message: status.stderr.trim() || "git status failed" })
  if (!status.text.trim()) return false
  const add = yield* git(["add", "-A"], input.dir)
  if (add.code !== 0) return yield* new WorktreeError({ message: add.stderr.trim() || "git add failed" })
  const commit = yield* git(["commit", "-m", input.message], input.dir)
  if (commit.code !== 0) return yield* new WorktreeError({ message: commit.stderr.trim() || "git commit failed" })
  return true
})

// Merge a worker branch into the repo checkout. Returns "merged", or fails
// with MergeConflict (leaving the repo clean via --abort) for escalation.
export const merge = Effect.fn("AsyncRunWorktree.merge")(function* (input: { repo: string; branch: string }) {
  const result = yield* git(["merge", "--no-ff", "--no-edit", input.branch], input.repo)
  if (result.code === 0) return "merged" as const
  yield* git(["merge", "--abort"], input.repo)
  return yield* new MergeConflict({ branch: input.branch, output: (result.stderr + result.text).trim() })
})

export const diffStat = Effect.fn("AsyncRunWorktree.diffStat")(function* (input: {
  repo: string
  base: string
  branch: string
}) {
  const result = yield* git(["diff", "--stat", `${input.base}...${input.branch}`], input.repo)
  if (result.code !== 0) return yield* new WorktreeError({ message: result.stderr.trim() || "git diff failed" })
  return result.text.trim()
})

export * as AsyncRunWorktree from "./worktree"
