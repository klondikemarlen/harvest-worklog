# frozen_string_literal: true

require "json"

module HarvestWorklog
  class MappingDataCLI
    def self.run(arguments, output: $stdout, error: $stderr, client: nil)
      from, to = arguments
      raise Error, "FROM and TO are required" unless arguments.length == 2

      from = Date.iso8601(from)
      to = Date.iso8601(to)
      raise Error, "end date must not be before start date" if to < from

      client ||= Marlens::HarvestApiV2::Client.from_environment
      assignments = client.active_personal_task_assignments.filter_map do |assignment|
        project = assignment["project"]
        task = assignment["task"]
        next unless project&.fetch("id", nil) && project&.fetch("name", nil) && task&.fetch("id", nil) && task&.fetch("name", nil)

        { "project" => { "id" => project.fetch("id"), "name" => project.fetch("name") }, "task" => { "id" => task.fetch("id"), "name" => task.fetch("name") } }
      end
      entries = AggregateCLI.fetch_entries(client, from:, to:).filter_map do |entry|
        project = entry["project"]
        task = entry["task"]
        next unless project&.fetch("id", nil) && project&.fetch("name", nil) && task&.fetch("id", nil) && task&.fetch("name", nil) && Float(entry.fetch("hours"))

        { "project" => { "id" => project.fetch("id"), "name" => project.fetch("name") }, "task" => { "id" => task.fetch("id"), "name" => task.fetch("name") }, "hours" => entry.fetch("hours") }
      end
      output.puts JSON.generate(assignments:, entries:)
      0
    rescue Error, Marlens::HarvestApiV2::Error, Date::Error => e
      error.puts "Error: #{e.message}"
      1
    end
  end
end
