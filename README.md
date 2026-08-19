# Harvest Worklog

Harvest Worklog is a Project Time-driven Ruby CLI and OMP plugin that builds reviewable personal work timesheets from local evidence. Harvest remains a manual destination: the only Harvest operations are explicitly requested time-off and ordinary-work writes.

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

The `work-entry` command checks for existing or locked entries for its project, task, and date before creating a new duration entry. Use `--dry-run` to complete that preflight without a write.

### Project Time timesheets

`/harvest-worklog timesheet DATE` reads local `human_active` Project Time evidence and produces one review-only draft for every local project active on that day. It does not call Harvest or require Harvest credentials.

Use `--project PROJECT` only to restrict the draft to one exact local Project Time project:

```text
/harvest-worklog timesheet yesterday
/harvest-worklog timesheet yesterday --project wrap
```

A configured `projectTimeMappings` destination becomes the draft's `Project` and `Task`. Evidence with no mapping, an ambiguous work item, or an unassigned work item remains visible under its local project with `Task: Review destination`; choose the Harvest project and task before submitting. The command first renders compact date, local-project, and duration totals capped at 22 lines. It then asks the active OMP model for an eight-line task summary from bounded activity and narrative evidence; GitHub issue numbers and Jira ticket IDs are extracted as facts, not inferred by the model. `harvest_preview_project_time_drafts` retains source IDs, source kinds, repository identities, intervals, work-item attribution, and narratives for detailed review. Nothing is submitted automatically.

Type `/harvest-worklog ` in OMP to discover `timesheet`; date aliases appear after selecting `timesheet `. After `--project`, Tab lists local human-active Project Time project names. Completion preserves the exact local project name.

## OMP settings

- `defaultHours`: hours per business day when a time-off tool call omits `hours`; defaults to `7`.
- `holidayRegions`: comma-separated Holidays regions; defaults to `ca_yt`.
- `command`: direct path to the `harvest-worklog` executable.
- `projectTimeLogPath`: optional path to Project Time v1 evidence; defaults to `~/.omp/project-time/time-log.sqlite`. A legacy versioned JSON snapshot is also supported.


## OMP Project Time integration

Configure `projectTimeMappings` with the recorded OMP Project Time project name as the key:

```json
{
  "Harvest API": { "project": "Internal", "task": "Development" }
}
```

Harvest Worklog reads Project Time's persisted `omp-project-time/evidence` v1 entries. An absent, unsupported, or malformed ledger produces a no-write diagnostic; run a current Project Time session to create the SQLite ledger before retrying.

`harvest_preview_project_time_drafts` produces deterministic, copyable Date/Project/Task/Duration blocks from all local `human_active` evidence in an inclusive date range. Mapped evidence uses its configured Harvest destination; unmapped, ambiguous, and unassigned evidence remains an explicit local-project draft. It preserves source entry IDs, intervals, source kind, repository identity, narratives, work items, and task-attribution provenance. Generated narratives are review evidence, never task identity or a factual Harvest note. The tool reads the local log only; it never calls or mutates Harvest.

### Activity transforms

`harvest_preview_project_time_transforms` emits deterministic JSON for local raw intervals. It accepts an inclusive date range and optional exact `repositoryId`, `project`, and `sourceKind` filters; each matching interval is split by local date and grouped by activity, with missing labels reported as `unlabelled`. It defaults to `human_active` and returns the effective top-level `sourceKind`; selecting `agent_turn_elapsed` requires an explicit source-kind request. Set `applyMappings` to create configured Harvest destinations or review-required local destinations for every included group. The output reports groups and draft entries; it never writes Harvest.



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
