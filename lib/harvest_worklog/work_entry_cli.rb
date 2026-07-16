# frozen_string_literal: true

module HarvestWorklog
  class WorkEntryCLI
    EXISTING_ENTRY = 2
    LOCKED_ENTRY = 3

    def self.run(arguments, output: $stdout, error: $stderr, client: nil)
      options = { dry_run: false }
      parser = option_parser(options)
      dates = parser.parse(arguments)
      validate!(dates, options)

      spent_date = Date.iso8601(dates.first)
      client ||= Marlens::HarvestApiV2::Client.from_environment
      project_id, task_id = if options[:project_id]
                              [options[:project_id], options[:task_id]]
                            else
                              TimeOffCLI.resolve_assignment(client, options[:project], options[:task])
                            end
      existing_entries = client.request(
        :get,
        "/v2/time_entries",
        params: { project_id:, task_id:, from: spent_date.iso8601, to: spent_date.iso8601 }
      ).fetch("time_entries")

      if existing_entries.any? { |entry| entry["is_locked"] }
        output.puts "Locked existing Harvest entry on #{spent_date.iso8601}; skipped"
        return LOCKED_ENTRY
      end

      if existing_entries.any?
        output.puts "Existing Harvest entry on #{spent_date.iso8601}; skipped"
        return EXISTING_ENTRY
      end

      if options[:dry_run]
        output.puts "Would create #{spent_date.iso8601}: #{HarvestWorklog.display_hours(options[:hours])}h on #{options[:project]} / #{options[:task]}; #{options[:notes]}"
        return 0
      end

      entry = client.create_time_entry(
        project_id:,
        task_id:,
        spent_date:,
        hours: options[:hours],
        notes: options[:notes]
      )
      output.puts "Created #{spent_date.iso8601}: #{HarvestWorklog.display_hours(options[:hours])}h (entry ##{entry.fetch("id")})"
      0
    rescue Error, Marlens::HarvestApiV2::Error, OptionParser::ParseError, Date::Error => e
      error.puts "Error: #{e.message}"
      error.puts parser if parser
      1
    end

    def self.option_parser(options)
      OptionParser.new do |opts|
        opts.banner = "Usage: harvest-worklog work-entry DATE --project NAME --task NAME --hours HOURS --notes NOTES [--dry-run]"
        opts.on("--project NAME", "Harvest project name") { |value| options[:project] = value }
        opts.on("--task NAME", "Harvest task name") { |value| options[:task] = value }
        opts.on("--project-id ID", Integer, "Harvest project ID") { |value| options[:project_id] = value }
        opts.on("--task-id ID", Integer, "Harvest task ID") { |value| options[:task_id] = value }
        opts.on("--hours HOURS", Float, "Hours for this entry") { |value| options[:hours] = value }
        opts.on("--notes NOTES", "Entry description") { |value| options[:notes] = value }
        opts.on("--dry-run", "Check for existing entries without writing") { options[:dry_run] = true }
        opts.on("-h", "--help", "Show this help") do
          puts opts
          exit 0
        end
      end
    end

    def self.validate!(dates, options)
      raise Error, "DATE is required" unless dates.length == 1
      raise Error, "--hours must be a positive finite number" unless options[:hours]&.positive? && options[:hours].finite?
      raise Error, "--notes is required" unless options[:notes] && !options[:notes].empty?

      names_provided = options[:project] || options[:task]
      ids_provided = options[:project_id] || options[:task_id]
      valid_names = options[:project] && options[:task]
      valid_ids = options[:project_id] && options[:task_id]
      raise Error, "supply --project and --task, or --project-id and --task-id" unless valid_names || valid_ids
      raise Error, "do not combine project/task names with IDs" if names_provided && ids_provided
    end
  end
end
