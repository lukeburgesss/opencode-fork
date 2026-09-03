import { afterEach, describe, expect, test } from "bun:test"
import { add, checkSpend, dailyCapUSD, empty, killSwitchEngaged, summarizeMessages, summarizeRows, summarizeUsages } from "@/spend/spend"

const savedCap = process.env.OPENCODE_SPEND_DAILY_CAP_USD
const savedKill = process.env.OPENCODE_SPEND_KILL_SWITCH

afterEach(() => {
  if (savedCap === undefined) delete process.env.OPENCODE_SPEND_DAILY_CAP_USD
  else process.env.OPENCODE_SPEND_DAILY_CAP_USD = savedCap
  if (savedKill === undefined) delete process.env.OPENCODE_SPEND_KILL_SWITCH
  else process.env.OPENCODE_SPEND_KILL_SWITCH = savedKill
})

describe("spend aggregation", () => {
  test("sums assistant message token fields with reasoning folded into output", () => {
    const summary = summarizeMessages([
      { tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 20, write: 5 } }, cost: 0.01 },
      { tokens: { input: 200, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, cost: 0.02 },
      { cost: 0.005 },
    ])
    expect(summary).toEqual({
      input: 300,
      output: 60,
      cacheRead: 20,
      cacheWrite: 5,
      totalTokens: 385,
      costUSD: expect.closeTo(0.035),
    })
  })

  test("sums session table rows", () => {
    const summary = summarizeRows([
      { tokens_input: 100, tokens_output: 50, tokens_reasoning: 10, tokens_cache_read: 20, tokens_cache_write: 5, cost: 0.01 },
      { tokens_input: 0, tokens_output: 0, tokens_reasoning: 0, tokens_cache_read: 0, tokens_cache_write: 0, cost: 0 },
    ])
    expect(summary.input).toBe(100)
    expect(summary.output).toBe(60)
    expect(summary.totalTokens).toBe(185)
    expect(summary.costUSD).toBe(0.01)
  })

  test("empty and add combine", () => {
    expect(empty()).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, costUSD: 0 })
    const combined = add(summarizeUsages([{ input: 10, output: 5, cost: 0.01 }]), summarizeUsages([{ input: 20, cacheWrite: 3, cost: 0.02 }]))
    expect(combined.input).toBe(30)
    expect(combined.output).toBe(5)
    expect(combined.cacheWrite).toBe(3)
    expect(combined.totalTokens).toBe(38)
    expect(combined.costUSD).toBeCloseTo(0.03)
  })
})

describe("spend guardrails", () => {
  test("allows spend by default", () => {
    delete process.env.OPENCODE_SPEND_DAILY_CAP_USD
    delete process.env.OPENCODE_SPEND_KILL_SWITCH
    expect(killSwitchEngaged()).toBe(false)
    expect(dailyCapUSD()).toBeUndefined()
    expect(checkSpend(summarizeUsages([{ input: 1, output: 1, cost: 999 }]))).toBe("ok")
  })

  test("flags blown daily cap", () => {
    process.env.OPENCODE_SPEND_DAILY_CAP_USD = "5"
    expect(dailyCapUSD()).toBe(5)
    expect(checkSpend(summarizeUsages([{ input: 1, output: 1, cost: 4.99 }]))).toBe("ok")
    expect(checkSpend(summarizeUsages([{ input: 1, output: 1, cost: 5 }]))).toBe("cap-exceeded")
  })

  test("kill-switch wins over everything", () => {
    process.env.OPENCODE_SPEND_KILL_SWITCH = "1"
    expect(killSwitchEngaged()).toBe(true)
    expect(checkSpend(empty())).toBe("kill-switch")
  })
})
