import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { InvalidRequestError } from "../errors"

export const ScheduleInfo = Schema.Struct({
  id: Schema.String,
  sessionID: Schema.optional(Schema.String),
  prompt: Schema.String,
  spec: Schema.String,
  nextRunAt: Schema.Number,
  enabled: Schema.Boolean,
}).annotate({ identifier: "ScheduleInfo" })
export type ScheduleInfo = typeof ScheduleInfo.Type

export const ScheduleGroup = HttpApiGroup.make("server.schedules")
  .add(
    HttpApiEndpoint.post("schedules.create", "/api/schedules", {
      payload: Schema.Struct({
        sessionID: Schema.optional(Schema.String),
        prompt: Schema.String,
        spec: Schema.String,
      }),
      success: Schema.Struct({ data: ScheduleInfo }),
      error: InvalidRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.schedules.create",
        summary: "Create schedule",
        description:
          "Create a prompt schedule. Spec is interval ('every 30m', 'every 2h') or daily time ('daily 09:30'). Fires SessionV2.prompt on schedule.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("schedules.list", "/api/schedules", {
      success: Schema.Struct({ data: Schema.Array(ScheduleInfo) }),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.schedules.list",
        summary: "List schedules",
        description: "List stored prompt schedules.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("schedules.delete", "/api/schedules/:scheduleID", {
      params: Schema.Struct({ scheduleID: Schema.String }),
      success: HttpApiSchema.NoContent,
      error: InvalidRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.schedules.delete",
        summary: "Delete schedule",
        description: "Delete a prompt schedule by ID.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "schedules",
      description: "Prompt schedule routes.",
    }),
  )
