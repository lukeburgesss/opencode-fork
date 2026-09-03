import { describe, expect, test } from "bun:test"
import { nextFire, parseSchedule, ScheduleSpecError } from "@/schedules/parser"

describe("parseSchedule", () => {
  test("parses interval specs", () => {
    expect(parseSchedule("every 30s")).toEqual({ kind: "interval", everyMs: 30_000 })
    expect(parseSchedule("every 15m")).toEqual({ kind: "interval", everyMs: 900_000 })
    expect(parseSchedule("every 2h")).toEqual({ kind: "interval", everyMs: 7_200_000 })
    expect(parseSchedule("every 90 m")).toEqual({ kind: "interval", everyMs: 5_400_000 })
  })

  test("parses daily specs", () => {
    expect(parseSchedule("daily 09:30")).toEqual({ kind: "daily", hour: 9, minute: 30 })
    expect(parseSchedule("every day 9:05")).toEqual({ kind: "daily", hour: 9, minute: 5 })
  })

  test("rejects invalid specs", () => {
    for (const spec of ["", "sometimes", "every 0m", "every -5m", "daily 25:00", "daily 09:60", "daily 9:3", "weekly"]) {
      expect(() => parseSchedule(spec), spec).toThrow(ScheduleSpecError)
    }
  })
})

describe("nextFire", () => {
  test("interval adds duration to anchor", () => {
    expect(nextFire({ kind: "interval", everyMs: 60_000 }, 1_000)).toBe(61_000)
  })

  test("daily fires later the same day", () => {
    const from = new Date(2026, 8, 3, 8, 0, 0).getTime()
    const next = new Date(nextFire({ kind: "daily", hour: 9, minute: 30 }, from))
    expect([next.getFullYear(), next.getMonth(), next.getDate()]).toEqual([2026, 8, 3])
    expect([next.getHours(), next.getMinutes()]).toEqual([9, 30])
  })

  test("daily rolls to the next day after the time passes", () => {
    const from = new Date(2026, 8, 3, 10, 0, 0).getTime()
    const next = new Date(nextFire({ kind: "daily", hour: 9, minute: 30 }, from))
    expect([next.getFullYear(), next.getMonth(), next.getDate()]).toEqual([2026, 8, 4])
    expect([next.getHours(), next.getMinutes()]).toEqual([9, 30])
  })

  test("daily at the exact time fires the next day", () => {
    const from = new Date(2026, 8, 3, 9, 30, 0).getTime()
    const next = new Date(nextFire({ kind: "daily", hour: 9, minute: 30 }, from))
    expect([next.getMonth(), next.getDate()]).toEqual([8, 4])
  })
})
