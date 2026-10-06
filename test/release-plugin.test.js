import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

test("when the installed revision differs, rejects the plugin", () => {
  // Arrange
  const home = mkdtempSync(join(tmpdir(), "omp-worklog-release-"))
  const pluginRoot = join(home, ".omp", "plugins")
  const packagePath = join(pluginRoot, "node_modules", "omp-worklog", "package.json")
  const version = execFileSync("node", ["-p", "require('./package.json').version"], { encoding: "utf8" }).trim()
  mkdirSync(join(pluginRoot, "node_modules", "omp-worklog"), { recursive: true })
  writeFileSync(packagePath, JSON.stringify({ name: "omp-worklog", version }))
  writeFileSync(join(pluginRoot, "bun.lock"), JSON.stringify({
    packages: {
      "omp-worklog": ["omp-worklog@github:klondikemarlen/omp-worklog#0000000"],
    },
  }))

  try {
    // Act
    const result = spawnSync("bash", ["bin/verify-plugin-release"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, HOME: home },
    })
    // Assert
    assert.equal(result.status, 1)
    assert.match(result.stderr, new RegExp(`Expected installed omp-worklog@${version} from Git revision`))
    assert.match(result.stderr, new RegExp(`found omp-worklog@${version} at ${packagePath} resolved from Git revision 0000000`))
  } finally {
    rmSync(home, { force: true, recursive: true })
  }
})

test("when only the retired plugin is installed, it replaces it with OMP Worklog", () => {
  // Arrange
  const home = mkdtempSync(join(tmpdir(), "omp-worklog-release-"))
  const bin = join(home, "bin")
  const calls = join(home, "calls")
  const omp = join(bin, "omp")
  mkdirSync(bin)
  writeFileSync(omp, `#!/usr/bin/env bash
printf '%s\n' "$*" >> "$OMP_CALLS"
if [ "$1 $2" = "plugin list" ]; then
  printf '%s\n' '{"npm":[{"name":"harvest-worklog"}]}'
fi
`)
  chmodSync(omp, 0o755)

  try {
    // Act
    const result = spawnSync("bash", ["bin/release-plugin"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, HOME: home, OMP_CALLS: calls, PATH: `${bin}:${process.env.PATH}` },
    })

    // Assert
    assert.equal(result.status, 0)
    assert.deepEqual(readFileSync(calls, "utf8").trim().split("\n"), [
      "plugin list --json",
      "plugin list --json",
      "plugin uninstall harvest-worklog",
      "plugin install --force github:klondikemarlen/omp-worklog",
    ])
  } finally {
    rmSync(home, { force: true, recursive: true })
  }
})

test("when no worklog plugin is installed, it installs OMP Worklog", () => {
  // Arrange
  const home = mkdtempSync(join(tmpdir(), "omp-worklog-release-"))
  const bin = join(home, "bin")
  const calls = join(home, "calls")
  const omp = join(bin, "omp")
  mkdirSync(bin)
  writeFileSync(omp, `#!/usr/bin/env bash
printf '%s\n' "$*" >> "$OMP_CALLS"
if [ "$1 $2" = "plugin list" ]; then
  printf '%s\n' '{"npm":[]}'
fi
`)
  chmodSync(omp, 0o755)

  try {
    // Act
    const result = spawnSync("bash", ["bin/release-plugin"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, HOME: home, OMP_CALLS: calls, PATH: `${bin}:${process.env.PATH}` },
    })

    // Assert
    assert.equal(result.status, 0)
    assert.deepEqual(readFileSync(calls, "utf8").trim().split("\n"), [
      "plugin list --json",
      "plugin list --json",
      "plugin install --force github:klondikemarlen/omp-worklog",
    ])
  } finally {
    rmSync(home, { force: true, recursive: true })
  }
})
