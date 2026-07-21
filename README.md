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
harvest-worklog time-off FROM TO --project-id ID --task-id ID [options]
harvest-worklog work-entry DATE --project NAME --task NAME --hours HOURS --notes NOTES [options]
harvest-worklog work-entry DATE --project-id ID --task-id ID --hours HOURS --notes NOTES [options]
harvest-worklog aggregate FROM TO [--project NAME] [--task NAME]
harvest-worklog timesheet DATE --project NAME [--task NAME]
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

The `harvest_record_time_off` OMP tool accepts the same name pair or ID pair. Its optional `holidayRegions` array adds per-call regions to the configured defaults.

### Reviewed ordinary work

The `work-entry` command checks for existing or locked entries for its project, task, and date before creating a new duration entry. Use `--dry-run` to complete that preflight without a write. OMP Project Time uses the same path.

### Read-only aggregates

The `aggregate` command reads all matching Harvest time-entry pages and prints totals grouped by spent date and project/task. It lists every date in the inclusive range, including weekend or empty dates, and never writes a Harvest record.

```bash
harvest-worklog aggregate 2026-07-17 2026-07-19 \
  --project WRAP \
  --task Programming
```

The `harvest_time_aggregates` OMP tool exposes the same optional filters and is approval-gated as a read.

### Timesheets

The CLI `timesheet` command and `harvest_time_sheet` OMP tool read the authenticated user's compact daily Harvest view. They show task totals, entry durations, and notes already recorded in Harvest.

```bash
harvest-worklog timesheet today --project WRAP
```

The `/harvest-worklog timesheet today --project wrap` slash command reads only the requested local OMP Project Time day. Its output explicitly says `Source: local OMP Project Time (not Harvest)`, shows up to five duration-ranked activity labels and an honest total for any other activity labels, then asks the active OMP model for a clearly labelled best-effort worklog draft from those same local records. If no model is available or generation fails, the local totals still render. When `projectTimeMappings` contains `wrap`, it separately shows the prospective `Harvest destination`; it does not present that destination as recorded Harvest data. It never calls Harvest or uploads entries.
`/project-time history` reports all logged dates, so its totals can be larger than the selected day.

Type `/harvest-worklog ` in OMP to discover `timesheet`; date aliases appear only after selecting `timesheet `, before the contextual `--project` option. The editable project name must exactly match the case-sensitive local Project Time name.

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

### Activity transforms

`harvest_preview_project_time_transforms` emits deterministic JSON for local raw intervals. It accepts an inclusive date range and optional exact `repositoryId`, `project`, and `sourceKind` filters; each matching interval is split by local date and grouped by activity, with missing labels reported as `unlabelled`. Set `applyMappings` to include configured Harvest project/task mappings. The output reports `groups`, proposed mapped `entries`, and any `unmapped` or `excluded` rows.

`harvest_record_project_time_transforms` is a separate approval-gated write step. It always applies configured mappings and records the reviewed activity entries through the existing locked and duplicate preflight. Different activity labels may share a date/project/task; rerunning the same activity label is skipped, as are locked or unrelated existing entries.

## Reconciling WRAP hours with manual entries

Use a closed date range and record the expected OMP Project Time and manually entered hours for each day. Preview OMP entries first, then compare the final Harvest total for each day:

```bash
harvest-worklog aggregate FROM TO \
  --project WRAP \
  --task Programming
```

OMP-created entries use an `OMP Project Time:` note; use a `Manual reconciliation:` note for manual entries while testing. Inspect the Harvest entry details to distinguish their source—the aggregate intentionally combines all matching entries.

The standard work-entry importer allows only one entry for a date, project, and task. If a manual `WRAP / Programming` entry exists for a date, importing ordinary OMP Project Time for that same mapping skips it rather than adding hours. Activity transforms are the exception: distinct activity labels can create separate entries while the same label, locked entries, and unrelated manual entries are still skipped. Reconcile ordinary entries as either OMP or manual hours, not their sum.

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
VERSION="$(ruby -Ilib -rharvest_worklog/version -e 'puts HarvestWorklog::VERSION')"
gem build harvest-worklog.gemspec
gem push "harvest-worklog-${VERSION}.gem"
gem uninstall harvest-time-off --all --executables --ignore-dependencies
gem install --clear-sources --source https://rubygems.org harvest-worklog --version "$VERSION" --no-document
omp plugin uninstall harvest-time-off
npm run release
npm run verify:release
harvest-worklog --help
```

`npm run release` owns the uninstall/force-install mutation. `npm run verify:release` never changes the installation: it checks the exact installed version and runs a deterministic slash-command smoke test against the installed plugin. It exits after verification. Existing OMP sessions retain startup-loaded extension code; restart them before optional manual autocomplete and slash-command QA.
