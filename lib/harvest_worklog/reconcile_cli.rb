# frozen_string_literal: true

module HarvestWorklog
  class ReconcileCLI
    def self.run(arguments, output: $stdout, error: $stderr, client: nil, log_path: default_log_path, today: Date.today)
      options = {}
      parser = option_parser(options)
      dates = parser.parse(arguments)
      validate!(dates, options)

      date = TimesheetCLI.resolve_date(dates.first, today:)
      client ||= Marlens::HarvestApiV2::Client.from_environment
      user_id = TimesheetCLI.current_user_id(client)
      harvest_entries = AggregateCLI.fetch_entries(client, from: date, to: date, user_id:).select do |entry|
        AggregateCLI.matches?(entry, project: options[:harvest_project], task: options[:task])
      end
      print_reconciliation(
        output,
        date:,
        local_project: options[:project],
        intervals: local_intervals(log_path, date:, project: options[:project]),
        harvest_entries:
      )
      0
    rescue Error, Marlens::HarvestApiV2::Error, OptionParser::ParseError, Date::Error, Errno::ENOENT, JSON::ParserError => e
      error.puts "Error: #{e.message}"
      error.puts parser if parser
      1
    end

    def self.option_parser(options)
      OptionParser.new do |opts|
        opts.banner = "Usage: harvest-worklog reconcile DATE --project PROJECT --harvest-project NAME [--task NAME]"
        opts.on("--project NAME", "Filter local OMP Project Time project name") { |value| options[:project] = value }
        opts.on("--harvest-project NAME", "Filter manual Harvest project name") { |value| options[:harvest_project] = value }
        opts.on("--task NAME", "Filter manual Harvest task name") { |value| options[:task] = value }
        opts.on("-h", "--help", "Show this help") do
          puts opts
          exit 0
        end
      end
    end

    def self.validate!(dates, options)
      raise Error, "DATE is required" unless dates.length == 1
      %i[project harvest_project].each do |name|
        raise Error, "--#{name.to_s.tr('_', '-')} is required" unless options[name]&.strip&.length&.positive?
      end
      raise Error, "--task must not be blank" if options[:task]&.strip&.empty?
    end

    def self.default_log_path
      File.join(Dir.home, ".omp", "project-time", "time-log.json")
    end

    def self.local_intervals(log_path, date:, project:)
      state = JSON.parse(File.read(log_path))
      entries = state.is_a?(Hash) ? state["entries"] : nil
      raise Error, "OMP Project Time log is missing an entries array" unless entries.is_a?(Array)

      day_start = Time.local(date.year, date.month, date.day).to_f * 1000
      next_date = date + 1
      day_end = Time.local(next_date.year, next_date.month, next_date.day).to_f * 1000
      entries.filter_map do |entry|
        next unless entry.is_a?(Hash) && entry["sourceKind"] == "human_active" && entry["project"] == project

        start_at = entry["startAtMs"]
        end_at = entry["endAtMs"]
        raise Error, "OMP Project Time log contains an invalid session interval" unless start_at.is_a?(Numeric) && end_at.is_a?(Numeric) && start_at < end_at

        start_at = [start_at, day_start].max
        end_at = [end_at, day_end].min
        [start_at, end_at] if start_at < end_at
      end
    end

    def self.print_reconciliation(output, date:, local_project:, intervals:, harvest_entries:)
      raw = intervals.sum { |start_at, end_at| end_at - start_at }
      union = merged_duration(intervals)
      harvest = AggregateCLI.total_hours(harvest_entries) * 3_600_000

      output.puts "#{date.iso8601} reconciliation"
      output.puts "Manual Harvest: #{duration(harvest)} (#{harvest_entries.length} #{AggregateCLI.entry_label(harvest_entries.length)})"
      output.puts "Local OMP Project Time #{local_project}:"
      output.puts "  Raw intervals: #{duration(raw)}"
      output.puts "  Non-overlapping union: #{duration(union)}"
      output.puts "  Concurrent overlap: #{duration(raw - union)}"
      output.puts "Harvest minus local raw: #{signed_duration(harvest - raw)}"
      output.puts "Harvest minus local union: #{signed_duration(harvest - union)}"
      output.puts "Verdict: Manual Harvest is the benchmark. This read-only comparison creates or changes no entries."
    end

    def self.merged_duration(intervals)
      merged = intervals.sort_by(&:first).each_with_object([]) do |(start_at, end_at), result|
        if result.empty? || start_at > result.last.last
          result << [start_at, end_at]
        else
          result.last[1] = [result.last[1], end_at].max
        end
      end
      merged.sum { |start_at, end_at| end_at - start_at }
    end

    def self.signed_duration(milliseconds)
      seconds = (milliseconds / 1000.0).round
      return duration(0) if seconds.zero?

      "#{seconds.negative? ? '-' : '+'}#{duration(seconds.abs * 1000)}"
    end

    def self.duration(milliseconds)
      seconds = (milliseconds / 1000.0).round
      "%dh %dm %ds" % [seconds / 3600, seconds / 60 % 60, seconds % 60]
    end
  end
end
