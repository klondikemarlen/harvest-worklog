import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

const HOUR_MS = 60 * 60 * 1000
const PROJECT_TIME_EVIDENCE_FORMAT = "omp-project-time/evidence"
const PROJECT_TIME_EVIDENCE_VERSION = 1

function projectTimeEvidenceEntries(state) {
  if (!state || typeof state !== "object" || Array.isArray(state) || !Array.isArray(state.entries)) {
    throw new Error("OMP Project Time evidence must include an entries array")
  }
  if (state.format !== PROJECT_TIME_EVIDENCE_FORMAT || state.version !== PROJECT_TIME_EVIDENCE_VERSION) {
    throw new Error(`Unsupported OMP Project Time evidence format; expected ${PROJECT_TIME_EVIDENCE_FORMAT} v${PROJECT_TIME_EVIDENCE_VERSION}`)
  }
  return state.entries
}

export function defaultProjectTimeLogPath() {
  return path.join(homedir(), ".omp", "project-time", "time-log.json")
}

export function parseProjectTimeMappings(value) {
  const mappings = typeof value === "string" ? JSON.parse(value.trim() || "{}") : value
  if (typeof mappings !== "object" || mappings === null || Array.isArray(mappings)) {
    throw new Error("projectTimeMappings must be a JSON object")
  }

  const result = new Map()
  for (const [project, mapping] of Object.entries(mappings)) {
    const normalizedProject = project.trim()
    if (
      typeof mapping !== "object" ||
      mapping === null ||
      Array.isArray(mapping) ||
      normalizedProject.length === 0 ||
      typeof mapping.project !== "string" ||
      mapping.project.trim().length === 0 ||
      typeof mapping.task !== "string" ||
      mapping.task.trim().length === 0
    ) {
      throw new Error(`projectTimeMappings.${project} requires project and task names`)
    }
    if (result.has(normalizedProject)) throw new Error(`projectTimeMappings has duplicate project ${normalizedProject}`)
    result.set(normalizedProject, { ...mapping, project: mapping.project.trim(), task: mapping.task.trim() })
  }
  return result
}


export function projectTimeProjectNames(state) {
  return [...new Set(projectTimeEvidenceEntries(state)
    .filter(session => session?.sourceKind === "human_active" && typeof session.project === "string" && session.project.trim().length > 0)
    .map(session => session.project))]
    .sort((left, right) => left.localeCompare(right))
}


export function projectTimeTransform(
  state,
  mappings,
  {
    from,
    to,
    repositoryId,
    project,
    sourceKind = "human_active",
    applyMappings = false,
  },
) {
  const entries = projectTimeEvidenceEntries(state)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) {
    throw new Error("from and to must be an inclusive ISO date range")
  }

  const grouped = new Map()
  const excluded = []

  for (const session of entries) {
    const row = sessionRow(session)
    if (!session || !Number.isFinite(session.startAtMs) || !Number.isFinite(session.endAtMs) || session.startAtMs >= session.endAtMs) {
      excluded.push({ ...row, reason: "invalid_interval" })
      continue
    }

    const reasons = []
    if (repositoryId !== undefined && session.repositoryId !== repositoryId) reasons.push("repository_id")
    if (project !== undefined && session.project !== project) reasons.push("project")
    if (sourceKind !== undefined && session.sourceKind !== sourceKind) reasons.push("source_kind")
    if (reasons.length > 0) {
      excluded.push({ ...row, reason: reasons.join(",") })
      continue
    }

    let cursor = session.startAtMs
    let included = false
    while (cursor < session.endAtMs) {
      const date = new Date(cursor)
      const spentDate = localDate(date)
      const segmentEnd = Math.min(session.endAtMs, new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime())

      if (spentDate >= from && spentDate <= to) {
        const source = projectTimeEvidenceSegment(session, spentDate, cursor, segmentEnd)
        const activity = source.activity ?? "unlabelled"
        const key = JSON.stringify([spentDate, source.repositoryId, source.project, source.sourceKind, activity, source.workItemAttribution ?? null, source.workItem?.kind ?? null, source.workItem?.number ?? null, source.workItem?.repository ?? null])
        const entry = grouped.get(key) ?? {
          spentDate,
          repositoryId: source.repositoryId,
          ...(source.repositoryIdentity === undefined ? {} : { repositoryIdentity: source.repositoryIdentity }),
          project: source.project,
          sourceKind: source.sourceKind,
          activity,
          ...(source.workItem === undefined ? {} : { workItem: source.workItem }),
          ...(source.workItemAttribution === undefined ? {} : { workItemAttribution: source.workItemAttribution }),
          sources: [],
          milliseconds: 0,
        }
        entry.milliseconds += source.milliseconds
        entry.sources.push(source)
        grouped.set(key, entry)
        included = true
      }
      cursor = segmentEnd
    }
    if (!included) excluded.push({ ...row, reason: "date_range" })
  }

  const groups = [...grouped.values()]
    .map(entry => ({ ...entry, sources: entry.sources.sort(compareEvidenceSources), hours: displayHours(entry.milliseconds), harvest: null }))
    .sort(compareGroups)
  const timesheetDraftEntries = applyMappings ? timesheetEntries(groups, mappings) : []

  return {
    sourceKind,
    groups,
    entries: timesheetDraftEntries,
    excluded: excluded.sort(compareRows),
  }
}


