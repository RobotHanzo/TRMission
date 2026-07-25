# Config plugins (`apps/mobile/plugins/`)

App-wide context: `apps/mobile/CLAUDE.md`. `apps/mobile/ios` and `android` are CNG output —
anything a plugin doesn't inject is gone on the next `expo prebuild`.

## `withLiveActivity.js`

Injects the Live Activity widget extension **target** into the generated pbxproj on every prebuild
(via the `xcode` lib @expo/config-plugins already ships), and COPIES
`TRMissionActivityAttributes.swift` from `modules/live-activity/` into the widget folder so both
targets compile one declaration. Feature context: `../modules/live-activity/CLAUDE.md`.

Three `xcode` API traps are handled and pinned by `withLiveActivity.test.ts` (which runs the plugin
against a real SDK-56 template pbxproj fixture — `expo prebuild -p ios` refuses to run off macOS):

1. `pbxTargetByName` can't find a target `addTarget` created (its section comment is quoted),
2. `addTargetDependency` silently no-ops unless the PBXTargetDependency/PBXContainerItemProxy
   sections already exist,
3. `addTarget` returns `{uuid, pbxNativeTarget}` — passing the wrapper to a configuration lookup
   drops every build setting.

`.github/workflows/mobile-ios.yml` re-asserts the same shape after a real prebuild.
