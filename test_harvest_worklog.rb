# frozen_string_literal: true

require "date"
require "tmpdir"
require "minitest/autorun"
require "json"
require "stringio"

$LOAD_PATH.unshift File.expand_path("lib", __dir__)
require "harvest_worklog"

class HarvestWorklogTest < Minitest::Test
  def test_global_help_lists_name_and_id_assignment_forms
    output = StringIO.new

    assert_equal 0, HarvestWorklog::CLI.run(["--help"], output:)
    assert_includes output.string, "time-off FROM TO --project-id ID --task-id ID"
    assert_includes output.string, "work-entry DATE --project-id ID --task-id ID"
  end

  def test_dates_between_skips_weekends_by_default
    from = Date.new(2026, 7, 17)
    to = Date.new(2026, 7, 20)

    assert_equal [Date.new(2026, 7, 17), Date.new(2026, 7, 20)], HarvestWorklog.dates_between(from, to, holiday_regions: ["ca"])
  end

  def test_dates_between_excludes_observed_regional_holidays
    dates = HarvestWorklog.dates_between(Date.new(2007, 7, 2), Date.new(2007, 7, 6), holiday_regions: ["ca_bc"])

    assert_equal [Date.new(2007, 7, 3), Date.new(2007, 7, 4), Date.new(2007, 7, 5), Date.new(2007, 7, 6)], dates
  end

  def test_time_off_rejects_blank_names_and_nonpositive_ids
    empty_name_error = StringIO.new
    blank_notes_error = StringIO.new
    invalid_id_error = StringIO.new

    assert_equal 1, HarvestWorklog::TimeOffCLI.run(
      ["2026-07-17", "2026-07-17", "--project", " ", "--task", "Vacation", "--dry-run"],
      error: empty_name_error
    )
    assert_includes empty_name_error.string, "supply --project and --task"
    assert_equal 1, HarvestWorklog::TimeOffCLI.run(
      ["2026-07-17", "2026-07-17", "--project", "PTO", "--task", "Vacation", "--notes", " ", "--dry-run"],
      error: blank_notes_error
    )
    assert_includes blank_notes_error.string, "--notes must not be blank"
    assert_equal 1, HarvestWorklog::TimeOffCLI.run(
      ["2026-07-17", "2026-07-17", "--project-id", "0", "--task-id", "-1", "--dry-run"],
      error: invalid_id_error
    )
    assert_includes invalid_id_error.string, "supply --project and --task"
  end

  def test_work_entry_rejects_blank_names_notes_and_nonpositive_ids
    empty_name_error = StringIO.new
    blank_notes_error = StringIO.new
    invalid_id_error = StringIO.new

    assert_equal 1, HarvestWorklog::WorkEntryCLI.run(
      ["2026-07-17", "--project", " ", "--task", "Programming", "--hours", "1", "--notes", "Work", "--dry-run"],
      error: empty_name_error
    )
    assert_includes empty_name_error.string, "supply --project and --task"
    assert_equal 1, HarvestWorklog::WorkEntryCLI.run(
      ["2026-07-17", "--project", "WRAP", "--task", "Programming", "--hours", "1", "--notes", " ", "--dry-run"],
      error: blank_notes_error
    )
    assert_includes blank_notes_error.string, "--notes is required"
    assert_equal 1, HarvestWorklog::WorkEntryCLI.run(
      ["2026-07-17", "--project-id", "0", "--task-id", "-1", "--hours", "1", "--notes", "Work", "--dry-run"],
      error: invalid_id_error
    )
    assert_includes invalid_id_error.string, "supply --project and --task"
  end

  def test_read_commands_reject_blank_filters
    aggregate_error = StringIO.new
    timesheet_project_error = StringIO.new
    timesheet_task_error = StringIO.new

    assert_equal 1, HarvestWorklog::AggregateCLI.run(
      ["2026-07-17", "2026-07-17", "--project", " "],
      error: aggregate_error
    )
    assert_includes aggregate_error.string, "--project must not be blank"
    assert_equal 1, HarvestWorklog::TimesheetCLI.run(
      ["today", "--project", " "],
      error: timesheet_project_error
    )
    assert_includes timesheet_project_error.string, "--project is required"
    assert_equal 1, HarvestWorklog::TimesheetCLI.run(
      ["today", "--project", "WRAP", "--task", " "],
      error: timesheet_task_error
    )
    assert_includes timesheet_task_error.string, "--task must not be blank"
  end

  def test_dry_run_accepts_hours_notes_and_named_assignment
    output = StringIO.new
    error = StringIO.new

    status = HarvestWorklog::CLI.run(
      ["time-off", "2026-07-17", "2026-07-20", "--project", "Time Off - Marlen", "--task", "Vacation / PTO", "--notes", "Vacation", "--holiday-region", "ca", "--dry-run"],
      output:,
      error:
    )

    assert_equal 0, status
    assert_equal "", error.string
    assert_equal 2, output.string.lines.length
    assert_includes output.string, "2026-07-17: 7h on Time Off - Marlen / Vacation / PTO; Vacation"
    assert_includes output.string, "2026-07-20: 7h on Time Off - Marlen / Vacation / PTO; Vacation"
  end

  def test_time_off_normalizes_regions_and_rejects_whitespace_only_values
    options = { holiday_regions: ["ca_yt"] }
    HarvestWorklog::TimeOffCLI.option_parser(options).parse(["--holiday-region", "CA_YT", "--holiday-region", " "])
    assert_equal ["ca_yt"], HarvestWorklog::TimeOffCLI.normalize_holiday_regions!(options[:holiday_regions])

    empty_options = { holiday_regions: [], hours: 7.0, project: "PTO", task: "Vacation" }
    HarvestWorklog::TimeOffCLI.option_parser(empty_options).parse(["--holiday-region", " "])
    HarvestWorklog::TimeOffCLI.normalize_holiday_regions!(empty_options[:holiday_regions])
    error = assert_raises(HarvestWorklog::Error) { HarvestWorklog::TimeOffCLI.validate!(["2026-07-17", "2026-07-17"], empty_options) }
    assert_equal "--holiday-region or HARVEST_HOLIDAY_REGIONS is required", error.message
  end

  def test_cli_defaults_to_yukon_holidays
    output = StringIO.new

    status = HarvestWorklog::TimeOffCLI.run(
      ["2026-08-17", "2026-08-28", "--project", "Time Off - Marlen", "--task", "Vacation / PTO", "--dry-run"],
      output:
    )

    assert_equal 0, status
    assert_equal 9, output.string.lines.length
    refute_includes output.string, "2026-08-17"
  end


  def test_command_resolves_assignment_and_creates_one_entry_per_workday
    client = FakeClient.new
    output = StringIO.new
    error = StringIO.new

    status = HarvestWorklog::TimeOffCLI.run(
      ["2026-07-17", "2026-07-20", "--project", "Time Off - Marlen", "--task", "Vacation / PTO", "--hours", "7.5", "--notes", "Vacation", "--holiday-region", "ca"],
      output:,
      error:,
      client:
    )

    assert_equal 0, status
    assert_equal "", error.string
    assert_equal 2, client.entries.length
    assert_equal :personal, client.assignment_source
    assert_equal(
      [
        { project_id: 48_730_683, task_id: 8_083_365, spent_date: Date.new(2026, 7, 17), hours: 7.5, notes: "Vacation" },
        { project_id: 48_730_683, task_id: 8_083_365, spent_date: Date.new(2026, 7, 20), hours: 7.5, notes: "Vacation" }
      ],
      client.entries
    )
    assert_includes output.string, "Created 2026-07-17: 7.5h (entry #1)"
  end

  def test_work_entry_preview_checks_existing_entries_before_proposing_write
    client = FakeClient.new
    output = StringIO.new
    error = StringIO.new

    status = HarvestWorklog::CLI.run(
      ["work-entry", "2026-07-17", "--project", "Time Off - Marlen", "--task", "Vacation / PTO", "--hours", "2.25", "--notes", "OMP Project Time: Harvest API", "--dry-run"],
      output:,
      error:,
      client:
    )

    assert_equal 0, status
    assert_equal "", error.string
    assert_includes output.string, "Would create 2026-07-17: 2.25h"
    assert_equal [{ method: :get, path: "/v2/time_entries", params: { project_id: 48_730_683, task_id: 8_083_365, from: "2026-07-17", to: "2026-07-17" } }], client.requests
  end

  def test_work_entry_id_preview_names_the_assignment
    client = FakeClient.new
    output = StringIO.new

    status = HarvestWorklog::CLI.run(
      ["work-entry", "2026-07-17", "--project-id", "123", "--task-id", "456", "--hours", "2.25", "--notes", "Reviewed work", "--dry-run"],
      output:,
      client:
    )

    assert_equal 0, status
    assert_includes output.string, "Would create 2026-07-17: 2.25h on project #123 / task #456; Reviewed work"
    assert_equal [{ method: :get, path: "/v2/time_entries", params: { project_id: 123, task_id: 456, from: "2026-07-17", to: "2026-07-17" } }], client.requests
  end

  def test_work_entry_skips_locked_existing_entry
    client = FakeClient.new(existing_entries: [{ "is_locked" => true }])
    output = StringIO.new

    status = HarvestWorklog::WorkEntryCLI.run(
      ["2026-07-17", "--project", "Time Off - Marlen", "--task", "Vacation / PTO", "--hours", "2.25", "--notes", "OMP Project Time: Harvest API"],
      output:,
      client:
    )

    assert_equal HarvestWorklog::WorkEntryCLI::LOCKED_ENTRY, status
    assert_equal "Locked existing Harvest entry on 2026-07-17; skipped\n", output.string
    assert_empty client.entries
  end

  def test_work_entry_skips_existing_unlocked_entry
    client = FakeClient.new(existing_entries: [{ "is_locked" => false }])
    output = StringIO.new

    status = HarvestWorklog::WorkEntryCLI.run(
      ["2026-07-17", "--project", "Time Off - Marlen", "--task", "Vacation / PTO", "--hours", "2.25", "--notes", "OMP Project Time: Harvest API"],
      output:,
      client:
    )

    assert_equal HarvestWorklog::WorkEntryCLI::EXISTING_ENTRY, status
    assert_equal "Existing Harvest entry on 2026-07-17; skipped\n", output.string
    assert_empty client.entries
  end

  def test_work_entry_activity_entry_allows_distinct_activity
    client = FakeClient.new(existing_entries: [{ "is_locked" => false, "notes" => "OMP Project Time activity: \"implementation\"\nHarvest API (repo)" }])

    status = HarvestWorklog::WorkEntryCLI.run(
      ["2026-07-17", "--project", "Time Off - Marlen", "--task", "Vacation / PTO", "--hours", "2.25", "--notes", "OMP Project Time activity: \"review\"\nHarvest API (repo)", "--activity-entry"],
      client:
    )

    assert_equal 0, status
    assert_equal 1, client.entries.length
  end

  def test_work_entry_activity_entry_skips_the_same_activity
    client = FakeClient.new(existing_entries: [{ "is_locked" => false, "notes" => "OMP Project Time activity: \"implementation\"\nHarvest API (repo)" }])

    status = HarvestWorklog::WorkEntryCLI.run(
      ["2026-07-17", "--project", "Time Off - Marlen", "--task", "Vacation / PTO", "--hours", "2.25", "--notes", "OMP Project Time activity: \"implementation\"\nDifferent repository", "--activity-entry"],
      client:
    )

    assert_equal HarvestWorklog::WorkEntryCLI::EXISTING_ENTRY, status
    assert_empty client.entries
  end

  def test_work_entry_activity_entry_skips_an_unrelated_entry
    client = FakeClient.new(existing_entries: [{ "is_locked" => false, "notes" => "Manual work" }])

    status = HarvestWorklog::WorkEntryCLI.run(
      ["2026-07-17", "--project", "Time Off - Marlen", "--task", "Vacation / PTO", "--hours", "2.25", "--notes", "OMP Project Time activity: \"implementation\"\nHarvest API (repo)", "--activity-entry"],
      client:
    )

    assert_equal HarvestWorklog::WorkEntryCLI::EXISTING_ENTRY, status
    assert_empty client.entries
  end

  def test_work_entry_activity_entry_keeps_distinct_activities_on_one_date
    client = FakeClient.new
    implementation = ["2026-07-17", "--project", "Time Off - Marlen", "--task", "Vacation / PTO", "--hours", "2.25", "--notes", "OMP Project Time activity: \"implementation\"\nHarvest API (repo)", "--activity-entry"]
    review = ["2026-07-17", "--project", "Time Off - Marlen", "--task", "Vacation / PTO", "--hours", "0.5", "--notes", "OMP Project Time activity: \"review\"\nHarvest API (repo)", "--activity-entry"]

    assert_equal 0, HarvestWorklog::WorkEntryCLI.run(implementation, client:)
    assert_equal 0, HarvestWorklog::WorkEntryCLI.run(review, client:)
    assert_equal HarvestWorklog::WorkEntryCLI::EXISTING_ENTRY, HarvestWorklog::WorkEntryCLI.run(implementation, client:)
    assert_equal ["OMP Project Time activity: \"implementation\"\nHarvest API (repo)", "OMP Project Time activity: \"review\"\nHarvest API (repo)"], client.entries.map { |entry| entry.fetch(:notes) }
  end

  def test_mapping_data_cli_prints_assignments_and_historical_entries
    output = StringIO.new
    client = MappingDataClient.new(
      [{ "project" => { "id" => 1, "name" => "WRAP" }, "task" => { "id" => 2, "name" => "Programming" } }],
      [{ "spent_date" => "2026-07-17", "hours" => 2.5, "project" => { "id" => 1, "name" => "WRAP" }, "task" => { "id" => 2, "name" => "Programming" } }]
    )

    assert_equal 0, HarvestWorklog::CLI.run(["mapping-data", "2026-07-17", "2026-07-17"], output:, client:)
    assert_equal(
      {
        "assignments" => [{ "project" => { "id" => 1, "name" => "WRAP" }, "task" => { "id" => 2, "name" => "Programming" } }],
        "entries" => [{ "hours" => 2.5, "project" => { "id" => 1, "name" => "WRAP" }, "task" => { "id" => 2, "name" => "Programming" } }]
      },
      JSON.parse(output.string)
    )
    assert_equal [{ method: :get, path: "/v2/time_entries", params: { from: "2026-07-17", to: "2026-07-17", page: 1, per_page: 100 } }], client.requests
  end

  def test_timesheet_cli_prints_project_tasks_and_multiline_notes
    client = AggregateClient.new([{ "time_entries" => [
      { "spent_date" => "2026-07-17", "hours" => 2, "notes" => "fixing tests\nstarting templates", "project" => { "name" => "WRAP" }, "task" => { "name" => "Programming" } },
      { "spent_date" => "2026-07-17", "hours" => 1.5, "notes" => "reviewing PRs", "project" => { "name" => "WRAP" }, "task" => { "name" => "Programming" } },
      { "spent_date" => "2026-07-17", "hours" => 0.5, "notes" => nil, "project" => { "name" => "WRAP" }, "task" => { "name" => "Meeting" } },
      { "spent_date" => "2026-07-17", "hours" => 9, "notes" => "excluded", "project" => { "name" => "Other" }, "task" => { "name" => "Programming" } }
    ], "next_page" => nil }])
    output = StringIO.new

    status = HarvestWorklog::CLI.run(["timesheet", "2026-07-17", "--project", "wrap"], output:, client:)

    assert_equal 0, status
    assert_equal <<~OUTPUT, output.string
      WRAP · Fri, Jul 17 · 4h

      Meeting · 0.5h
        (no notes)

      Programming · 3.5h
        2h
          fixing tests
          starting templates
        1.5h
          reviewing PRs
    OUTPUT
    assert_equal [
      { method: :get, path: "/v2/users/me", params: {} },
      { method: :get, path: "/v2/time_entries", params: { from: "2026-07-17", to: "2026-07-17", page: 1, per_page: 100, user_id: 42 } }
    ], client.requests
  end

  def test_timesheet_cli_resolves_relative_dates_and_reports_empty_days
    today = Date.new(2026, 7, 17)
    output = StringIO.new

    status = HarvestWorklog::TimesheetCLI.run(["yesterday", "--project", "WRAP"], output:, client: AggregateClient.new([{ "time_entries" => [], "next_page" => nil }]), today:)

    assert_equal Date.new(2026, 7, 17), HarvestWorklog::TimesheetCLI.resolve_date("today", today:)
    assert_equal Date.new(2026, 7, 16), HarvestWorklog::TimesheetCLI.resolve_date("yesterday", today:)
    assert_equal Date.new(2026, 7, 15), HarvestWorklog::TimesheetCLI.resolve_date("2026-07-15", today:)
    assert_equal 0, status
    assert_equal "WRAP · Thu, Jul 16 · 0h\n\nNo time entries.\n", output.string
  end

  def test_timesheet_cli_filters_to_one_task
    output = StringIO.new
    client = AggregateClient.new([{ "time_entries" => [
      { "spent_date" => "2026-07-17", "hours" => 2, "notes" => "build", "project" => { "name" => "WRAP" }, "task" => { "name" => "Programming" } },
      { "spent_date" => "2026-07-17", "hours" => 1, "notes" => "plan", "project" => { "name" => "WRAP" }, "task" => { "name" => "Meeting" } }
    ], "next_page" => nil }])

    status = HarvestWorklog::TimesheetCLI.run(["today", "--project", "WRAP", "--task", "Programming"], output:, client:, today: Date.new(2026, 7, 17))

    assert_equal 0, status
    assert_equal "WRAP · Fri, Jul 17 · 2h\n\nProgramming · 2h\n  build\n", output.string
  end

  def test_aggregate_cli_paginates_filters_and_shows_empty_dates
    client = AggregateClient.new(
      [
        {
          "time_entries" => [
            { "spent_date" => "2026-07-17", "hours" => 7, "project" => { "name" => "WRAP" }, "task" => { "name" => "Programming" } },
            { "spent_date" => "2026-07-19", "hours" => 1.5, "project" => { "name" => "WRAP" }, "task" => { "name" => "Programming" } },
            { "spent_date" => "2026-07-17", "hours" => 0.5, "project" => { "name" => "WRAP" }, "task" => { "name" => "Meeting" } }
          ],
          "next_page" => 2
        },
        {
          "time_entries" => [
            { "spent_date" => "2026-07-18", "hours" => 2, "project" => { "name" => "Travel" }, "task" => { "name" => "Programming" } }
          ],
          "next_page" => nil
        }
      ]
    )
    output = StringIO.new

    status = HarvestWorklog::CLI.run(
      ["aggregate", "2026-07-17", "2026-07-19", "--project", "WRAP", "--task", "Programming"],
      output:,
      client:
    )

    assert_equal 0, status
    assert_equal(
      [
        { method: :get, path: "/v2/time_entries", params: { from: "2026-07-17", to: "2026-07-19", page: 1, per_page: 100 } },
        { method: :get, path: "/v2/time_entries", params: { from: "2026-07-17", to: "2026-07-19", page: 2, per_page: 100 } }
      ],
      client.requests
    )
    assert_equal <<~OUTPUT, output.string
      2 entries, 8.5h from 2026-07-17 through 2026-07-19
      By date:
        2026-07-17: 1 entry, 7h
        2026-07-18: 0 entries, 0h
        2026-07-19: 1 entry, 1.5h
      By project/task:
        WRAP / Programming: 2 entries, 8.5h
    OUTPUT
  end

  def test_aggregate_cli_reports_empty_range
    output = StringIO.new

    status = HarvestWorklog::CLI.run(
      ["aggregate", "2026-07-18", "2026-07-19"],
      output:,
      client: AggregateClient.new([{ "time_entries" => [], "next_page" => nil }])
    )

    assert_equal 0, status
    assert_equal <<~OUTPUT, output.string
      0 entries, 0h from 2026-07-18 through 2026-07-19
      By date:
        2026-07-18: 0 entries, 0h
        2026-07-19: 0 entries, 0h
      By project/task:
        none
    OUTPUT
  end

  def test_reconcile_cli_reports_harvest_benchmark_and_local_overlap
    start_at = Time.local(2026, 7, 17, 9).to_f * 1000
    output = StringIO.new
    client = AggregateClient.new([{ "time_entries" => [
      { "spent_date" => "2026-07-17", "hours" => 7, "project" => { "name" => "WRAP" }, "task" => { "name" => "Programming" } }
    ], "next_page" => nil }])

    with_project_time_log([
      { "project" => "wrap", "sourceKind" => "human_active", "startAtMs" => start_at, "endAtMs" => start_at + 7_200_000 },
      { "project" => "wrap", "sourceKind" => "human_active", "startAtMs" => start_at + 5_400_000, "endAtMs" => start_at + 9_000_000 },
      { "project" => "wrap", "sourceKind" => "agent_turn_elapsed", "startAtMs" => start_at, "endAtMs" => start_at + 25_200_000 }
    ]) do |log_path|
      status = HarvestWorklog::ReconcileCLI.run(
        ["2026-07-17", "--project", "wrap", "--harvest-project", "WRAP", "--task", "Programming"],
        output:,
        client:,
        log_path:
      )

      assert_equal 0, status
    end

    assert_equal <<~OUTPUT, output.string
      2026-07-17 reconciliation
      Manual Harvest: 7h 0m 0s (1 entry)
      Local OMP Project Time wrap:
        Raw intervals: 3h 0m 0s
        Non-overlapping union: 2h 30m 0s
        Concurrent overlap: 0h 30m 0s
      Harvest minus local raw: +4h 0m 0s
      Harvest minus local union: +4h 30m 0s
      Verdict: Manual Harvest is the benchmark. This read-only comparison creates or changes no entries.
    OUTPUT
  end

  def test_reconcile_cli_rounds_milliseconds_to_nearest_second
    assert_equal "1h 0m 1s", HarvestWorklog::ReconcileCLI.duration(3_600_600)
    assert_equal "0h 0m 0s", HarvestWorklog::ReconcileCLI.signed_duration(-400)
  end

  def test_reconcile_cli_reports_empty_harvest_and_local_data
    output = StringIO.new

    with_project_time_log([]) do |log_path|
      status = HarvestWorklog::ReconcileCLI.run(
        ["2026-07-17", "--project", "wrap", "--harvest-project", "WRAP"],
        output:,
        client: AggregateClient.new([{ "time_entries" => [], "next_page" => nil }]),
        log_path:
      )

      assert_equal 0, status
    end

    assert_includes output.string, "Manual Harvest: 0h 0m 0s (0 entries)"
    assert_includes output.string, "Raw intervals: 0h 0m 0s"
    assert_includes output.string, "Harvest minus local union: 0h 0m 0s"
  end

  def test_reconcile_cli_reports_a_malformed_local_log
    error = StringIO.new

    Dir.mktmpdir do |directory|
      path = File.join(directory, "time-log.json")
      File.write(path, JSON.generate([]))
      status = HarvestWorklog::ReconcileCLI.run(
        ["2026-07-17", "--project", "wrap", "--harvest-project", "WRAP"],
        error:,
        client: AggregateClient.new([{ "time_entries" => [], "next_page" => nil }]),
        log_path: path
      )

      assert_equal 1, status
    end

    assert_includes error.string, "OMP Project Time log is missing an entries array"
  end

  def with_project_time_log(entries)
    Dir.mktmpdir do |directory|
      path = File.join(directory, "time-log.json")
      File.write(path, JSON.generate({ "entries" => entries }))
      yield path
    end
  end

  class FakeClient
    attr_reader :assignment_source, :entries, :requests

    def initialize(existing_entries: [])
      @entries = []
      @existing_entries = existing_entries
      @requests = []
    end

    def active_personal_task_assignments
      @assignment_source = :personal
      [{ "project" => { "id" => 48_730_683, "name" => "Time Off - Marlen" }, "task" => { "id" => 8_083_365, "name" => "Vacation / PTO" } }]
    end

    def request(method, path, params:)
      @requests << { method:, path:, params: }
      { "time_entries" => @existing_entries + @entries.map { |entry| { "is_locked" => false, "notes" => entry.fetch(:notes) } } }
    end

    def create_time_entry(**entry)
      @entries << entry
      { "id" => @entries.length }
    end
  end

  class AggregateClient
    attr_reader :requests

    def initialize(pages, current_user_id: 42)
      @pages = pages
      @current_user_id = current_user_id
      @requests = []
    end

    def request(method, path, params:)
      @requests << { method:, path:, params: }
      return { "id" => @current_user_id } if path == "/v2/users/me"

      @pages.fetch(params.fetch(:page) - 1)
    end
  end

  class MappingDataClient
    attr_reader :requests

    def initialize(assignments, entries)
      @assignments = assignments
      @entries = entries
      @requests = []
    end

    def active_personal_task_assignments
      @assignments
    end

    def request(method, path, params:)
      @requests << { method:, path:, params: }
      { "time_entries" => @entries, "next_page" => nil }
    end
  end
end
