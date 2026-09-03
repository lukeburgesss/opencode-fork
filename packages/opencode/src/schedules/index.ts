import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { serviceUse } from "@opencode-ai/core/effect/service-use"
import { Database } from "@opencode-ai/core/database/database"
import { SessionV2 } from "@opencode-ai/core/session"
import { ScheduleTable } from "@opencode-ai/core/schedules/sql"
import { nextFire, parseSchedule, ScheduleSpecError } from "@opencode-ai/core/schedules/parser"
import { NotFoundError } from "@/storage/storage"
import { SessionID } from "@/session/schema"
import { killSwitchEngaged } from "@/spend/spend"
import { and, desc, eq, lte, sql } from "drizzle-orm"
import { Cause, Context, Duration, Effect, Layer, Option, Schedule, Schema } from "effect"

export class InvalidScheduleError extends Schema.TaggedErrorClass<InvalidScheduleError>()(
  "Schedules.InvalidScheduleError",
  { spec: Schema.String },
) {}

export interface Info {
  id: string
  sessionID?: string
  prompt: string
  spec: string
  nextRunAt: number
  enabled: boolean
}

function fromRow(row: typeof ScheduleTable.$inferSelect): Info {
  return {
    id: row.id,
    sessionID: row.session_id ?? undefined,
    prompt: row.prompt,
    spec: row.spec,
    nextRunAt: row.next_run_at,
    enabled: row.enabled === 1,
  }
}

export interface Interface {
  readonly create: (input: {
    sessionID?: string
    prompt: string
    spec: string
  }) => Effect.Effect<Info, InvalidScheduleError>
  readonly list: () => Effect.Effect<Info[]>
  readonly remove: (id: string) => Effect.Effect<void, NotFoundError>
  readonly fireDue: () => Effect.Effect<number>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Schedules") {}

export const use = serviceUse(Service)

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db
      .run(
        sql`CREATE TABLE IF NOT EXISTS schedule (id TEXT PRIMARY KEY, session_id TEXT, prompt TEXT NOT NULL, spec TEXT NOT NULL, next_run_at INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL)`,
      )
      .pipe(Effect.orDie)

    const create = Effect.fn("Schedules.create")(function* (input: {
      sessionID?: string
      prompt: string
      spec: string
    }) {
      if (!input.prompt.trim()) return yield* new InvalidScheduleError({ spec: input.spec })
      const schedule = yield* Effect.try({
        try: () => parseSchedule(input.spec),
        catch: () => new InvalidScheduleError({ spec: input.spec }),
      })
      const now = Date.now()
      const row = {
        id: `sch_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`,
        session_id: input.sessionID ?? null,
        prompt: input.prompt,
        spec: input.spec,
        next_run_at: nextFire(schedule, now),
        enabled: 1,
        time_created: now,
        time_updated: now,
      }
      yield* db.insert(ScheduleTable).values(row).run().pipe(Effect.orDie)
      return fromRow(row)
    })

    const list = Effect.fn("Schedules.list")(function* () {
      const rows = yield* db
        .select()
        .from(ScheduleTable)
        .orderBy(desc(ScheduleTable.next_run_at))
        .all()
        .pipe(Effect.orDie)
      return rows.map(fromRow)
    })

    const remove = Effect.fn("Schedules.remove")(function* (id: string) {
      const existing = yield* db.select().from(ScheduleTable).where(eq(ScheduleTable.id, id)).get().pipe(Effect.orDie)
      if (!existing) return yield* Effect.fail(new NotFoundError({ message: `Schedule not found: ${id}` }))
      yield* db.delete(ScheduleTable).where(eq(ScheduleTable.id, id)).run().pipe(Effect.orDie)
    })

    const fireDue = Effect.fn("Schedules.fireDue")(function* () {
      // Kill-switch is enforced here too so scheduled fires stop even though
      // they bypass HTTP prompt admission (where the daily cap is enforced).
      if (killSwitchEngaged()) return 0
      // Optional: the runner idles in runtimes without SessionV2 (e.g. bare
      // CLI workers) instead of adding a hard layer dependency. Due rows keep
      // their next_run_at and fire once a full runtime provides sessions.
      const maybeSession = yield* Effect.serviceOption(SessionV2.Service)
      if (Option.isNone(maybeSession)) {
        yield* Effect.logDebug("schedules idle without SessionV2")
        return 0
      }
      const session = maybeSession.value
      const now = Date.now()
      const due = yield* db
        .select()
        .from(ScheduleTable)
        .where(and(eq(ScheduleTable.enabled, 1), lte(ScheduleTable.next_run_at, now)))
        .all()
        .pipe(Effect.orDie)
      let fired = 0
      for (const row of due) {
        const schedule = yield* Effect.try({
          try: () => parseSchedule(row.spec),
          catch: () => new ScheduleSpecError(row.spec),
        }).pipe(Effect.orElseSucceed(() => undefined))
        // Reschedule even when the spec no longer parses so one bad row
        // cannot wedge the runner; failures are logged per row below.
        const next = schedule ? nextFire(schedule, Date.now()) : Date.now() + 3_600_000
        yield* db
          .update(ScheduleTable)
          .set({ next_run_at: next, time_updated: Date.now() })
          .where(eq(ScheduleTable.id, row.id))
          .run()
          .pipe(Effect.orDie)
        const sessionID = row.session_id
        if (!schedule || !sessionID) {
          yield* Effect.logWarning("skipping unfireable schedule", { scheduleID: row.id, spec: row.spec })
          continue
        }
        yield* Effect.gen(function* () {
          yield* session.prompt({ sessionID: SessionID.make(sessionID), prompt: { text: row.prompt } })
          fired += 1
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("scheduled prompt failed", { scheduleID: row.id, cause: Cause.pretty(cause) }),
          ),
        )
      }
      return fired
    })

    yield* fireDue().pipe(
      Effect.catchCause((cause) => Effect.logError("schedule runner failed", { cause: Cause.pretty(cause) })),
      Effect.repeat(Schedule.spaced(Duration.seconds(30))),
      Effect.delay(Duration.seconds(10)),
      Effect.forkScoped,
    )

    return Service.of({ create, list, remove, fireDue })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [Database.node] })

export * as Schedules from "."
