import { ServerAuth } from "../auth"
import { UnauthorizedError } from "@opencode-ai/protocol/errors"
import { Authorization } from "@opencode-ai/protocol/middleware/authorization"
export { Authorization } from "@opencode-ai/protocol/middleware/authorization"
import { hasPtyConnectTicketURL } from "@opencode-ai/protocol/groups/pty"
import { DeviceStore } from "../device"
import { Effect, Encoding, Layer, Option, Redacted } from "effect"
import { HttpEffect, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"

const AUTH_TOKEN_QUERY = "auth_token"
const WWW_AUTHENTICATE = 'Basic realm="Secure Area"'

function isDeviceClaim(request: HttpServerRequest.HttpServerRequest) {
  if (request.method !== "POST") return false
  return new URL(request.url, "http://localhost").pathname === "/api/device/claim"
}

function bearerFromRequest(request: HttpServerRequest.HttpServerRequest) {
  const header = ServerAuth.bearerToken(request.headers.authorization)
  if (header) return header
  // EventSource cannot set headers, so accept a raw device token via ?auth_token=dev_…
  // (base64 Basic credentials keep working through credentialFromRequest).
  const query = new URL(request.url, "http://localhost").searchParams.get(AUTH_TOKEN_QUERY)
  if (query && !query.includes(":") && !query.includes("=")) return query.trim() || undefined
  const bearerPrefix = /^Bearer\s+(.+)$/i.exec(query ?? "")
  if (bearerPrefix) return bearerPrefix[1].trim() || undefined
  return undefined
}

function emptyCredential() {
  return { username: "", password: Redacted.make("") }
}

function decodeCredential(input: string) {
  return Effect.fromResult(Encoding.decodeBase64String(input)).pipe(
    Effect.match({
      onFailure: emptyCredential,
      onSuccess: (header) => {
        const separator = header.indexOf(":")
        if (separator === -1) return emptyCredential()
        return { username: header.slice(0, separator), password: Redacted.make(header.slice(separator + 1)) }
      },
    }),
  )
}

function credentialFromRequest(request: HttpServerRequest.HttpServerRequest) {
  const url = new URL(request.url, "http://localhost")
  const token = url.searchParams.get(AUTH_TOKEN_QUERY)
  if (token) return decodeCredential(token)
  const match = /^Basic\s+(.+)$/i.exec(request.headers.authorization ?? "")
  if (match) return decodeCredential(match[1])
  return Effect.succeed(emptyCredential())
}

export const authorizationLayer = Layer.effect(
  Authorization,
  Effect.gen(function* () {
    const config = yield* ServerAuth.Config
    const device = yield* Effect.serviceOption(DeviceStore.Service)
    if (!ServerAuth.required(config)) return Authorization.of((effect) => effect)
    return Authorization.of((effect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        // Browsers cannot set headers on WebSocket upgrades, so a ticketed PTY connect skips
        // credential checks here; the connect handler consumes and validates the ticket.
        if (hasPtyConnectTicketURL(new URL(request.url, "http://localhost"))) return yield* effect
        // Pairing codes are single-use secrets: claiming is public by design.
        if (isDeviceClaim(request)) return yield* effect
        const credential = yield* credentialFromRequest(request)
        if (ServerAuth.authorized(credential, config)) return yield* effect
        const bearer = bearerFromRequest(request)
        if (bearer && Option.isSome(device)) {
          const deviceID = yield* device.value.verify(bearer).pipe(Effect.orElseSucceed(() => undefined))
          if (deviceID) return yield* effect
        }
        yield* HttpEffect.appendPreResponseHandler((_request, response) =>
          Effect.succeed(HttpServerResponse.setHeader(response, "www-authenticate", WWW_AUTHENTICATE)),
        )
        return yield* new UnauthorizedError({ message: "Authentication required" })
      }),
    )
  }),
)
