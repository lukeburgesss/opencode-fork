import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"

// Scaffold-only copy: move to i18n `remote.*` keys (plus every locale) before production use.
const STORE_TOKEN = "opencode.remote.token"
const STORE_URL = "opencode.remote.url"

type SessionRow = { id: string; title?: string }

export default function RemotePage() {
  const [baseUrl, setBaseUrl] = createSignal(localStorage.getItem(STORE_URL) ?? window.location.origin)
  const [token, setToken] = createSignal(localStorage.getItem(STORE_TOKEN) ?? "")
  const [sessions, setSessions] = createSignal<SessionRow[]>([])
  const [activeID, setActiveID] = createSignal<string | undefined>(undefined)
  const [prompt, setPrompt] = createSignal("")
  const [events, setEvents] = createSignal<string[]>([])
  const [permissions, setPermissions] = createSignal<Array<{ id: string }>>([])
  const [error, setError] = createSignal<string | undefined>(undefined)

  const client = createMemo(() =>
    createOpencodeClient({
      baseUrl: baseUrl().replace(/\/$/, ""),
      headers: token() ? { Authorization: `Bearer ${token()}` } : undefined,
    }),
  )

  const refresh = async () => {
    setError(undefined)
    try {
      const result = await client().v2.session.list()
      setSessions(((result.data as { data: SessionRow[] }).data ?? []) as SessionRow[])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  createEffect(() => {
    void client()
    void refresh()
  })

  createEffect(() => {
    const id = activeID()
    if (!id) return
    const url = `${baseUrl().replace(/\/$/, "")}/api/session/${id}/event${token() ? `?auth_token=${encodeURIComponent(token())}` : ""}`
    const source = new EventSource(url)
    source.onmessage = (event) => setEvents((current) => [...current.slice(-99), String(event.data)])
    source.onerror = () => source.close()
    onCleanup(() => source.close())
  })

  createEffect(() => {
    const id = activeID()
    if (!id) return
    // Re-poll when new events arrive.
    void events().length
    client()
      .v2.session.permission.list({ sessionID: id })
      .then((result) => setPermissions(((result.data as { data: Array<{ id: string }> }).data ?? []) as Array<{
        id: string
      }>))
      .catch(() => setPermissions([]))
  })

  const send = async () => {
    const id = activeID()
    const text = prompt().trim()
    if (!id || !text) return
    await client().v2.session.prompt({ sessionID: id, prompt: { text } })
    setPrompt("")
  }

  return (
    <div style={{ padding: "16px", "max-width": "720px", margin: "0 auto" }}>
      <h1>Remote</h1>
      <Show when={error()}>
        <p role="alert">{error()}</p>
      </Show>
      <label>
        Server URL
        <input
          value={baseUrl()}
          onInput={(event) => {
            const next = event.currentTarget.value
            setBaseUrl(next)
            localStorage.setItem(STORE_URL, next)
          }}
        />
      </label>
      <label>
        Device token
        <input
          type="password"
          value={token()}
          onInput={(event) => {
            const next = event.currentTarget.value.trim()
            setToken(next)
            localStorage.setItem(STORE_TOKEN, next)
          }}
        />
      </label>
      <button type="button" onClick={() => void refresh()}>
        Refresh sessions
      </button>
      <ul>
        <For each={sessions()}>
          {(session) => (
            <li>
              <button type="button" onClick={() => setActiveID(session.id)}>
                {session.title || session.id}
              </button>
            </li>
          )}
        </For>
      </ul>
      <Show when={activeID()}>
        {(id) => (
          <>
            <textarea value={prompt()} onInput={(event) => setPrompt(event.currentTarget.value)} rows={3} />
            <button type="button" disabled={!prompt().trim()} onClick={() => void send()}>
              Send
            </button>
            <button type="button" onClick={() => void client().v2.session.interrupt({ sessionID: id() })}>
              Interrupt
            </button>
            <ul>
              <For each={permissions()}>
                {(request) => (
                  <li>
                    <span>{request.id}</span>
                    <button
                      type="button"
                      onClick={() =>
                        void client().v2.session.permission.reply({ sessionID: id(), requestID: request.id, reply: "once" })
                      }
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void client().v2.session.permission.reply({ sessionID: id(), requestID: request.id, reply: "reject" })
                      }
                    >
                      Deny
                    </button>
                  </li>
                )}
              </For>
            </ul>
            <ol>
              <For each={events()}>{(event) => <li>{event}</li>}</For>
            </ol>
          </>
        )}
      </Show>
    </div>
  )
}
