import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

test("rejects an installed plugin from a mismatched Git revision", () => {
  const home = mkdtempSync(join(tmpdir(), "harvest-worklog-release-"))
  const pluginRoot = join(home, ".omp", "plugins")
  const packagePath = join(pluginRoot, "node_modules", "harvest-worklog", "package.json")
  const version = execFileSync("node", ["-p", "require('./package.json').version"], { encoding: "utf8" }).trim()
  mkdirSync(join(pluginRoot, "node_modules", "harvest-worklog"), { recursive: true })
  writeFileSync(packagePath, JSON.stringify({ name: "harvest-worklog", version }))
  writeFileSync(join(pluginRoot, "bun.lock"), JSON.stringify({
    packages: {
      "harvest-worklog": ["harvest-worklog@github:klondikemarlen/harvest-worklog#0000000"],
    },
  }))

  try {
    const result = spawnSync("bash", ["bin/verify-plugin-release"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, HOME: home },
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, new RegExp(`Expected installed harvest-worklog@${version} from Git revision`))
    assert.match(result.stderr, new RegExp(`found harvest-worklog@${version} at ${packagePath} resolved from Git revision 0000000`))
  } finally {
    rmSync(home, { force: true, recursive: true })
  }
})
