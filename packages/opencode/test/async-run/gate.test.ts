import { describe, expect, it } from "bun:test"
import { decide, MAX_REVIEW_ROUNDS, parseVerdict, reviewPromptWithDiff } from "../../src/async-run/gate"

describe("AsyncRunGate", () => {
  describe("decide", () => {
    it("merges on approve at any round", () => {
      expect(decide({ verdict: "APPROVE", round: 0 })).toBe("merge")
      expect(decide({ verdict: "APPROVE", round: MAX_REVIEW_ROUNDS })).toBe("merge")
    })

    it("retries request-changes below the cap, escalates at it", () => {
      expect(decide({ verdict: "REQUEST_CHANGES", round: 0 })).toBe("retry")
      expect(decide({ verdict: "REQUEST_CHANGES", round: MAX_REVIEW_ROUNDS - 1 })).toBe("retry")
      expect(decide({ verdict: "REQUEST_CHANGES", round: MAX_REVIEW_ROUNDS })).toBe("escalate")
    })

    it("treats needs-tests like a retry below the cap", () => {
      expect(decide({ verdict: "NEEDS_TESTS", round: 1 })).toBe("retry")
      expect(decide({ verdict: "NEEDS_TESTS", round: MAX_REVIEW_ROUNDS })).toBe("escalate")
    })
  })

  describe("parseVerdict", () => {
    it("matches verdict lines case-insensitively with priority", () => {
      expect(parseVerdict("verdict: approve")).toBe("APPROVE")
      expect(parseVerdict("REQUEST_CHANGES: fix auth")).toBe("REQUEST_CHANGES")
      expect(parseVerdict("needs_tests before merge")).toBe("NEEDS_TESTS")
      expect(parseVerdict("looks fine, approve but needs_tests")).toBe("NEEDS_TESTS")
      expect(parseVerdict("looks good to me")).toBeUndefined()
    })
  })

  describe("reviewPromptWithDiff", () => {
    it("appends the diff stat and flags empty diffs", () => {
      const withDiff = reviewPromptWithDiff({ prompt: "review this", diffStat: "a.ts | 2 +-" })
      expect(withDiff).toContain("a.ts | 2 +-")
      expect(reviewPromptWithDiff({ prompt: "review this", diffStat: "" })).toContain("no changes")
    })
  })
})
