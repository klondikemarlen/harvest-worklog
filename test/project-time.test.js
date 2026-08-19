import assert from "node:assert/strict"
import test from "node:test"

import { createProjectTimeTransformTool } from "../index.js"
import { defaultProjectTimeLogPath, formatProjectTimeCommandSummary, formatProjectTimeEntryDrafts, loadProjectTimeTransform, parseProjectTimeMappings, projectTimeProjectNames, projectTimeTransform, resolveProjectTimeDate } from "../project-time.js"

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

const evidenceState = entries => ({ format: "omp-project-time/evidence", version: 1, entries })

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

test("resolves a local Project Time date", () => {
  assert.equal(resolveProjectTimeDate("today", new Date(2026, 6, 20, 12)), "2026-07-20")
  assert.equal(resolveProjectTimeDate("yesterday", new Date(2026, 6, 20, 12)), "2026-07-19")
  assert.throws(() => resolveProjectTimeDate("2026-02-31"), /valid local date/)
})


test("lists unique human-active local Project Time names", () => {
  assert.deepEqual(
    projectTimeProjectNames(evidenceState([
      { sourceKind: "human_active", project: "wrap" },
      { sourceKind: "agent_turn_elapsed", project: "ignored" },
      { sourceKind: "human_active", project: "Ice Fog Analytics" },
      { sourceKind: "human_active", project: "wrap" },
      { sourceKind: "human_active", project: " " },
    ])),
    ["Ice Fog Analytics", "wrap"],
  )
})

test("loads current Project Time SQLite evidence", async () => {
  const startAtMs = new Date(2026, 6, 17, 9).getTime()
  const entry = {
    id: "entry-1",
    project: "Harvest Worklog",
    repositoryId: "github.com/klondikemarlen/harvest-worklog",
    sourceKind: "human_active",
    activity: "implementation",
    startAtMs,
    endAtMs: startAtMs + 3_600_000,
  }
  let closed = false
  const plan = await loadProjectTimeTransform({
    from: "2026-07-17",
    to: "2026-07-17",
    mappings: new Map(),
    logPath: "/tmp/time-log.sqlite",
    openDatabase(logPath) {
      assert.equal(logPath, "/tmp/time-log.sqlite")
      return {
        query(sql) {
          assert.equal(sql, "SELECT entry_json FROM entries ORDER BY rowid")
          return { all: () => [{ entry_json: JSON.stringify(entry) }] }
        },
        close() { closed = true },
      }
    },
  })

  const legacyPlan = await loadProjectTimeTransform({
    from: "2026-07-17",
    to: "2026-07-17",
    mappings: new Map(),
    logPath: "/tmp/time-log.json",
    read: async () => JSON.stringify(evidenceState([entry])),
  })

  assert.match(defaultProjectTimeLogPath(), /time-log\.sqlite$/)
  assert.equal(plan.groups[0].hours, 1)
  assert.equal(legacyPlan.groups[0].hours, 1)
  assert.equal(closed, true)
})







test("creates a multi-project draft with configured and review-required destinations", () => {
  const at = (hour, minute = 0) => new Date(2026, 6, 17, hour, minute).getTime()
  const plan = projectTimeTransform(
    evidenceState([
      {
        id: "entry-mapped",
        project: "wrap",
        repositoryId: "wrap-repository",
        sourceKind: "human_active",
        activity: "Implement",
        workItemAttribution: "explicit_prompt",
        startAtMs: at(9),
        endAtMs: at(10),
      },
      {
        id: "entry-unassigned",
        project: "wrap",
        repositoryId: "wrap-repository",
        sourceKind: "human_active",
        activity: "Review",
        workItemAttribution: "unassigned",
        startAtMs: at(10),
        endAtMs: at(11),
      },
      {
        id: "entry-unmapped-project",
        project: "Administration",
        repositoryId: "administration-repository",
        sourceKind: "human_active",
        workItemAttribution: "explicit_prompt",
        startAtMs: at(11),
        endAtMs: at(11, 45),
      },
    ]),
    parseProjectTimeMappings({ wrap: { project: "WRAP", task: "Programming" } }),
    { from: "2026-07-17", to: "2026-07-17", applyMappings: true },
  )

  assert.deepEqual(
    plan.entries.map(({ project, task, destination, hours }) => ({ project, task, destination, hours })),
    [
      { project: "Administration", task: "Review destination", destination: "Local Project Time project — no configured Harvest destination; choose a Harvest project and task before submitting.", hours: 0.75 },
      { project: "wrap", task: "Review destination", destination: "Local Project Time project — unassigned work item; choose a Harvest project and task before submitting.", hours: 1 },
      { project: "WRAP", task: "Programming", destination: "Configured Harvest destination", hours: 1 },
    ],
  )
  const draft = formatProjectTimeEntryDrafts(plan)
  assert.match(draft, /Project: Administration\nTask: Review destination\nDestination: Local Project Time project/)
  assert.match(draft, /Project: WRAP\nTask: Programming\nDestination: Configured Harvest destination/)
  assert.match(draft, /Project: wrap\nTask: Review destination\nDestination: Local Project Time project — unassigned work item/)
  assert.match(draft, /source entry-mapped/)
  assert.match(draft, /source entry-unassigned/)
  assert.match(draft, /source entry-unmapped-project/)
})

test("caps interactive timesheet summaries at thirty lines", () => {
  const output = formatProjectTimeCommandSummary({
    entries: Array.from({ length: 40 }, (_, index) => ({
      spentDate: "2026-07-20",
      project: "wrap",
      task: index === 0 ? `Task ${index}\nhidden` : `Task ${index}`,
      destination: index === 0 ? "Configured\nHarvest destination" : "Configured Harvest destination",
      milliseconds: 60_000,
    })),
  })

  assert.equal(output.split("\n").length, 30)
  assert.match(output, /Project: wrap \| Task: Task 0 hidden \| Duration: 0:01 \| Review: Configured Harvest destination/)
  assert.match(output, /12 additional drafts omitted; use harvest_preview_project_time_drafts for detailed review\./)
})


