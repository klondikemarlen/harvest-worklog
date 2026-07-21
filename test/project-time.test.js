import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"

import { createProjectTimeTool, createProjectTimeTransformTool, workEntryArguments } from "../index.js"
import { approvedProjectTimeMappings, formatProjectTimeTimesheet, inferProjectTimeMappings, parseProjectTimeMappings, projectTimeEntries, projectTimeTransform, resolveProjectTimeDate } from "../project-time.js"

const narrativeFixtures = JSON.parse(await readFile(new URL("./fixtures/narrative-worklog-scenarios.json", import.meta.url), "utf8"))

const schema = () => ({
  regex() { return this },
  min() { return this },
  trim() { return this },
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

test("normalizes and validates Project Time mapping settings", () => {
  assert.deepEqual([...parseProjectTimeMappings(" ")], [])
  assert.deepEqual(
    [...parseProjectTimeMappings({ " Harvest API ": { project: " Internal ", task: " Development " } })],
    [["Harvest API", { project: "Internal", task: "Development" }]],
  )
  assert.throws(
    () => parseProjectTimeMappings({ "Harvest API": { project: " ", task: "Development" } }),
    /requires project and task names/,
  )
  assert.throws(
    () => parseProjectTimeMappings({
      "Harvest API": { project: "Internal", task: "Development" },
      " Harvest API ": { project: "Other", task: "Development" },
    }),
    /duplicate project Harvest API/,
  )
})

test("formats daily human activities as Harvest-style notes", () => {
  const plan = {
    groups: [
      { spentDate: "2026-07-20", sourceKind: "human_active", activity: "Fix test suite", milliseconds: 24_040_000 },
      { spentDate: "2026-07-20", sourceKind: "agent_turn_elapsed", activity: "Fix test suite", milliseconds: 1_789_000 },
      { spentDate: "2026-07-20", sourceKind: "human_active", activity: "Prototype template v3 UI", milliseconds: 300_000 },
      { spentDate: "2026-07-21", sourceKind: "human_active", activity: "Tomorrow", milliseconds: 7_200_000 },
    ],
  }

  assert.equal(
    formatProjectTimeTimesheet(plan, { project: "wrap", spentDate: "2026-07-20", mapping: { project: "WRAP (YG - SIS)", task: "Programming" } }),
    "WRAP (YG - SIS) · Mon, Jul 20 · 6:45\n\nProgramming\n- Fix test suite\n- Prototype template v3 UI",
  )
  assert.equal(resolveProjectTimeDate("today", new Date(2026, 6, 20, 12)), "2026-07-20")
  assert.equal(resolveProjectTimeDate("yesterday", new Date(2026, 6, 20, 12)), "2026-07-19")
  assert.throws(() => resolveProjectTimeDate("2026-02-31"), /valid local date/)
  assert.equal(
    formatProjectTimeTimesheet({ groups: [] }, { project: "WRAP", spentDate: "2026-07-20" }),
    "WRAP · Mon, Jul 20 · 0:00\n\nActivities\nNo local Project Time sessions found for WRAP on 2026-07-20.",
  )
})

test("renders synthetic narrative worklog fixtures", () => {
  for (const scenario of narrativeFixtures.scenarios.filter(scenario => scenario.expectedLegacy)) {
    assert.equal(
      formatProjectTimeTimesheet({ groups: scenario.groups }, scenario),
      scenario.expectedLegacy,
      scenario.id,
    )
  }
})

test("keeps future narrative fixture expectations explicit", () => {
  const scenarios = Object.fromEntries(narrativeFixtures.scenarios.map(scenario => [scenario.id, scenario]))

  assert.deepEqual(
    scenarios["multi-topic-programming"].expectedNarrativesForFutureSchema,
    [
      "Implemented validation for a configurable workflow and covered invalid-state errors.",
      "Built an approval panel and simplified the supporting form flow.",
      "Fixed flaky integration checks and documented a deployment safeguard.",
    ],
  )
  assert.deepEqual(
    scenarios["deduplicate-identical-narrative"].expectedNarrativesForFutureSchema,
    ["Generated: Investigated and stabilized an intermittent integration check."],
  )
  assert.deepEqual(scenarios["mixed-task-day"].expectedTaskGroups, ["Meeting", "Programming"])
  assert.equal(scenarios["generic-activity-fallback"].groups[0].activity, "unlabelled")
  assert.equal(scenarios["missing-activity-fallback"].groups[0].activity, "")
})

test("infers reviewed Harvest mapping candidates deterministically", () => {
  const analysis = inferProjectTimeMappings(
    {
      groups: [
        { project: " wrap ", repositoryId: "hashed-repository", activity: "Implementation", sourceKind: "human_active", milliseconds: 7_200_000 },
        { project: "WRAP", repositoryId: "hashed-repository", activity: "Planning", sourceKind: "human_active", milliseconds: 3_600_000 },
        { project: "wrap", repositoryId: "hashed-repository", activity: "Review", sourceKind: "agent_turn_elapsed", milliseconds: 3_600_000 },
        { project: "Unknown", repositoryId: "other-repository", activity: "Research", sourceKind: "human_active", milliseconds: 1_800_000 },
      ],
    },
    {
      assignments: [
        { project: { id: 1, name: "WRAP" }, task: { id: 10, name: "Programming" } },
        { project: { id: 1, name: "WRAP" }, task: { id: 11, name: "Meeting" } },
      ],
      entries: [
        { project: { id: 1, name: "WRAP" }, task: { id: 10, name: "Programming" }, hours: 8 },
        { project: { id: 1, name: "WRAP" }, task: { id: 10, name: "Programming" }, hours: 2 },
        { project: { id: 1, name: "WRAP" }, task: { id: 11, name: "Meeting" }, hours: 1.5 },
      ],
    },
  )

  assert.deepEqual(analysis.excluded, { sourceKind: "agent_turn_elapsed", hours: 1 })
  const wrapCandidate = analysis.candidates.find(candidate => candidate.source.project === " wrap ")
  assert.deepEqual(wrapCandidate.source, { project: " wrap ", projects: [" wrap ", "WRAP"], repositoryIds: ["hashed-repository"], activities: ["Implementation", "Planning"], hours: 3 })
  assert.equal(wrapCandidate.status, "suggested")
  assert.deepEqual(wrapCandidate.candidates[0], {
    project: { id: 1, name: "WRAP" },
    task: { id: 10, name: "Programming" },
    score: 113,
    reasons: [
      "Normalized local project \" wrap \" matches assigned Harvest project \"WRAP\".",
      "2 historical entries (10h) for this project/task in the requested range.",
    ],
  })
  assert.deepEqual(approvedProjectTimeMappings(analysis, [{ sourceProject: "WRAP", projectId: 1, taskId: 10 }]), { " wrap ": { project: "WRAP", task: "Programming" }, WRAP: { project: "WRAP", task: "Programming" } })
  assert.throws(() => approvedProjectTimeMappings(analysis, [
    { sourceProject: "WRAP", projectId: 1, taskId: 10 },
    { sourceProject: " wrap ", projectId: 1, taskId: 10 },
  ]), /approved more than once/)
  assert.deepEqual(approvedProjectTimeMappings(analysis, [{ sourceProject: " wrap ", projectId: 1, taskId: 10 }]), { " wrap ": { project: "WRAP", task: "Programming" }, WRAP: { project: "WRAP", task: "Programming" } })
  assert.throws(() => approvedProjectTimeMappings(analysis, [{ sourceProject: "Unknown", projectId: 1, taskId: 10 }]), /not an analysed Harvest candidate/)
})

test("marks equally scored assigned tasks as ambiguous", () => {
  const analysis = inferProjectTimeMappings(
    { groups: [{ project: "WRAP", sourceKind: "human_active", activity: "Implementation", milliseconds: 3_600_000 }] },
    { assignments: [
      { project: { id: 1, name: "WRAP" }, task: { id: 11, name: "Programming" } },
      { project: { id: 1, name: "WRAP" }, task: { id: 10, name: "Meeting" } },
    ], entries: [] },
  )
  assert.equal(analysis.candidates[0].status, "ambiguous")
  assert.deepEqual(analysis.candidates[0].candidates.map(candidate => candidate.task.name), ["Meeting", "Programming"])
})

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
  const loads = []
  const preview = createProjectTimeTool(z, {
    command: " ",
    projectTimeMappings: JSON.stringify({
      "Harvest API": { project: "Internal", task: "Development" },
    }),
    projectTimeLogPath: " ",
    loadEntries: async options => {
      loads.push(options)
      return {
        entries: [{ spentDate: "2026-07-17", project: "Internal", task: "Development", hours: 1.25, notes: "OMP Project Time: Harvest API (repo)" }],
        unmapped: 1,
      }
    },
    run: async (...args) => {
      calls.push(args)
      return { code: 0, stdout: "Would create 2026-07-17", stderr: "" }
    },
  }, { dryRun: true })

  const result = await preview.execute("call-1", { from: "2026-07-17", to: "2026-07-17" }, undefined, undefined, { cwd: "/tmp" })

  assert.equal(loads[0].logPath, undefined)
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

test("filters, groups, maps, and reports Project Time transforms deterministically", () => {
  const at = (hour, minute = 0) => new Date(2026, 6, 17, hour, minute).getTime()
  const mappings = parseProjectTimeMappings(JSON.stringify({
    "Harvest API": { project: "Internal", task: "Development" },
  }))
  const state = {
    entries: [
      { project: "Harvest API", repositoryId: "repo", sourceKind: "human_active", activity: "implementation", startAtMs: at(9), endAtMs: at(9, 30) },
      { project: "Harvest API", repositoryId: "repo", sourceKind: "human_active", activity: "implementation", startAtMs: at(10), endAtMs: at(10, 30) },
      { project: "Harvest API", repositoryId: "repo", sourceKind: "human_active", startAtMs: at(11), endAtMs: at(11, 15) },
      { project: "Other", repositoryId: "repo", sourceKind: "human_active", activity: "review", startAtMs: at(12), endAtMs: at(12, 30) },
      { project: "Harvest API", repositoryId: "repo", sourceKind: "idle", activity: "implementation", startAtMs: at(13), endAtMs: at(13, 30) },
      { project: "Harvest API", repositoryId: "repo", sourceKind: "human_active", activity: "invalid", startAtMs: at(14), endAtMs: at(14) },
    ],
  }
  const options = {
    from: "2026-07-17",
    to: "2026-07-17",
    repositoryId: "repo",
    sourceKind: "human_active",
    applyMappings: true,
  }

  const plan = projectTimeTransform(state, mappings, options)

  assert.deepEqual(
    plan.groups.map(({ spentDate, activity, hours, harvest }) => ({ spentDate, activity, hours, harvest })),
    [
      { spentDate: "2026-07-17", activity: "implementation", hours: 1, harvest: { project: "Internal", task: "Development" } },
      { spentDate: "2026-07-17", activity: "unlabelled", hours: 0.25, harvest: { project: "Internal", task: "Development" } },
      { spentDate: "2026-07-17", activity: "review", hours: 0.5, harvest: null },
    ],
  )
  assert.deepEqual(
    plan.entries.map(({ spentDate, project, task, activity, hours }) => ({ spentDate, project, task, activity, hours })),
    [
      { spentDate: "2026-07-17", project: "Internal", task: "Development", activity: "implementation", hours: 1 },
      { spentDate: "2026-07-17", project: "Internal", task: "Development", activity: "unlabelled", hours: 0.25 },
    ],
  )
  assert.deepEqual(plan.unmapped.map(({ activity, reason }) => ({ activity, reason })), [{ activity: "review", reason: "unmapped_project" }])
  assert.deepEqual(plan.excluded.map(({ activity, reason }) => ({ activity, reason })), [
    { activity: "implementation", reason: "source_kind" },
    { activity: "invalid", reason: "invalid_interval" },
  ])
  assert.equal(JSON.stringify(plan), JSON.stringify(projectTimeTransform(state, mappings, options)))
})

test("previews JSON transforms and records activity entries sequentially", async () => {
  const plan = {
    groups: [],
    entries: [
      { spentDate: "2026-07-17", project: "Internal", task: "Development", activity: "implementation", hours: 1, notes: "OMP Project Time activity: \"implementation\"\nHarvest API (repo)" },
      { spentDate: "2026-07-17", project: "Internal", task: "Development", activity: "review", hours: 0.5, notes: "OMP Project Time activity: \"review\"\nHarvest API (repo)" },
    ],
    unmapped: [],
    excluded: [],
  }
  const previewCalls = []
  const preview = createProjectTimeTransformTool(z, {
    loadTransform: async options => {
      previewCalls.push(options)
      return plan
    },
  }, { record: false })

  const previewResult = await preview.execute("preview", {
    from: "2026-07-17",
    to: "2026-07-17",
    repositoryId: "repo",
    sourceKind: "human_active",
    applyMappings: true,
  }, undefined, undefined, { cwd: "/tmp" })

  assert.equal(preview.approval, "read")
  assert.deepEqual(JSON.parse(previewResult.content[0].text), plan)
  assert.equal(previewCalls[0].applyMappings, true)

  const calls = []
  let inFlight = 0
  let maximumInFlight = 0
  const record = createProjectTimeTransformTool(z, {
    loadTransform: async () => plan,
    run: async (...args) => {
      calls.push(args)
      inFlight += 1
      maximumInFlight = Math.max(maximumInFlight, inFlight)
      await new Promise(resolve => setTimeout(resolve, 0))
      inFlight -= 1
      return { code: 0, stdout: "Created", stderr: "" }
    },
  }, { record: true })

  const recordResult = await record.execute("record", { from: "2026-07-17", to: "2026-07-17" }, undefined, undefined, { cwd: "/tmp" })

  assert.equal(record.approval, "write")
  assert.equal(maximumInFlight, 1)
  assert.deepEqual(calls.map(([, args]) => args.at(-1)), ["--activity-entry", "--activity-entry"])
  assert.deepEqual(JSON.parse(recordResult.content[0].text).results.map(result => result.code), [0, 0])
})

test("does not propose activity groups that round to zero Harvest hours", () => {
  const startAtMs = new Date(2026, 6, 17, 9).getTime()
  const plan = projectTimeTransform(
    {
      entries: [{
        project: "Harvest API",
        repositoryId: "repo",
        sourceKind: "human_active",
        activity: "implementation",
        startAtMs,
        endAtMs: startAtMs + 10_000,
      }],
    },
    parseProjectTimeMappings({ "Harvest API": { project: "Internal", task: "Development" } }),
    { from: "2026-07-17", to: "2026-07-17", applyMappings: true },
  )

  assert.equal(plan.groups[0].hours, 0)
  assert.deepEqual(plan.entries, [])
})
