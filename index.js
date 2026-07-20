import { spawn } from "node:child_process"
import { loadProjectTimeEntries, loadProjectTimeTransform, parseProjectTimeMappings } from "./project-time.js"

function normalizeHolidayRegions(regions) {
  return [...new Set(regions.map(region => region.trim().toLowerCase()).filter(Boolean))]
}

function normalizeCommand(command) {
  return command?.trim() || "harvest-worklog"
}

export function timeOffArguments({
  from,
  to,
  project,
  task,
  projectId,
  taskId,
  hours,
  notes,
  holidayRegions: callHolidayRegions = [],
  dryRun = false,
}, { defaultHours = 7, holidayRegions = [] } = {}) {
  const args = ["time-off", from, to]
  if (project) args.push("--project", project)
  if (task) args.push("--task", task)
  if (projectId !== undefined) args.push("--project-id", String(projectId))
  if (taskId !== undefined) args.push("--task-id", String(taskId))
  args.push("--hours", String(hours ?? defaultHours))
  for (const region of normalizeHolidayRegions([...holidayRegions, ...callHolidayRegions])) args.push("--holiday-region", region)
  if (notes) args.push("--notes", notes)
  if (dryRun) args.push("--dry-run")
  return args
}

export function runCommand(command, args, { cwd, signal } = {}) {
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    let finished = false
    const abort = () => child.kill("SIGTERM")
    const finish = (code, spawnError) => {
      if (finished) return
      finished = true
      signal?.removeEventListener("abort", abort)
      resolve({ code, stdout, stderr, spawnError })
    }

    child.stdout.on("data", chunk => { stdout += chunk })
    child.stderr.on("data", chunk => { stderr += chunk })
    child.once("error", error => finish(null, error))
    child.once("close", code => finish(code))
    signal?.addEventListener("abort", abort, { once: true })
  })
}

export function workEntryArguments(entry, dryRun, { activityEntry = false } = {}) {
  const args = [
    "work-entry",
    entry.spentDate,
    "--project", entry.project,
    "--task", entry.task,
    "--hours", String(entry.hours),
    "--notes", entry.notes,
  ]
  if (dryRun) args.push("--dry-run")
  if (activityEntry) args.push("--activity-entry")
  return args
}

export function aggregateArguments({ from, to, project, task }) {
  const args = ["aggregate", from, to]
  if (project) args.push("--project", project)
  if (task) args.push("--task", task)
  return args
}

export function timesheetArguments({ date, project, task }) {
  const args = ["timesheet", date, "--project", project]
  if (task) args.push("--task", task)
  return args
}

export function createProjectTimeTool(
  z,
  {
    command = "harvest-worklog",
    projectTimeMappings = "{}",
    projectTimeLogPath = "",
    run = runCommand,
    loadEntries = loadProjectTimeEntries,
  } = {},
  { dryRun },
) {
  command = normalizeCommand(command)
  projectTimeLogPath = projectTimeLogPath.trim()
  const operation = dryRun ? "Preview" : "Record"
  return {
    name: dryRun ? "harvest_preview_project_time_entries" : "harvest_record_project_time_entries",
    label: `${operation} Harvest Project Time`,
    description: `${operation} configured OMP Project Time sessions as Harvest work entries for an inclusive date range. Unmapped sessions and existing or locked Harvest entries are reported; recording requires approval.`,
    approval: dryRun ? "read" : "write",
    parameters: z.object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be an ISO date"),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be an ISO date"),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      try {
        const mappings = parseProjectTimeMappings(projectTimeMappings)
        const plan = await loadEntries({
          from: params.from,
          to: params.to,
          mappings,
          logPath: projectTimeLogPath || undefined,
        })
        if (plan.entries.length === 0) {
          const unmapped = plan.unmapped ? ` ${plan.unmapped} unmapped session(s) were skipped.` : ""
          return {
            content: [{ type: "text", text: `No mapped OMP Project Time sessions found.${unmapped}` }],
            details: { entries: [], unmapped: plan.unmapped },
          }
        }

        onUpdate?.({ content: [{ type: "text", text: `${operation}ing ${plan.entries.length} Harvest work entr${plan.entries.length === 1 ? "y" : "ies"}…` }] })
        const results = []
        for (const entry of plan.entries) {
          const result = await run(command, workEntryArguments(entry, dryRun), { cwd: ctx.cwd, signal })
          results.push({ entry, ...result })
        }
        const output = results.map(result => {
          if (result.spawnError) return `${result.entry.spentDate}: Could not run ${command}: ${result.spawnError.message}`
          return [result.stdout, result.stderr].filter(Boolean).join("\n").trim() || `${result.entry.spentDate}: ${command} exited with ${result.code}`
        }).join("\n")
        const unmapped = plan.unmapped ? `\nSkipped ${plan.unmapped} unmapped session(s).` : ""
        return {
          content: [{ type: "text", text: `${output}${unmapped}` }],
          details: { entries: plan.entries, unmapped: plan.unmapped, results },
        }
      } catch (error) {
        return {
          content: [{ type: "text", text: `Could not ${operation.toLowerCase()} OMP Project Time entries: ${error.message}` }],
          details: { entries: [] },
        }
      }
    },
  }
}

export function createProjectTimeTransformTool(
  z,
  {
    command = "harvest-worklog",
    projectTimeMappings = "{}",
    projectTimeLogPath = "",
    run = runCommand,
    loadTransform = loadProjectTimeTransform,
  } = {},
  { record },
) {
  command = normalizeCommand(command)
  projectTimeLogPath = projectTimeLogPath.trim()
  const operation = record ? "Record" : "Preview"
  const parameters = {
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be an ISO date"),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be an ISO date"),
    repositoryId: z.string().trim().min(1).optional(),
    project: z.string().trim().min(1).optional(),
    sourceKind: z.string().trim().min(1).optional(),
  }
  if (!record) parameters.applyMappings = z.boolean().optional()

  return {
    name: record ? "harvest_record_project_time_transforms" : "harvest_preview_project_time_transforms",
    label: `${operation} Project Time transforms`,
    description: `${operation} local Project Time intervals grouped by date and activity. Preview never writes Harvest; recording is approval-gated and preserves duplicate and locked-entry checks.`,
    approval: record ? "write" : "read",
    parameters: z.object(parameters),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      try {
        const plan = await loadTransform({
          ...params,
          applyMappings: record || params.applyMappings === true,
          mappings: parseProjectTimeMappings(projectTimeMappings),
          logPath: projectTimeLogPath || undefined,
        })
        if (!record) {
          return {
            content: [{ type: "text", text: JSON.stringify(plan) }],
            details: plan,
          }
        }

        onUpdate?.({ content: [{ type: "text", text: `Recording ${plan.entries.length} transformed Harvest work entr${plan.entries.length === 1 ? "y" : "ies"}…` }] })
        const results = []
        for (const entry of plan.entries) {
          const result = await run(command, workEntryArguments(entry, false, { activityEntry: true }), { cwd: ctx.cwd, signal })
          results.push({
            entry,
            code: result.code,
            stdout: result.stdout,
            stderr: result.stderr,
            spawnError: result.spawnError?.message ?? null,
          })
        }
        const output = { plan, results }
        return {
          content: [{ type: "text", text: JSON.stringify(output) }],
          details: output,
        }
      } catch (error) {
        const output = { error: error.message }
        return {
          content: [{ type: "text", text: JSON.stringify(output) }],
          details: output,
        }
      }
    },
  }
}

