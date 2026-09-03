import { createResource, Match, Switch } from "solid-js"

// Scaffold-only copy (like remote.tsx): move to i18n `remote.*` keys before production use.
// Plain fetch so no SDK codegen is needed for the new /api/spend endpoints.

export interface SpendSummary {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  totalTokens: number
  costUSD: number
}

async function fetchSpend(baseUrl: string, token: string): Promise<SpendSummary> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/spend/summary`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
  if (!response.ok) throw new Error(`Spend summary failed: ${response.status}`)
  return ((await response.json()) as { data: SpendSummary }).data
}

export function SpendDashboard(props: { baseUrl: string; token: string }) {
  const [summary, { refetch }] = createResource(
    () => `${props.baseUrl}|${props.token}`,
    () => fetchSpend(props.baseUrl, props.token),
  )

  const usd = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" })

  return (
    <section aria-label="Spend">
      <h2>Spend today</h2>
      <Switch>
        <Match when={summary.loading}>
          <p>Loading spend…</p>
        </Match>
        <Match when={summary.error}>
          <p role="alert">Spend unavailable</p>
        </Match>
        <Match when={summary()}>
          {(item) => (
            <>
              <p>
                {usd.format(item().costUSD)} · {item().totalTokens.toLocaleString()} tokens (in{" "}
                {item().input.toLocaleString()} / out {item().output.toLocaleString()} / cache{" "}
                {item().cacheRead.toLocaleString()}/{item().cacheWrite.toLocaleString()})
              </p>
              <button type="button" onClick={() => void refetch()}>
                Refresh spend
              </button>
            </>
          )}
        </Match>
      </Switch>
    </section>
  )
}
