import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { SessionOverflow } from "../../src/session/overflow"
import { Provider } from "@/provider/provider"

function createModel(opts: { context: number; output: number; input?: number }): Provider.Model {
  return {
    id: "test-model",
    providerID: "test",
    name: "Test",
    limit: {
      context: opts.context,
      input: opts.input,
      output: opts.output,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    capabilities: {
      toolcall: true,
      attachment: false,
      reasoning: false,
      temperature: true,
      input: { text: true, image: false, audio: false, video: false },
      output: { text: true, image: false, audio: false, video: false },
    },
    api: { npm: "@ai-sdk/anthropic" },
    options: {},
  } as Provider.Model
}

function cfg(compaction?: ConfigV1.Info["compaction"]) {
  const base = Schema.decodeUnknownSync(ConfigV1.Info)({}) as ConfigV1.Info
  return { ...base, compaction } as ConfigV1.Info
}

function tokens(overrides?: Partial<{ input: number; output: number; reasoning: number; read: number; write: number }>) {
  return {
    input: overrides?.input ?? 0,
    output: overrides?.output ?? 0,
    reasoning: overrides?.reasoning ?? 0,
    cache: { read: overrides?.read ?? 0, write: overrides?.write ?? 0 },
  }
}

describe("session.overflow.contextUsage", () => {
  test("sums input output reasoning and cache for used", () => {
    const model = createModel({ context: 200_000, output: 32_000 })
    const result = SessionOverflow.contextUsage({
      tokens: tokens({ input: 10_000, output: 2_000, reasoning: 1_000, read: 3_000, write: 500 }),
      model,
      cfg: cfg(),
    })
    expect(result.used).toBe(16_500)
    expect(result.cacheRead).toBe(3_000)
    expect(result.cacheWrite).toBe(500)
    expect(String(result.model.providerID)).toBe("test")
    expect(String(result.model.modelID)).toBe("test-model")
    expect(result.model.contextLimit).toBe(200_000)
  })

  test("computes usable pct and preserve budget from context window", () => {
    const model = createModel({ context: 200_000, output: 32_000 })
    const result = SessionOverflow.contextUsage({
      tokens: tokens({ input: 80_000, output: 8_000 }),
      model,
      cfg: cfg(),
    })
    expect(result.usable).toBe(168_000)
    expect(result.pct).toBe(Math.round((88_000 / 168_000) * 100))
    expect(result.preserveBudget).toBe(15_000)
    expect(result.etaTurns).toBe(Math.ceil((168_000 - 88_000) / 10_000))
  })

  test("respects input limit for usable", () => {
    const model = createModel({ context: 400_000, input: 272_000, output: 128_000 })
    const result = SessionOverflow.contextUsage({
      tokens: tokens({ input: 100_000, output: 10_000 }),
      model,
      cfg: cfg(),
    })
    expect(result.usable).toBe(252_000)
    expect(result.pct).toBe(Math.round((110_000 / 252_000) * 100))
  })

  test("respects preserve_recent_tokens override", () => {
    const model = createModel({ context: 200_000, output: 32_000 })
    const result = SessionOverflow.contextUsage({
      tokens: tokens({ input: 1_000 }),
      model,
      cfg: cfg({ preserve_recent_tokens: 5_000 }),
    })
    expect(result.preserveBudget).toBe(5_000)
  })

  test("returns zero pct and null eta when context limit is zero", () => {
    const model = createModel({ context: 0, output: 32_000 })
    const result = SessionOverflow.contextUsage({
      tokens: tokens({ input: 1_000 }),
      model,
      cfg: cfg(),
    })
    expect(result.usable).toBe(0)
    expect(result.pct).toBe(0)
    expect(result.etaTurns).toBeNull()
  })

  test("returns zero eta when used exceeds usable", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const result = SessionOverflow.contextUsage({
      tokens: tokens({ input: 70_000, output: 10_000 }),
      model,
      cfg: cfg(),
    })
    expect(result.usable).toBe(68_000)
    expect(result.etaTurns).toBe(0)
  })
})
