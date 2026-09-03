import { For, Show } from "solid-js"
import { useTheme, selectedForeground } from "../../context/theme"

export type ApprovalDecision = "once" | "always" | "deny"

export type ApprovalRow = {
  id: string
  action: string
  sessionID?: string
  resources?: string[]
  created_at?: number
  expires_at?: number
  status?: string
}

export type ApprovalJobRow = {
  id: string
  type: string
  title?: string
  status: string
}

export function approvalRemaining(expires_at?: number, now = Date.now()) {
  if (expires_at === undefined) return undefined
  const remaining = expires_at - now
  if (remaining <= 0) return "expired"
  const total = Math.floor(remaining / 1000)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}

// Dashboard listing pending approvals plus background jobs. Prop-driven so the
// parent can source rows from `permission.request.list` today and the unified
// `/api/approval` queue after SDK codegen; decisions flow out via onDecide.
export function ApprovalsView(props: {
  approvals: ApprovalRow[]
  jobs: ApprovalJobRow[]
  onDecide: (requestID: string, decision: ApprovalDecision) => void
}) {
  const { theme } = useTheme()

  return (
    <box flexDirection="column" gap={1}>
      <box flexDirection="row" gap={1} flexShrink={0}>
        <text fg={theme.warning}>{"△"}</text>
        <text fg={theme.text}>Approvals ({props.approvals.length} pending)</text>
      </box>
      <Show when={props.approvals.length === 0}>
        <box paddingLeft={2}>
          <text fg={theme.textMuted}>No pending approvals</text>
        </box>
      </Show>
      <For each={props.approvals}>
        {(row) => (
          <box
            backgroundColor={theme.backgroundPanel}
            border={["left"]}
            borderColor={theme.warning}
            flexDirection="column"
            gap={0}
            paddingLeft={1}
            paddingRight={1}
          >
            <box flexDirection="row" gap={1}>
              <text fg={theme.text}>{row.action}</text>
              <Show when={row.sessionID}>
                <text fg={theme.textMuted}>{row.sessionID}</text>
              </Show>
              <Show when={approvalRemaining(row.expires_at)}>
                <text fg={theme.textMuted}>{approvalRemaining(row.expires_at)}</text>
              </Show>
            </box>
            <box flexDirection="row" gap={1}>
              <DecisionButton label="Allow once" onSelect={() => props.onDecide(row.id, "once")} />
              <DecisionButton label="Allow always" onSelect={() => props.onDecide(row.id, "always")} />
              <DecisionButton label="Reject" onSelect={() => props.onDecide(row.id, "deny")} />
            </box>
          </box>
        )}
      </For>
      <box flexDirection="row" gap={1} flexShrink={0}>
        <text fg={theme.text}>Background jobs ({props.jobs.length})</text>
      </box>
      <Show when={props.jobs.length === 0}>
        <box paddingLeft={2}>
          <text fg={theme.textMuted}>No background jobs</text>
        </box>
      </Show>
      <For each={props.jobs}>
        {(job) => (
          <box flexDirection="row" gap={1} paddingLeft={2}>
            <text fg={theme.textMuted}>{job.status}</text>
            <text fg={theme.text}>{job.title ?? job.type}</text>
          </box>
        )}
      </For>
    </box>
  )
}

function DecisionButton(props: { label: string; onSelect: () => void }) {
  const { theme } = useTheme()
  return (
    <box
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={theme.backgroundMenu}
      onMouseUp={() => props.onSelect()}
    >
      <text fg={selectedForeground(theme, theme.backgroundMenu)}>{props.label}</text>
    </box>
  )
}
