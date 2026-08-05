import assert from "node:assert/strict"
import test from "node:test"

import { createProjectTimeTool, createProjectTimeTransformTool } from "../index.js"
import { approvedProjectTimeMappings, formatProjectTimeEntryDrafts, inferProjectTimeMappings, loadProjectTimeEntries, parseProjectTimeMappings, projectTimeEntries, projectTimeProjectNames, projectTimeSummaryRecords, projectTimeTransform, resolveProjectTimeDate } from "../project-time.js"

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


test("keeps summary records within the requested repository", () => {
  const state = evidenceState([
    { sourceKind: "human_active", project: "wrap", repositoryId: "current", activity: "Included", startAtMs: new Date(2026, 6, 20, 9).getTime(), endAtMs: new Date(2026, 6, 20, 9, 30).getTime() },
    { sourceKind: "human_active", project: "wrap", repositoryId: "other", activity: "Excluded", startAtMs: new Date(2026, 6, 20, 10).getTime(), endAtMs: new Date(2026, 6, 20, 10, 30).getTime() },
  ])
  assert.deepEqual(
    projectTimeSummaryRecords(state, { from: "2026-07-20", to: "2026-07-20", project: "wrap", repositoryId: "current" }),
    [{ activity: "Included", durationMilliseconds: 1_800_000 }],
  )
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
    evidenceState([
      { project: "Harvest API", repositoryId: "klondikemarlen/harvest-api-v2", sourceKind: "human_active", startAtMs, endAtMs },
      { project: "Harvest API", repositoryId: "klondikemarlen/harvest-api-v2", sourceKind: "agent_turn_elapsed", startAtMs, endAtMs: endAtMs + 3_600_000 },
    ]),
    mappings,
    { from: "2026-07-17", to: "2026-07-18" },
  )

  assert.equal(plan.sourceKind, "human_active")
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

test("preserves versioned source evidence while leaving unassigned and ambiguous work unmapped", () => {
  const startAtMs = new Date(2026, 6, 17, 9).getTime()
  const source = (id, workItemAttribution, workItem, narrative) => ({
    id,
    sourceKind: "human_active",
    project: "wrap",
    repositoryId: "repository-id",
    repositoryIdentity: "github.com/klondikemarlen/wrap",
    activity: "Review",
    workItemAttribution,
    ...(workItem === undefined ? {} : { workItem }),
    ...(narrative === undefined ? {} : { narrative }),
    startAtMs,
    endAtMs: startAtMs + 1_800_000,
    createdAtMs: startAtMs + 1_800_000,
  })
  const workItem = { kind: "issue", number: 91, repository: "klondikemarlen/harvest-worklog", source: "user_provided" }
  const plan = projectTimeTransform(
    evidenceState([
      source("entry-explicit", "explicit_prompt", workItem, { text: "Validated the versioned evidence contract.", source: "generated" }),
      source("entry-carried", "carried_forward", workItem),
      source("entry-unassigned", "unassigned"),
      source("entry-ambiguous", "ambiguous"),
    ]),
    parseProjectTimeMappings({ wrap: { project: "WRAP", task: "Programming" } }),
    { from: "2026-07-17", to: "2026-07-17", applyMappings: true },
  )

  assert.deepEqual(
    plan.entries[0].sources.map(({ id, sourceKind, project, repositoryId, repositoryIdentity, startAtMs, endAtMs, createdAtMs, narrative, workItem, workItemAttribution }) => ({ id, sourceKind, project, repositoryId, repositoryIdentity, startAtMs, endAtMs, createdAtMs, narrative, workItem, workItemAttribution })),
    [
      { id: "entry-carried", sourceKind: "human_active", project: "wrap", repositoryId: "repository-id", repositoryIdentity: "github.com/klondikemarlen/wrap", startAtMs, endAtMs: startAtMs + 1_800_000, createdAtMs: startAtMs + 1_800_000, narrative: undefined, workItem, workItemAttribution: "carried_forward" },
      { id: "entry-explicit", sourceKind: "human_active", project: "wrap", repositoryId: "repository-id", repositoryIdentity: "github.com/klondikemarlen/wrap", startAtMs, endAtMs: startAtMs + 1_800_000, createdAtMs: startAtMs + 1_800_000, narrative: { text: "Validated the versioned evidence contract.", source: "generated" }, workItem, workItemAttribution: "explicit_prompt" },
    ],
  )
  assert.deepEqual(plan.unmapped.map(entry => [entry.reason, entry.sources.map(source => source.id)]), [
    ["ambiguous_work_item", ["entry-ambiguous"]],
    ["unassigned_work_item", ["entry-unassigned"]],
  ])
  const draft = formatProjectTimeEntryDrafts(plan)
  assert.match(draft, /source entry-explicit; source kind human_active; repository github\.com\/klondikemarlen\/wrap; task explicit_prompt issue #91 \(klondikemarlen\/harvest-worklog\); interval 2026-07-17T\d{2}:00:00\.000Z–2026-07-17T\d{2}:30:00\.000Z/)
  assert.match(draft, /Narrative evidence \(review only\): Validated the versioned evidence contract\./)
  assert.match(draft, /Unmapped automatic evidence \(not submittable\)[\s\S]*task ambiguous[\s\S]*ambiguous_work_item[\s\S]*task unassigned[\s\S]*unassigned_work_item/)
})

test("rejects unsupported Project Time evidence before a dry-run preflight", async () => {
  const calls = []
  const preview = createProjectTimeTool(z, {
    loadEntries: options => loadProjectTimeEntries({
      ...options,
      read: async () => JSON.stringify({ format: "omp-project-time/evidence", version: "1", entries: [] }),
    }),
    run: async (...args) => {
      calls.push(args)
      return { code: 0, stdout: "", stderr: "" }
    },
  })

  const result = await preview.execute("call-1", { from: "2026-07-17", to: "2026-07-17" }, undefined, undefined, { cwd: "/tmp" })

  assert.match(result.content[0].text, /Unsupported OMP Project Time evidence format/)
  assert.deepEqual(calls, [])
})

test("aggregates mapped sources before ordinary import", () => {
  const at = hour => new Date(2026, 6, 17, hour).getTime()
  const plan = projectTimeEntries(
    evidenceState([
      { project: "wrap", repositoryId: "repo-a", sourceKind: "human_active", startAtMs: at(9), endAtMs: at(10) },
      { project: "wrap", repositoryId: "repo-b", sourceKind: "human_active", startAtMs: at(10), endAtMs: at(11) },
    ]),
    parseProjectTimeMappings(JSON.stringify({ wrap: { project: "WRAP", task: "Programming" } })),
    { from: "2026-07-17", to: "2026-07-17" },
  )

  assert.deepEqual(
    plan.entries,
    [{ spentDate: "2026-07-17", project: "WRAP", task: "Programming", notes: "OMP Project Time: wrap (repo-a); wrap (repo-b)", milliseconds: 7_200_000, hours: 2 }],
  )
})

test("previews inferred Project Time entries without writing", async () => {
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
  })

  const result = await preview.execute("call-1", { from: "2026-07-17", to: "2026-07-17" }, undefined, undefined, { cwd: "/tmp" })

  assert.equal(loads[0].logPath, undefined)
  assert.equal(preview.approval, "read")
  assert.deepEqual(calls, [[
    "harvest-worklog",
    ["work-entry", "2026-07-17", "--project", "Internal", "--task", "Development", "--hours", "1.25", "--notes", "OMP Project Time: Harvest API (repo)", "--dry-run"],
    { cwd: "/tmp", signal: undefined },
  ]])
  assert.match(result.content[0].text, /Would create 2026-07-17/)
  assert.match(result.content[0].text, /Source policy: human_active local Project Time intervals only\./)
  assert.equal(result.details.sourceKind, "human_active")
  assert.match(result.content[0].text, /Skipped 1 unmapped session/)
})

test("filters, groups, maps, and reports Project Time transforms deterministically", () => {
  const at = (hour, minute = 0) => new Date(2026, 6, 17, hour, minute).getTime()
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
  ])
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
  assert.deepEqual(defaultPlan.excluded.map(({ reason }) => reason), ["source_kind"])
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
