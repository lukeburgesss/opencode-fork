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

export const RunStatus = Schema.Literals(["pending", "running", "done", "failed"])
export type RunStatus = typeof RunStatus.Type

export class RunTask extends Schema.Class<RunTask>("AsyncRunTask")({
  title: Schema.String,
  branch: Schema.String,
  directory: Schema.String,
  sessionID: Schema.optional(Schema.String),
  status: RunStatus,
}) {}
export type RunTaskType = typeof RunTask.Type

export class RunInfo extends Schema.Class<RunInfo>("AsyncRunInfo")({
  id: RunID,
  baseCommit: Schema.String,
  directory: Schema.String,
  tasks: Schema.Array(RunTask),
  review: Schema.Boolean,
  createdAt: Schema.Number,
}) {}

export * as AsyncRunSchema from "./schema"
