import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ApprovalQueue as CoreApprovalQueue } from "@opencode-ai/core/approvals/queue"
import { InstanceState } from "@/effect/instance-state"
import { Effect, Layer } from "effect"

export {
  Service,
  DefaultTimeoutMs,
  ID,
  Decision,
  Status,
  Info,
  AuditEntry,
  RequestInput,
  DecideInput,
  ListInput,
  NotFoundError,
  NotPendingError,
  type Interface,
} from "@opencode-ai/core/approvals/queue"

/** Keeps the legacy service instance-scoped while sharing the core approval engine. */
const layer = Layer.effect(
  CoreApprovalQueue.Service,
  Effect.gen(function* () {
    const state = yield* InstanceState.make(() => CoreApprovalQueue.make)
    return CoreApprovalQueue.Service.of({
      request: (input) => InstanceState.useEffect(state, (queue) => queue.request(input)),
      list: (input) => InstanceState.useEffect(state, (queue) => queue.list(input)),
      get: (id) => InstanceState.useEffect(state, (queue) => queue.get(id)),
      decide: (input) => InstanceState.useEffect(state, (queue) => queue.decide(input)),
      expireDue: () => InstanceState.useEffect(state, (queue) => queue.expireDue()),
      audit: (id) => InstanceState.useEffect(state, (queue) => queue.audit(id)),
    })
  }),
)

export const node = LayerNode.make({ service: CoreApprovalQueue.Service, layer, deps: [] })

export * as ApprovalQueue from "./queue"
