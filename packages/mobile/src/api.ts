// Minimal fetch wrapper for the opencode mobile remote.
// Uses fetch + EventSource only; no native modules.

export type SessionSummary = {
  id: string
  title?: string
  directory?: string
}

export type RemoteConfig = {
  baseUrl: string
  token?: string
}

function headers(config: RemoteConfig) {
  return {
    "content-type": "application/json",
    ...(config.token ? { authorization: `Bearer ${config.token}` } : {}),
  }
}

function url(config: RemoteConfig, path: string) {
  return `${config.baseUrl.replace(/\/$/, "")}${path}`
}

export async function pairDevice(config: RemoteConfig, code: string) {
  const response = await fetch(url(config, "/api/device/claim"), {
    method: "POST",
    headers: headers(config),
    body: JSON.stringify({ code: code.trim().toUpperCase() }),
  })
  if (!response.ok) throw new Error(`Pair failed: ${response.status}`)
  return (await response.json()) as { data: { token: string; deviceID: string; name: string } }
}

export async function listSessions(config: RemoteConfig) {
  const response = await fetch(url(config, "/api/session"), { headers: headers(config) })
  if (!response.ok) throw new Error(`List sessions failed: ${response.status}`)
  return (await response.json()) as { data: SessionSummary[]; cursor: { next?: string; previous?: string } }
}

export async function sendPrompt(config: RemoteConfig, sessionID: string, prompt: string) {
  const response = await fetch(url(config, `/api/session/${sessionID}/prompt`), {
    method: "POST",
    headers: headers(config),
    body: JSON.stringify({ prompt: { text: prompt } }),
  })
  if (!response.ok) throw new Error(`Prompt failed: ${response.status}`)
  return (await response.json()) as { data: unknown }
}

export async function interruptSession(config: RemoteConfig, sessionID: string) {
  const response = await fetch(url(config, `/api/session/${sessionID}/interrupt`), {
    method: "POST",
    headers: headers(config),
  })
  if (!response.ok) throw new Error(`Interrupt failed: ${response.status}`)
}

export async function listPermissions(config: RemoteConfig, sessionID: string) {
  const response = await fetch(url(config, `/api/session/${sessionID}/permission`), {
    headers: headers(config),
  })
  if (!response.ok) throw new Error(`List permissions failed: ${response.status}`)
  return (await response.json()) as { data: Array<{ id: string; action?: unknown; resources?: unknown }> }
}

export async function replyPermission(
  config: RemoteConfig,
  sessionID: string,
  requestID: string,
  reply: "once" | "always" | "reject",
  message?: string,
) {
  const response = await fetch(url(config, `/api/session/${sessionID}/permission/${requestID}/reply`), {
    method: "POST",
    headers: headers(config),
    body: JSON.stringify({ reply, ...(message ? { message } : {}) }),
  })
  if (!response.ok) throw new Error(`Permission reply failed: ${response.status}`)
}

export type ApprovalDecision = "once" | "always" | "deny"

export type ApprovalItem = {
  id: string
  sessionID?: string
  action: string
  resources: string[]
  created_at: number
  expires_at: number
  timeout_ms: number
  status: "pending" | "decided" | "expired"
  decision?: ApprovalDecision
}

export type BackgroundJobItem = {
  id: string
  type: string
  title?: string
  status: "running" | "completed" | "error" | "cancelled"
  started_at: number
  completed_at?: number
  output?: string
  error?: string
}

export function approvalRemaining(expires_at: number, now = Date.now()) {
  const remaining = expires_at - now
  if (remaining <= 0) return "expired"
  const total = Math.floor(remaining / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")} left`
}

export async function listApprovals(config: RemoteConfig, status?: ApprovalItem["status"]) {
  const query = status ? `?status=${encodeURIComponent(status)}` : ""
  const response = await fetch(url(config, `/api/approval${query}`), { headers: headers(config) })
  if (!response.ok) throw new Error(`List approvals failed: ${response.status}`)
  return (await response.json()) as { data: ApprovalItem[] }
}

export async function decideApproval(
  config: RemoteConfig,
  requestID: string,
  decision: ApprovalDecision,
  message?: string,
) {
  const response = await fetch(url(config, `/api/approval/${requestID}/decide`), {
    method: "POST",
    headers: headers(config),
    body: JSON.stringify({ decision, ...(message ? { message } : {}) }),
  })
  if (!response.ok) throw new Error(`Approval decide failed: ${response.status}`)
}

export async function listBackgroundJobs(config: RemoteConfig) {
  const response = await fetch(url(config, "/api/approval/jobs"), { headers: headers(config) })
  if (!response.ok) throw new Error(`List background jobs failed: ${response.status}`)
  return (await response.json()) as { data: BackgroundJobItem[] }
}

export function sessionEventUrl(config: RemoteConfig, sessionID: string) {
  const separator = config.baseUrl.includes("?") ? "&" : "?"
  const auth = config.token ? `${separator}auth_token=${encodeURIComponent(config.token)}` : ""
  return `${url(config, `/api/session/${sessionID}/event`)}${auth}`
}

export type SessionEventHandler = {
  onMessage: (data: string) => void
  onError?: () => void
}

type EventSourceLike = {
  onmessage: ((event: { data: string }) => void) | null
  onerror: (() => void) | null
  close: () => void
}

// EventSource comes from the host (Expo/RN polyfill or browser); look it up
// dynamically so scaffold typechecks without DOM libs or native modules.
export function openSessionEvents(config: RemoteConfig, sessionID: string, handler: SessionEventHandler) {
  const factory = (globalThis as unknown as { EventSource?: new (url: string) => EventSourceLike }).EventSource
  if (!factory) throw new Error("EventSource is not available")
  const source = new factory(sessionEventUrl(config, sessionID))
  source.onmessage = (event) => handler.onMessage(String(event.data))
  source.onerror = () => handler.onError?.()
  return source
}
