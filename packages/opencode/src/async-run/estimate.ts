// Pre-spawn fan-out estimate: workers x observed cost x review passes.
// Used for the cost guard (spend-cap check) and the "this will cost ~X"
// line before fanning out. Pure math, no services.
export const MAX_WORKERS = 8
export const AVG_TOKENS_PER_TURN = 12_000
export const TURNS_PER_TASK = 8

export interface FanOutInput {
  readonly tasks: number
  readonly avgTokensPerTurn?: number
  readonly turnsPerTask?: number
  readonly reviewPasses?: number
  readonly usdPerMTok?: number
  readonly cpuCount?: number
}

export interface FanOutEstimate {
  readonly workers: number
  readonly tokens: number
  readonly usd: number
}

// Workers are capped at min(cpu-2, MAX_WORKERS), at least 1. Depth is
// always one level: workers never spawn workers.
export function workerCount(input: { tasks: number; cpuCount?: number }): number {
  const cpu = input.cpuCount ?? 8
  return Math.max(1, Math.min(input.tasks, MAX_WORKERS, cpu - 2))
}

export function estimateFanOut(input: FanOutInput): FanOutEstimate {
  const workers = workerCount({ tasks: input.tasks, cpuCount: input.cpuCount })
  const perTurn = input.avgTokensPerTurn ?? AVG_TOKENS_PER_TURN
  const turns = input.turnsPerTask ?? TURNS_PER_TASK
  const passes = 1 + (input.reviewPasses ?? 1)
  const tokens = Math.round(workers * perTurn * turns * passes)
  const usd = (tokens / 1_000_000) * (input.usdPerMTok ?? 3)
  return { workers, tokens, usd: Math.round(usd * 100) / 100 }
}

export * as AsyncRunEstimate from "./estimate"
