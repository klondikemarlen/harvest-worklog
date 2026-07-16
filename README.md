# Harvest Worklog

Harvest Worklog is a Ruby CLI and OMP plugin for personal Harvest work logs. It creates holiday-aware time-off entries, writes reviewed ordinary-work entries, and imports reviewed OMP Project Time sessions.

## Credentials

1. Open [Harvest ID Developers](https://id.getharvest.com/developers) and create a Personal Access Token for this local tool.
2. Harvest displays the token and the available Harvest account IDs once. Copy the account ID for the account to track time in.
3. Fill the ignored `.envrc` in this repository:

   ```bash
   export HARVEST_ACCESS_TOKEN="your-personal-access-token"
   export HARVEST_ACCOUNT_ID="your-harvest-account-id"
   ```

4. Run `direnv allow` if you use direnv; otherwise run `source .envrc` in the shell that starts OMP or the CLI.

Personal Access Tokens are the intended Harvest authentication method for personal scripts. Revoke and replace a token from Harvest ID if it is exposed. [Harvest authentication documentation](https://help.getharvest.com/api-v2/authentication-api/authentication/authentication/).

## CLI

```text
harvest-worklog time-off FROM TO --project NAME --task NAME [options]
harvest-worklog work-entry DATE --project NAME --task NAME --hours HOURS --notes NOTES [options]
```

### Time off

The `time-off` command creates one 7-hour entry for each Yukon business day in an inclusive range. It skips weekends and observed Yukon holidays by default.

```bash
harvest-worklog time-off 2026-08-17 2026-08-28 \
  --project 'Time Off - Marlen' \
  --task 'Vacation / PTO' \
  --notes 'regular time off' \
  --dry-run
```

The default holiday region is `ca_yt`. Add `--holiday-region REGION` or set `HARVEST_HOLIDAY_REGIONS` to include other [Holidays](https://github.com/holidays/holidays) regions. `business_time` calculates business days and `holidays` supplies observed statutory holidays.

A time-off block never creates weekend entries. When names are supplied, it resolves them from your active personal Harvest assignments, so a Project Manager role is not required.

### Reviewed ordinary work

The `work-entry` command checks for existing or locked entries for its project, task, and date before creating a new duration entry. Use `--dry-run` to complete that preflight without a write. OMP Project Time uses the same path.

## OMP settings

- `defaultHours`: hours per business day when a time-off tool call omits `hours`; defaults to `7`.
- `holidayRegions`: comma-separated Holidays regions; defaults to `ca_yt`.
- `command`: direct path to the `harvest-worklog` executable.
- `projectTimeMappings`: JSON mapping from OMP Project Time project names to Harvest project/task names.
- `projectTimeLogPath`: optional override for `~/.omp/project-time/time-log.json`.

## OMP Project Time integration

Configure `projectTimeMappings` with the recorded OMP Project Time project name as the key:

```json
{
  "Harvest API": { "project": "Internal", "task": "Development" }
}
```

`harvest_preview_project_time_entries` reads the configured time log, splits sessions across local dates, generates descriptions from the project and repository, and checks Harvest for existing or locked entries without writing. `harvest_record_project_time_entries` performs the same preflight then creates only new entries; OMP treats it as a write requiring approval. Unmapped sessions are reported and never written.

## Migration from harvest-time-off

Version `0.5.0` is a clean identity cutover. Uninstall the prior `harvest-time-off` gem and OMP plugin, then install `harvest-worklog`; replace former top-level CLI commands with the `harvest-worklog time-off` and `harvest-worklog work-entry` subcommands. The old package, executables, and `workEntryCommand` setting are not retained.

## Release

Before merging a release PR, self-review its complete diff, address every actionable review comment, and rerun focused QA after fixups. Record the review and QA evidence on the PR. Then merge to `main`, build and publish the Ruby gem, install the released OMP plugin from GitHub, and verify it:

```bash
ruby test_harvest_worklog.rb
npm run test:omp
harvest-worklog time-off 2026-08-17 2026-08-28 \
  --project 'Time Off - Marlen' \
  --task 'Vacation / PTO' \
  --holiday-region ca_yt \
  --dry-run
gem build harvest-worklog.gemspec
gem push harvest-worklog-<version>.gem
omp plugin uninstall harvest-time-off
omp plugin install --force github:klondikemarlen/harvest-worklog
omp plugin list
harvest-worklog --help
```
