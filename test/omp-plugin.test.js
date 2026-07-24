import assert from "node:assert/strict"
import test from "node:test"

import harvestTimeExtension, { aggregateArguments, createProjectTimeMappingReviewTool, createProjectTimeProjectNamesLoader, createTimeAggregateTool, createTimeOffTool, createTimesheetTool, harvestWorklogArgumentCompletions, parseCommandArguments, parseDailySummary, parseHarvestWorklogArguments, timeOffArguments, timesheetArguments } from "../index.js"

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

test("reviews mapping candidates without writing Harvest or settings", async () => {
  const calls = []
  const tool = createProjectTimeMappingReviewTool(z, {
    run: async (...args) => {
      calls.push(args)
      return {
        code: 0,
        stdout: JSON.stringify({
          assignments: [{ project: { id: 1, name: "WRAP" }, task: { id: 2, name: "Programming" } }],
          entries: [{ project: { id: 1, name: "WRAP" }, task: { id: 2, name: "Programming" }, hours: 2 }],
        }),
        stderr: "",
      }
    },
    loadTransform: async () => ({
      groups: [{ project: "wrap", repositoryId: "hashed", activity: "Implementation", sourceKind: "human_active", milliseconds: 7_200_000 }],
    }),
  })

  const result = await tool.execute("review", { from: "2026-07-17", to: "2026-07-17", approvals: [{ sourceProject: "wrap", projectId: 1, taskId: 2 }] }, undefined, undefined, { cwd: "/tmp" })

  assert.equal(tool.approval, "read")
  assert.deepEqual(calls, [["harvest-worklog", ["mapping-data", "2026-07-17", "2026-07-17"], { cwd: "/tmp", signal: undefined }]])
  assert.deepEqual(result.details.projectTimeMappings, { wrap: { project: "WRAP", task: "Programming" } })
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
      return JSON.stringify({ entries: [{ sourceKind: "human_active", project: "wrap" }] })
    },
  })

  assert.deepEqual(loader("/tmp/project-time.json"), ["wrap"])
  assert.deepEqual(loader("/tmp/project-time.json"), ["wrap"])
  assert.equal(reads, 1)
  mtimeMs = 2
  assert.deepEqual(loader("/tmp/project-time.json"), ["wrap"])
  assert.equal(reads, 2)
})

