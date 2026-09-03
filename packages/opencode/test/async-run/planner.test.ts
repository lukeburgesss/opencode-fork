import { describe, expect, it } from "bun:test"
import { Effect } from "effect"
import {
  decompositionPrompt,
  parseDecomposition,
  shouldFanOut,
  splitByDomains,
} from "../../src/async-run/planner"

describe("AsyncRunPlanner", () => {
  describe("splitByDomains", () => {
    it("keeps disjoint hints separate", () => {
      const out = splitByDomains([
        { title: "auth", files: ["src/auth.ts"] },
        { title: "billing", files: ["src/billing.ts"] },
      ])
      expect(out).toHaveLength(2)
    })

    it("merges hints that share a file", () => {
      const out = splitByDomains([
        { title: "auth login", files: ["src/auth.ts"] },
        { title: "auth logout", files: ["src/auth.ts", "src/session.ts"] },
        { title: "billing", files: ["src/billing.ts"] },
      ])
      expect(out).toHaveLength(2)
      expect(out[0].title).toContain("auth login")
      expect([...out[0].files].sort()).toEqual(["src/auth.ts", "src/session.ts"])
    })

    it("normalizes case and ./ prefixes", () => {
      const out = splitByDomains([{ title: "a", files: ["./SRC/A.ts"] }])
      expect(out[0].files).toEqual(["src/a.ts"])
    })
  })

  describe("shouldFanOut", () => {
    it("rejects single actionable subtasks", () => {
      expect(shouldFanOut([{ title: "a", files: ["x.ts"] }])).toBe(false)
    })

    it("rejects overlapping domains", () => {
      expect(
        shouldFanOut([
          { title: "a", files: ["x.ts"] },
          { title: "b", files: ["x.ts"] },
        ]),
      ).toBe(false)
    })

    it("accepts disjoint domains", () => {
      expect(
        shouldFanOut([
          { title: "a", files: ["x.ts"] },
          { title: "b", files: ["y.ts"] },
        ]),
      ).toBe(true)
    })
  })

  describe("decompositionPrompt", () => {
    it("embeds the task, files and JSON shape", () => {
      const prompt = decompositionPrompt({ task: "migrate auth", files: ["a.ts"] })
      expect(prompt).toContain("migrate auth")
      expect(prompt).toContain("a.ts")
      expect(prompt).toContain('"files"')
    })
  })

  describe("parseDecomposition", () => {
    it("parses a raw JSON array", async () => {
      const out = await Effect.runPromise(
        parseDecomposition('[{"title": "auth", "files": ["a.ts"]}]'),
      )
      expect(out).toEqual([{ title: "auth", files: ["a.ts"] }])
    })

    it("extracts JSON from fenced blocks and prose", async () => {
      const out = await Effect.runPromise(
        parseDecomposition('Here you go:\n```json\n[{"title": "b", "files": []}]\n```'),
      )
      expect(out).toEqual([{ title: "b", files: [] }])
    })

    it("fails on missing arrays and wrong shapes", async () => {
      for (const raw of ["no json here", "```\n{}\n```", '[{"title": 1}]']) {
        const exit = await Effect.runPromise(Effect.exit(parseDecomposition(raw)))
        expect(exit._tag).toBe("Failure")
      }
    })
  })
})
