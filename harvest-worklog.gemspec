# frozen_string_literal: true

require_relative "lib/harvest_worklog/version"

Gem::Specification.new do |spec|
  spec.name = "harvest-worklog"
  spec.version = HarvestWorklog::VERSION
  spec.authors = ["Marlen Brunner"]
  spec.email = ["klondikemarlen@gmail.com"]
  spec.summary = "Harvest work-log CLI and OMP integration."
  spec.homepage = "https://github.com/klondikemarlen/harvest-worklog"
  spec.license = "MIT"
  spec.required_ruby_version = ">= 3.2"

  spec.metadata["source_code_uri"] = spec.homepage

  spec.files = Dir["lib/**/*.rb", "bin/*", "harvest-worklog.rb", "README.md"]
  spec.bindir = "bin"
  spec.executables = ["harvest-worklog"]
  spec.require_paths = ["lib"]

  spec.add_dependency "marlens-harvest-api-v2", "~> 0.2"
  spec.add_dependency "business_time", "~> 0.13"
  spec.add_dependency "holidays", "~> 9.2"
end
