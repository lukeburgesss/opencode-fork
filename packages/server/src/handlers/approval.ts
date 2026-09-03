import { ApprovalQueue } from "@opencode-ai/core/approvals/queue"
import { BackgroundJob } from "@opencode-ai/core/background-job"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { Effect, Option } from "effect"
import { HttpServerRequest } from "effect/unstable/http"
import { PermissionNotFoundError } from "@opencode-ai/protocol/errors"
import type { ApprovalInfo } from "@opencode-ai/protocol/groups/permission"
import { ServerAuth } from "../auth"
import { DeviceStore } from "../device"

export function missing(id: string) {
  return new PermissionNotFoundError({ requestID: id, message: `Approval not found: ${id}` })
}

export function toProtocol(info: ApprovalQueue.Info): ApprovalInfo {
  return {
    id: info.id,
    ...(info.sessionID ? { sessionID: info.sessionID } : {}),
    action: info.action,
    resources: [...info.resources],
    created_at: info.created_at,
    expires_at: info.expires_at,
    timeout_ms: info.timeout_ms,
    status: info.status,
    ...(info.decision ? { decision: info.decision } : {}),
    ...(info.decided_at !== undefined ? { decided_at: info.decided_at } : {}),
    ...(info.decided_by ? { decided_by: info.decided_by } : {}),
    ...(info.deviceID ? { deviceID: info.deviceID } : {}),
    audit: info.audit.map((entry) => ({
      decision: entry.decision,
      actor: entry.actor,
      ...(entry.deviceID ? { deviceID: entry.deviceID } : {}),
      ...(entry.message ? { message: entry.message } : {}),
      at: entry.at,
    })),
  }
}

// Audit device from the verified Bearer device token when present, falling
// back to the client-reported deviceID. Authorization itself is enforced by
// the global authorization middleware, which already accepts device tokens.
export const resolveDeviceID = Effect.fn("Approval.resolveDeviceID")(function* (fallback?: string) {
  const device = yield* Effect.serviceOption(DeviceStore.Service)
  if (Option.isNone(device)) return fallback
  const current = yield* Effect.serviceOption(HttpServerRequest.HttpServerRequest)
  if (Option.isNone(current)) return fallback
  const token = ServerAuth.bearerToken(current.value.headers.authorization)
  if (!token) return fallback
  return (yield* device.value.verify(token).pipe(Effect.orElseSucceed(() => undefined))) ?? fallback
})

// Best-effort bridge: approving here also releases a live PermissionV2
// request with the same id when one exists in this location.
export const bridgePermission = Effect.fn("Approval.bridgePermission")(function* (
  id: string,
  decision: ApprovalQueue.Decision,
  message?: string,
) {
  const permission = yield* Effect.serviceOption(PermissionV2.Service)
  if (Option.isNone(permission)) return
  const existing = yield* permission.value.get(id as PermissionV2.ID).pipe(Effect.orElseSucceed(() => undefined))
  if (!existing) return
  const reply = decision === "deny" ? ("reject" as const) : decision
  yield* permission.value
    .reply({ requestID: id as PermissionV2.ID, reply, ...(message ? { message } : {}) })
    .pipe(Effect.orElseSucceed(() => undefined))
})

export const listJobs = Effect.fn("Approval.listJobs")(function* () {
  const jobs = yield* Effect.serviceOption(BackgroundJob.Service)
  if (Option.isNone(jobs)) return []
  const infos = yield* jobs.value.list()
  return infos.map((job) => ({
    id: job.id,
    type: job.type,
    ...(job.title ? { title: job.title } : {}),
    status: job.status,
    started_at: job.started_at,
    ...(job.completed_at !== undefined ? { completed_at: job.completed_at } : {}),
    ...(job.output ? { output: job.output } : {}),
    ...(job.error ? { error: job.error } : {}),
  }))
})
