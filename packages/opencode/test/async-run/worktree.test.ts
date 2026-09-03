import { describe, expect } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect } from "effect"
import * as FileSystem from "effect/FileSystem"
import * as Path from "effect/Path"
import { add, baseCommit, remove } from "../../src/async-run/worktree"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  LayerNode.compile(LayerNode.group([CrossSpawnSpawner.node, LayerNodePlatform.filesystem, LayerNodePlatform.path])),
)

describe("AsyncRunWorktree", () => {
  it.live("baseCommit() reads HEAD from a real git repo", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const commit = yield* baseCommit(dir)
      expect(commit).toMatch(/^[0-9a-f]{40}$/)
    }),
  )

  it.live("add() and remove() manage a real git worktree", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const base = yield* baseCommit(dir)
      const target = path.join(dir, "wt", "task-one")

      yield* add({ repo: dir, path: target, branch: "async/task-one-0", base })
      expect(yield* fs.exists(target)).toBe(true)
      expect(yield* baseCommit(target)).toBe(base)

      yield* remove({ repo: dir, path: target })
      expect(yield* fs.exists(target)).toBe(false)
    }),
  )

  it.live("baseCommit() fails outside a git repo", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const exit = yield* baseCommit(dir).pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
    }),
  )
})
