import { For, Show } from "solid-js"

// Scaffold-only copy: move to i18n `approvals.*` keys (plus every locale) before production use.
export type ApprovalDecision = "once" | "always" | "deny"

export type ApprovalRow = {
  id: string
  action: string
  sessionID?: string
  resources: string[]
  created_at: number
  expires_at: number
  status: string
  decision?: ApprovalDecision
}

export type ApprovalJobRow = {
  id: string
  type: string
  title?: string
  status: string
  started_at: number
  completed_at?: number
  output?: string
  error?: string
}

export function approvalRemaining(expires_at: number, now = Date.now()) {
  const remaining = expires_at - now
  if (remaining <= 0) return "expired"
  const total = Math.floor(remaining / 1000)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, "0")} left`
}

// Lists pending approvals plus background jobs with approve/deny actions.
// Data comes from the unified `/api/approval` queue (fetch with the device
// Bearer token); decisions flow out via onDecide so hosts can use fetch until
// SDK codegen lands.
export function ApprovalsDashboard(props: {
  approvals: ApprovalRow[]
  jobs: ApprovalJobRow[]
  loading?: boolean
  onDecide: (requestID: string, decision: ApprovalDecision) => void
}) {
  return (
    <section style={{ display: "flex", "flex-direction": "column", gap: "12px" }}>
      <h2>Approvals ({props.approvals.length} pending)</h2>
      <Show when={props.loading}>
        <p>Loading…</p>
      </Show>
      <Show when={!props.loading && props.approvals.length === 0}>
        <p>No pending approvals</p>
      </Show>
      <ul style={{ display: "flex", "flex-direction": "column", gap: "8px", padding: 0, "list-style": "none" }}>
        <For each={props.approvals}>
          {(row) => (
            <li
              style={{ border: "1px solid #ccc", "border-radius": "8px", padding: "8px", display: "flex", "flex-direction": "column", gap: "4px" }}
            >
              <div style={{ display: "flex", gap: "8px", "align-items": "baseline" }}>
                <strong>{row.action}</strong>
                <Show when={row.sessionID}>
                  <span>{row.sessionID}</span>
                </Show>
                <span>{approvalRemaining(row.expires_at)}</span>
              </div>
              <Show when={row.resources.length > 0}>
                <span>{row.resources.join(", ")}</span>
              </Show>
              <div style={{ display: "flex", gap: "8px" }}>
                <button type="button" onClick={() => props.onDecide(row.id, "once")}>
                  Approve
                </button>
                <button type="button" onClick={() => props.onDecide(row.id, "always")}>
                  Always
                </button>
                <button type="button" onClick={() => props.onDecide(row.id, "deny")}>
                  Deny
                </button>
              </div>
            </li>
          )}
        </For>
      </ul>
      <h2>Background jobs ({props.jobs.length})</h2>
      <Show when={props.jobs.length === 0}>
        <p>No background jobs</p>
      </Show>
      <ul style={{ display: "flex", "flex-direction": "column", gap: "8px", padding: 0, "list-style": "none" }}>
        <For each={props.jobs}>
          {(job) => (
            <li style={{ display: "flex", gap: "8px" }}>
              <span>{job.status}</span>
              <span>{job.title || job.type}</span>
            </li>
          )}
        </For>
      </ul>
    </section>
  )
}
