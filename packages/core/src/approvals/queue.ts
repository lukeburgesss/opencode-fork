export * as ApprovalQueue from "./queue"

import { makeGlobalNode } from "../effect/app-node"
import { Clock, Context, Effect, Layer, Schema, SynchronizedRef } from "effect"
import { ascending } from "@opencode-ai/schema/identifier"

export const DefaultTimeoutMs = 10 * 60 * 1000

export const ID = Schema.String.check(Schema.isStartsWith("apr_")).pipe(Schema.brand("ApprovalQueue.ID")).annotate({
  identifier: "ApprovalQueue.ID",
})
export type ID = typeof ID.Type

function createID(id?: string) {
  return ID.make(id ?? `apr_${ascending()}`)
}

export const Decision = Schema.Literals(["once", "always", "deny"]).annotate({ identifier: "ApprovalQueue.Decision" })
export type Decision = typeof Decision.Type

export const Status = Schema.Literals(["pending", "decided", "expired"]).annotate({
  identifier: "ApprovalQueue.Status",
})
export type Status = typeof Status.Type

export class AuditEntry extends Schema.Class<AuditEntry>("ApprovalQueue.AuditEntry")({
  decision: Decision,
  actor: Schema.String,
  deviceID: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
  at: Schema.Number,
}) {}

export class Info extends Schema.Class<Info>("ApprovalQueue.Info")({
  id: ID,
  sessionID: Schema.optional(Schema.String),
  action: Schema.String,
  resources: Schema.Array(Schema.String),
  created_at: Schema.Number,
  expires_at: Schema.Number,
  timeout_ms: Schema.Number,
  status: Status,
  decision: Schema.optional(Decision),
  decided_at: Schema.optional(Schema.Number),
  decided_by: Schema.optional(Schema.String),
  deviceID: Schema.optional(Schema.String),
  audit: Schema.Array(AuditEntry),
}) {}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("ApprovalQueue.NotFoundError", {
  requestID: Schema.String,
}) {}

export class NotPendingError extends Schema.TaggedErrorClass<NotPendingError>()("ApprovalQueue.NotPendingError", {
  requestID: Schema.String,
  status: Status,
}) {}

export const RequestInput = Schema.Struct({
  id: Schema.optional(Schema.String),
  sessionID: Schema.optional(Schema.String),
  action: Schema.String,
  resources: Schema.Array(Schema.String),
  timeout_ms: Schema.optional(Schema.Number),
}).annotate({ identifier: "ApprovalQueue.RequestInput" })
export type RequestInput = typeof RequestInput.Type

export const DecideInput = Schema.Struct({
  id: Schema.String,
  decision: Decision,
  actor: Schema.optional(Schema.String),
  deviceID: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
}).annotate({ identifier: "ApprovalQueue.DecideInput" })
export type DecideInput = typeof DecideInput.Type

export const ListInput = Schema.Struct({
  sessionID: Schema.optional(Schema.String),
  status: Schema.optional(Status),
}).annotate({ identifier: "ApprovalQueue.ListInput" })
export type ListInput = typeof ListInput.Type

export interface Interface {
  readonly request: (input: RequestInput) => Effect.Effect<Info>
  readonly list: (input?: ListInput) => Effect.Effect<ReadonlyArray<Info>>
  readonly get: (id: string) => Effect.Effect<Info | undefined>
  readonly decide: (input: DecideInput) => Effect.Effect<Info, NotFoundError | NotPendingError>
  readonly expireDue: () => Effect.Effect<number>
  readonly audit: (id: string) => Effect.Effect<ReadonlyArray<AuditEntry>, NotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ApprovalQueue") {}

function isExpired(info: Info, now: number) {
  return info.status === "pending" && info.expires_at <= now
}

function toExpired(info: Info, now: number): Info {
  return new Info({
    ...info,
    status: "expired",
    audit: [
      ...info.audit,
      new AuditEntry({ decision: "deny", actor: "system", at: now, message: "approval timed out" }),
    ],
  })
}

export const make = Effect.gen(function* () {
  const store = yield* SynchronizedRef.make(new Map<string, Info>())

  const sweep = Effect.fnUntraced(function* (now: number) {
    return yield* SynchronizedRef.modify(store, (entries) => {
      const next = new Map(entries)
      let expired = 0
      for (const [id, info] of entries) {
        if (!isExpired(info, now)) continue
        next.set(id, toExpired(info, now))
        expired += 1
      }
      return [expired, next] as const
    })
  })

  const request: Interface["request"] = Effect.fn("ApprovalQueue.request")(function* (input: RequestInput) {
    const now = yield* Clock.currentTimeMillis
    const timeout_ms = input.timeout_ms ?? DefaultTimeoutMs
    const info = new Info({
      id: createID(input.id),
      ...(input.sessionID ? { sessionID: input.sessionID } : {}),
      action: input.action,
      resources: [...input.resources],
      created_at: now,
      expires_at: now + timeout_ms,
      timeout_ms,
      status: "pending",
      audit: [],
    })
    yield* SynchronizedRef.update(store, (entries) => new Map(entries).set(info.id, info))
    return info
  })

  const list: Interface["list"] = Effect.fn("ApprovalQueue.list")(function* (input?: ListInput) {
    const now = yield* Clock.currentTimeMillis
    yield* sweep(now)
    const entries = yield* SynchronizedRef.get(store)
    return Array.from(entries.values())
      .filter((info) => (input?.sessionID ? info.sessionID === input.sessionID : true))
      .filter((info) => (input?.status ? info.status === input.status : true))
      .toSorted((a, b) => a.created_at - b.created_at)
  })

  const get: Interface["get"] = Effect.fn("ApprovalQueue.get")(function* (id: string) {
    const now = yield* Clock.currentTimeMillis
    yield* sweep(now)
    return (yield* SynchronizedRef.get(store)).get(id)
  })

  const decide: Interface["decide"] = Effect.fn("ApprovalQueue.decide")(function* (input: DecideInput) {
    const now = yield* Clock.currentTimeMillis
    yield* sweep(now)
    const existing = (yield* SynchronizedRef.get(store)).get(input.id)
    if (!existing) return yield* new NotFoundError({ requestID: input.id })
    if (existing.status !== "pending") return yield* new NotPendingError({ requestID: input.id, status: existing.status })
    const actor = input.actor ?? "device"
    const decided = new Info({
      ...existing,
      status: "decided",
      decision: input.decision,
      decided_at: now,
      decided_by: actor,
      ...(input.deviceID ? { deviceID: input.deviceID } : {}),
      audit: [
        ...existing.audit,
        new AuditEntry({
          decision: input.decision,
          actor,
          ...(input.deviceID ? { deviceID: input.deviceID } : {}),
          ...(input.message ? { message: input.message } : {}),
          at: now,
        }),
      ],
    })
    yield* SynchronizedRef.update(store, (entries) => new Map(entries).set(decided.id, decided))
    return decided
  })

  const expireDue: Interface["expireDue"] = Effect.fn("ApprovalQueue.expireDue")(function* () {
    return yield* sweep(yield* Clock.currentTimeMillis)
  })

  const audit: Interface["audit"] = Effect.fn("ApprovalQueue.audit")(function* (id: string) {
    const existing = (yield* SynchronizedRef.get(store)).get(id)
    if (!existing) return yield* new NotFoundError({ requestID: id })
    return [...existing.audit]
  })

  return Service.of({ request, list, get, decide, expireDue, audit })
})

const layer = Layer.effect(Service, make)

export const node = makeGlobalNode({ service: Service, layer, deps: [] })
