# frozen_string_literal: true

module HarvestWorklog
  class AggregateCLI
    PER_PAGE = 100

    def self.run(arguments, output: $stdout, error: $stderr, client: nil)
      options = {}
      parser = option_parser(options)
      dates = parser.parse(arguments)
      validate!(dates, options)

      from = Date.iso8601(dates[0])
      to = Date.iso8601(dates[1])
      raise Error, "end date must not be before start date" if to < from

      client ||= Marlens::HarvestApiV2::Client.from_environment
      entries = fetch_entries(client, from:, to:).select { |entry| matches?(entry, options) }
      print_summary(output, entries, from:, to:)
      0
    rescue Error, Marlens::HarvestApiV2::Error, OptionParser::ParseError, Date::Error => e
      error.puts "Error: #{e.message}"
      error.puts parser if parser
      1
    end

    def self.option_parser(options)
      OptionParser.new do |opts|
        opts.banner = "Usage: harvest-worklog aggregate FROM TO [--project NAME] [--task NAME]"
        opts.on("--project NAME", "Filter by Harvest project name") { |value| options[:project] = value }
        opts.on("--task NAME", "Filter by Harvest task name") { |value| options[:task] = value }
        opts.on("-h", "--help", "Show this help") do
          puts opts
          exit 0
        end
      end
    end

    def self.validate!(dates, options = {})
      raise Error, "FROM and TO are required" unless dates.length == 2
      raise Error, "--project must not be blank" if options[:project]&.strip&.empty?
      raise Error, "--task must not be blank" if options[:task]&.strip&.empty?
    end

    def self.fetch_entries(client, from:, to:, user_id: nil)
      entries = []
      page = 1
      loop do
        params = { from: from.iso8601, to: to.iso8601, page:, per_page: PER_PAGE }
        params[:user_id] = user_id if user_id
        response = client.request(
          :get,
          "/v2/time_entries",
          params:
        )
        entries.concat(response.fetch("time_entries"))
        page = response["next_page"]
        break if page.nil?
      end
      entries
    end

    def self.matches?(entry, options)
      name_matches?(entry.dig("project", "name"), options[:project]) &&
        name_matches?(entry.dig("task", "name"), options[:task])
    end

    def self.name_matches?(actual, expected)
      expected.nil? || actual&.casecmp?(expected)
    end

    def self.print_summary(output, entries, from:, to:)
      output.puts "#{entries.length} #{entry_label(entries.length)}, #{HarvestWorklog.display_hours(total_hours(entries))}h from #{from.iso8601} through #{to.iso8601}"
      output.puts "By date:"
      (from..to).each do |date|
        date_entries = entries.select { |entry| entry.fetch("spent_date") == date.iso8601 }
        output.puts "  #{date.iso8601}: #{date_entries.length} #{entry_label(date_entries.length)}, #{HarvestWorklog.display_hours(total_hours(date_entries))}h"
      end
      output.puts "By project/task:"

      groups = entries.group_by { |entry| [entry.dig("project", "name"), entry.dig("task", "name")] }
      if groups.empty?
        output.puts "  none"
        return
      end

      groups.keys.sort_by { |project, task| [project.downcase, task.downcase] }.each do |project, task|
        group = groups.fetch([project, task])
        output.puts "  #{project} / #{task}: #{group.length} #{entry_label(group.length)}, #{HarvestWorklog.display_hours(total_hours(group))}h"
      end
    end

    def self.total_hours(entries)
      entries.sum { |entry| Float(entry.fetch("hours")) }
    end

    def self.entry_label(count)
      count == 1 ? "entry" : "entries"
    end
  end
end
