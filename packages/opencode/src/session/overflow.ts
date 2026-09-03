import type { Config } from "@/config/config"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import type { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import type { MessageV2 } from "./message-v2"

const COMPACTION_BUFFER = 20_000
const PRESERVE_MIN_TOKENS = 2_000
const PRESERVE_MAX_TOKENS = 15_000
const ETA_TOKENS_PER_TURN = 10_000

export function usable(input: { cfg: ConfigV1.Info; model: Provider.Model; outputTokenMax?: number }) {
  const context = input.model.limit.context
  if (context === 0) return 0

  const reserved =
    input.cfg.compaction?.reserved ??
    Math.min(COMPACTION_BUFFER, ProviderTransform.maxOutputTokens(input.model, input.outputTokenMax))
  return input.model.limit.input
    ? Math.max(0, input.model.limit.input - reserved)
    : Math.max(0, context - ProviderTransform.maxOutputTokens(input.model, input.outputTokenMax))
}

export function isOverflow(input: {
  cfg: ConfigV1.Info
  tokens: SessionV1.Assistant["tokens"]
  model: Provider.Model
  outputTokenMax?: number
}) {
  if (input.cfg.compaction?.auto === false) return false
  if (input.model.limit.context === 0) return false

  const count =
    input.tokens.total || input.tokens.input + input.tokens.output + input.tokens.cache.read + input.tokens.cache.write
  return count >= usable(input)
}

export function contextUsage(input: {
  tokens: SessionV1.Assistant["tokens"]
  model: Provider.Model
  cfg: ConfigV1.Info
  outputTokenMax?: number
}) {
  const used =
    input.tokens.input + input.tokens.output + input.tokens.reasoning + input.tokens.cache.read + input.tokens.cache.write
  const usableValue = usable(input)
  const pct = usableValue > 0 ? Math.round((used / usableValue) * 100) : 0
  const preserveBudget =
    input.cfg.compaction?.preserve_recent_tokens ??
    Math.min(PRESERVE_MAX_TOKENS, Math.max(PRESERVE_MIN_TOKENS, Math.floor(usableValue * 0.25)))
  const etaTurns =
    usableValue <= 0 ? null : used >= usableValue ? 0 : Math.ceil((usableValue - used) / ETA_TOKENS_PER_TURN)
  return {
    used,
    usable: usableValue,
    pct,
    cacheRead: input.tokens.cache.read,
    cacheWrite: input.tokens.cache.write,
    preserveBudget,
    etaTurns,
    model: {
      providerID: input.model.providerID,
      modelID: input.model.id,
      contextLimit: input.model.limit.context,
    },
  }
}

export * as SessionOverflow from "./overflow"
