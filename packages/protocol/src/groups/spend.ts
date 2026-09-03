import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { SessionNotFoundError } from "../errors"
import { Session } from "@opencode-ai/schema/session"

export const SpendSummary = Schema.Struct({
  input: Schema.Finite,
  output: Schema.Finite,
  cacheRead: Schema.Finite,
  cacheWrite: Schema.Finite,
  totalTokens: Schema.Finite,
  costUSD: Schema.Finite,
}).annotate({ identifier: "SpendSummary" })
export type SpendSummary = typeof SpendSummary.Type

export const SpendGroup = HttpApiGroup.make("server.spend")
  .add(
    HttpApiEndpoint.get("spend.session", "/api/session/:id/spend", {
      params: Schema.Struct({ id: Session.ID }),
      success: Schema.Struct({ data: SpendSummary }),
      error: SessionNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.spend.session",
        summary: "Get session spend",
        description: "Aggregate token usage and cost for one session from stored message token fields.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("spend.summary", "/api/spend/summary", {
      success: Schema.Struct({ data: SpendSummary }),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.spend.summary",
        summary: "Get spend summary",
        description: "Aggregate token usage and cost across sessions updated since local midnight.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "spend",
      description: "Token and cost aggregation routes.",
    }),
  )
