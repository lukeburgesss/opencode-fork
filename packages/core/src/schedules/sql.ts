import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

// Runtime-created table (CREATE TABLE IF NOT EXISTS at service/handler init).
// Kept out of schema.gen/migrations so schedules stay an additive fork feature.
export const ScheduleTable = sqliteTable(
  "schedule",
  {
    id: text().primaryKey(),
    session_id: text(),
    prompt: text().notNull(),
    spec: text().notNull(),
    next_run_at: integer().notNull(),
    enabled: integer().notNull().default(1),
    time_created: integer()
      .notNull()
      .$default(() => Date.now()),
    time_updated: integer()
      .notNull()
      .$onUpdate(() => Date.now()),
  },
  (table) => [index("schedule_next_run_idx").on(table.enabled, table.next_run_at)],
)