test("filters, groups, maps, and limits Project Time transforms to the requested scope", () => {
  const at = (hour, minute = 0) => new Date(2026, 6, 17, hour, minute).getTime()
  const nextDay = new Date(2026, 6, 18, 9).getTime()
  const mappings = parseProjectTimeMappings(JSON.stringify({
    "Harvest API": { project: "Internal", task: "Development" },
  }))
  const state = evidenceState([
    { project: "Harvest API", repositoryId: "repo", sourceKind: "human_active", activity: "implementation", startAtMs: at(9), endAtMs: at(9, 30) },
    { project: "Harvest API", repositoryId: "repo", sourceKind: "human_active", activity: "implementation", startAtMs: at(10), endAtMs: at(10, 30) },
    { project: "Harvest API", repositoryId: "repo", sourceKind: "human_active", startAtMs: at(11), endAtMs: at(11, 15) },
    { project: "Other", repositoryId: "repo", sourceKind: "human_active", activity: "review", startAtMs: at(12), endAtMs: at(12, 30) },
    { project: "Harvest API", repositoryId: "repo", sourceKind: "idle", activity: "implementation", startAtMs: at(13), endAtMs: at(13, 30) },
    { project: "Harvest API", repositoryId: "repo", sourceKind: "human_active", activity: "invalid", startAtMs: at(14), endAtMs: at(14) },
    { project: "Harvest API", repositoryId: "repo", sourceKind: "human_active", activity: "out-of-range", startAtMs: nextDay, endAtMs: nextDay + 1_800_000 },
  ])
  const options = {
    from: "2026-07-17",
    to: "2026-07-17",
    project: "Harvest API",
    sourceKind: "human_active",
    applyMappings: true,
  }

  const plan = projectTimeTransform(state, mappings, options)

  assert.deepEqual(
    plan.groups.map(({ spentDate, activity, hours, harvest }) => ({ spentDate, activity, hours, harvest })),
    [
      { spentDate: "2026-07-17", activity: "implementation", hours: 1, harvest: { project: "Internal", task: "Development" } },
      { spentDate: "2026-07-17", activity: "unlabelled", hours: 0.25, harvest: { project: "Internal", task: "Development" } },
    ],
  )
  assert.deepEqual(
    plan.entries.map(({ spentDate, project, task, destination, hours }) => ({ spentDate, project, task, destination, hours })),
    [
      { spentDate: "2026-07-17", project: "Internal", task: "Development", destination: "Configured Harvest destination", hours: 1.25 },
    ],
  )
  assert.equal("excluded" in plan, false)
  const draft = formatProjectTimeEntryDrafts({
    ...plan,
    excluded: [{ project: "unrelated", repositoryId: "other", milliseconds: 0, reason: "date_range" }],
  })
  assert.doesNotMatch(draft, /Excluded Project Time evidence|unrelated/)
  assert.equal(JSON.stringify(plan), JSON.stringify(projectTimeTransform(state, mappings, options)))
})

test("defaults transforms to human-active intervals", () => {
  const startAtMs = new Date(2026, 6, 17, 9).getTime()
  const mappings = parseProjectTimeMappings({ "Harvest API": { project: "Internal", task: "Development" } })
  const state = evidenceState([{ project: "Harvest API", repositoryId: "repo", sourceKind: "agent_turn_elapsed", activity: "implementation", startAtMs, endAtMs: startAtMs + 3_600_000 }])
  const defaultPlan = projectTimeTransform(
    state,
    mappings,
    { from: "2026-07-17", to: "2026-07-17", applyMappings: true },
  )
  const explicitPlan = projectTimeTransform(
    state,
    mappings,
    { from: "2026-07-17", to: "2026-07-17", sourceKind: "agent_turn_elapsed", applyMappings: true },
  )

  assert.equal(defaultPlan.sourceKind, "human_active")
  assert.equal(explicitPlan.sourceKind, "agent_turn_elapsed")
  assert.deepEqual(defaultPlan.groups, [])
  assert.deepEqual(defaultPlan.entries, [])
  assert.equal("excluded" in defaultPlan, false)
  assert.deepEqual(explicitPlan.entries.map(({ hours }) => hours), [1])
})

test("previews JSON transforms without writing activity entries", async () => {
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
  })

  const previewResult = await preview.execute("preview", {
    from: "2026-07-17",
    to: "2026-07-17",
    repositoryId: "repo",
    sourceKind: "human_active",
    applyMappings: true,
  })

  assert.equal(preview.approval, "read")
  assert.deepEqual(JSON.parse(previewResult.content[0].text), plan)
  assert.equal(previewCalls[0].applyMappings, true)
})

test("does not propose activity groups that round to zero Harvest hours", () => {
  const startAtMs = new Date(2026, 6, 17, 9).getTime()
  const plan = projectTimeTransform(
    evidenceState([{
      project: "Harvest API",
      repositoryId: "repo",
      sourceKind: "human_active",
      activity: "implementation",
      startAtMs,
      endAtMs: startAtMs + 10_000,
    }]),
    parseProjectTimeMappings({ "Harvest API": { project: "Internal", task: "Development" } }),
    { from: "2026-07-17", to: "2026-07-17", applyMappings: true },
  )

  assert.equal(plan.groups[0].hours, 0)
  assert.deepEqual(plan.entries, [])
})
