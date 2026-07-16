import { spawn } from "node:child_process"

export function timeOffArguments({
  from,
  to,
  project,
  task,
  hours,
  notes,
  dryRun = false,
}, { defaultHours = 7, holidayRegions = [] } = {}) {
  const args = [from, to, "--project", project, "--task", task, "--hours", String(hours ?? defaultHours)]
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

export function createTimeOffTool(z, { command = "harvest-time-off", defaultHours = 7, holidayRegions = "", run = runCommand } = {}) {
  return {
    name: "harvest_time_off",
    label: "Harvest Time Off",
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
      onUpdate?.({ content: [{ type: "text", text: "Creating Harvest time entries…" }] })
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
  pi.setLabel?.("Harvest Time")
  pi.registerTool(createTimeOffTool(pi.zod.z, {
    command: options.command,
    defaultHours: options.defaultHours,
    holidayRegions: options.holidayRegions,
  }))
}
