import assert from "node:assert/strict"
import test from "node:test"

import harvestTimeExtension, { aggregateArguments, createTimeAggregateTool, createTimeOffTool, createTimesheetTool, harvestWorklogArgumentCompletions, parseCommandArguments, parseHarvestWorklogArguments, timeOffArguments, timesheetArguments } from "../index.js"

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

test("builds a safe CLI argument vector", () => {
  assert.deepEqual(
    timeOffArguments({
      from: "2026-07-17",
      to: "2026-07-20",
      project: "Time Off - Marlen",
      task: "Vacation / PTO",
      hours: 7.5,
      notes: "Vacation",
      dryRun: true,
    }),
    [
      "time-off", "2026-07-17", "2026-07-20", "--project", "Time Off - Marlen", "--task", "Vacation / PTO",
      "--hours", "7.5", "--notes", "Vacation", "--dry-run",
    ],
  )
})

test("registers a read-only aggregate tool", async () => {
  const calls = []
  const tool = createTimeAggregateTool(z, {
    command: "harvest-worklog",
    run: async (...args) => {
      calls.push(args)
      return { code: 0, stdout: "2 entries, 8.5h", stderr: "" }
    },
  })

  const result = await tool.execute(
    "call-aggregate",
    { from: "2026-07-17", to: "2026-07-19", project: "WRAP", task: "Programming" },
    undefined,
    undefined,
    { cwd: "/tmp" },
  )

  assert.equal(tool.approval, "read")
  assert.deepEqual(
    aggregateArguments({ from: "2026-07-17", to: "2026-07-19", project: "WRAP", task: "Programming" }),
    ["aggregate", "2026-07-17", "2026-07-19", "--project", "WRAP", "--task", "Programming"],
  )
  assert.deepEqual(calls, [[
    "harvest-worklog",
    ["aggregate", "2026-07-17", "2026-07-19", "--project", "WRAP", "--task", "Programming"],
    { cwd: "/tmp", signal: undefined },
  ]])
  assert.equal(result.content[0].text, "2 entries, 8.5h")
})

test("registers a read-only daily timesheet wrapper", async () => {
  const calls = []
  const tool = createTimesheetTool(z, {
    command: "harvest-worklog",
    run: async (...args) => {
      calls.push(args)
      return { code: 0, stdout: "WRAP · Fri, Jul 17 · 7h", stderr: "" }
    },
  })

  const result = await tool.execute(
    "call-timesheet",
    { date: "today", project: "WRAP", task: "Programming" },
    undefined,
    undefined,
    { cwd: "/tmp" },
  )

  assert.equal(tool.approval, "read")
  assert.deepEqual(
    timesheetArguments({ date: "today", project: "WRAP", task: "Programming" }),
    ["timesheet", "today", "--project", "WRAP", "--task", "Programming"],
  )
  assert.deepEqual(calls, [[
    "harvest-worklog",
    ["timesheet", "today", "--project", "WRAP", "--task", "Programming"],
    { cwd: "/tmp", signal: undefined },
  ]])
  assert.equal(result.content[0].text, "WRAP · Fri, Jul 17 · 7h")
})

test("registers an approval-gated OMP write tool", async () => {
  const calls = []
  const tool = createTimeOffTool(z, {
    command: "harvest-worklog",
    run: async (...args) => {
      calls.push(args)
      return { code: 0, stdout: "Created 2026-07-17", stderr: "" }
    },
  })

  const result = await tool.execute(
    "call-1",
    { from: "2026-07-17", to: "2026-07-17", project: "Time Off - Marlen", task: "Vacation / PTO" },
    undefined,
    undefined,
    { cwd: "/tmp" },
  )

  assert.equal(tool.approval, "write")
  assert.deepEqual(calls, [[
    "harvest-worklog",
    ["time-off", "2026-07-17", "2026-07-17", "--project", "Time Off - Marlen", "--task", "Vacation / PTO", "--hours", "7"],
    { cwd: "/tmp", signal: undefined },
  ]])
  assert.equal(result.content[0].text, "Created 2026-07-17")
})

test("uses configured default hours and holiday regions", async () => {
  const calls = []
  const tool = createTimeOffTool(z, {
    defaultHours: 6.5,
    holidayRegions: "ca_yt, ca",
    run: async (...args) => {
      calls.push(args)
      return { code: 0, stdout: "Created", stderr: "" }
    },
  })

  await tool.execute(
    "call-2",
    { from: "2026-08-17", to: "2026-08-28", project: "Time Off - Marlen", task: "Vacation / PTO" },
    undefined,
    undefined,
    { cwd: "/tmp" },
  )

  assert.deepEqual(calls[0][1], [
    "time-off", "2026-08-17", "2026-08-28", "--project", "Time Off - Marlen", "--task", "Vacation / PTO",
    "--hours", "6.5", "--holiday-region", "ca_yt", "--holiday-region", "ca",
  ])
})