export function createTimeAggregateTool(z, { command = "harvest-worklog", run = runCommand } = {}) {
  command = normalizeCommand(command)
  return {
    name: "harvest_time_aggregates",
    label: "View Harvest Time Aggregates",
    description: "Read Harvest time-entry totals for an inclusive date range, grouped by date and project/task. This does not write Harvest records.",
    approval: "read",
    parameters: z.object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be an ISO date"),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be an ISO date"),
      project: z.string().trim().min(1).optional(),
      task: z.string().trim().min(1).optional(),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const args = aggregateArguments(params)
      onUpdate?.({ content: [{ type: "text", text: "Reading Harvest time aggregates…" }] })
      const result = await run(command, args, { cwd: ctx.cwd, signal })
      const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim()

      if (result.spawnError) {
        return {
          content: [{ type: "text", text: `Could not run ${command}: ${result.spawnError.message}` }],
          details: { command, args, code: result.code },
        }
      }

      return {
        content: [{ type: "text", text: output || `${command} exited with ${result.code}` }],
        details: { command, args, code: result.code },
      }
    },
  }
}

export function createTimesheetTool(z, { command = "harvest-worklog", run = runCommand } = {}) {
  command = normalizeCommand(command)
  return {
    name: "harvest_time_sheet",
    label: "View Daily Harvest Timesheet",
    description: "Read one project's compact Harvest timesheet for today, yesterday, or an ISO date. This does not write Harvest records.",
    approval: "read",
    parameters: z.object({
      date: z.string().regex(DATE_PATTERN, "must be today, yesterday, or an ISO date"),
      project: z.string().trim().min(1),
      task: z.string().trim().min(1).optional(),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const args = timesheetArguments(params)
      onUpdate?.({ content: [{ type: "text", text: "Reading Harvest timesheet…" }] })
      const result = await run(command, args, { cwd: ctx.cwd, signal })
      const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim()

      if (result.spawnError) {
        return {
          content: [{ type: "text", text: `Could not run ${command}: ${result.spawnError.message}` }],
          details: { command, args, code: result.code },
        }
      }

      return {
        content: [{ type: "text", text: output || `${command} exited with ${result.code}` }],
        details: { command, args, code: result.code },
      }
    },
  }
}

function hasValidAssignment({ project, task, projectId, taskId }) {
  const anyNames = project !== undefined || task !== undefined
  const anyIds = projectId !== undefined || taskId !== undefined
  return (Boolean(project && task) && !anyIds) || (projectId !== undefined && taskId !== undefined && !anyNames)
}

export function createTimeOffTool(z, { command = "harvest-worklog", defaultHours = 7, holidayRegions = "ca_yt", run = runCommand } = {}) {
  command = normalizeCommand(command)
  const configuredHolidayRegions = normalizeHolidayRegions(holidayRegions.split(","))
  return {
    name: "harvest_record_time_off",
    label: "Record Time Off",
    description: "Create one Harvest duration entry for each local business day in an inclusive date range. Supply either project/task names or project/task IDs; optional holidayRegions add repeatable CLI regions. Verify all values before calling; this mutates Harvest.",
    approval: "write",
    parameters: z.object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be an ISO date"),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be an ISO date"),
      project: z.string().trim().min(1).optional(),
      task: z.string().trim().min(1).optional(),
      projectId: z.number().int().positive().optional(),
      taskId: z.number().int().positive().optional(),
      hours: z.number().positive().finite().optional(),
      notes: z.string().trim().min(1).optional(),
      holidayRegions: z.array(z.string().trim().min(1)).optional(),
      dryRun: z.boolean().optional(),
    })
      .refine(hasValidAssignment, { message: "supply project and task, or projectId and taskId, but not both" })
      .refine(params => configuredHolidayRegions.length > 0 || normalizeHolidayRegions(params.holidayRegions ?? []).length > 0, { message: "supply holidayRegions when no regions are configured" }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const args = timeOffArguments(params, { defaultHours, holidayRegions: configuredHolidayRegions })
      onUpdate?.({ content: [{ type: "text", text: "Recording Harvest time-off entries…" }] })
      const result = await run(command, args, { cwd: ctx.cwd, signal })
      const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim()

      if (result.spawnError) {
        return {
          content: [{ type: "text", text: `Could not run ${command}: ${result.spawnError.message}` }],
          details: { command, args, code: result.code },
        }
      }

      return {
        content: [{ type: "text", text: output || `${command} exited with ${result.code}` }],
        details: { command, args, code: result.code },
      }
    },
  }
}

