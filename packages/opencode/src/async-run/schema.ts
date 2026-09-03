import { Schema } from "effect"
import { ascending } from "@opencode-ai/schema/identifier"
import { statics } from "@opencode-ai/schema/schema"

export const RunID = Schema.String.check(Schema.isStartsWith("run")).pipe(
  Schema.brand("AsyncRunID"),
  statics((schema) => {
    const create = () => schema.make("run_" + ascending())
    return { create }
  }),
)
export type RunID = typeof RunID.Type

export const RunStatus = Schema.Literals(["pending", "running", "review", "merging", "done", "failed"])
export type RunStatus = typeof RunStatus.Type

export class RunTask extends Schema.Class<RunTask>("AsyncRunTask")({
  title: Schema.String,
  branch: Schema.String,
  directory: Schema.String,
  sessionID: Schema.optional(Schema.String),
  status: RunStatus,
  rounds: Schema.optional(Schema.Number),
}) {}
export type RunTaskType = typeof RunTask.Type

export const RunMode = Schema.Literals(["single", "parallel"])
export type RunMode = typeof RunMode.Type

export class RunInfo extends Schema.Class<RunInfo>("AsyncRunInfo")({
  id: RunID,
  baseCommit: Schema.String,
  directory: Schema.String,
  tasks: Schema.Array(RunTask),
  review: Schema.Boolean,
  createdAt: Schema.Number,
  mode: Schema.optional(RunMode),
  serial: Schema.optional(Schema.Boolean),
}) {}

export const taskRounds = (task: typeof RunTask.Type): number => task.rounds ?? 0
export const runMode = (info: typeof RunInfo.Type): typeof RunMode.Type => info.mode ?? "parallel"
export const runSerial = (info: typeof RunInfo.Type): boolean => info.serial ?? false

export * as AsyncRunSchema from "./schema"
