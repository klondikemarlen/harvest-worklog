import assert from "node:assert/strict"
import test from "node:test"

import { createProjectTimeTool, workEntryArguments } from "../index.js"
import { parseProjectTimeMappings, projectTimeEntries } from "../project-time.js"

const schema = () => ({
  regex() { return this },
  min() { return this },
  positive() { return this },
  finite() { return this },
  optional() { return this },
})
const z = {
  string: schema,
  number: schema,
  boolean: schema,
  object: shape => shape,
}

test("maps and splits Project Time sessions by local Harvest date", () => {
  const mappings = parseProjectTimeMappings(JSON.stringify({
    "Harvest API": { project: "Internal", task: "Development" },
  }))
  const startAtMs = new Date(2026, 6, 17, 23, 30).getTime()
  const endAtMs = new Date(2026, 6, 18, 1, 30).getTime()

  const plan = projectTimeEntries(
    { entries: [{ project: "Harvest API", repositoryId: "klondikemarlen/harvest-api-v2", startAtMs, endAtMs }] },
    mappings,
    { from: "2026-07-17", to: "2026-07-18" },
  )

  assert.equal(plan.unmapped, 0)
  assert.deepEqual(
    plan.entries.map(({ spentDate, project, task, hours }) => ({ spentDate, project, task, hours })),
    [
      { spentDate: "2026-07-17", project: "Internal", task: "Development", hours: 0.5 },
      { spentDate: "2026-07-18", project: "Internal", task: "Development", hours: 1.5 },
    ],
  )
  assert.match(plan.entries[0].notes, /Harvest API \(klondikemarlen\/harvest-api-v2\)/)
})

test("previews mapped Project Time entries without writing", async () => {
  const calls = []
  const preview = createProjectTimeTool(z, {
    command: "harvest-worklog",
    projectTimeMappings: JSON.stringify({
      "Harvest API": { project: "Internal", task: "Development" },
    }),
    loadEntries: async () => ({
      entries: [{ spentDate: "2026-07-17", project: "Internal", task: "Development", hours: 1.25, notes: "OMP Project Time: Harvest API (repo)" }],
      unmapped: 1,
    }),
    run: async (...args) => {
      calls.push(args)
      return { code: 0, stdout: "Would create 2026-07-17", stderr: "" }
    },
  }, { dryRun: true })

  const result = await preview.execute("call-1", { from: "2026-07-17", to: "2026-07-17" }, undefined, undefined, { cwd: "/tmp" })

  assert.equal(preview.approval, "read")
  assert.deepEqual(calls, [[
    "harvest-worklog",
    ["work-entry", "2026-07-17", "--project", "Internal", "--task", "Development", "--hours", "1.25", "--notes", "OMP Project Time: Harvest API (repo)", "--dry-run"],
    { cwd: "/tmp", signal: undefined },
  ]])
  assert.match(result.content[0].text, /Would create 2026-07-17/)
  assert.match(result.content[0].text, /Skipped 1 unmapped session/)

  const record = createProjectTimeTool(z, {}, { dryRun: false })
  assert.equal(record.approval, "write")
  assert.deepEqual(
    workEntryArguments({ spentDate: "2026-07-17", project: "Internal", task: "Development", hours: 1.25, notes: "OMP Project Time: Harvest API (repo)" }, false),
    ["work-entry", "2026-07-17", "--project", "Internal", "--task", "Development", "--hours", "1.25", "--notes", "OMP Project Time: Harvest API (repo)"],
  )
})
