export * as DeviceStore from "./device"

import { Database } from "@opencode-ai/core/database/database"
import { makeGlobalNode } from "@opencode-ai/core/effect/app-node"
import { sql } from "drizzle-orm"
import { createHash, randomUUID } from "crypto"
import { Context, Effect, Layer } from "effect"

export const PairTTL = 10 * 60 * 1000

export type Info = {
  readonly id: string
  readonly name: string
  readonly created_at: number
  readonly last_used_at?: number
}

export interface Interface {
  readonly pair: (name?: string) => Effect.Effect<{ code: string; expires_at: number }>
  readonly claim: (code: string) => Effect.Effect<{ token: string; deviceID: string; name: string } | undefined>
  readonly list: () => Effect.Effect<Info[]>
  readonly revoke: (deviceID: string) => Effect.Effect<boolean>
  readonly verify: (token: string) => Effect.Effect<string | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ServerDeviceStore") {}

const CodeAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

function makeCode(length = 8) {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (byte) => CodeAlphabet[byte % CodeAlphabet.length]).join("")
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex")
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db
      .run(
        sql`CREATE TABLE IF NOT EXISTS device_pairing (code TEXT PRIMARY KEY, name TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL)`,
      )
      .pipe(Effect.orDie)
    yield* db
      .run(
        sql`CREATE TABLE IF NOT EXISTS device_token (id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, last_used_at INTEGER, revoked INTEGER NOT NULL DEFAULT 0)`,
      )
      .pipe(Effect.orDie)

    return Service.of({
      pair: Effect.fn("DeviceStore.pair")(function* (name?: string) {
        const now = Date.now()
        // Prune expired codes opportunistically.
        yield* db.run(sql`DELETE FROM device_pairing WHERE expires_at <= ${now}`).pipe(Effect.orDie)
        for (let attempt = 0; attempt < 5; attempt++) {
          const code = makeCode()
          const expires_at = now + PairTTL
          const existing = yield* db
            .get<{ code: string }>(sql`SELECT code FROM device_pairing WHERE code = ${code}`)
            .pipe(Effect.orDie)
          if (existing) continue
          yield* db
            .run(
              sql`INSERT INTO device_pairing (code, name, expires_at, created_at) VALUES (${code}, ${name ?? "mobile"}, ${expires_at}, ${now})`,
            )
            .pipe(Effect.orDie)
          return { code, expires_at }
        }
        return yield* Effect.die(new Error("DeviceStore.pair failed to generate a unique code"))
      }),
      claim: Effect.fn("DeviceStore.claim")(function* (code: string) {
        const normalized = code.trim().toUpperCase()
        const row = yield* db
          .get<{ code: string; name: string; expires_at: number }>(
            sql`SELECT code, name, expires_at FROM device_pairing WHERE code = ${normalized}`,
          )
          .pipe(Effect.orDie)
        if (!row) return undefined
        if (row.expires_at <= Date.now()) {
          yield* db.run(sql`DELETE FROM device_pairing WHERE code = ${normalized}`).pipe(Effect.orDie)
          return undefined
        }
        yield* db.run(sql`DELETE FROM device_pairing WHERE code = ${normalized}`).pipe(Effect.orDie)
        const deviceID = randomUUID()
        const token = `dev_${randomUUID().replace(/-/g, "")}`
        const now = Date.now()
        yield* db
          .run(
            sql`INSERT INTO device_token (id, name, token_hash, created_at, revoked) VALUES (${deviceID}, ${row.name}, ${hashToken(token)}, ${now}, 0)`,
          )
          .pipe(Effect.orDie)
        return { token, deviceID, name: row.name }
      }),
      list: Effect.fn("DeviceStore.list")(function* () {
        const rows = yield* db
          .all<{ id: string; name: string; created_at: number; last_used_at: number | null }>(
            sql`SELECT id, name, created_at, last_used_at FROM device_token WHERE revoked = 0 ORDER BY created_at ASC`,
          )
          .pipe(Effect.orDie)
        return rows.map((row) => ({
          id: row.id,
          name: row.name,
          created_at: row.created_at,
          ...(row.last_used_at !== null ? { last_used_at: row.last_used_at } : {}),
        }))
      }),
      revoke: Effect.fn("DeviceStore.revoke")(function* (deviceID: string) {
        const existing = yield* db
          .get<{ id: string }>(sql`SELECT id FROM device_token WHERE id = ${deviceID}`)
          .pipe(Effect.orDie)
        if (!existing) return false
        yield* db.run(sql`UPDATE device_token SET revoked = 1 WHERE id = ${deviceID}`).pipe(Effect.orDie)
        return true
      }),
      verify: Effect.fn("DeviceStore.verify")(function* (token: string) {
        const row = yield* db
          .get<{ id: string }>(sql`SELECT id FROM device_token WHERE token_hash = ${hashToken(token)} AND revoked = 0`)
          .pipe(Effect.orDie)
        if (!row) return undefined
        yield* db.run(sql`UPDATE device_token SET last_used_at = ${Date.now()} WHERE id = ${row.id}`).pipe(Effect.orDie)
        return row.id
      }),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })
