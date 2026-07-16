import { spawn } from "node:child_process"
import { loadProjectTimeEntries, parseProjectTimeMappings } from "./project-time.js"

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

export function workEntryArguments(entry, dryRun) {
  const args = [
    "work-entry",
    entry.spentDate,
    "--project", entry.project,
    "--task", entry.task,
    "--hours", String(entry.hours),
    "--notes", entry.notes,
  ]
  if (dryRun) args.push("--dry-run")
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

export default function harvestTimeExtension(pi, options = {}) {
  pi.setLabel?.("Harvest Worklog")
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
}
