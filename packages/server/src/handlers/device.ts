import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { InvalidRequestError } from "@opencode-ai/protocol/errors"
import { Api } from "../api"
import { DeviceStore } from "../device"

export const DeviceHandler = HttpApiBuilder.group(Api, "server.device", (handlers) =>
  Effect.gen(function* () {
    const device = yield* DeviceStore.Service

    return handlers
      .handle(
        "device.pair",
        Effect.fn(function* (ctx) {
          return { data: yield* device.pair(ctx.payload.name) }
        }),
      )
      .handle(
        "device.claim",
        Effect.fn(function* (ctx) {
          const claimed = yield* device.claim(ctx.payload.code)
          if (!claimed)
            return yield* new InvalidRequestError({ message: "Invalid or expired pairing code", field: "code" })
          return { data: claimed }
        }),
      )
      .handle(
        "device.list",
        Effect.fn(function* () {
          return { data: yield* device.list() }
        }),
      )
      .handle(
        "device.revoke",
        Effect.fn(function* (ctx) {
          const revoked = yield* device.revoke(ctx.params.deviceID)
          if (!revoked)
            return yield* new InvalidRequestError({ message: `Device not found: ${ctx.params.deviceID}` })
          return HttpApiSchema.NoContent.make()
        }),
      )
  }),
)
