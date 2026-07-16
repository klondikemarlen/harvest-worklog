# frozen_string_literal: true

require "harvest_time_off/version"
require "business_time"
require "date"
require "holidays"
require "optparse"
require "harvest_api_v2"

module HarvestTimeOff
  module_function

  def dates_between(from, to, holiday_regions:)
    raise Error, "end date must not be before start date" if to < from
    raise Error, "at least one holiday region is required" if holiday_regions.empty?

    holidays = Holidays.between(from, to, *(holiday_regions.map { |region| region.downcase.to_sym } + [:observed])).map { |holiday| holiday[:date] }
    (from..to).select { |date| date.workday?(holidays:) }
  rescue Holidays::InvalidRegion
    raise Error, "invalid holiday region: #{holiday_regions.join(", ")}"
  end

  def display_hours(hours)
    format("%g", hours)
  end

  class Error < StandardError; end

  class CLI
    def self.run(arguments, output: $stdout, error: $stderr, client: nil)
      options = { hours: 7.0, dry_run: false, holiday_regions: holiday_regions_from_environment }
      parser = option_parser(options)
      dates = parser.parse(arguments)
      validate!(dates, options)

      from = Date.iso8601(dates[0])
      to = Date.iso8601(dates[1])
      workdays = HarvestTimeOff.dates_between(from, to, holiday_regions: options[:holiday_regions])
      raise Error, "date range contains no days to enter" if workdays.empty?

      if options[:dry_run]
        print_dry_run(output, workdays, options)
        return 0
      end

      client ||= HarvestApiV2::Client.from_environment
      project_id, task_id = if options[:project_id]
                              [options[:project_id], options[:task_id]]
                            else
                              resolve_assignment(client, options[:project], options[:task])
                            end

      workdays.each do |date|
        entry = client.create_time_entry(
          project_id:,
          task_id:,
          spent_date: date,
          hours: options[:hours],
          notes: options[:notes]
        )
        output.puts "Created #{date.iso8601}: #{HarvestTimeOff.display_hours(options[:hours])}h (entry ##{entry.fetch("id")})"
      end
      0
    rescue Error, HarvestApiV2::Error, OptionParser::ParseError, Date::Error => e
      error.puts "Error: #{e.message}"
      error.puts parser if parser
      1
    end

    def self.option_parser(options)
      OptionParser.new do |opts|
        opts.banner = <<~USAGE
          Usage: harvest-time-off FROM TO --project NAME --task NAME [options]
                 harvest-time-off FROM TO --project-id ID --task-id ID [options]

          Creates one Harvest duration entry for each local business day from FROM through TO.
        USAGE
        opts.on("--project NAME", "Harvest project name") { |value| options[:project] = value }
        opts.on("--task NAME", "Harvest task name") { |value| options[:task] = value }
        opts.on("--project-id ID", Integer, "Harvest project ID") { |value| options[:project_id] = value }
        opts.on("--task-id ID", Integer, "Harvest task ID") { |value| options[:task_id] = value }
        opts.on("--hours HOURS", Float, "Hours per day (default: 7)") { |value| options[:hours] = value }
        opts.on("--notes NOTES", "Optional note on every entry") { |value| options[:notes] = value }
        opts.on("--holiday-region REGION", "Holidays region; repeat for each locality") { |value| options[:holiday_regions] << value.strip.downcase }
        opts.on("--dry-run", "Print entries without calling Harvest") { options[:dry_run] = true }
        opts.on("-h", "--help", "Show this help") do
          puts opts
          exit 0
        end
      end
    end

    def self.validate!(dates, options)
      raise Error, "FROM and TO are required" unless dates.length == 2
      raise Error, "--hours must be a positive finite number" unless options[:hours].positive? && options[:hours].finite?
      raise Error, "--holiday-region or HARVEST_HOLIDAY_REGIONS is required" if options[:holiday_regions].empty?

      names_provided = options[:project] || options[:task]
      ids_provided = options[:project_id] || options[:task_id]
      valid_names = options[:project] && options[:task]
      valid_ids = options[:project_id] && options[:task_id]
      raise Error, "supply --project and --task, or --project-id and --task-id" unless valid_names || valid_ids
      raise Error, "do not combine project/task names with IDs" if names_provided && ids_provided
    end

    def self.holiday_regions_from_environment
      ENV.fetch("HARVEST_HOLIDAY_REGIONS", "ca_yt").split(",").map { |region| region.strip.downcase }.reject(&:empty?)
    end

    def self.resolve_assignment(client, project_name, task_name)
      # ponytail: one 2,000-item page covers personal assignments; follow cursor pagination if that ceiling is exceeded.
      matches = client.active_task_assignments.select do |assignment|
        assignment.dig("project", "name")&.casecmp?(project_name) &&
          assignment.dig("task", "name")&.casecmp?(task_name)
      end

      return [matches.first.dig("project", "id"), matches.first.dig("task", "id")] if matches.one?

      qualifier = "project #{project_name.inspect} and task #{task_name.inspect}"
      raise Error, "No active task assignment matches #{qualifier}. Pass --project-id and --task-id instead." if matches.empty?

      raise Error, "Multiple active task assignments match #{qualifier}. Pass --project-id and --task-id instead."
    end

    def self.print_dry_run(output, dates, options)
      project = options[:project] || "project ##{options[:project_id]}"
      task = options[:task] || "task ##{options[:task_id]}"
      notes = options[:notes] ? "; #{options[:notes]}" : ""
      dates.each do |date|
        output.puts "Would create #{date.iso8601}: #{HarvestTimeOff.display_hours(options[:hours])}h on #{project} / #{task}#{notes}"
      end
    end
  end
end
