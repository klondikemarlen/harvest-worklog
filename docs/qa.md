# QA Evidence

## Acceptance Evidence

The current behavior is covered by focused tests in the repository:

| Behavior | Evidence location |
| --- | --- |
| Project Time evidence parsing, filtering, grouping, mappings, drafts, and compact timesheet formatting | `test/project-time.test.js` |
| OMP command parsing, completions, read-only draft tools, write approval, and interactive summary lifecycle | `test/omp-plugin.test.js` |
| Harvest CLI validation and write behavior | `test_harvest_worklog.rb` |
| Installed plugin revision verification failure behavior | `test/release-plugin.test.js` |

Run the relevant JavaScript suite with:

```bash
npm test
```

Run the Ruby CLI suite with:

```bash
ruby test_harvest_worklog.rb
```

For a no-write CLI smoke check, run:

```bash
bin/harvest-worklog --help
```

## Documentation Verification

For a documentation change, verify every local Markdown link, then check each implementation claim against its owning source and test. The implementation and its tests remain authoritative for detailed behavior; this knowledge base must not create a conflicting second specification.

## Release Boundary

Release instructions and installed-plugin verification live in the [repository README](../README.md#release). A documentation-only change does not by itself change the gem or plugin artifact, so it does not require publishing or reinstalling one.
