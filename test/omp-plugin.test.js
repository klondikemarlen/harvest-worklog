import assert from "node:assert/strict"
import test from "node:test"

import harvestTimeExtension, { aggregateArguments, createTimeAggregateTool, createTimeOffTool, createTimesheetTool, harvestWorklogArgumentCompletions, parseCommandArguments, parseHarvestWorklogArguments, timeOffArguments, timesheetArguments } from "../index.js"

const schema = () => ({
  regex() { return this },
  min() { return this },
  trim() { return this },
  int() { return this },
  positive() { return this },
  finite() { return this },
  optional() { return this },
})
const z = {
  string: schema,
  number: schema,
  boolean: schema,
  array: schema,
  object: shape => ({
    shape,
    refinements: [],
    refine(predicate) {
      this.refinements.push(predicate)
      return this
    },
  }),
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
  assert.deepEqual(
    timeOffArguments({
      from: "2026-07-17",
      to: "2026-07-20",
      projectId: 123,
      taskId: 456,
      holidayRegions: [" US_CA ", "ca_yt", " "],
    }, { defaultHours: 6.5, holidayRegions: ["ca_yt", "CA_YT"] }),
    [
      "time-off", "2026-07-17", "2026-07-20", "--project-id", "123", "--task-id", "456",
      "--hours", "6.5", "--holiday-region", "ca_yt", "--holiday-region", "us_ca",
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
  const accepts = params => tool.parameters.refinements.every(refinement => refinement(params))
  assert.equal(accepts({ project: "PTO", task: "Vacation" }), true)
  assert.equal(accepts({ projectId: 123, taskId: 456 }), true)
  assert.equal(accepts({}), false)
  assert.equal(accepts({ project: "PTO" }), false)
  assert.equal(accepts({ project: "PTO", task: "Vacation", projectId: 123, taskId: 456 }), false)
  const unconfiguredTool = createTimeOffTool(z, { holidayRegions: "" })
  const acceptsUnconfigured = params => unconfiguredTool.parameters.refinements.every(refinement => refinement(params))
  assert.equal(acceptsUnconfigured({ project: "PTO", task: "Vacation" }), false)
  assert.equal(acceptsUnconfigured({ project: "PTO", task: "Vacation", holidayRegions: ["ca_yt"] }), true)
  assert.deepEqual(calls, [[
    "harvest-worklog",
    [
      "time-off", "2026-07-17", "2026-07-17", "--project", "Time Off - Marlen", "--task", "Vacation / PTO",
      "--hours", "7", "--holiday-region", "ca_yt",
    ],
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
    {
      from: "2026-08-17",
      to: "2026-08-28",
      project: "Time Off - Marlen",
      task: "Vacation / PTO",
      holidayRegions: ["us_ca"],
    },
    undefined,
    undefined,
    { cwd: "/tmp" },
  )

  assert.deepEqual(calls[0][1], [
    "time-off", "2026-08-17", "2026-08-28", "--project", "Time Off - Marlen", "--task", "Vacation / PTO",
    "--hours", "6.5", "--holiday-region", "ca_yt", "--holiday-region", "ca", "--holiday-region", "us_ca",
  ])
})

test("completes the explicit timesheet hierarchy contextually", () => {
  assert.deepEqual(
    harvestWorklogArgumentCompletions("").map(item => item.value),
    ["timesheet", "help"],
  )
  assert.deepEqual(harvestWorklogArgumentCompletions("ti").map(item => item.value), ["timesheet"])
  const dates = harvestWorklogArgumentCompletions("timesheet ")
  assert.deepEqual(dates.slice(0, 2).map(item => item.value), ["timesheet today", "timesheet yesterday"])
  assert.match(dates[2].value, /^timesheet \d{4}-\d{2}-\d{2}$/)
  assert.deepEqual(harvestWorklogArgumentCompletions("timesheet t").map(item => item.value), ["timesheet today"])
  assert.deepEqual(
    harvestWorklogArgumentCompletions("timesheet today ").map(item => item.value),
    ["timesheet today --project", "timesheet today --help"],
  )
  assert.deepEqual(
    harvestWorklogArgumentCompletions("timesheet today --project WRAP ").map(item => item.value),
    ["timesheet today --project WRAP --task", "timesheet today --project WRAP --help"],
  )
  const contextualHelp = harvestWorklogArgumentCompletions("timesheet today --project WRAP ").find(item => item.label === "--help")
  assert.deepEqual(
    parseHarvestWorklogArguments(contextualHelp.value),
    { argv: ["timesheet", "today", "--project", "WRAP", "--help"] },
  )
  assert.equal(harvestWorklogArgumentCompletions(`${contextualHelp.value} `), null)
  assert.equal(harvestWorklogArgumentCompletions("timesheet nonsense "), null)
  assert.equal(harvestWorklogArgumentCompletions("timesheet today extra "), null)
  assert.equal(harvestWorklogArgumentCompletions("today "), null)
  assert.equal(harvestWorklogArgumentCompletions("aggregate "), null)
})

test("parses quoted explicit timesheet arguments", () => {
  assert.deepEqual(
    parseCommandArguments("timesheet today --project 'Ice Fog Analytics' --task Programming"),
    ["timesheet", "today", "--project", "Ice Fog Analytics", "--task", "Programming"],
  )
  assert.deepEqual(
    parseHarvestWorklogArguments("timesheet today --project 'Ice Fog Analytics' --task Programming"),
    { argv: ["timesheet", "today", "--project", "Ice Fog Analytics", "--task", "Programming"] },
  )
  assert.deepEqual(parseHarvestWorklogArguments("timesheet --help"), { argv: ["timesheet", "--help"] })
  assert.deepEqual(parseHarvestWorklogArguments("timesheet today --help"), { argv: ["timesheet", "today", "--help"] })
  assert.equal(parseHarvestWorklogArguments("today Ice Fog Analytics --task Programming"), null)
  assert.equal(parseHarvestWorklogArguments("timesheet"), null)
  assert.equal(parseHarvestWorklogArguments("timesheet today --task Programming"), null)
  assert.equal(parseHarvestWorklogArguments("timesheet today --project WRAP --task"), null)
  assert.equal(parseHarvestWorklogArguments("timesheet today --project WRAP --bogus x"), null)
  assert.equal(parseHarvestWorklogArguments("timesheet today --project WRAP --project Other"), null)
  assert.equal(parseHarvestWorklogArguments("timesheet nonsense --help"), null)
  assert.equal(parseHarvestWorklogArguments("timesheet --bogus --help"), null)
  assert.equal(parseHarvestWorklogArguments("time-off --help"), null)
  assert.equal(parseCommandArguments("timesheet today --project 'WRAP"), null)
})

test("registers autocomplete and delegates slash commands to the CLI", async () => {
  const tools = []
  const commands = []
  const calls = []
  const messages = []
  const notifications = []
  harvestTimeExtension({
    zod: { z },
    registerTool(tool) { tools.push(tool) },
    registerCommand(name, command) { commands.push({ name, command }) },
    sendMessage(message, options) { messages.push({ message, options }) },
  }, {
    command: " ",
    projectTimeMappings: " ",
    projectTimeLogPath: " ",
    run: async (...args) => {
      calls.push(args)
      return { code: 0, stdout: "CLI output", stderr: "" }
    },
  })

  const ui = {
    notify(message, type) { notifications.push({ message, type }) },
  }
  const command = commands[0].command

  assert.equal(commands[0].name, "harvest-worklog")
  assert.equal(command.getArgumentCompletions, harvestWorklogArgumentCompletions)
  await command.handler("", { cwd: "/tmp", ui })
  assert.match(notifications[0].message, /\/harvest-worklog timesheet DATE --project PROJECT/)

  await command.handler("timesheet today --project WRAP --task Programming", { cwd: "/tmp", ui })
  assert.deepEqual(calls[0], [
    "harvest-worklog",
    ["timesheet", "today", "--project", "WRAP", "--task", "Programming"],
    { cwd: "/tmp" },
  ])
  assert.equal(messages[0].message.customType, "harvest-worklog-timesheet")

  await command.handler("time-off --help", { cwd: "/tmp", ui })
  assert.equal(calls.length, 1)

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
