import { Show, createMemo } from "solid-js"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { useProviders } from "@/hooks/use-providers"
import { useLanguage } from "@/context/language"
import { getSessionContext } from "@/components/session/session-context-metrics"

export function SessionContextMeter(props: { sessionID: string }) {
  const sync = useSync()
  const sdk = useSDK()
  const language = useLanguage()
  const providers = useProviders(() => sdk().directory)

  const messages = createMemo(() => sync().data.message[props.sessionID] ?? [])
  const session = createMemo(() => sync().session.get(props.sessionID))
  const base = createMemo(() => getSessionContext(messages(), [...providers.all().values()]))

  const meter = createMemo(() => {
    const ctx = base()
    if (!ctx) return
    if (!ctx.limit) return
    const usable = Math.max(0, ctx.limit - 32_000)
    if (usable <= 0) return
    const used = ctx.total
    const pct = Math.round((used / usable) * 100)
    const color = pct >= 85 ? "#dc2626" : pct >= 60 ? "#ca8a04" : "#16a34a"
    const cacheRead = ctx.message.tokens.cache.read
    const cacheWrite = ctx.message.tokens.cache.write
    const eta = used >= usable ? 0 : Math.ceil((usable - used) / 10_000)
    const intl = language.intl()
    const cost = session()?.cost ?? 0
    const money =
      cost > 0
        ? new Intl.NumberFormat(intl, { style: "currency", currency: "USD" }).format(cost)
        : undefined
    const text = [
      `${used.toLocaleString(intl)}/${usable.toLocaleString(intl)} (${pct}%)`,
      `cache ${cacheRead.toLocaleString(intl)}/${cacheWrite.toLocaleString(intl)}`,
      `compact in ~${eta}`,
      money,
    ]
      .filter(Boolean)
      .join(" · ")
    return { text, color, pct }
  })

  return (
    <Show when={meter()}>
      {(item) => (
        <span
          style={{ color: item().color }}
          title={`${language.t("context.usage.tokens")}: ${base()?.total.toLocaleString(language.intl()) ?? "0"}`}
          aria-label={language.t("context.usage.view")}
        >
          {item().text}
        </span>
      )}
    </Show>
  )
}
