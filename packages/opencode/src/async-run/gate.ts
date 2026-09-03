import { Effect, Schema } from "effect"
import { append } from "./log"

export class GateError extends Schema.TaggedErrorClass<GateError>()("AsyncRunGateError", {
  message: Schema.String,
}) {}

// Reviewer verdicts. The model replies with one of these lines (see
// reviewer.ts buildReviewPrompt); anything else escalates to a human.
export const ReviewVerdict = Schema.Literals(["APPROVE", "REQUEST_CHANGES", "NEEDS_TESTS"])
export type ReviewVerdict = typeof ReviewVerdict.Type

export type GateDecision = "merge" | "retry" | "escalate"

export const MAX_REVIEW_ROUNDS = 2

// Pure gate: approve/needs-tests-with-evidence merges, request-changes
// retries until the round cap, then a human decides.
export function decide(input: { verdict: typeof ReviewVerdict.Type; round: number }): GateDecision {
  if (input.verdict === "APPROVE") return "merge"
  if (input.round >= MAX_REVIEW_ROUNDS) return "escalate"
  return "retry"
}

export function parseVerdict(text: string): typeof ReviewVerdict.Type | undefined {
  const upper = text.toUpperCase()
  if (upper.includes("REQUEST_CHANGES")) return "REQUEST_CHANGES"
  if (upper.includes("NEEDS_TESTS")) return "NEEDS_TESTS"
  if (upper.includes("APPROVE")) return "APPROVE"
  return undefined
}

export function reviewPromptWithDiff(input: { prompt: string; diffStat: string }): string {
  return [
    input.prompt,
    "",
    "Diff against base (--stat):",
    input.diffStat || "(empty — worker produced no changes)",
  ].join("\n")
}

// Record a gate decision in the write-ahead log before acting on it.
export const recordDecision = Effect.fn("AsyncRunGate.record")(function* (input: {
  directory: string
  runID: string
  task: string
  verdict: typeof ReviewVerdict.Type
  decision: GateDecision
  round: number
}) {
  yield* append({
    directory: input.directory,
    runID: input.runID,
    kind: "complete",
    action: "review",
    task: input.task,
    detail: `${input.verdict} -> ${input.decision} (round ${input.round})`,
  }).pipe(Effect.mapError((cause) => new GateError({ message: cause.message })))
})

export * as AsyncRunGate from "./gate"
