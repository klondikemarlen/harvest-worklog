# Harvest Worklog

Harvest Worklog is a Ruby CLI and OMP plugin that infers reviewable personal work timesheets from local Project Time evidence while keeping Harvest authoritative. It creates holiday-aware time-off entries and writes only explicitly requested ordinary-work entries.

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
harvest-worklog reconcile DATE --project PROJECT --harvest-project NAME [--task NAME]
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

The `/harvest-worklog timesheet today --project wrap` slash command reads the requested local OMP Project Time day and renders a deterministic `Inferred work-timesheet draft (review only; nothing written)`. Only `projectTimeMappings` can supply its Harvest project/task destination. Explicit and carried-forward evidence is mapped; unassigned and ambiguous task evidence stays visible but not submittable. Every source entry shows its ID, source kind, repository identity, interval, task-attribution provenance, and any source narrative. The command never calls or changes Harvest.
When a Project Time log has no narrative text, the draft does not turn activity labels into Harvest notes; it asks the user to add factual detail.
`/project-time history` reports all logged dates, so its totals can be larger than the selected day.

Type `/harvest-worklog ` in OMP to discover `timesheet`; date aliases appear only after selecting `timesheet `. After `--project`, Tab lists local human-active Project Time project names; a prefix filters them case-insensitively. Completion preserves the case-sensitive name required by the command.

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

Harvest Worklog reads only the documented `omp-project-time/evidence` format at version `1`. An absent, unsupported, or malformed version produces a no-write diagnostic; run a current Project Time session to persist the v1 ledger format before retrying.

`harvest_preview_project_time_entries` reads only `human_active` sessions from the configured time log, splits them across local dates, combines sources that map to the same Harvest date/project/task, and performs a no-write Harvest preflight. It reports the inferred timesheet entries, source policy, and unmapped sessions; it never records Project Time-derived work in Harvest.

`harvest_preview_project_time_drafts` produces one deterministic, copyable Date/Project/Task/Duration block per mapped local day and Harvest destination from `human_active` evidence. It preserves source entry IDs, intervals, source kind, repository identity, narratives, work items, and task-attribution provenance. Explicit and carried-forward evidence can use the existing project-to-Harvest mapping; unassigned and ambiguous evidence stays visible but not submittable. Generated narratives are review evidence, never task identity or a factual Harvest note. The tool reads the local log only; it never calls or mutates Harvest.

### Activity transforms

`harvest_preview_project_time_transforms` emits deterministic JSON for local raw intervals. It accepts an inclusive date range and optional exact `repositoryId`, `project`, and `sourceKind` filters; each matching interval is split by local date and grouped by activity, with missing labels reported as `unlabelled`. It defaults to `human_active` and returns the effective top-level `sourceKind`; selecting `agent_turn_elapsed` requires an explicit source-kind request. Set `applyMappings` to include configured Harvest project/task mappings. The output reports groups, source records, candidate mapped entries, and any unmapped or excluded rows; it never writes Harvest.


## Daily reconciliation

`reconcile` compares one local Project Time project against the manual Harvest total for one date. It reads only local `human_active` intervals, reports the raw duration, non-overlapping union, concurrent overlap, and both Harvest-minus-local deltas. It never creates or changes Harvest entries: manual Harvest is the benchmark.

```bash
harvest-worklog reconcile 2026-07-21 \
  --project wrap \
  --harvest-project WRAP \
  --task Programming
```

Empty local or Harvest data is reported as zero, so this command is suitable for daily capture checks while manual tracking remains authoritative. It never decides or applies a Harvest delta.

Manual Harvest entries remain separate from inferred Project Time durations. Review the timesheet and reconciliation output, then choose the actual Harvest entry yourself; do not sum local evidence and manually recorded Harvest time as if they were independent entries.

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

`npm run release` owns the uninstall/force-install mutation. `npm run verify:release` never changes the installation: it checks the installed package version, resolved Git revision, and plugin path before running a deterministic slash-command smoke test against the installed plugin. It exits after verification. Existing OMP sessions retain startup-loaded extension code; restart them before optional manual autocomplete and slash-command QA.
