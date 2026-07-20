# frozen_string_literal: true

module HarvestWorklog
  class TimesheetCLI
    def self.run(arguments, output: $stdout, error: $stderr, client: nil, today: Date.today)
      options = {}
      parser = option_parser(options)
      dates = parser.parse(arguments)
      validate!(dates, options)

      spent_date = resolve_date(dates.first, today:)
      client ||= Marlens::HarvestApiV2::Client.from_environment
      user_id = current_user_id(client)
      entries = AggregateCLI.fetch_entries(client, from: spent_date, to: spent_date, user_id:).select { |entry| AggregateCLI.matches?(entry, options) }
      print_timesheet(output, entries, spent_date:, requested_project: options[:project])
      0
    rescue Error, Marlens::HarvestApiV2::Error, OptionParser::ParseError, Date::Error => e
      error.puts "Error: #{e.message}"
      error.puts parser if parser
      1
    end

    def self.option_parser(options)
      OptionParser.new do |opts|
        opts.banner = "Usage: harvest-worklog timesheet DATE --project NAME [--task NAME]"
        opts.on("--project NAME", "Filter by Harvest project name") { |value| options[:project] = value }
        opts.on("--task NAME", "Filter by Harvest task name") { |value| options[:task] = value }
        opts.on("-h", "--help", "Show this help") do
          puts opts
          exit 0
        end
      end
    end

    def self.resolve_date(value, today: Date.today)
      case value.downcase
      when "today" then today
      when "yesterday" then today - 1
      else Date.iso8601(value)
      end
    end

    def self.current_user_id(client)
      client.request(:get, "/v2/users/me", params: {}).fetch("id")
    end

    def self.validate!(dates, options)
      raise Error, "DATE is required" unless dates.length == 1
      raise Error, "--project is required" unless options[:project] && !options[:project].strip.empty?
      raise Error, "--task must not be blank" if options[:task]&.strip&.empty?
    end

    def self.print_timesheet(output, entries, spent_date:, requested_project:)
      project = entries.first&.dig("project", "name") || requested_project
      output.puts "#{project} · #{spent_date.strftime("%a, %b %-d")} · #{HarvestWorklog.display_hours(AggregateCLI.total_hours(entries))}h"
      if entries.empty?
        output.puts
        output.puts "No time entries."
        return
      end

      entries.group_by { |entry| entry.dig("task", "name") }.sort_by { |task, _| task.downcase }.each do |task, task_entries|
        output.puts
        output.puts "#{task} · #{HarvestWorklog.display_hours(AggregateCLI.total_hours(task_entries))}h"
        if task_entries.one?
          print_notes(output, task_entries.first["notes"].to_s, indent: 2)
        else
          task_entries.each do |entry|
            output.puts "  #{HarvestWorklog.display_hours(Float(entry.fetch("hours")))}h"
            print_notes(output, entry["notes"].to_s, indent: 4)
          end
        end
      end
    end

    def self.print_notes(output, notes, indent:)
      lines = notes.lines(chomp: true).reject(&:empty?)
      lines = ["(no notes)"] if lines.empty?
      lines.each { |line| output.puts "#{" " * indent}#{line}" }
    end
  end
end
