# frozen_string_literal: true

require_relative "lib/harvest_time_off/version"

Gem::Specification.new do |spec|
  spec.name = "harvest-time-off"
  spec.version = HarvestTimeOff::VERSION
  spec.authors = ["Marlen Brunner"]
  spec.email = ["klondikemarlen@gmail.com"]
  spec.summary = "Create Harvest time-off and reviewed OMP Project Time entries."
  spec.homepage = "https://github.com/klondikemarlen/harvest-time-off"
  spec.license = "MIT"
  spec.required_ruby_version = ">= 3.2"

  spec.metadata["source_code_uri"] = spec.homepage

  spec.files = Dir["lib/**/*.rb", "bin/*", "harvest-time-off.rb", "README.md"]
  spec.bindir = "bin"
  spec.executables = ["harvest-time-off", "harvest-work-entry"]
  spec.require_paths = ["lib"]

  spec.add_dependency "marlens-harvest-api-v2", "~> 0.2"
  spec.add_dependency "business_time", "~> 0.13"
  spec.add_dependency "holidays", "~> 9.2"
end