export async function loadProjectTimeTransform({ from, to, repositoryId, project, sourceKind, applyMappings, mappings, logPath = defaultProjectTimeLogPath(), read = readFile }) {
  const state = JSON.parse(await read(logPath, "utf8"))
  return projectTimeTransform(state, mappings, { from, to, repositoryId, project, sourceKind, applyMappings })
}

export function resolveProjectTimeDate(value, today = new Date()) {
  const alias = value.toLowerCase()
  const date = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  if (alias === "today") return localDate(date)
  if (alias === "yesterday") {
    date.setDate(date.getDate() - 1)
    return localDate(date)
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) throw new Error("DATE must be today, yesterday, or YYYY-MM-DD")
  const [, year, month, day] = match.map(Number)
  const parsed = new Date(year, month - 1, day)
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) {
    throw new Error("DATE must be a valid local date")
  }
  return value
}

export function formatProjectTimeEntryDrafts(plan) {
  const drafts = new Map()
  for (const entry of plan.entries ?? []) {
    const key = JSON.stringify([entry.spentDate, entry.project, entry.task])
    const draft = drafts.get(key) ?? {
      spentDate: entry.spentDate,
      project: entry.project,
      task: entry.task,
      destination: entry.destination,
      milliseconds: 0,
      sources: new Map(),
    }
    draft.milliseconds += entry.milliseconds
    for (const source of entry.sources ?? []) {
      const sourceKey = source.id ?? JSON.stringify([source.spentDate, source.project, source.repositoryId, source.sourceKind, source.activity])
      const aggregate = draft.sources.get(sourceKey) ?? { ...source, milliseconds: 0 }
      aggregate.milliseconds += source.milliseconds
      draft.sources.set(sourceKey, aggregate)
    }
    drafts.set(key, draft)
  }

  const sections = [...drafts.values()]
    .sort((left, right) => left.spentDate.localeCompare(right.spentDate) || left.project.localeCompare(right.project) || left.task.localeCompare(right.task))
    .map(draft => [
      `Date: ${draft.spentDate}`,
      `Project: ${draft.project}`,
      `Task: ${draft.task}`,
      `Destination: ${draft.destination}`,
      `Duration: ${formatExactDuration(draft.milliseconds)}`,
      "Notes (required before submitting)",
      "- Add a factual Harvest note; automatic activity labels are reference only.",
      "Source evidence",
      ...[...draft.sources.values()].sort(compareGroups).map(formatDraftEvidence),
    ].join("\n"))
  if (sections.length === 0) sections.push("No local Project Time evidence found.")
  const excluded = plan.excluded ?? []
  if (excluded.length > 0) {
    sections.push([
      "Excluded Project Time evidence",
      ...excluded.map(formatDraftEvidence),
    ].join("\n"))
  }

  return [
    `Source policy: ${plan.sourceKind ?? "human_active"} local Project Time intervals only.`,
    "Inferred work-timesheet drafts (review only; nothing written)",
    ...sections,
  ].join("\n\n")
}

