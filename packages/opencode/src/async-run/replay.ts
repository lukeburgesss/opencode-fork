import { Effect } from "effect"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionID } from "@/session/schema"
import { get } from "./manager"
import { formatReplay, pendingIntents, read } from "./log"
import { RunInfo } from "./schema"

export function formatStepLine(input: { type: string; detail: string }): string {
  return `[${input.type}] ${input.detail}`
}

export function describeEvent(event: { type: string; data: unknown }): string {
  const props = event.data as unknown as Record<string, unknown>
  const text = (key: string) => (typeof props[key] === "string" ? (props[key] as string) : undefined)
  if (event.type === "session.next.prompted" || event.type === "session.next.prompt.admitted")
    return formatStepLine({ type: "prompt", detail: text("messageID") ?? "admitted" })
  if (event.type === "session.next.step.started")
    return formatStepLine({ type: "step", detail: `start ${text("assistantMessageID") ?? ""}`.trim() })
  if (event.type === "session.next.step.ended")
    return formatStepLine({ type: "step", detail: `end finish=${text("finish") ?? "unknown"}` })
  if (event.type === "session.next.step.failed") return formatStepLine({ type: "step", detail: "failed" })
  if (event.type === "session.next.tool.called")
    return formatStepLine({ type: "tool", detail: text("tool") ?? text("callID") ?? "called" })
  if (event.type === "session.next.tool.success")
    return formatStepLine({ type: "tool", detail: `ok ${text("callID") ?? ""}`.trim() })
  if (event.type === "session.next.tool.failed")
    return formatStepLine({ type: "tool", detail: `error ${text("callID") ?? ""}`.trim() })
  if (event.type === "session.next.text.ended") return formatStepLine({ type: "text", detail: "ended" })
  return formatStepLine({ type: event.type, detail: text("messageID") ?? text("callID") ?? "" })
}

export function formatRunLines(info: typeof RunInfo.Type): Array<string> {
  const lines = [`run ${info.id} base ${info.baseCommit} tasks ${info.tasks.length}`]
  for (const task of info.tasks) lines.push(`task ${task.title} [${task.status}] ${task.directory}`)
  return lines
}

export const replaySession = Effect.fn("AsyncRunReplay.session")(function* (input: {
  sessionID: string
  limit?: number
}) {
  const session = yield* SessionV2.Service
  const page = yield* session.history({
    sessionID: SessionID.make(input.sessionID),
    limit: input.limit ?? 100,
  })
  return page.events.map((event) => describeEvent(event))
})

export const replayRun = Effect.fn("AsyncRunReplay.run")(function* (input: { directory: string; id: string }) {
  const info = yield* get({ directory: input.directory, id: input.id })
  const lines: Array<string> = formatRunLines(info)
  const events = yield* read({ directory: input.directory, runID: input.id }).pipe(
    Effect.orElseSucceed(() => []),
  )
  for (const line of formatReplay(events)) lines.push(`  ${line}`)
  const pending = pendingIntents(events)
  if (pending.length > 0) {
    lines.push(`pending ${pending.length} unfinished action(s) — resume to continue:`)
    for (const event of pending) lines.push(`  ! ${event.action}${event.task ? ` [${event.task}]` : ""}`)
  }
  for (const task of info.tasks) {
    if (!task.sessionID) continue
    const steps = yield* replaySession({ sessionID: task.sessionID }).pipe(Effect.orElseSucceed(() => []))
    for (const step of steps) lines.push(`  ${step}`)
  }
  return lines
})

export * as AsyncRunReplay from "./replay"
