import { describe, expect, test } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect } from "effect"
import * as FileSystem from "effect/FileSystem"
import * as Path from "effect/Path"
import { create, get } from "../../src/async-run/manager"
import { finish, guard, mergeTask, spawn } from "../../src/async-run/worker"
import { commitAll } from "../../src/async-run/worktree"
import { pendingIntents, read } from "../../src/async-run/log"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  LayerNode.compile(LayerNode.group([CrossSpawnSpawner.node, LayerNodePlatform.filesystem, LayerNodePlatform.path])),
)

describe("AsyncRunWorker", () => {
  it.live("runs the full lifecycle: spawn, work, finish, merge", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const created = yield* create({ directory: dir, tasks: ["alpha", "beta"], review: true })
      expect(created.info.mode).toBe("parallel")

      let info = yield* spawn({ info: created.info, title: "alpha", base: created.info.baseCommit })
      expect(info.tasks.find((t) => t.title === "alpha")?.status).toBe("running")

      const worktree = info.tasks.find((t) => t.title === "alpha")!.directory
      yield* fs.writeFileString(path.join(worktree, "alpha.txt"), "alpha\n")
      info = yield* finish({ info, title: "alpha", ok: true })
      expect(info.tasks.find((t) => t.title === "alpha")?.status).toBe("review")

      info = yield* mergeTask({ info, title: "alpha" })
      expect(info.tasks.find((t) => t.title === "alpha")?.status).toBe("done")
      expect(yield* fs.exists(path.join(worktree, "alpha.txt"))).toBe(false)
      expect((yield* fs.readFileString(path.join(dir, "alpha.txt"))).trim()).toBe("alpha")

      const events = yield* read({ directory: dir, runID: created.info.id })
      expect(pendingIntents(events)).toEqual([])
    }),
  )

  it.live("fails the second merge on conflicting edits", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      yield* fs.writeFileString(path.join(dir, "shared.txt"), "base\n")
      yield* commitAll({ dir, message: "base file" })

      const created = yield* create({ directory: dir, tasks: ["one", "two"], review: false })
      let info = created.info
      info = yield* spawn({ info, title: "one", base: info.baseCommit })
      info = yield* spawn({ info, title: "two", base: info.baseCommit })
      for (const title of ["one", "two"]) {
        const wt = info.tasks.find((t) => t.title === title)!.directory
        yield* fs.writeFileString(path.join(wt, "shared.txt"), `${title}\n`)
        info = yield* finish({ info, title, ok: true })
      }
      info = yield* mergeTask({ info, title: "one" })
      const exit = yield* Effect.exit(mergeTask({ info, title: "two" }))
      expect(exit._tag).toBe("Failure")
      const reloaded = yield* get({ directory: dir, id: created.info.id })
      expect(reloaded.tasks.find((t) => t.title === "two")?.status).toBe("failed")
    }),
  )

  it.live("records failure without committing", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const created = yield* create({ directory: dir, tasks: ["solo"], review: false })
      expect(created.info.mode).toBe("single")
      let info = yield* spawn({ info: created.info, title: "solo", base: created.info.baseCommit })
      info = yield* finish({ info, title: "solo", ok: false })
      expect(info.tasks.find((t) => t.title === "solo")?.status).toBe("failed")
    }),
  )

  it.live("refuses workers for serial runs", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const created = yield* create({ directory: dir, tasks: ["a", "b"], review: false, serial: true })
      expect(created.info.serial).toBe(true)
      expect(created.info.mode).toBe("single")
      expect(created.worktrees).toEqual([])
      const exit = yield* Effect.exit(spawn({ info: created.info, title: "a", base: created.info.baseCommit }))
      expect(exit._tag).toBe("Failure")
    }),
  )

  describe("guard", () => {
    test("caps workers and flags spend overruns", () => {
      const ok = guard({ tasks: 2, usdCap: 1000 })
      expect(ok.workers).toBe(2)
      expect(ok.overCap).toBe(false)
      const over = guard({ tasks: 8, usdCap: 0.01 })
      expect(over.overCap).toBe(true)
    })
  })
})