const HARVEST_WORKLOG_USAGE = [
  "Usage:",
  "  /harvest-worklog timesheet DATE --project PROJECT [--task TASK]",
  "",
  "DATE: today, yesterday, or YYYY-MM-DD",
].join("\n")

const DATE_COMPLETIONS = [
  { label: "today", value: "today", description: "Local date alias; YYYY-MM-DD is also accepted" },
  { label: "yesterday", value: "yesterday", description: "Previous local date; YYYY-MM-DD is also accepted" },
]

function dateCompletions() {
  const now = new Date()
  const value = [now.getFullYear(), now.getMonth() + 1, now.getDate()].map(part => String(part).padStart(2, "0")).join("-")
  return [...DATE_COMPLETIONS, { label: "YYYY-MM-DD", value, description: "Today's local ISO date; edit as needed" }]
}

const DATE_PATTERN = /^(today|yesterday|\d{4}-\d{2}-\d{2})$/i

const TIMESHEET_FLAGS = {
  "--project": "Exact Harvest project name",
  "--task": "Optional exact Harvest task name",
  "--help": "Show timesheet CLI help",
}

export function harvestWorklogArgumentCompletions(argumentPrefix) {
  const input = argumentPrefix
  const trimmed = input.trim()

  if (!trimmed || !input.includes(" ")) {
    const choices = [
      { label: "timesheet", value: "timesheet", description: "Read one project's personal daily timesheet" },
      { label: "help", value: "help", description: "Show the timesheet command form and date options" },
    ]
    return choices.filter(choice => choice.value.startsWith(trimmed.toLowerCase()))
  }

  const first = trimmed.split(/\s+/, 1)[0].toLowerCase()
  if (first !== "timesheet") return null

  const words = trimmed.split(/\s+/)
  if (words.some(word => ["--help", "-h"].includes(word))) return null
  const optionIndex = words.findIndex((word, index) => index > 0 && word.startsWith("--"))
  const positionals = words.slice(1, optionIndex === -1 ? words.length : optionIndex)
  if (optionIndex === -1 && (positionals.length < 1 || (!input.endsWith(" ") && positionals.length === 1))) {
    const partial = input.endsWith(" ") ? "" : positionals.at(-1) ?? ""
    const base = [first, ...positionals.slice(0, input.endsWith(" ") ? positionals.length : -1)]
    return dateCompletions()
      .filter(choice => choice.value.startsWith(partial.toLowerCase()))
      .map(choice => ({ ...choice, value: [...base, choice.value].join(" ") }))
  }

  if (positionals.length !== 1 || !DATE_PATTERN.test(positionals[0])) return null

  const flags = !words.includes("--project")
    ? { "--project": TIMESHEET_FLAGS["--project"], "--help": TIMESHEET_FLAGS["--help"] }
    : hasFlagValue(words, "--project")
      ? { "--task": TIMESHEET_FLAGS["--task"], "--help": TIMESHEET_FLAGS["--help"] }
      : { "--help": TIMESHEET_FLAGS["--help"] }
  return completionForFlag(input, flags)
}

function completionForFlag(input, flags) {
  const trimmed = input.trim()
  const words = trimmed.split(/\s+/)
  const current = input.endsWith(" ") ? "" : words.at(-1)
  const previous = input.endsWith(" ") ? words.at(-1) : words.at(-2)
  if (!current && previous?.startsWith("--")) return null
  if (current && !current.startsWith("--")) return null

  const base = current ? trimmed.slice(0, -current.length).trimEnd() : trimmed
  const choices = Object.entries(flags)
    .filter(([flag]) => !words.includes(flag) && (!current || flag.startsWith(current)))
    .map(([flag, description]) => ({ label: flag, value: `${base} ${flag}`.trim(), description }))
  return choices.length > 0 ? choices : null
}

