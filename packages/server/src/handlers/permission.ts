import { Location } from "@opencode-ai/core/location"
import { ApprovalQueue } from "@opencode-ai/core/approvals/queue"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { PermissionSaved } from "@opencode-ai/core/permission/saved"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"
import { PermissionNotFoundError, SessionNotFoundError } from "@opencode-ai/protocol/errors"
import { response } from "../location"
import { bridgePermission, listJobs, missing, resolveDeviceID, toProtocol } from "./approval"

function missingRequest(id: PermissionV2.ID) {
  return new PermissionNotFoundError({ requestID: id, message: `Permission request not found: ${id}` })
}

export const PermissionHandler = HttpApiBuilder.group(Api, "server.permission", (handlers) =>
  Effect.gen(function* () {
    const queue = yield* ApprovalQueue.Service
    return handlers
      .handle(
        "permission.request.list",
        Effect.fn(function* () {
          return yield* response((yield* PermissionV2.Service).list())
        }),
      )
      .handle(
        "session.permission.create",
        Effect.fn(function* (ctx) {
          const permission = yield* PermissionV2.Service
          return {
            data: yield* permission
              .ask({
                id: ctx.payload.id,
                sessionID: ctx.params.sessionID,
                action: ctx.payload.action,
                resources: ctx.payload.resources,
                save: ctx.payload.save,
                metadata: ctx.payload.metadata,
                source: ctx.payload.source,
                agent: ctx.payload.agent,
              })
              .pipe(
                Effect.catchTag(
                  "Session.NotFoundError",
                  (error) =>
                    new SessionNotFoundError({
                      sessionID: error.sessionID,
                      message: `Session not found: ${error.sessionID}`,
                    }),
                ),
              ),
          }
        }),
      )
      .handle(
        "session.permission.list",
        Effect.fn(function* (ctx) {
          const permission = yield* PermissionV2.Service
          return { data: yield* permission.forSession(ctx.params.sessionID) }
        }),
      )
      .handle(
        "session.permission.get",
        Effect.fn(function* (ctx) {
          const request = yield* (yield* PermissionV2.Service).get(ctx.params.requestID)
          if (!request || request.sessionID !== ctx.params.sessionID) return yield* missingRequest(ctx.params.requestID)
          return { data: request }
        }),
      )
      .handle(
        "session.permission.reply",
        Effect.fn(function* (ctx) {
          const permission = yield* PermissionV2.Service
          const request = yield* permission.get(ctx.params.requestID)
          if (!request || request.sessionID !== ctx.params.sessionID) return yield* missingRequest(ctx.params.requestID)
          yield* permission
            .reply({ requestID: ctx.params.requestID, reply: ctx.payload.reply, message: ctx.payload.message })
            .pipe(Effect.catchTag("PermissionV2.NotFoundError", () => missingRequest(ctx.params.requestID)))
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "permission.saved.list",
        Effect.fn(function* (ctx) {
          const location = yield* Location.Service
          return {
            data: yield* (yield* PermissionSaved.Service).list({
              projectID: ctx.query.projectID ?? location.project.id,
            }),
          }
        }),
      )
      .handle(
        "permission.saved.remove",
        Effect.fn(function* (ctx) {
          yield* (yield* PermissionSaved.Service).remove(ctx.params.id)
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "approval.request",
        Effect.fn(function* (ctx) {
          const info = yield* queue.request({
            ...(ctx.payload.sessionID ? { sessionID: ctx.payload.sessionID } : {}),
            action: ctx.payload.action,
            resources: [...ctx.payload.resources],
            ...(ctx.payload.timeout_ms !== undefined ? { timeout_ms: ctx.payload.timeout_ms } : {}),
          })
          return { data: toProtocol(info) }
        }),
      )
      .handle(
        "approval.list",
        Effect.fn(function* (ctx) {
          const infos = yield* queue.list({
            ...(ctx.query.sessionID ? { sessionID: ctx.query.sessionID } : {}),
            ...(ctx.query.status ? { status: ctx.query.status } : {}),
          })
          return { data: infos.map(toProtocol) }
        }),
      )
      .handle(
        "approval.jobs.list",
        Effect.fn(function* () {
          return { data: yield* listJobs() }
        }),
      )
      .handle(
        "approval.get",
        Effect.fn(function* (ctx) {
          const info = yield* queue.get(ctx.params.requestID)
          if (!info) return yield* missing(ctx.params.requestID)
          return { data: toProtocol(info) }
        }),
      )
      .handle(
        "approval.decide",
        Effect.fn(function* (ctx) {
          const deviceID = yield* resolveDeviceID(ctx.payload.deviceID)
          const actor = ctx.payload.actor ?? "device"
          const decided = yield* queue
            .decide({
              id: ctx.params.requestID,
              decision: ctx.payload.decision,
              actor,
              ...(deviceID ? { deviceID } : {}),
              ...(ctx.payload.message ? { message: ctx.payload.message } : {}),
            })
            .pipe(
              Effect.catchTag("ApprovalQueue.NotPendingError", (cause) =>
                Effect.gen(function* () {
                  const info = yield* queue.get(cause.requestID)
                  if (!info) return yield* missing(cause.requestID)
                  return info
                }),
              ),
              Effect.catchTag("ApprovalQueue.NotFoundError", () => missing(ctx.params.requestID)),
            )
          yield* bridgePermission(decided.id, ctx.payload.decision, ctx.payload.message).pipe(Effect.orDie)
          return HttpApiSchema.NoContent.make()
        }),
      )
  }),
)