test("completes base CLI commands, dates, and options contextually", () => {
  assert.deepEqual(
    harvestWorklogArgumentCompletions("").slice(0, 4).map(item => item.value),
    ["timesheet", "aggregate", "time-off", "work-entry"],
  )
  assert.deepEqual(harvestWorklogArgumentCompletions("ti").map(item => item.value), ["timesheet", "time-off"])
  assert.deepEqual(harvestWorklogArgumentCompletions("timesheet t").map(item => item.value), ["timesheet today"])
  assert.deepEqual(
    harvestWorklogArgumentCompletions("timesheet today ").map(item => item.value),
    ["timesheet today --project", "timesheet today --help"],
  )
  assert.deepEqual(
    harvestWorklogArgumentCompletions("timesheet today --project WRAP ").map(item => item.value),
    ["timesheet today --project WRAP --task", "timesheet today --project WRAP --help"],
  )
  assert.deepEqual(harvestWorklogArgumentCompletions("today WRAP ").map(item => item.value), ["today WRAP --task"])
  assert.match(harvestWorklogArgumentCompletions("aggregate ")[0].value, /^aggregate \d{4}-\d{2}-\d{2}$/)
  assert.deepEqual(
    harvestWorklogArgumentCompletions("time-off 2026-08-17 2026-08-28 --d").map(item => item.value),
    ["time-off 2026-08-17 2026-08-28 --dry-run"],
  )
  assert.deepEqual(
    harvestWorklogArgumentCompletions("work-entry 2026-07-20 ").map(item => item.label),
    ["--project", "--project-id", "--hours", "--notes", "--dry-run", "--activity-entry", "--help"],
  )
  assert.ok(
    harvestWorklogArgumentCompletions("time-off 2026-08-17 2026-08-28 --project PTO --task Vacation --holiday-region ca_yt ")
      .some(item => item.label === "--holiday-region"),
  )
})

test("parses quoted base CLI and compact timesheet arguments", () => {
  assert.deepEqual(
    parseCommandArguments("time-off today --project 'Time Off - Marlen' --dry-run"),
    ["time-off", "today", "--project", "Time Off - Marlen", "--dry-run"],
  )
  assert.deepEqual(
    parseHarvestWorklogArguments("timesheet today --project 'Ice Fog Analytics' --task Programming"),
    { argv: ["timesheet", "today", "--project", "Ice Fog Analytics", "--task", "Programming"] },
  )
  assert.deepEqual(
    parseHarvestWorklogArguments("today Ice Fog Analytics --task Programming"),
    { argv: ["timesheet", "today", "--project", "Ice Fog Analytics", "--task", "Programming"] },
  )
  assert.deepEqual(
    parseHarvestWorklogArguments("today 'Ice Fog Analytics' --task 'Planning and review'"),
    { argv: ["timesheet", "today", "--project", "Ice Fog Analytics", "--task", "Planning and review"] },
  )
  assert.equal(parseCommandArguments("timesheet today --project 'WRAP"), null)
})

test("registers autocomplete and delegates slash commands to the CLI", async () => {
  const tools = []
  const commands = []
  const calls = []
  const messages = []
  const notifications = []
  let confirmed = false
  harvestTimeExtension({
    zod: { z },
    registerTool(tool) { tools.push(tool) },
    registerCommand(name, command) { commands.push({ name, command }) },
    sendMessage(message, options) { messages.push({ message, options }) },
  }, {
    run: async (...args) => {
      calls.push(args)
      return { code: 0, stdout: "CLI output", stderr: "" }
    },
  })

  const ui = {
    notify(message, type) { notifications.push({ message, type }) },
    confirm: async () => confirmed,
  }
  const command = commands[0].command

  assert.equal(commands[0].name, "harvest-worklog")
  assert.equal(command.getArgumentCompletions, harvestWorklogArgumentCompletions)
  await command.handler("", { cwd: "/tmp", ui })
  assert.match(notifications[0].message, /Commands: timesheet, aggregate, time-off, work-entry/)

  await command.handler("today WRAP", { cwd: "/tmp", ui })
  assert.deepEqual(calls[0], [
    "harvest-worklog",
    ["timesheet", "today", "--project", "WRAP"],
    { cwd: "/tmp" },
  ])
  assert.equal(messages[0].message.customType, "harvest-worklog-cli")
  await command.handler("time-off --help", { cwd: "/tmp", ui })
  assert.deepEqual(calls[1][1], ["time-off", "--help"])

  await command.handler("time-off 2026-08-17 2026-08-17 --project PTO --task Vacation", { cwd: "/tmp", ui })
  assert.equal(calls.length, 2)
  confirmed = true
  await command.handler("time-off 2026-08-17 2026-08-17 --project PTO --task Vacation", { cwd: "/tmp", ui })
  assert.deepEqual(calls[2][1], ["time-off", "2026-08-17", "2026-08-17", "--project", "PTO", "--task", "Vacation"])

  assert.deepEqual(
    tools.map(tool => tool.name),
    [
      "harvest_time_aggregates",
      "harvest_time_sheet",
      "harvest_record_time_off",
      "harvest_preview_project_time_entries",
      "harvest_record_project_time_entries",
      "harvest_preview_project_time_transforms",
      "harvest_record_project_time_transforms",
    ],
  )
})
