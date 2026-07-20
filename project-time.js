import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

const HOUR_MS = 60 * 60 * 1000

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

export function projectTimeEntries(state, mappings, { from, to }) {
  if (!state || !Array.isArray(state.entries)) {
    throw new Error("OMP Project Time log is missing an entries array")
  }

  const grouped = new Map()
  let unmapped = 0

  for (const session of state.entries) {
    const mapping = mappings.get(session.project)
    if (!mapping) {
      unmapped += 1
      continue
    }
    if (!Number.isFinite(session.startAtMs) || !Number.isFinite(session.endAtMs) || session.startAtMs >= session.endAtMs) {
      throw new Error("OMP Project Time log contains an invalid session interval")
    }

    let cursor = session.startAtMs
    while (cursor < session.endAtMs) {
      const date = new Date(cursor)
      const spentDate = localDate(date)
      const nextDay = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime()
      const segmentEnd = Math.min(session.endAtMs, nextDay)

      if (spentDate >= from && spentDate <= to) {
        const key = [spentDate, mapping.project, mapping.task, session.project, session.repositoryId].join("\u0000")
        const entry = grouped.get(key) ?? {
          spentDate,
          project: mapping.project,
          task: mapping.task,
          notes: `OMP Project Time: ${session.project} (${session.repositoryId})`,
          milliseconds: 0,
        }
        entry.milliseconds += segmentEnd - cursor
        grouped.set(key, entry)
      }
      cursor = segmentEnd
    }
  }

  return {
    entries: [...grouped.values()]
      .map(entry => ({ ...entry, hours: Math.round((entry.milliseconds / HOUR_MS) * 100) / 100 }))
      .filter(entry => entry.hours > 0)
      .sort((left, right) => left.spentDate.localeCompare(right.spentDate) || left.notes.localeCompare(right.notes)),
    unmapped,
  }
}

export function projectTimeTransform(
  state,
  mappings,
  {
    from,
    to,
    repositoryId,
    project,
    sourceKind,
    applyMappings = false,
  },
) {
  if (!state || !Array.isArray(state.entries)) {
    throw new Error("OMP Project Time log is missing an entries array")
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) {
    throw new Error("from and to must be an inclusive ISO date range")
  }

  const grouped = new Map()
  const excluded = []

  for (const session of state.entries) {
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
        const activity = typeof session.activity === "string" && session.activity.length > 0 ? session.activity : "unlabelled"
        const key = JSON.stringify([spentDate, session.repositoryId, session.project, session.sourceKind ?? null, activity])
        const entry = grouped.get(key) ?? {
          spentDate,
          repositoryId: session.repositoryId ?? null,
          project: session.project ?? null,
          sourceKind: session.sourceKind ?? null,
          activity,
          milliseconds: 0,
        }
        entry.milliseconds += segmentEnd - cursor
        grouped.set(key, entry)
        included = true
      }
      cursor = segmentEnd
    }
    if (!included) excluded.push({ ...row, reason: "date_range" })
  }

  const groups = [...grouped.values()]
    .map(entry => ({ ...entry, hours: displayHours(entry.milliseconds), harvest: null }))
    .sort(compareGroups)
  const unmapped = []
  const entries = applyMappings ? mappedEntries(groups, mappings, unmapped) : []

  return {
    groups,
    entries,
    unmapped: unmapped.sort(compareGroups),
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
export function projectTimeWeek(spentDate) {
  const from = dateFromIso(spentDate)
  from.setDate(from.getDate() - ((from.getDay() + 6) % 7))
  const to = new Date(from)
  to.setDate(to.getDate() + 6)
  return { from: localDate(from), to: localDate(to) }
}

export function formatProjectTimeTimesheet(plan, { project, spentDate }) {
  const { from, to } = projectTimeWeek(spentDate)
  const weeklyTotals = new Map()
  const selectedTotals = new Map([["human_active", 0], ["agent_turn_elapsed", 0]])
  for (const group of plan.groups) {
    if (group.sourceKind === "human_active") weeklyTotals.set(group.spentDate, (weeklyTotals.get(group.spentDate) ?? 0) + group.milliseconds)
    if (group.spentDate === spentDate && selectedTotals.has(group.sourceKind)) {
      selectedTotals.set(group.sourceKind, selectedTotals.get(group.sourceKind) + group.milliseconds)
    }
  }

  const start = dateFromIso(from)
  const dates = Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(start)
    date.setDate(date.getDate() + offset)
    return localDate(date)
  })
  const week = dates.map(date => `${formatShortDate(dateFromIso(date)).slice(0, 3)} ${formatDayTotal(weeklyTotals.get(date) ?? 0)}`).join(" · ")
  const detail = selectedTotals.get("human_active") + selectedTotals.get("agent_turn_elapsed") === 0
    ? `No local Project Time sessions found for ${project} on ${spentDate}.`
    : `Human active · ${formatDuration(selectedTotals.get("human_active"))}\nAgent elapsed · ${formatDuration(selectedTotals.get("agent_turn_elapsed"))}`
  return [
    `${project} · Week of ${formatShortDate(start)}–${formatShortDate(dateFromIso(to))}`,
    "",
    week,
    "",
    formatShortDate(dateFromIso(spentDate)),
    detail,
  ].join("\n")
}

