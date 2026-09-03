import { describe, expect } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect } from "effect"
import { append, formatReplay, pendingIntents, read } from "../../src/async-run/log"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  LayerNode.compile(LayerNode.group([CrossSpawnSpawner.node, LayerNodePlatform.filesystem, LayerNodePlatform.path])),
)

describe("AsyncRunLog", () => {
  it.live("appends intents and completions in order", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      yield* append({ directory: dir, runID: "run_test", kind: "intent", action: "spawn", task: "a" })
      yield* append({ directory: dir, runID: "run_test", kind: "complete", action: "spawn", task: "a" })
      const events = yield* read({ directory: dir, runID: "run_test" })
      expect(events.map((e) => e.seq)).toEqual([0, 1])
      expect(pendingIntents(events)).toEqual([])
      expect(formatReplay(events)).toHaveLength(2)
    }),
  )

  it.live("detects pending intents after a simulated crash", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      yield* append({ directory: dir, runID: "run_test", kind: "intent", action: "spawn", task: "a" })
      yield* append({ directory: dir, runID: "run_test", kind: "complete", action: "spawn", task: "a" })
      yield* append({ directory: dir, runID: "run_test", kind: "intent", action: "merge", task: "a" })
      const events = yield* read({ directory: dir, runID: "run_test" })
      const pending = pendingIntents(events)
      expect(pending).toHaveLength(1)
      expect(pending[0].action).toBe("merge")
    }),
  )

  it.live("reads empty for a fresh run", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      expect(yield* read({ directory: dir, runID: "run_missing" })).toEqual([])
    }),
  )
})
