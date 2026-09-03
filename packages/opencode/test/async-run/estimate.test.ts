import { describe, expect, it } from "bun:test"
import { estimateFanOut, MAX_WORKERS, workerCount } from "../../src/async-run/estimate"

describe("AsyncRunEstimate", () => {
  describe("workerCount", () => {
    it("caps at MAX_WORKERS and reserves two CPUs", () => {
      expect(workerCount({ tasks: 100, cpuCount: 64 })).toBe(MAX_WORKERS)
      expect(workerCount({ tasks: 10, cpuCount: 4 })).toBe(2)
      expect(workerCount({ tasks: 3 })).toBe(3)
      expect(workerCount({ tasks: 1, cpuCount: 2 })).toBe(1)
    })
  })

  describe("estimateFanOut", () => {
    it("scales tokens with workers and review passes", () => {
      const base = estimateFanOut({ tasks: 2, avgTokensPerTurn: 1000, turnsPerTask: 2, reviewPasses: 0 })
      expect(base.tokens).toBe(2 * 1000 * 2 * 1)
      const reviewed = estimateFanOut({ tasks: 2, avgTokensPerTurn: 1000, turnsPerTask: 2, reviewPasses: 1 })
      expect(reviewed.tokens).toBe(2 * 1000 * 2 * 2)
    })

    it("prices in USD per million tokens", () => {
      const estimate = estimateFanOut({ tasks: 1, avgTokensPerTurn: 1_000_000, turnsPerTask: 1, reviewPasses: 0 })
      expect(estimate.usd).toBe(3)
    })
  })
})
