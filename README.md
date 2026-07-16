# Harvest Time Off

OMP-native Harvest integration. V1 makes holiday-aware time-off blocks convenient; it does not automate ordinary work tracking.

## Credentials

1. Open [Harvest ID Developers](https://id.getharvest.com/developers) and create a Personal Access Token for this local script.
2. Harvest displays the token and the available Harvest account IDs once. Copy the account ID for the account to track time in.
3. Fill the ignored `.envrc` in this repository:

   ```bash
   export HARVEST_ACCESS_TOKEN="your-personal-access-token"
   export HARVEST_ACCOUNT_ID="your-harvest-account-id"
   ```

4. Run `direnv allow` if you use direnv; otherwise run `source .envrc` in the shell that starts OMP or the CLI.

Personal Access Tokens are the intended Harvest authentication method for personal scripts. Revoke and replace a token from Harvest ID if it is exposed. [Harvest authentication documentation](https://help.getharvest.com/api-v2/authentication-api/authentication/authentication/).

## V1: time off

The approval-gated `harvest_time_off` OMP tool and `harvest-time-off` CLI create 7-hour entries for each Yukon business day in an inclusive range. They skip weekends and observed Yukon holidays by default.

```bash
harvest-time-off 2026-08-17 2026-08-28 \
  --project 'Time Off - Marlen' \
  --task 'Vacation / PTO' \
  --notes 'regular time off' \
  --dry-run
```

The default holiday region is `ca_yt`. Add `--holiday-region REGION` or set `HARVEST_HOLIDAY_REGIONS` to include other [Holidays](https://github.com/holidays/holidays) regions. `business_time` calculates business days and `holidays` supplies observed statutory holidays.

A time-off block never creates weekend entries. The underlying [`harvest-api-v2`](https://github.com/klondikemarlen/harvest-api-v2) client accepts any ISO date, including weekends, for ordinary work entries.

## OMP settings

- `defaultHours`: hours per business day when a tool call omits `hours`; defaults to `7`.
- `holidayRegions`: comma-separated Holidays regions; defaults to `ca_yt`.
- `command`: direct path to the `harvest-time-off` executable.

## V2: OMP Project Time integration

[Issue #3](https://github.com/klondikemarlen/harvest-time-off/issues/3) tracks the next scope: turn reviewed `omp-project-time` output into Harvest work entries with configured project/task mappings, generated descriptions, duplicate/lock checks, preview, and approval. V1 remains deliberately focused on time off.

## Release

Before merging a release PR, self-review its complete diff, address every actionable review comment, and rerun focused QA after fixups. Record the review and QA evidence on the PR. Then merge to `main`, build and publish the Ruby gem when its `harvest-api-v2` dependency is available on RubyGems, install the released OMP plugin from GitHub, and verify it:

```bash
ruby test_harvest_time_off.rb
npm run test:omp
harvest-time-off 2026-08-17 2026-08-28 \
  --project 'Time Off - Marlen' \
  --task 'Vacation / PTO' \
  --holiday-region ca_yt \
  --dry-run
gem build harvest-time-off.gemspec
gem push harvest-time-off-<version>.gem
omp plugin install --force github:klondikemarlen/harvest-time-off
omp plugin list
harvest-time-off --help
```
