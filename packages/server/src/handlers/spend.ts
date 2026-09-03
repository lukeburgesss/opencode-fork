import { Database } from "@opencode-ai/core/database/database"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { and, gte, isNull } from "drizzle-orm"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { PaymentRequiredError, SessionNotFoundError, TooManyRequestsError } from "@opencode-ai/protocol/errors"
import type { SpendSummary } from "@opencode-ai/protocol/groups/spend"
import { Api } from "../api"

export function startOfDayMs(now = Date.now()) {
  const day = new Date(now)
  day.setHours(0, 0, 0, 0)
  return day.getTime()
}

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

type TokenTotals = {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  cost: number
}

export function toSpendSummary(totals: TokenTotals): SpendSummary {
  // Reasoning tokens are charged at output rates (see Session.getUsage), so fold them into output.
  const output = totals.output + totals.reasoning
  return {
    input: totals.input,
    output,
    cacheRead: totals.cacheRead,
    cacheWrite: totals.cacheWrite,
    totalTokens: totals.input + output + totals.cacheRead + totals.cacheWrite,
    costUSD: totals.cost,
  }
}

export const dailySpend = Effect.fn("Spend.daily")(function* () {
  const { db } = yield* Database.Service
  const rows = yield* db
    .select({
      tokens_input: SessionTable.tokens_input,
      tokens_output: SessionTable.tokens_output,
      tokens_reasoning: SessionTable.tokens_reasoning,
      tokens_cache_read: SessionTable.tokens_cache_read,
      tokens_cache_write: SessionTable.tokens_cache_write,
      cost: SessionTable.cost,
    })
    .from(SessionTable)
    .where(and(gte(SessionTable.time_updated, startOfDayMs()), isNull(SessionTable.time_archived)))
    .all()
    .pipe(Effect.orDie)
  return toSpendSummary({
    input: rows.reduce((sum, row) => sum + row.tokens_input, 0),
    output: rows.reduce((sum, row) => sum + row.tokens_output, 0),
    reasoning: rows.reduce((sum, row) => sum + row.tokens_reasoning, 0),
    cacheRead: rows.reduce((sum, row) => sum + row.tokens_cache_read, 0),
    cacheWrite: rows.reduce((sum, row) => sum + row.tokens_cache_write, 0),
    cost: rows.reduce((sum, row) => sum + row.cost, 0),
  })
})

// Prompt admission guard: kill-switch refuses with 429, blown daily cap with 402.
export const checkPromptAllowed = Effect.fn("Spend.checkPromptAllowed")(function* () {
  if (killSwitchEngaged())
    return yield* new TooManyRequestsError({ message: "Spend kill-switch engaged: prompts are disabled" })
  const cap = dailyCapUSD()
  if (cap === undefined) return
  const spend = yield* dailySpend()
  if (spend.costUSD >= cap)
    return yield* new PaymentRequiredError({
      message: `Daily spend cap exceeded: $${spend.costUSD.toFixed(2)} >= $${cap.toFixed(2)}`,
      costUSD: spend.costUSD,
      capUSD: cap,
    })
})

export const SpendHandler = HttpApiBuilder.group(Api, "server.spend", (handlers) =>
  Effect.gen(function* () {
    const session = yield* SessionV2.Service

    return handlers
      .handle(
        "spend.session",
        Effect.fn(function* (ctx) {
          const info = yield* session.get(ctx.params.id).pipe(
            Effect.catchTag(
              "Session.NotFoundError",
              (error) =>
                new SessionNotFoundError({
                  sessionID: error.sessionID,
                  message: `Session not found: ${error.sessionID}`,
                }),
            ),
          )
          return {
            data: toSpendSummary({
              input: info.tokens.input,
              output: info.tokens.output,
              reasoning: info.tokens.reasoning,
              cacheRead: info.tokens.cache.read,
              cacheWrite: info.tokens.cache.write,
              cost: info.cost,
            }),
          }
        }),
      )
      .handle(
        "spend.summary",
        Effect.fn(function* () {
          return { data: yield* dailySpend() }
        }),
      )
  }),
)
