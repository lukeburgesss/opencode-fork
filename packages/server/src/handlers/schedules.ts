import { Database } from "@opencode-ai/core/database/database"
import { ScheduleTable } from "@opencode-ai/core/schedules/sql"
import { parseSchedule, nextFire, ScheduleSpecError } from "@opencode-ai/core/schedules/parser"
import { desc, eq, sql } from "drizzle-orm"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { InvalidRequestError } from "@opencode-ai/protocol/errors"
import type { ScheduleInfo } from "@opencode-ai/protocol/groups/schedules"
import { Api } from "../api"

function toInfo(row: typeof ScheduleTable.$inferSelect): ScheduleInfo {
  return {
    id: row.id,
    sessionID: row.session_id ?? undefined,
    prompt: row.prompt,
    spec: row.spec,
    nextRunAt: row.next_run_at,
    enabled: row.enabled === 1,
  }
}

const ensureTable = Effect.fn("Schedules.ensureTable")(function* () {
  const { db } = yield* Database.Service
  yield* db
    .run(
      sql`CREATE TABLE IF NOT EXISTS schedule (id TEXT PRIMARY KEY, session_id TEXT, prompt TEXT NOT NULL, spec TEXT NOT NULL, next_run_at INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL)`,
    )
    .pipe(Effect.orDie)
})

export const SchedulesHandler = HttpApiBuilder.group(Api, "server.schedules", (handlers) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* ensureTable()

    return handlers
      .handle(
        "schedules.create",
        Effect.fn(function* (ctx) {
          if (!ctx.payload.prompt.trim())
            return yield* new InvalidRequestError({ message: "prompt must not be empty", field: "prompt" })
          const schedule = yield* Effect.try({
            try: () => parseSchedule(ctx.payload.spec),
            catch: (cause) =>
              new InvalidRequestError({
                message: cause instanceof ScheduleSpecError ? cause.message : `Invalid schedule spec`,
                field: "spec",
              }),
          })
          const now = Date.now()
          const row = {
            id: `sch_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`,
            session_id: ctx.payload.sessionID ?? null,
            prompt: ctx.payload.prompt,
            spec: ctx.payload.spec,
            next_run_at: nextFire(schedule, now),
            enabled: 1,
            time_created: now,
            time_updated: now,
          }
          yield* db.insert(ScheduleTable).values(row).run().pipe(Effect.orDie)
          return { data: toInfo(row) }
        }),
      )
      .handle(
        "schedules.list",
        Effect.fn(function* () {
          const rows = yield* db.select().from(ScheduleTable).orderBy(desc(ScheduleTable.next_run_at)).all().pipe(Effect.orDie)
          return { data: rows.map(toInfo) }
        }),
      )
      .handle(
        "schedules.delete",
        Effect.fn(function* (ctx) {
          const existing = yield* db
            .select()
            .from(ScheduleTable)
            .where(eq(ScheduleTable.id, ctx.params.scheduleID))
            .get()
            .pipe(Effect.orDie)
          if (!existing)
            return yield* new InvalidRequestError({ message: `Schedule not found: ${ctx.params.scheduleID}` })
          yield* db.delete(ScheduleTable).where(eq(ScheduleTable.id, ctx.params.scheduleID)).run().pipe(Effect.orDie)
          return HttpApiSchema.NoContent.make()
        }),
      )
  }),
)