test("validates AI activity category responses", () => {
  const activities = ["Build", "Review"]
  const mappings = [
    { activity: "Build", category: "Implementation" },
    { activity: "Review", category: "Review" },
  ]
  const generated = parseDailySummary(JSON.stringify({ categories: mappings, worklog: ["Built the feature.", "Reviewed the change."] }), activities)
  assert.deepEqual([...generated.categories], [["Build", "Implementation"], ["Review", "Review"]])
  assert.equal(generated.summary, "- Built the feature.\n- Reviewed the change.")
  const fenced = parseDailySummary('```json\n{"categories":{"Build":"Implementation","Review":"Review"}}\n```', activities)
  const worklogOnly = parseDailySummary(JSON.stringify({ worklog: ["Investigated the scheduler issue.", "Improved the workflow tooling."] }), activities, ["WRAP / Programming"])
  assert.equal(worklogOnly.categories, undefined)
  assert.equal(worklogOnly.summary, "- Investigated the scheduler issue.\n- Improved the workflow tooling.")
  assert.equal(parseDailySummary(JSON.stringify({ worklog: ["unsafe\nline"] }), activities), undefined)
  assert.deepEqual([...fenced.categories], [["Build", "Implementation"], ["Review", "Review"]])
  const compactWithoutHarvest = parseDailySummary(JSON.stringify({
    classifications: [
      { activity: "Build", category: "Implementation", workstream: "Feature delivery" },
      { activity: "Review", category: "Review", workstream: "Feature delivery" },
    ],
  }), activities)
  assert.deepEqual([...compactWithoutHarvest.workstreams], [["Build", "Feature delivery"], ["Review", "Feature delivery"]])
  const compactWithIds = parseDailySummary(JSON.stringify({
    classifications: [
      { id: "1", category: "Implementation", workstream: "Feature delivery" },
      { id: "2", category: "Review", workstream: "Feature delivery" },
    ],
  }), activities)
  assert.deepEqual([...compactWithIds.categories], [["Build", "Implementation"], ["Review", "Review"]])
  const harvestCategories = ["WRAP / Programming", "WRAP Support / Support"]
  const harvestMapped = parseDailySummary(
    JSON.stringify({
      classifications: [
        { activity: "Build", category: "WRAP / Programming", workstream: "Feature delivery" },
        { activity: "Review", category: "WRAP Support / Support", workstream: "Feature delivery" },
      ],
    }),
    activities,
    harvestCategories,
  )
  const legacyCategoryOnly = parseDailySummary(
    JSON.stringify({
      categories: [
        { activity: "Build", category: "WRAP / Programming" },
        { activity: "Review", category: "WRAP Support / Support" },
      ],
    }),
    activities,
    harvestCategories,
  )
  assert.deepEqual([...legacyCategoryOnly.categories], [["Build", "WRAP / Programming"], ["Review", "WRAP Support / Support"]])
  assert.equal(legacyCategoryOnly.workstreams, undefined)
  assert.deepEqual([...harvestMapped.categories], [["Build", "WRAP / Programming"], ["Review", "WRAP Support / Support"]])
  assert.deepEqual([...harvestMapped.workstreams], [["Build", "Feature delivery"], ["Review", "Feature delivery"]])
  const unmappedClassification = parseDailySummary(JSON.stringify({
    classifications: [
      { id: "1", category: null, workstream: "Unmapped work" },
      { id: "2", category: "WRAP / Support", workstream: "Feature delivery" },
    ],
  }), activities, ["WRAP / Support"])
  assert.equal(unmappedClassification.categories.get("Build"), null)
  const fiveCategoriesPlusNull = parseDailySummary(JSON.stringify({
    classifications: [
      { id: "1", category: null, workstream: "Feature delivery" },
      ...Array.from({ length: 5 }, (_, index) => ({ id: String(index + 2), category: `WRAP / ${index}`, workstream: "Feature delivery" })),
    ],
  }), Array.from({ length: 6 }, (_, index) => `Category activity ${index + 1}`), Array.from({ length: 5 }, (_, index) => `WRAP / ${index}`))
  assert.equal(fiveCategoriesPlusNull.categories.size, 6)
  assert.equal(
    parseDailySummary(JSON.stringify({
      classifications: [{ activity: "Build", category: "WRAP / Programming", workstream: "Feature delivery" }],
    }), activities, harvestCategories),
    undefined,
  )
  const legacyHarvestMapped = parseDailySummary(
    JSON.stringify({
      categories: [
        { activity: "Build", category: "WRAP / Programming" },
        { activity: "Review", category: "WRAP Support / Support" },
      ],
      workstreams: [
        { activity: "Build", workstream: "Feature delivery" },
        { activity: "Review", workstream: "Feature delivery" },
      ],
    }),
    activities,
    harvestCategories,
  )
  assert.deepEqual([...legacyHarvestMapped.workstreams], [["Build", "Feature delivery"], ["Review", "Feature delivery"]])
  assert.equal(
    parseDailySummary(JSON.stringify({
      classifications: [
        { activity: "Build", category: "WRAP / Programming", workstream: "Feature delivery\nunsafe" },
        { activity: "Review", category: "WRAP Support / Support", workstream: "Feature delivery" },
      ],
    }), activities, harvestCategories),
    undefined,
  )
  assert.equal(
    parseDailySummary(JSON.stringify({
      classifications: [
        { activity: "Build", category: "Unassigned", workstream: "Feature delivery" },
        { activity: "Review", category: "WRAP / Programming", workstream: "Feature delivery" },
      ],
    }), activities, harvestCategories),
    undefined,
  )
  const longHarvestCategory = "Project ".repeat(12) + "/ Task"
  assert.ok(parseDailySummary(
    JSON.stringify({
      classifications: [
        { activity: "Build", category: longHarvestCategory, workstream: "Feature delivery" },
        { activity: "Review", category: longHarvestCategory, workstream: "Feature delivery" },
      ],
    }),
    activities,
    [longHarvestCategory],
  ))
  const fourLegacyActivities = Array.from({ length: 4 }, (_, index) => `Legacy ${index + 1}`)
  const fourLegacyWorkstreams = parseDailySummary(JSON.stringify({
    categories: fourLegacyActivities.map(activity => ({ activity, category: "WRAP / Programming" })),
    workstreams: fourLegacyActivities.map((activity, index) => ({ activity, workstream: `Stream ${index + 1}` })),
  }), fourLegacyActivities, ["WRAP / Programming"])
  assert.equal(fourLegacyWorkstreams.workstreams.size, 4)
  const fiveLegacyActivities = Array.from({ length: 5 }, (_, index) => `Legacy ${index + 1}`)
  const fiveLegacyWorkstreams = parseDailySummary(JSON.stringify({
    categories: fiveLegacyActivities.map(activity => ({ activity, category: "WRAP / Programming" })),
    workstreams: fiveLegacyActivities.map((activity, index) => ({ activity, workstream: `Stream ${index + 1}` })),
  }), fiveLegacyActivities, ["WRAP / Programming"])
  assert.equal(fiveLegacyWorkstreams, undefined)
  const manyActivities = Array.from({ length: 65 }, (_, index) => `Activity ${index + 1}`)
  const highCardinality = parseDailySummary(JSON.stringify({ categories: manyActivities.map((activity, index) => ({ activity, category: ["Coordination", "Implementation", "Review", "Design", "Quality"][index % 5] })) }), manyActivities)
  const fourClassifications = Array.from({ length: 4 }, (_, index) => ({
    id: String(index + 1),
    category: "WRAP / Programming",
    workstream: `Stream ${index + 1}`,
  }))
  const fourActivities = fourClassifications.map((_, index) => `Activity ${index + 1}`)
  const fourWorkstreams = parseDailySummary(JSON.stringify({ classifications: fourClassifications }), fourActivities, ["WRAP / Programming"])
  assert.equal(fourWorkstreams.workstreams.size, 4)
  const fiveClassifications = Array.from({ length: 5 }, (_, index) => ({
    id: String(index + 1),
    category: "WRAP / Programming",
    workstream: `Stream ${index + 1}`,
  }))
  assert.equal(
    parseDailySummary(JSON.stringify({ classifications: fiveClassifications }), fiveClassifications.map((_, index) => `Activity ${index + 1}`), ["WRAP / Programming"]),
    undefined,
  )
  assert.equal(highCardinality.categories.size, 65)
  assert.equal(parseDailySummary(JSON.stringify({ categories: [...manyActivities.map(activity => ({ activity, category: "Implementation" })), { activity: "ignored", category: "ignored" }] }), manyActivities), undefined)
  assert.equal(parseDailySummary("not JSON", activities), undefined)
  assert.equal(parseDailySummary('{"categories":[{"activity":"Build","category":"Implementation"}]}', activities), undefined)
  assert.equal(parseDailySummary('{"categories":[{"activity":"Build","category":""}]}', ["Build"]), undefined)
  assert.equal(parseDailySummary(JSON.stringify({ categories: [{ activity: "Build", category: "x".repeat(81) }] }), ["Build"]), undefined)
  assert.equal(parseDailySummary('{"categories":[{"activity":"1","category":"a"},{"activity":"2","category":"b"},{"activity":"3","category":"c"},{"activity":"4","category":"d"},{"activity":"5","category":"e"},{"activity":"6","category":"f"}]}', ["1", "2", "3", "4", "5", "6"]), undefined)
  assert.deepEqual([...parseDailySummary('{"categories":[{"activity":"Build","category":"Implementation"}]}', ["Build"]).categories], [["Build", "Implementation"]])
  assert.equal(parseDailySummary('{"categories":[{"activity":"Build","category":"Implementation"},{"activity":"Build","category":"Review"}]}', activities), undefined)
  assert.equal(parseDailySummary('{"categories":[{"activity":"Build","category":"Implementation"},{"activity":"Unknown","category":"Review"}]}', activities), undefined)
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

test("renders a review-only Harvest draft from local Project Time", async () => {
  const tools = []
  const commands = []
  const calls = []
  const messages = []
  const notifications = []
  const transformLoads = []
  let summaries = 0
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
        summaryRecords: [
          { activity: "Fix test suite", durationMilliseconds: 24_040_000 },
          { activity: "Prototype template v3 UI", durationMilliseconds: 300_000 },
        ],
        groups: [
          { spentDate: "2026-07-20", sourceKind: "human_active", activity: "Fix test suite", milliseconds: 24_040_000 },
          { spentDate: "2026-07-20", sourceKind: "human_active", activity: "Prototype template v3 UI", milliseconds: 300_000 },
        ],
      }
    },
    generateDailySummary: async (records, ctx, categoryOptions) => {
      assert.deepEqual(records, [
        { activity: "Fix test suite", durationMilliseconds: 24_040_000 },
        { activity: "Prototype template v3 UI", durationMilliseconds: 300_000 },
      ])
      assert.deepEqual(categoryOptions, ["WRAP (YG - SIS) / Programming", "WRAP Support (YG - SIS) / Support"])
      return summaries++ === 0
        ? {
          categories: new Map([
            ["Fix test suite", "WRAP (YG - SIS) / Programming"],
            ["Prototype template v3 UI", "WRAP Support (YG - SIS) / Support"],
          ]),
          workstreams: new Map([
            ["Fix test suite", "Project test suite"],
            ["Prototype template v3 UI", "Template v3 development"],
          ]),
        }
        : undefined
    },
    run: async (...args) => {
      calls.push(args)
      if (args[1][0] === "mapping-data") {
        return {
          code: 0,
          stdout: JSON.stringify({
            assignments: [
              { project: { name: "WRAP (YG - SIS)" }, task: { name: "Programming" } },
              { project: { name: "WRAP Support (YG - SIS)" }, task: { name: "Support" } },
            ],
          }),
          stderr: "",
        }
      }
      return { code: 0, stdout: "CLI output", stderr: "" }
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
  assert.match(notifications[0].message, /\/harvest-worklog timesheet DATE --project PROJECT/)

  await command.handler("timesheet 2026-07-20 --project wrap", { cwd: "/tmp", ui })
  assert.deepEqual(transformLoads, [{
    from: "2026-07-20",
    to: "2026-07-20",
    project: "wrap",
    mappings: new Map(),
    logPath: "/tmp/project-time.json",
  }])
  assert.deepEqual(calls, [[
    "harvest-worklog",
    ["mapping-data", "2026-07-20", "2026-07-20"],
    { cwd: "/tmp" },
  ]])
  assert.equal(messages[0].message.content, "wrap · Mon, Jul 20 · 6:45\nSource: local OMP Project Time (not Harvest)\nHarvest draft (review only; nothing written)\n\nWRAP (YG - SIS)\nProgramming\n- Project test suite · 6:40\nTotal: 6:40\nWRAP Support (YG - SIS)\nSupport\n- Template v3 development · 0:05\nTotal: 0:05\n\nTotal: 6:45")
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
      "harvest_review_project_time_mappings",
    ],
  )
})
