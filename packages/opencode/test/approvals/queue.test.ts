import { describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect } from "effect"
import { ApprovalQueue } from "@/approvals/queue"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(ApprovalQueue.node))

describe("approvals.queue", () => {
  it.instance("requests default to a 10 minute timeout", () =>
    Effect.gen(function* () {
      const queue = yield* ApprovalQueue.Service
      const info = yield* queue.request({ action: "bash", resources: ["rm -rf /tmp/x"] })

      expect(info.id.startsWith("apr_")).toBe(true)
      expect(info.status).toBe("pending")
      expect(info.timeout_ms).toBe(ApprovalQueue.DefaultTimeoutMs)
      expect(ApprovalQueue.DefaultTimeoutMs).toBe(10 * 60 * 1000)
      expect(info.expires_at - info.created_at).toBe(10 * 60 * 1000)
      expect(info.audit).toEqual([])
    }),
  )

  it.instance("honors per-request timeouts", () =>
    Effect.gen(function* () {
      const queue = yield* ApprovalQueue.Service
      const info = yield* queue.request({ action: "edit", resources: ["a.txt"], timeout_ms: 60_000 })

      expect(info.timeout_ms).toBe(60_000)
      expect(info.expires_at - info.created_at).toBe(60_000)
    }),
  )

  it.instance("lists and filters pending approvals", () =>
    Effect.gen(function* () {
      const queue = yield* ApprovalQueue.Service
      const first = yield* queue.request({ sessionID: "ses_a", action: "bash", resources: ["ls"] })
      const second = yield* queue.request({ sessionID: "ses_b", action: "edit", resources: ["b.txt"] })

      expect((yield* queue.list()).map((item) => item.id)).toEqual([first.id, second.id])
      expect((yield* queue.list({ sessionID: "ses_a" })).map((item) => item.id)).toEqual([first.id])
      expect((yield* queue.list({ status: "pending" })).length).toBe(2)
      expect((yield* queue.get(first.id))?.action).toBe("bash")
      expect(yield* queue.get("apr_missing")).toBeUndefined()
    }),
  )

  it.instance("decide once records who/when/device audit", () =>
    Effect.gen(function* () {
      const queue = yield* ApprovalQueue.Service
      const info = yield* queue.request({ sessionID: "ses_a", action: "bash", resources: ["deploy"] })
      const decided = yield* queue.decide({
        id: info.id,
        decision: "once",
        actor: "lukes-phone",
        deviceID: "device_1",
        message: "looks safe",
      })

      expect(decided.status).toBe("decided")
      expect(decided.decision).toBe("once")
      expect(decided.decided_by).toBe("lukes-phone")
      expect(decided.deviceID).toBe("device_1")
      expect(decided.decided_at).toBeGreaterThanOrEqual(decided.created_at)
      expect(decided.audit.length).toBe(1)
      expect(decided.audit[0].decision).toBe("once")
      expect(decided.audit[0].actor).toBe("lukes-phone")
      expect(decided.audit[0].deviceID).toBe("device_1")
      expect(decided.audit[0].message).toBe("looks safe")
      expect(decided.audit[0].at).toBeGreaterThanOrEqual(decided.created_at)
      expect((yield* queue.list({ status: "pending" })).length).toBe(0)
    }),
  )

  it.instance("rejects a second decision on the same request", () =>
    Effect.gen(function* () {
      const queue = yield* ApprovalQueue.Service
      const info = yield* queue.request({ action: "bash", resources: ["ls"] })
      yield* queue.decide({ id: info.id, decision: "always", actor: "owner" })

      const error = yield* queue.decide({ id: info.id, decision: "deny", actor: "owner" }).pipe(Effect.flip)
      expect(error._tag).toBe("ApprovalQueue.NotPendingError")
      const current = yield* queue.get(info.id)
      expect(current?.status).toBe("decided")
      expect(current?.decision).toBe("always")
    }),
  )

  it.instance("expires overdue requests with a system audit entry", () =>
    Effect.gen(function* () {
      const queue = yield* ApprovalQueue.Service
      const info = yield* queue.request({ action: "bash", resources: ["sleep"], timeout_ms: 50 })

      yield* Effect.sleep("200 millis")
      expect(yield* queue.expireDue()).toBe(1)

      const expired = yield* queue.get(info.id)
      expect(expired?.status).toBe("expired")
      expect(expired?.audit.length).toBe(1)
      expect(expired?.audit[0].decision).toBe("deny")
      expect(expired?.audit[0].actor).toBe("system")

      const error = yield* queue.decide({ id: info.id, decision: "once", actor: "late" }).pipe(Effect.flip)
      expect(error._tag).toBe("ApprovalQueue.NotPendingError")
    }),
  )

  it.instance("returns the audit log for a request", () =>
    Effect.gen(function* () {
      const queue = yield* ApprovalQueue.Service
      const info = yield* queue.request({ action: "edit", resources: ["c.txt"] })
      yield* queue.decide({ id: info.id, decision: "deny", actor: "reviewer", message: "no" })

      const audit = yield* queue.audit(info.id)
      expect(audit.length).toBe(1)
      expect(audit[0].actor).toBe("reviewer")
      expect(audit[0].decision).toBe("deny")
    }),
  )
})
