// Token/cost aggregation and spend-guardrail config.
// Pure and dependency-free: session rows (SessionTable token columns) and
// assistant message token fields share the same shape, summed here.

// Spend caps config. Env-based so no config-schema migration is needed:
// OPENCODE_SPEND_DAILY_CAP_USD (unset/0 = unlimited), OPENCODE_SPEND_KILL_SWITCH (1/true = refuse prompts).
export function killSwitchEngaged() {
  const raw = process.env.OPENCODE_SPEND_KILL_SWITCH?.toLowerCase()
  return raw === "1" || raw === "true"
}

export function dailyCapUSD() {
  const raw = Number(process.env.OPENCODE_SPEND_DAILY_CAP_USD)
  return Number.isFinite(raw) && raw > 0 ? raw : undefined
}

export interface TokenUsage {
  input?: number
  output?: number
  reasoning?: number
  cacheRead?: number
  cacheWrite?: number
  cost?: number
}

export interface SpendSummary {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  totalTokens: number
  costUSD: number
}

export function empty(): SpendSummary {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, costUSD: 0 }
}

// Reasoning tokens are charged at output rates (see Session.getUsage), so fold them into output.
export function summarizeUsages(usages: Iterable<TokenUsage>): SpendSummary {
  const summary = empty()
  for (const usage of usages) {
    const output = (usage.output ?? 0) + (usage.reasoning ?? 0)
    summary.input += usage.input ?? 0
    summary.output += output
    summary.cacheRead += usage.cacheRead ?? 0
    summary.cacheWrite += usage.cacheWrite ?? 0
    summary.costUSD += usage.cost ?? 0
  }
  summary.totalTokens = summary.input + summary.output + summary.cacheRead + summary.cacheWrite
  return summary
}

// Assistant message token fields ({tokens: {input, output, reasoning, cache: {read, write}}, cost}).
export function summarizeMessages(
  messages: Iterable<{ tokens?: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }; cost?: number }>,
): SpendSummary {
  return summarizeUsages(
    Array.from(messages, (message) => ({
      input: message.tokens?.input ?? 0,
      output: message.tokens?.output ?? 0,
      reasoning: message.tokens?.reasoning ?? 0,
      cacheRead: message.tokens?.cache.read ?? 0,
      cacheWrite: message.tokens?.cache.write ?? 0,
      cost: message.cost ?? 0,
    })),
  )
}

// SessionTable token columns ({tokens_input, tokens_output, ...}).
export function summarizeRows(
  rows: Iterable<{
    tokens_input: number
    tokens_output: number
    tokens_reasoning: number
    tokens_cache_read: number
    tokens_cache_write: number
    cost: number
  }>,
): SpendSummary {
  return summarizeUsages(
    Array.from(rows, (row) => ({
      input: row.tokens_input,
      output: row.tokens_output,
      reasoning: row.tokens_reasoning,
      cacheRead: row.tokens_cache_read,
      cacheWrite: row.tokens_cache_write,
      cost: row.cost,
    })),
  )
}

export function add(left: SpendSummary, right: SpendSummary): SpendSummary {
  return summarizeUsages([
    { input: left.input, output: left.output, cacheRead: left.cacheRead, cacheWrite: left.cacheWrite, cost: left.costUSD },
    { input: right.input, output: right.output, cacheRead: right.cacheRead, cacheWrite: right.cacheWrite, cost: right.costUSD },
  ])
}

export type SpendCheck = "ok" | "kill-switch" | "cap-exceeded"

export function checkSpend(summary: SpendSummary): SpendCheck {
  if (killSwitchEngaged()) return "kill-switch"
  const cap = dailyCapUSD()
  if (cap !== undefined && summary.costUSD >= cap) return "cap-exceeded"
  return "ok"
}

export * as Spend from "./spend"
