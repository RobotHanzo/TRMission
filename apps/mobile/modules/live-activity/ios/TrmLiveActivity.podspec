Pod::Spec.new do |s|
  s.name           = 'TrmLiveActivity'
  s.version        = '1.0.0'
  s.summary        = 'ActivityKit bridge for the TRMission game Live Activity'
  s.description    = 'Starts/updates/ends the in-game Live Activity and surfaces its ActivityKit push token.'
  s.author         = 'TRMission'
  s.homepage       = 'https://github.com/RobotHanzo/TRMission'
  # 16.4 is the whole SDK 56 floor (every expo-* podspec pins it), comfortably above ActivityKit's
  # own iOS 16.1/16.2 — so nothing in here needs an `#available` guard.
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/RobotHanzo/TRMission' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,swift}"
end