function formatDraftEvidence(entry) {
  const source = `- ${entry.spentDate ?? "unknown date"} / ${entry.project ?? "unlabelled"} / ${entry.repositoryId ?? "unknown repository"} / ${entry.activity ?? "unlabelled"} · ${formatExactDuration(entry.milliseconds ?? 0)}`
  const details = [
    ...(typeof entry.id === "string" ? [`source ${entry.id}`] : []),
    ...(typeof entry.sourceKind === "string" ? [`source kind ${entry.sourceKind}`] : []),
    ...(typeof entry.repositoryIdentity === "string" ? [`repository ${entry.repositoryIdentity}`] : []),
    ...(typeof entry.workItemAttribution === "string" ? [`task ${entry.workItemAttribution}${entry.workItem ? ` ${entry.workItem.kind} #${entry.workItem.number}${entry.workItem.repository ? ` (${entry.workItem.repository})` : ""}` : ""}`] : []),
    ...(Number.isFinite(entry.segmentStartAtMs) && Number.isFinite(entry.segmentEndAtMs) ? [`interval ${new Date(entry.segmentStartAtMs).toISOString()}–${new Date(entry.segmentEndAtMs).toISOString()}`] : []),
    ...(typeof entry.reason === "string" ? [entry.reason] : []),
  ]
  const narrative = normalizeNote(entry.narrative?.text)
  return `${source}${details.length > 0 ? ` (${details.join("; ")})` : ""}${narrative ? `\n  Narrative evidence (review only): ${narrative}` : ""}`
}

function formatExactDuration(milliseconds) {
  const minutes = Math.floor(milliseconds / 60_000)
  const seconds = Math.floor((milliseconds % 60_000) / 1000)
  const remainder = milliseconds % 1000
  if (seconds === 0 && remainder === 0) return formatDayTotal(milliseconds)
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${String(seconds).padStart(2, "0")}${remainder === 0 ? "" : `.${String(remainder).padStart(3, "0")}`}`
}

function normalizeNote(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : ""
}


function formatDayTotal(milliseconds) {
  const minutes = Math.floor(milliseconds / 60_000)
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`
}

function timesheetEntries(groups, mappings) {
  const entries = new Map()

  for (const group of groups) {
    const destination = timesheetDestination(group, mappings)
    const key = JSON.stringify([group.spentDate, destination.project, destination.task])
    const entry = entries.get(key) ?? {
      spentDate: group.spentDate,
      project: destination.project,
      task: destination.task,
      destination: destination.label,
      milliseconds: 0,
      sources: [],
    }
    entry.milliseconds += group.milliseconds
    entry.sources.push(...group.sources)
    entries.set(key, entry)
  }

  return [...entries.values()]
    .map(entry => ({
      ...entry,
      hours: displayHours(entry.milliseconds),
      sources: entry.sources.sort(compareEvidenceSources),
    }))
    .filter(entry => entry.hours > 0)
    .sort((left, right) => left.spentDate.localeCompare(right.spentDate) || left.project.localeCompare(right.project) || left.task.localeCompare(right.task))
}

function timesheetDestination(group, mappings) {
  const localProject = group.project || "Unlabelled Project Time project"
  const attribution = group.workItemAttribution
  const mapping = mappings.get(group.project)

  if (attribution === "unassigned" || attribution === "ambiguous") {
    return {
      project: localProject,
      task: "Review destination",
      label: `Local Project Time project — ${attribution} work item; choose a Harvest project and task before submitting.`,
    }
  }

  if (!mapping) {
    return {
      project: localProject,
      task: "Review destination",
      label: "Local Project Time project — no configured Harvest destination; choose a Harvest project and task before submitting.",
    }
  }

  group.harvest = { project: mapping.project, task: mapping.task }
  return {
    project: mapping.project,
    task: mapping.task,
    label: "Configured Harvest destination",
  }
}

function sessionRow(session) {
  return {
    id: session?.id ?? null,
    repositoryId: session?.repositoryId ?? null,
    ...(session?.repositoryIdentity === undefined ? {} : { repositoryIdentity: session.repositoryIdentity }),
    project: session?.project ?? null,
    sourceKind: session?.sourceKind ?? null,
    activity: typeof session?.activity === "string" && session.activity.length > 0 ? session.activity : "unlabelled",
    ...(session?.narrative === undefined ? {} : { narrative: session.narrative }),
    ...(session?.workItem === undefined ? {} : { workItem: session.workItem }),
    ...(session?.workItemAttribution === undefined ? {} : { workItemAttribution: session.workItemAttribution }),
    startAtMs: session?.startAtMs ?? null,
    endAtMs: session?.endAtMs ?? null,
    createdAtMs: session?.createdAtMs ?? null,
  }
}

function projectTimeEvidenceSegment(session, spentDate, segmentStartAtMs, segmentEndAtMs) {
  return {
    id: session.id,
    spentDate,
    sourceKind: session.sourceKind,
    project: session.project,
    repositoryId: session.repositoryId,
    ...(session.repositoryIdentity === undefined ? {} : { repositoryIdentity: session.repositoryIdentity }),
    startAtMs: session.startAtMs,
    endAtMs: session.endAtMs,
    segmentStartAtMs,
    segmentEndAtMs,
    createdAtMs: session.createdAtMs,
    ...(typeof session.activity === "string" && session.activity.length > 0 ? { activity: session.activity } : {}),
    ...(session.narrative === undefined ? {} : { narrative: session.narrative }),
    ...(session.workItem === undefined ? {} : { workItem: session.workItem }),
    ...(session.workItemAttribution === undefined ? {} : { workItemAttribution: session.workItemAttribution }),
    milliseconds: segmentEndAtMs - segmentStartAtMs,
  }
}

function displayHours(milliseconds) {
  return Math.round((milliseconds / HOUR_MS) * 100) / 100
}

function compareEvidenceSources(left, right) {
  return String(left.spentDate).localeCompare(String(right.spentDate)) ||
    String(left.id ?? "").localeCompare(String(right.id ?? "")) ||
    Number(left.segmentStartAtMs ?? left.startAtMs ?? 0) - Number(right.segmentStartAtMs ?? right.startAtMs ?? 0) ||
    Number(left.segmentEndAtMs ?? left.endAtMs ?? 0) - Number(right.segmentEndAtMs ?? right.endAtMs ?? 0)
}

function compareGroups(left, right) {
  return left.spentDate.localeCompare(right.spentDate) ||
    String(left.project).localeCompare(String(right.project)) ||
    String(left.repositoryId).localeCompare(String(right.repositoryId)) ||
    String(left.sourceKind).localeCompare(String(right.sourceKind)) ||
    String(left.activity ?? "").localeCompare(String(right.activity ?? "")) ||
    String(left.workItemAttribution ?? "").localeCompare(String(right.workItemAttribution ?? ""))
}

function compareRows(left, right) {
  return String(left.startAtMs).localeCompare(String(right.startAtMs)) ||
    String(left.endAtMs).localeCompare(String(right.endAtMs)) ||
    String(left.project).localeCompare(String(right.project)) ||
    String(left.repositoryId).localeCompare(String(right.repositoryId)) ||
    String(left.sourceKind).localeCompare(String(right.sourceKind)) ||
    left.reason.localeCompare(right.reason)
}


function localDate(date) {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()].map(value => String(value).padStart(2, "0")).join("-")
}
