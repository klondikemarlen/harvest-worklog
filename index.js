import { spawn } from "node:child_process"
import { loadProjectTimeEntries, loadProjectTimeTransform, parseProjectTimeMappings } from "./project-time.js"

export function timeOffArguments({
  from,
  to,
  project,
  task,
  hours,
  notes,
  dryRun = false,
}, { defaultHours = 7, holidayRegions = [] } = {}) {
  const args = ["time-off", from, to, "--project", project, "--task", task, "--hours", String(hours ?? defaultHours)]
  for (const region of holidayRegions) args.push("--holiday-region", region)
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
  const operation = record ? "Record" : "Preview"
  const parameters = {
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be an ISO date"),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be an ISO date"),
    repositoryId: z.string().min(1).optional(),
    project: z.string().min(1).optional(),
    sourceKind: z.string().min(1).optional(),
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
  return {
    name: "harvest_time_aggregates",
    label: "View Harvest Time Aggregates",
    description: "Read Harvest time-entry totals for an inclusive date range, grouped by date and project/task. This does not write Harvest records.",
    approval: "read",
    parameters: z.object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be an ISO date"),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be an ISO date"),
      project: z.string().min(1).optional(),
      task: z.string().min(1).optional(),
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
  return {
    name: "harvest_time_sheet",
    label: "View Daily Harvest Timesheet",
    description: "Read one project's compact Harvest timesheet for today, yesterday, or an ISO date. This does not write Harvest records.",
    approval: "read",
    parameters: z.object({
      date: z.string().min(1),
      project: z.string().min(1),
      task: z.string().min(1).optional(),
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

export function createTimeOffTool(z, { command = "harvest-worklog", defaultHours = 7, holidayRegions = "", run = runCommand } = {}) {
  return {
    name: "harvest_record_time_off",
    label: "Record Time Off",
    description: "Create one Harvest duration entry for each local business day in an inclusive date range. Verify the project, task, dates, configured holiday region, hours, and optional note before calling; this mutates Harvest.",
    approval: "write",
    parameters: z.object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be an ISO date"),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be an ISO date"),
      project: z.string().min(1),
      task: z.string().min(1),
      hours: z.number().positive().finite().optional(),
      notes: z.string().min(1).optional(),
      dryRun: z.boolean().optional(),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const args = timeOffArguments(params, { defaultHours, holidayRegions: holidayRegions.split(",").map(region => region.trim()).filter(Boolean) })
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
  "  /harvest-worklog DATE PROJECT [--task TASK]",
  "  /harvest-worklog COMMAND [CLI OPTIONS]",
  "",
  "Commands: timesheet, aggregate, time-off, work-entry",
  "DATE: today, yesterday, or YYYY-MM-DD",
].join("\n")

const DATE_COMPLETIONS = [
  { label: "today", value: "today", description: "Local date alias; YYYY-MM-DD is also accepted" },
  { label: "yesterday", value: "yesterday", description: "Previous local date; YYYY-MM-DD is also accepted" },
]

function dateCompletions(command) {
  if (command === "timesheet") return DATE_COMPLETIONS
  const now = new Date()
  const value = [now.getFullYear(), now.getMonth() + 1, now.getDate()].map(part => String(part).padStart(2, "0")).join("-")
  return [{ label: "YYYY-MM-DD", value, description: "Today's local ISO date; edit as needed" }]
}

const COMMAND_COMPLETIONS = {
  timesheet: {
    description: "Read one project's personal daily timesheet",
    dates: 1,
    flags: {
      "--project": "Exact Harvest project name",
      "--help": "Show timesheet CLI help",
      "--task": "Optional exact Harvest task name",
    },
  },
  aggregate: {
    description: "Read Harvest totals for an inclusive date range",
    dates: 2,
    flags: {
      "--project": "Optional exact Harvest project name",
      "--help": "Show aggregate CLI help",
      "--task": "Optional exact Harvest task name",
    },
  },
  "time-off": {
    description: "Record holiday-aware time-off entries",
    dates: 2,
    flags: {
      "--project": "Harvest project name",
      "--task": "Harvest task name",
      "--project-id": "Harvest project ID",
      "--task-id": "Harvest task ID",
      "--hours": "Hours per business day",
      "--notes": "Entry notes",
      "--holiday-region": "Holidays region code",
      "--help": "Show time-off CLI help",
      "--dry-run": "Preview without writing",
    },
  },
  "work-entry": {
    description: "Record one reviewed work entry",
    dates: 1,
    flags: {
      "--project": "Harvest project name",
      "--task": "Harvest task name",
      "--project-id": "Harvest project ID",
      "--task-id": "Harvest task ID",
      "--hours": "Entry hours",
      "--notes": "Entry notes",
      "--dry-run": "Preview without writing",
      "--activity-entry": "Allow distinct Project Time activity entries",
      "--help": "Show work-entry CLI help",
    },
  },
}

const BOOLEAN_FLAGS = new Set(["--dry-run", "--activity-entry"])
const REPEATABLE_FLAGS = new Set(["--holiday-region"])

export function harvestWorklogArgumentCompletions(argumentPrefix) {
  const input = argumentPrefix
  const trimmed = input.trim()

  if (!trimmed || !input.includes(" ")) {
    const choices = [
      ...Object.entries(COMMAND_COMPLETIONS).map(([value, command]) => ({ label: value, value, description: command.description })),
      ...DATE_COMPLETIONS,
      { label: "help", value: "help", description: "Show command forms and date options" },
    ]
    return choices.filter(choice => choice.value.startsWith(trimmed.toLowerCase()))
  }

  const first = trimmed.split(/\s+/, 1)[0].toLowerCase()
  const command = COMMAND_COMPLETIONS[first]
  if (!command) {
    if (!/^(today|yesterday|\d{4}-\d{2}-\d{2})$/i.test(first) || trimmed.includes("--task")) return null
    const compactFlag = completionForFlag(input, { "--task": "Optional exact Harvest task name" })
    return trimmed.split(/\s+/).length > 1 ? compactFlag : null
  }

  const words = trimmed.split(/\s+/)
  const optionIndex = words.findIndex((word, index) => index > 0 && word.startsWith("--"))
  const positionals = words.slice(1, optionIndex === -1 ? words.length : optionIndex)
  if (optionIndex === -1 && (positionals.length < command.dates || (!input.endsWith(" ") && positionals.length === command.dates))) {
    const partial = input.endsWith(" ") ? "" : positionals.at(-1) ?? ""
    const base = [first, ...positionals.slice(0, input.endsWith(" ") ? positionals.length : -1)]
    return dateCompletions(first)
      .filter(choice => choice.value.startsWith(partial.toLowerCase()) || choice.label.startsWith(partial.toUpperCase()))
      .map(choice => ({ ...choice, value: [...base, choice.value].join(" ") }))
  }

  return completionForFlag(input, command.flags, first)
}

function completionForFlag(input, flags, commandName) {
  const trimmed = input.trim()
  const words = trimmed.split(/\s+/)
  const current = input.endsWith(" ") ? "" : words.at(-1)
  const previous = input.endsWith(" ") ? words.at(-1) : words.at(-2)
  if (!current && previous?.startsWith("--") && !BOOLEAN_FLAGS.has(previous)) return null
  if (current && !current.startsWith("--")) return null

  const available = availableFlags(commandName, words, flags)

  const base = current ? trimmed.slice(0, -current.length).trimEnd() : trimmed
  const choices = Object.entries(available)
    .filter(([flag]) => (!words.includes(flag) || REPEATABLE_FLAGS.has(flag)) && (!current || flag.startsWith(current)))
    .map(([flag, description]) => ({ label: flag, value: `${base} ${flag}`.trim(), description }))
  return choices.length > 0 ? choices : null
}

function availableFlags(commandName, words, flags) {
  if (commandName === "timesheet") {
    if (!words.includes("--project")) return { "--project": flags["--project"], "--help": flags["--help"] }
    return hasFlagValue(words, "--project") ? { "--task": flags["--task"], "--help": flags["--help"] } : { "--help": flags["--help"] }
  }

  if (["time-off", "work-entry"].includes(commandName)) {
    const names = words.includes("--project") || words.includes("--task")
    const ids = words.includes("--project-id") || words.includes("--task-id")
    return Object.fromEntries(Object.entries(flags).filter(([flag]) => {
      if (names && ["--project-id", "--task-id"].includes(flag)) return false
      if (ids && ["--project", "--task"].includes(flag)) return false
      if (flag === "--task") return hasFlagValue(words, "--project")
      if (flag === "--task-id") return hasFlagValue(words, "--project-id")
      return true
    }))
  }

  return flags
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

export function parseHarvestWorklogArguments(args) {
  const input = args.trim()
  if (input === "help") return { help: true }

  const words = parseCommandArguments(input)
  if (!words || words.length === 0) return null
  if (COMMAND_COMPLETIONS[words[0]]) return { argv: words }

  const taskIndex = words.indexOf("--task")
  if (taskIndex !== -1 && (taskIndex < 2 || taskIndex === words.length - 1 || words.indexOf("--task", taskIndex + 1) !== -1)) return null
  const project = words.slice(1, taskIndex === -1 ? words.length : taskIndex).join(" ")
  if (!project) return null
  const task = taskIndex === -1 ? undefined : words.slice(taskIndex + 1).join(" ")
  return { argv: timesheetArguments({ date: words[0], project, task }) }
}

export default function harvestTimeExtension(pi, options = {}) {
  pi.setLabel?.("Harvest Worklog")
  const command = options.command ?? "harvest-worklog"
  const run = options.run ?? runCommand
  pi.registerCommand("harvest-worklog", {
    description: "Run Harvest Worklog CLI commands with contextual options",
    getArgumentCompletions: harvestWorklogArgumentCompletions,
    handler: async (args, ctx) => {
      const parsed = parseHarvestWorklogArguments(args)
      if (!parsed || parsed.help) {
        ctx.ui.notify(HARVEST_WORKLOG_USAGE, parsed?.help ? "info" : "error")
        return
      }

      if (["time-off", "work-entry"].includes(parsed.argv[0]) && !parsed.argv.some(argument => ["--dry-run", "--help", "-h"].includes(argument))) {
        const confirmed = await ctx.ui.confirm("Write to Harvest?", `${command} ${parsed.argv.join(" ")}`)
        if (!confirmed) return
      }

      const result = await run(command, parsed.argv, { cwd: ctx.cwd })
      if (result.spawnError) {
        ctx.ui.notify(`Could not run ${command}: ${result.spawnError.message}`, "error")
        return
      }

      const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim() || `${command} exited with ${result.code}`
      pi.sendMessage({ customType: "harvest-worklog-cli", content: output, display: true, attribution: "assistant" }, { triggerTurn: false })
    },
  })
  pi.registerTool(createTimeAggregateTool(pi.zod.z, { command: options.command }))
  pi.registerTool(createTimesheetTool(pi.zod.z, { command, run }))
  pi.registerTool(createTimeOffTool(pi.zod.z, {
    command: options.command,
    defaultHours: options.defaultHours,
    holidayRegions: options.holidayRegions,
  }))
  pi.registerTool(createProjectTimeTool(pi.zod.z, {
    command: options.command,
    projectTimeMappings: options.projectTimeMappings,
    projectTimeLogPath: options.projectTimeLogPath,
  }, { dryRun: true }))
  pi.registerTool(createProjectTimeTool(pi.zod.z, {
    command: options.command,
    projectTimeMappings: options.projectTimeMappings,
    projectTimeLogPath: options.projectTimeLogPath,
  }, { dryRun: false }))
  pi.registerTool(createProjectTimeTransformTool(pi.zod.z, {
    command: options.command,
    projectTimeMappings: options.projectTimeMappings,
    projectTimeLogPath: options.projectTimeLogPath,
  }, { record: false }))
  pi.registerTool(createProjectTimeTransformTool(pi.zod.z, {
    command: options.command,
    projectTimeMappings: options.projectTimeMappings,
    projectTimeLogPath: options.projectTimeLogPath,
  }, { record: true }))
}
