// Cron-ish schedule specs. Intentionally small: intervals plus daily times.
// Supported: "every 30s", "every 15m", "every 2h", "daily 09:30", "every day 09:30".
// Pure and dependency-free so server handlers and the opencode runner share it.

export type IntervalSchedule = {
  kind: "interval"
  everyMs: number
}

export type DailySchedule = {
  kind: "daily"
  hour: number
  minute: number
}

export type Schedule = IntervalSchedule | DailySchedule

export class ScheduleSpecError extends Error {
  constructor(readonly spec: string) {
    super(`Invalid schedule spec: ${spec}`)
    this.name = "ScheduleSpecError"
  }
}

const intervalPattern = /^every\s+(\d+)\s*([smh])$/i
const dailyPattern = /^(?:every\s+day|daily)\s+(\d{1,2}):(\d{2})$/i

export function parseSchedule(spec: string): Schedule {
  const input = spec.trim()
  const interval = intervalPattern.exec(input)
  if (interval) {
    const amount = Number(interval[1])
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new ScheduleSpecError(spec)
    const unit = interval[2]!.toLowerCase()
    const everyMs = amount * (unit === "s" ? 1000 : unit === "m" ? 60_000 : 3_600_000)
    return { kind: "interval", everyMs }
  }
  const daily = dailyPattern.exec(input)
  if (daily) {
    const hour = Number(daily[1])
    const minute = Number(daily[2])
    if (hour > 23 || minute > 59) throw new ScheduleSpecError(spec)
    return { kind: "daily", hour, minute }
  }
  throw new ScheduleSpecError(spec)
}

export function nextFire(schedule: Schedule, fromMs: number): number {
  if (schedule.kind === "interval") return fromMs + schedule.everyMs
  // Next local-time occurrence of hour:minute strictly after fromMs.
  const from = new Date(fromMs)
  const candidate = new Date(from)
  candidate.setHours(schedule.hour, schedule.minute, 0, 0)
  if (candidate.getTime() <= fromMs) candidate.setDate(candidate.getDate() + 1)
  return candidate.getTime()
}
