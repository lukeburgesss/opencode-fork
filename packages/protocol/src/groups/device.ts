import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { InvalidRequestError, UnauthorizedError } from "../errors"

export const DeviceInfo = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  created_at: Schema.Number,
  last_used_at: Schema.optional(Schema.Number),
}).annotate({ identifier: "DeviceInfo" })
export type DeviceInfo = typeof DeviceInfo.Type

export const DevicePairResponse = Schema.Struct({
  data: Schema.Struct({
    code: Schema.String,
    expires_at: Schema.Number,
  }),
}).annotate({ identifier: "DevicePairResponse" })

export const DeviceClaimResponse = Schema.Struct({
  data: Schema.Struct({
    token: Schema.String,
    deviceID: Schema.String,
    name: Schema.String,
  }),
}).annotate({ identifier: "DeviceClaimResponse" })

export const DeviceListResponse = Schema.Struct({
  data: Schema.Array(DeviceInfo),
}).annotate({ identifier: "DeviceListResponse" })

export const DeviceGroup = HttpApiGroup.make("server.device")
  .add(
    HttpApiEndpoint.post("device.pair", "/api/device/pair", {
      payload: Schema.Struct({
        name: Schema.optional(Schema.String),
      }),
      success: DevicePairResponse,
      error: UnauthorizedError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.device.pair",
        summary: "Pair mobile device",
        description:
          "Create a short pairing code (10 minute expiry) for a mobile remote. Requires the server password. Exchange the code via device.claim.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("device.claim", "/api/device/claim", {
      payload: Schema.Struct({
        code: Schema.String,
      }),
      success: DeviceClaimResponse,
      error: InvalidRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.device.claim",
        summary: "Claim pairing code",
        description:
          "Exchange a pairing code for a long-lived device token. This endpoint is public; the code is single-use and expires after 10 minutes.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("device.list", "/api/device", {
      success: DeviceListResponse,
      error: UnauthorizedError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.device.list",
        summary: "List paired devices",
        description: "List non-revoked paired devices.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("device.revoke", "/api/device/:deviceID", {
      params: Schema.Struct({ deviceID: Schema.String }),
      success: HttpApiSchema.NoContent,
      error: InvalidRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.device.revoke",
        summary: "Revoke paired device",
        description: "Revoke a paired device token by device ID.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "devices",
      description: "Mobile remote device pairing routes.",
    }),
  )
