import { Effect } from "effect"
import { Agent } from "@/agent/agent"
import { RunInfo, RunTask } from "./schema"

export interface ReviewInput {
  readonly run: typeof RunInfo.Type
  readonly task: typeof RunTask.Type
}

export function buildReviewPrompt(input: ReviewInput): string {
  const lines = [
    `You are reviewing async work for task "${input.task.title}".`,
    `Run ${input.run.id} based on commit ${input.run.baseCommit}.`,
    `Worktree: ${input.task.directory} (branch ${input.task.branch}).`,
    `Session: ${input.task.sessionID ?? "none"}.`,
    "",
    "Review the diff against the base commit and report:",
    "1. What changed (files and behavior).",
    "2. Test results or missing coverage.",
    "3. Risks, regressions, or follow-ups.",
    "Keep the verdict to one line: APPROVE, REQUEST_CHANGES, or NEEDS_TESTS.",
  ]
  return lines.join("\n")
}

export const reviewAgent = Effect.fn("AsyncRunReviewer.agent")(function* () {
  const agents = yield* Agent.Service
  const info = yield* agents.get("review").pipe(Effect.orElseSucceed(() => undefined))
  if (info) return info
  return yield* agents.defaultInfo()
})

export const buildReview = Effect.fn("AsyncRunReviewer.build")(function* (input: ReviewInput) {
  const agent = yield* reviewAgent()
  return { agent: agent.name, prompt: buildReviewPrompt(input) }
})

export * as AsyncRunReviewer from "./reviewer"
