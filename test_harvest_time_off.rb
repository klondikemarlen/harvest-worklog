# frozen_string_literal: true

require "date"
require "minitest/autorun"
require "stringio"

$LOAD_PATH.unshift File.expand_path("../harvest-api-v2/lib", __dir__)
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
    assert_equal(
      [
        { project_id: 48_730_683, task_id: 8_083_365, spent_date: Date.new(2026, 7, 17), hours: 7.5, notes: "Vacation" },
        { project_id: 48_730_683, task_id: 8_083_365, spent_date: Date.new(2026, 7, 20), hours: 7.5, notes: "Vacation" }
      ],
      client.entries
    )
    assert_includes output.string, "Created 2026-07-17: 7.5h (entry #1)"
  end

  class FakeClient
    attr_reader :entries

    def initialize
      @entries = []
    end

    def active_task_assignments
      [{ "project" => { "id" => 48_730_683, "name" => "Time Off - Marlen" }, "task" => { "id" => 8_083_365, "name" => "Vacation / PTO" } }]
    end

    def create_time_entry(**entry)
      @entries << entry
      { "id" => @entries.length }
    end
  end
end
