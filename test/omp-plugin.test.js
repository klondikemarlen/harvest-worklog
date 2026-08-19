import assert from "node:assert/strict"
import test from "node:test"

import harvestTimeExtension, { createProjectTimeDraftTool, createProjectTimeProjectNamesLoader, createTimeOffTool, harvestWorklogArgumentCompletions, parseCommandArguments, parseHarvestWorklogArguments, timeOffArguments } from "../index.js"

const schema = () => ({
  regex() { return this },
  min() { return this },
  int() { return this },
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
      project: " Time Off - Marlen ",
      task: " Vacation / PTO ",
      hours: 7.5,
      notes: " Vacation ",
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



test("drafts local Project Time evidence without calling Harvest", async () => {
  const loads = []
  const tool = createProjectTimeDraftTool(z, {
    loadTransform: async options => {
      loads.push(options)
      return {
        sourceKind: "human_active",
        entries: [{
          spentDate: "2026-07-20",
          project: "wrap",
          task: "Review destination",
          destination: "Local Project Time project — no configured Harvest destination; choose a Harvest project and task before submitting.",
          milliseconds: 5_430_000,
          sources: [{ spentDate: "2026-07-20", project: "wrap", repositoryId: "repo-a", sourceKind: "human_active", activity: "Build", milliseconds: 5_430_000 }],
        }],
        excluded: [],
      }
    },
  })

  const result = await tool.execute("draft", { from: "2026-07-20", to: "2026-07-20" })

  assert.equal(tool.approval, "read")
  assert.deepEqual(loads, [{
    from: "2026-07-20",
    to: "2026-07-20",
    sourceKind: "human_active",
    applyMappings: true,
    mappings: new Map(),
    logPath: undefined,
  }])
  assert.match(result.content[0].text, /Project: wrap\nTask: Review destination\nDestination: Local Project Time project/)
  assert.match(result.content[0].text, /Duration: 1:30:30\nNotes \(required before submitting\)\n- Add a factual Harvest note; automatic activity labels are reference only\.\nSource evidence/)
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
  assert.deepEqual(harvestWorklogArgumentCompletions("timesheet").map(item => item.value), ["timesheet"])
  assert.deepEqual(harvestWorklogArgumentCompletions("timesheet t").map(item => item.value), ["timesheet today"])
  assert.deepEqual(
    harvestWorklogArgumentCompletions("timesheet today ").map(item => item.value),
    ["timesheet today --project", "timesheet today --help"],
  )
  const projects = ["Ice Fog Analytics", "wrap", "WRAP"]
  assert.deepEqual(
    harvestWorklogArgumentCompletions("timesheet today --project ", projects).map(item => item.value),
    ["timesheet today --project \"Ice Fog Analytics\"", "timesheet today --project wrap", "timesheet today --project WRAP"],
  )
  assert.deepEqual(
    harvestWorklogArgumentCompletions("timesheet today --project w", projects).map(item => item.value),
    ["timesheet today --project wrap", "timesheet today --project WRAP"],
  )
  assert.deepEqual(
    harvestWorklogArgumentCompletions("timesheet today --project Ice F", projects).map(item => item.value),
    ["timesheet today --project \"Ice Fog Analytics\""],
  )
  assert.deepEqual(
    harvestWorklogArgumentCompletions("timesheet today --project w", [" wrap "]).map(item => item.value),
    ["timesheet today --project \" wrap \""],
  )
  assert.deepEqual(
    parseHarvestWorklogArguments(harvestWorklogArgumentCompletions("timesheet today --project i", projects)[0].value),
    { argv: ["timesheet", "today", "--project", "Ice Fog Analytics"] },
  )
  assert.deepEqual(
    harvestWorklogArgumentCompletions("timesheet today --project WRAP ").map(item => item.value),
    ["timesheet today --project WRAP --help"],
  )
  const contextualHelp = harvestWorklogArgumentCompletions("timesheet today --project WRAP ").find(item => item.label === "--help")
  assert.deepEqual(parseHarvestWorklogArguments(contextualHelp.value), { help: true })
  assert.equal(harvestWorklogArgumentCompletions(`${contextualHelp.value} `), null)
  assert.equal(harvestWorklogArgumentCompletions("timesheet nonsense "), null)
  assert.equal(harvestWorklogArgumentCompletions("timesheet today extra "), null)
  assert.equal(harvestWorklogArgumentCompletions("today "), null)
  assert.equal(harvestWorklogArgumentCompletions("aggregate "), null)
})

test("caches local project names until the log changes", () => {
  let reads = 0
  let mtimeMs = 1
  const loader = createProjectTimeProjectNamesLoader({
    stat: () => ({ mtimeMs, size: 10 }),
    read: () => {
      reads += 1
      return JSON.stringify({ format: "omp-project-time/evidence", version: 1, entries: [{ sourceKind: "human_active", project: "wrap" }] })
    },
  })

  assert.deepEqual(loader("/tmp/project-time.json"), ["wrap"])
  assert.deepEqual(loader("/tmp/project-time.json"), ["wrap"])
  assert.equal(reads, 1)
  mtimeMs = 2
  assert.deepEqual(loader("/tmp/project-time.json"), ["wrap"])
  assert.equal(reads, 2)
})


test("parses quoted explicit timesheet arguments", () => {
  assert.deepEqual(
    parseCommandArguments("timesheet today --project 'Ice Fog Analytics'"),
    ["timesheet", "today", "--project", "Ice Fog Analytics"],
  )
  assert.deepEqual(
    parseHarvestWorklogArguments("timesheet today --project 'Ice Fog Analytics'"),
    { argv: ["timesheet", "today", "--project", "Ice Fog Analytics"] },
  )
  assert.deepEqual(parseHarvestWorklogArguments("timesheet today"), { argv: ["timesheet", "today"] })
  assert.deepEqual(parseHarvestWorklogArguments("timesheet --help"), { help: true })
  assert.deepEqual(parseHarvestWorklogArguments("timesheet today --help"), { help: true })
  assert.equal(parseHarvestWorklogArguments("today Ice Fog Analytics --task Programming"), null)
  assert.equal(parseHarvestWorklogArguments("timesheet"), null)
  assert.equal(parseHarvestWorklogArguments("timesheet today --task Programming"), null)
  assert.equal(parseHarvestWorklogArguments("timesheet today --project WRAP --task"), null)
  assert.equal(parseHarvestWorklogArguments("timesheet today --project WRAP --task Programming"), null)
  assert.equal(parseHarvestWorklogArguments("timesheet today --project WRAP --bogus x"), null)
  assert.equal(parseHarvestWorklogArguments("timesheet today --project WRAP --project Other"), null)
  assert.equal(parseHarvestWorklogArguments("timesheet nonsense --help"), null)
  assert.equal(parseHarvestWorklogArguments("timesheet --bogus --help"), null)
  assert.equal(parseHarvestWorklogArguments("time-off --help"), null)
  assert.equal(parseCommandArguments("timesheet today --project 'WRAP"), null)
})

test("registers a deterministic no-write Project Time draft command", async () => {
  const tools = []
  const commands = []
  const messages = []
  const notifications = []
  const transformLoads = []
  harvestTimeExtension({
    zod: { z },
    registerTool(tool) { tools.push(tool) },
    registerCommand(name, command) { commands.push({ name, command }) },
    sendMessage(message, options) { messages.push({ message, options }) },
  }, {
    command: " ",
    projectTimeMappings: '{"wrap":{"project":"WRAP (YG - SIS)","task":"Programming"}}',
    projectTimeLogPath: " /tmp/project-time.json ",
    loadProjectTimeProjectNames: logPath => {
      assert.equal(logPath, "/tmp/project-time.json")
      return ["Ice Fog Analytics", "wrap"]
    },
    loadProjectTimeTransform: async options => {
      transformLoads.push(options)
      return {
        sourceKind: "human_active",
        entries: [{
          spentDate: "2026-07-20",
          project: "WRAP (YG - SIS)",
          task: "Programming",
          destination: "Configured Harvest destination",
          milliseconds: 24_040_000,
          sources: [{
            id: "entry-explicit",
            spentDate: "2026-07-20",
            sourceKind: "human_active",
            project: "wrap",
            repositoryId: "repository-id",
            repositoryIdentity: "github.com/klondikemarlen/wrap",
            activity: "Fix test suite",
            workItemAttribution: "explicit_prompt",
            workItem: { kind: "issue", number: 91, repository: "klondikemarlen/harvest-worklog" },
            startAtMs: new Date(2026, 6, 20, 9).getTime(),
            endAtMs: new Date(2026, 6, 20, 15, 40, 40).getTime(),
            segmentStartAtMs: new Date(2026, 6, 20, 9).getTime(),
            segmentEndAtMs: new Date(2026, 6, 20, 15, 40, 40).getTime(),
            narrative: { text: "Fixed the project test suite for WRAP-123." },
            milliseconds: 24_040_000,
          }],
        }],
      }
    },
  })

  const ui = {
    notify(message, type) { notifications.push({ message, type }) },
  }
  const command = commands[0].command

  assert.equal(commands[0].name, "harvest-worklog")
  assert.deepEqual(
    command.getArgumentCompletions("timesheet today --project w").map(item => item.value),
    ["timesheet today --project wrap"],
  )
  await command.handler("", { cwd: "/tmp", ui })
  assert.match(notifications[0].message, /\/harvest-worklog timesheet DATE \[--project PROJECT\]/)

  await command.handler("timesheet 2026-07-20", { cwd: "/tmp", ui })
  await command.handler("timesheet 2026-07-20 --project wrap", { cwd: "/tmp", ui, model: {} })
  assert.deepEqual(transformLoads, [
    {
      from: "2026-07-20",
      to: "2026-07-20",
      project: undefined,
      mappings: new Map([["wrap", { project: "WRAP (YG - SIS)", task: "Programming" }]]),
      applyMappings: true,
      logPath: "/tmp/project-time.json",
    },
    {
      from: "2026-07-20",
      to: "2026-07-20",
      project: "wrap",
      mappings: new Map([["wrap", { project: "WRAP (YG - SIS)", task: "Programming" }]]),
      applyMappings: true,
      logPath: "/tmp/project-time.json",
    },
  ])
  assert.match(messages[0].message.content, /Date: 2026-07-20 \| Project: WRAP \(YG - SIS\) \| Duration: 6:40:40/)
  assert.doesNotMatch(messages[0].message.content, /Task:|Review:|Work items|Source evidence|entry-explicit|repository-id|Fixed the project test suite/)
  assert.equal(messages.length, 3)
  assert.equal(messages[1].message.customType, "harvest-worklog-timesheet")
  assert.equal(messages[1].message.content.split("\n").length <= 22, true)
  assert.deepEqual(messages[1].options, { triggerTurn: false })
  assert.equal(messages[2].message.customType, "harvest-worklog-timesheet-summary-request")
  assert.match(messages[2].message.content, /"references":\["GitHub #91","Jira WRAP-123"\]/)
  assert.deepEqual(messages[2].options, { triggerTurn: true, deliverAs: "nextTurn" })
  await command.handler("time-off --help", { cwd: "/tmp", ui })
  assert.equal(messages.length, 3)
  assert.deepEqual(
    tools.map(tool => tool.name),
    [
      "harvest_record_time_off",
      "harvest_preview_project_time_drafts",
      "harvest_preview_project_time_transforms",
    ],
  )
  assert.deepEqual(tools.filter(tool => tool.approval === "write").map(tool => tool.name), ["harvest_record_time_off"])
})
