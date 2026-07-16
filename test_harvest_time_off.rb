# frozen_string_literal: true

require "date"
require "minitest/autorun"
require "stringio"

$LOAD_PATH.unshift File.expand_path("lib", __dir__)
require "harvest_time_off"

class HarvestTimeOffTest < Minitest::Test
  def test_dates_between_skips_weekends_by_default
    from = Date.new(2026, 7, 17)
    to = Date.new(2026, 7, 20)

    assert_equal [Date.new(2026, 7, 17), Date.new(2026, 7, 20)], HarvestTimeOff.dates_between(from, to, holiday_regions: ["ca"])
  end

  def test_dates_between_excludes_observed_regional_holidays
    dates = HarvestTimeOff.dates_between(Date.new(2007, 7, 2), Date.new(2007, 7, 6), holiday_regions: ["ca_bc"])

    assert_equal [Date.new(2007, 7, 3), Date.new(2007, 7, 4), Date.new(2007, 7, 5), Date.new(2007, 7, 6)], dates
  end

  def test_dry_run_accepts_hours_notes_and_named_assignment
    output = StringIO.new
    error = StringIO.new

    status = HarvestTimeOff::CLI.run(
      ["2026-07-17", "2026-07-20", "--project", "Time Off - Marlen", "--task", "Vacation / PTO", "--notes", "Vacation", "--holiday-region", "ca", "--dry-run"],
      output:,
      error:
    )

    assert_equal 0, status
    assert_equal "", error.string
    assert_equal 2, output.string.lines.length
    assert_includes output.string, "2026-07-17: 7h on Time Off - Marlen / Vacation / PTO; Vacation"
    assert_includes output.string, "2026-07-20: 7h on Time Off - Marlen / Vacation / PTO; Vacation"
  end

  def test_cli_defaults_to_yukon_holidays
    output = StringIO.new

    status = HarvestTimeOff::CLI.run(
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

    status = HarvestTimeOff::CLI.run(
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

    status = HarvestTimeOff::WorkEntryCLI.run(
      ["2026-07-17", "--project", "Time Off - Marlen", "--task", "Vacation / PTO", "--hours", "2.25", "--notes", "OMP Project Time: Harvest API", "--dry-run"],
      output:,
      error:,
      client:
    )

    assert_equal 0, status
    assert_equal "", error.string
    assert_includes output.string, "Would create 2026-07-17: 2.25h"
    assert_equal [{ method: :get, path: "/v2/time_entries", params: { project_id: 48_730_683, task_id: 8_083_365, from: "2026-07-17", to: "2026-07-17" } }], client.requests
  end

  def test_work_entry_skips_locked_existing_entry
    client = FakeClient.new(existing_entries: [{ "is_locked" => true }])
    output = StringIO.new

    status = HarvestTimeOff::WorkEntryCLI.run(
      ["2026-07-17", "--project", "Time Off - Marlen", "--task", "Vacation / PTO", "--hours", "2.25", "--notes", "OMP Project Time: Harvest API"],
      output:,
      client:
    )

    assert_equal HarvestTimeOff::WorkEntryCLI::LOCKED_ENTRY, status
    assert_equal "Locked existing Harvest entry on 2026-07-17; skipped\n", output.string
    assert_empty client.entries
  end

  def test_work_entry_skips_existing_unlocked_entry
    client = FakeClient.new(existing_entries: [{ "is_locked" => false }])
    output = StringIO.new

    status = HarvestTimeOff::WorkEntryCLI.run(
      ["2026-07-17", "--project", "Time Off - Marlen", "--task", "Vacation / PTO", "--hours", "2.25", "--notes", "OMP Project Time: Harvest API"],
      output:,
      client:
    )

    assert_equal HarvestTimeOff::WorkEntryCLI::EXISTING_ENTRY, status
    assert_equal "Existing Harvest entry on 2026-07-17; skipped\n", output.string
    assert_empty client.entries
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
      { "time_entries" => @existing_entries }
    end

    def create_time_entry(**entry)
      @entries << entry
      { "id" => @entries.length }
    end
  end
end
