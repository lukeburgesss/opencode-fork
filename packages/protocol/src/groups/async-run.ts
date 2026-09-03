import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { UnknownError } from "../errors"

export const AsyncRunID = Schema.String.pipe(Schema.brand("AsyncRunID"))
export type AsyncRunID = typeof AsyncRunID.Type

export const AsyncRunTask = Schema.Struct({
  title: Schema.String,
  branch: Schema.String,
  directory: Schema.String,
  sessionID: Schema.optional(Schema.String),
  status: Schema.Literals(["pending", "running", "done", "failed"]),
}).annotate({ identifier: "AsyncRunTask" })
export type AsyncRunTask = typeof AsyncRunTask.Type

export const AsyncRunInfo = Schema.Struct({
  id: AsyncRunID,
  baseCommit: Schema.String,
  directory: Schema.String,
  tasks: Schema.Array(AsyncRunTask),
  review: Schema.Boolean,
  createdAt: Schema.Number,
}).annotate({ identifier: "AsyncRunInfo" })
export type AsyncRunInfo = typeof AsyncRunInfo.Type

export class RunNotFoundError extends Schema.TaggedErrorClass<RunNotFoundError>()(
  "RunNotFoundError",
  {
    runID: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 404 },
) {}

// Muse-style async runs: one git worktree per task, optional reviewer agent.
export const AsyncRunGroup = HttpApiGroup.make("server.asyncRun")
  .add(
    HttpApiEndpoint.post("asyncRun.create", "/api/async-run", {
      payload: Schema.Struct({
        tasks: Schema.Array(Schema.String),
        review: Schema.Boolean.pipe(Schema.optional),
      }),
      success: Schema.Struct({ data: AsyncRunInfo }),
      error: UnknownError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.asyncRun.create",
        summary: "Create async run",
        description: "Record a base commit and create one worktree per task.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("asyncRun.list", "/api/async-run", {
      success: Schema.Struct({ data: Schema.Array(AsyncRunInfo) }),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.asyncRun.list",
        summary: "List async runs",
        description: "List async runs recorded for the current directory.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("asyncRun.get", "/api/async-run/:runID", {
      params: { runID: AsyncRunID },
      success: Schema.Struct({ data: AsyncRunInfo }),
      error: RunNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.asyncRun.get",
        summary: "Get async run",
        description: "Retrieve an async run by ID.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("asyncRun.replay", "/api/async-run/:runID/replay", {
      params: { runID: AsyncRunID },
      success: Schema.Struct({ data: Schema.Array(Schema.String) }),
      error: RunNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.asyncRun.replay",
        summary: "Replay async run",
        description: "Read durable session event history for each task and print the step log.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "async runs",
      description: "Experimental Muse-style async run routes.",
    }),
  )
