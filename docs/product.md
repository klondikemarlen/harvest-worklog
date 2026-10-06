# Product Direction

## Purpose

OMP Worklog converts local OMP Project Time evidence into a human-reviewable record of work. The immediate user job is to inspect a concise daily record, correct destination details if necessary, and choose whether to create an external entry.

## Current Product

The current package provides three related capabilities:

1. A review-only daily timesheet and deterministic draft tools built from `human_active` OMP Project Time evidence.
2. Configurable mappings from a local Project Time project to a Harvest project and task.
3. Explicit Harvest writes for time off and ordinary work through the Ruby CLI, plus an approved OMP time-off tool.

Harvest credentials are not required to read local evidence or generate drafts. No Project Time-driven command writes to Harvest automatically.

## Product Direction

The core product is a time-log and workflow tracker, not a Harvest client. Its standard output should be a concise, provider-neutral, line-oriented time log:

```text
Project: task: duration
```

Each standard record carries a source-side project, reviewable task label, and duration. OMP Project Time is the analytical source. The work-log layer should turn that evidence into clear records without making an external destination part of the canonical record. A Harvest mapping is a downstream projection used when a person deliberately chooses Harvest as the destination.

This direction is compatible with a future integration that writes reviewed entries to Harvest. It also leaves room for another destination without redefining the collected evidence or the review workflow.

## Experience Rules

- Prefer compact, standard work-log output over raw interval dumps.
- Preserve enough provenance in explicit diagnostics for review, but do not make source metadata the normal interactive output.
- Treat generated summaries and destination mappings as review aids, never as factual replacement for evidence or user approval.
- Require an explicit user action for any external write.
- Keep the local project/task/duration record useful when no external mapping exists.

## Non-goals for the Current Release

The OMP Worklog identity cutover does not alter the Project Time evidence schema, change the existing Harvest write path, add a new destination integration, or publish a documentation site. Those changes need separate compatibility, migration, and release decisions.