function dateFromIso(value) {
  const [year, month, day] = value.split("-").map(Number)
  return new Date(year, month - 1, day)
}

function formatShortDate(date) {
  return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getDay()]}, ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][date.getMonth()]} ${date.getDate()}`
}

function formatDayTotal(milliseconds) {
  const minutes = Math.floor(Math.max(0, milliseconds) / 60_000)
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`
}

function formatDuration(milliseconds) {
  let seconds = Math.floor(Math.max(0, milliseconds) / 1000)
  const hours = Math.floor(seconds / 3600)
  seconds %= 3600
  const minutes = Math.floor(seconds / 60)
  seconds %= 60
  return [hours && `${hours}h`, (hours || minutes) && `${minutes}m`, `${seconds}s`].filter(Boolean).join(" ")
}

function mappedEntries(groups, mappings, unmapped) {
  const entries = new Map()

  for (const group of groups) {
    const mapping = mappings.get(group.project)
    if (!mapping) {
      unmapped.push({ ...group, reason: "unmapped_project" })
      continue
    }

    group.harvest = { project: mapping.project, task: mapping.task }
    const key = JSON.stringify([group.spentDate, mapping.project, mapping.task, group.activity])
    const entry = entries.get(key) ?? {
      spentDate: group.spentDate,
      project: mapping.project,
      task: mapping.task,
      activity: group.activity,
      milliseconds: 0,
      sources: [],
    }
    entry.milliseconds += group.milliseconds
    entry.sources.push({
      spentDate: group.spentDate,
      repositoryId: group.repositoryId,
      project: group.project,
      sourceKind: group.sourceKind,
      activity: group.activity,
      milliseconds: group.milliseconds,
      hours: group.hours,
    })
    entries.set(key, entry)
  }

  return [...entries.values()]
    .map(entry => {
      const sources = entry.sources.sort(compareGroups)
      return {
        ...entry,
        hours: displayHours(entry.milliseconds),
        notes: `OMP Project Time activity: ${JSON.stringify(entry.activity)}\n${sources.map(source => `${source.project} (${source.repositoryId})`).join("; ")}`,
        sources,
      }
    })
    .filter(entry => entry.hours > 0)
    .sort((left, right) => left.spentDate.localeCompare(right.spentDate) || left.project.localeCompare(right.project) || left.task.localeCompare(right.task) || left.activity.localeCompare(right.activity))
}

function sessionRow(session) {
  return {
    repositoryId: session?.repositoryId ?? null,
    project: session?.project ?? null,
    sourceKind: session?.sourceKind ?? null,
    activity: typeof session?.activity === "string" && session.activity.length > 0 ? session.activity : "unlabelled",
    startAtMs: session?.startAtMs ?? null,
    endAtMs: session?.endAtMs ?? null,
  }
}

function displayHours(milliseconds) {
  return Math.round((milliseconds / HOUR_MS) * 100) / 100
}

function compareGroups(left, right) {
  return left.spentDate.localeCompare(right.spentDate) ||
    String(left.project).localeCompare(String(right.project)) ||
    String(left.repositoryId).localeCompare(String(right.repositoryId)) ||
    String(left.sourceKind).localeCompare(String(right.sourceKind)) ||
    left.activity.localeCompare(right.activity)
}

function compareRows(left, right) {
  return String(left.startAtMs).localeCompare(String(right.startAtMs)) ||
    String(left.endAtMs).localeCompare(String(right.endAtMs)) ||
    String(left.project).localeCompare(String(right.project)) ||
    String(left.repositoryId).localeCompare(String(right.repositoryId)) ||
    String(left.sourceKind).localeCompare(String(right.sourceKind)) ||
    left.reason.localeCompare(right.reason)
}

export async function loadProjectTimeEntries({ from, to, mappings, logPath = defaultProjectTimeLogPath(), read = readFile }) {
  const state = JSON.parse(await read(logPath, "utf8"))
  return projectTimeEntries(state, mappings, { from, to })
}

function localDate(date) {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()].map(value => String(value).padStart(2, "0")).join("-")
}
