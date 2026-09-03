import { describe, expect, test } from "bun:test"
import { buildReviewPrompt } from "../../src/async-run/reviewer"
import { describeEvent, formatRunLines, formatStepLine } from "../../src/async-run/replay"
import { RunID, RunInfo, RunTask } from "../../src/async-run/schema"

const task = new RunTask({
  title: "add login",
  branch: "async/add-login-0",
  directory: "/tmp/wt/add-login",
  status: "pending",
})

const run = new RunInfo({
  id: RunID.create(),
  baseCommit: "abc123",
  directory: "/tmp/repo",
  tasks: [task],
  review: true,
  createdAt: 0,
})

describe("AsyncRunReviewer", () => {
  test("buildReviewPrompt() names task, branch, and verdict line", () => {
    const prompt = buildReviewPrompt({ run, task })
    expect(prompt).toContain("add login")
    expect(prompt).toContain("async/add-login-0")
    expect(prompt).toContain("abc123")
    expect(prompt).toContain("APPROVE")
  })
})

describe("AsyncRunReplay", () => {
  test("formatStepLine() prefixes the step type", () => {
    expect(formatStepLine({ type: "tool", detail: "ok call_1" })).toBe("[tool] ok call_1")
  })

  test("describeEvent() summarizes tool and step events", () => {
    expect(describeEvent({ type: "session.next.tool.called", data: { tool: "read", callID: "call_1" } })).toBe(
      "[tool] read",
    )
    expect(describeEvent({ type: "session.next.step.failed", data: {} })).toBe("[step] failed")
  })

  test("formatRunLines() lists run and tasks", () => {
    const lines = formatRunLines(run)
    expect(lines[0]).toContain("tasks 1")
    expect(lines[1]).toContain("add login")
  })
})
