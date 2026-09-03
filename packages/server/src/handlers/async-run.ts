import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { RunNotFoundError } from "@opencode-ai/protocol/groups/async-run"
import { UnknownError } from "@opencode-ai/protocol/errors"

// TODO: wire to AsyncRunManager/AsyncRunReplay once per-location run
// storage is available in the server layer. Compiling stub for now.
export const AsyncRunHandler = HttpApiBuilder.group(Api, "server.asyncRun", (handlers) =>
  handlers
    .handle(
      "asyncRun.create",
      Effect.fn(function* () {
        return yield* new UnknownError({ message: "TODO: async run engine wiring" })
      }),
    )
    .handle("asyncRun.list", () => Effect.succeed({ data: [] }))
    .handle(
      "asyncRun.get",
      Effect.fn(function* (ctx) {
        return yield* new RunNotFoundError({ runID: ctx.params.runID, message: "TODO: async run engine wiring" })
      }),
    )
    .handle(
      "asyncRun.replay",
      Effect.fn(function* (ctx) {
        return yield* new RunNotFoundError({ runID: ctx.params.runID, message: "TODO: async run engine wiring" })
      }),
    ),
)