function hasFlagValue(words, flag) {
  const index = words.indexOf(flag)
  return index >= 0 && Boolean(words[index + 1]) && !words[index + 1].startsWith("--")
}

export function parseCommandArguments(input) {
  const words = []
  let word = ""
  let quote = null
  let started = false
  let escaped = false

  for (const character of input.trim()) {
    if (escaped) {
      word += character
      started = true
      escaped = false
    } else if (character === "\\" && quote !== "'") {
      escaped = true
    } else if (quote) {
      if (character === quote) quote = null
      else word += character
    } else if (character === "'" || character === "\"") {
      quote = character
      started = true
    } else if (/\s/.test(character)) {
      if (started) {
        words.push(word)
        word = ""
        started = false
      }
    } else {
      word += character
      started = true
    }
  }

  if (quote || escaped) return null
  if (started) words.push(word)
  return words
}

function isTimesheetForm(words, allowIncomplete = false) {
  if (words[0] !== "timesheet") return false
  if (allowIncomplete && words.length === 1) return true
  if (!DATE_PATTERN.test(words[1])) return false
  if (allowIncomplete && words.length === 2) return true
  if (words[2] !== "--project" || !words[3] || words[3].startsWith("--")) return false
  if (words.length === 4) return true
  return words.length === 6 && words[4] === "--task" && Boolean(words[5]) && !words[5].startsWith("--")
}

export function parseHarvestWorklogArguments(args) {
  const input = args.trim()
  if (input === "help") return { help: true }

  const words = parseCommandArguments(input)
  if (!words || words.length === 0) return null
  const help = ["--help", "-h"].includes(words.at(-1))
  const form = help ? words.slice(0, -1) : words
  return isTimesheetForm(form, help) ? { argv: words } : null
}

export default function harvestTimeExtension(pi, options = {}) {
  pi.setLabel?.("Harvest Worklog")
  const command = normalizeCommand(options.command)
  const run = options.run ?? runCommand
  const projectTimeMappings = options.projectTimeMappings?.trim() || "{}"
  const projectTimeLogPath = options.projectTimeLogPath?.trim() || ""
  pi.registerCommand("harvest-worklog", {
    description: "Show one project's daily Harvest timesheet",
    getArgumentCompletions: harvestWorklogArgumentCompletions,
    handler: async (args, ctx) => {
      const parsed = parseHarvestWorklogArguments(args)
      if (!parsed || parsed.help) {
        ctx.ui.notify(HARVEST_WORKLOG_USAGE, parsed?.help ? "info" : "error")
        return
      }

      const result = await run(command, parsed.argv, { cwd: ctx.cwd })
      if (result.spawnError) {
        ctx.ui.notify(`Could not run ${command}: ${result.spawnError.message}`, "error")
        return
      }

      const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim() || `${command} exited with ${result.code}`
      pi.sendMessage({ customType: "harvest-worklog-timesheet", content: output, display: true, attribution: "assistant" }, { triggerTurn: false })
    },
  })
  pi.registerTool(createTimeAggregateTool(pi.zod.z, { command }))
  pi.registerTool(createTimesheetTool(pi.zod.z, { command, run }))
  pi.registerTool(createTimeOffTool(pi.zod.z, {
    command,
    defaultHours: options.defaultHours,
    holidayRegions: options.holidayRegions,
  }))
  pi.registerTool(createProjectTimeTool(pi.zod.z, {
    command,
    projectTimeMappings,
    projectTimeLogPath,
  }, { dryRun: true }))
  pi.registerTool(createProjectTimeTool(pi.zod.z, {
    command,
    projectTimeMappings,
    projectTimeLogPath,
  }, { dryRun: false }))
  pi.registerTool(createProjectTimeTransformTool(pi.zod.z, {
    command,
    projectTimeMappings,
    projectTimeLogPath,
  }, { record: false }))
  pi.registerTool(createProjectTimeTransformTool(pi.zod.z, {
    command,
    projectTimeMappings,
    projectTimeLogPath,
  }, { record: true }))
}
