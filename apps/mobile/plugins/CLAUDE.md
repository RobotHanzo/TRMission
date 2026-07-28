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

## `withRemoteNotificationErrorGuard.js`

Injects a null-APNs-error guard into the generated `AppDelegate.swift` (Sentry TRMISSION-MOBILE-4).
iOS 26/27 can call `application(_:didFailToRegisterForRemoteNotificationsWithError:)` with a **nil**
error although UIKit declares it nonnull; Swift trusts the import, so the null reaches
`ExpoAppDelegateSubscriberManager` as a null `any Error` and the process dies in
`_swift_stdlib_bridgeErrorToNSError` when the manager bridges it back to NSError for its @objc
subscribers — before `expo-notifications` can reject the pending `getDevicePushTokenAsync()`. The
device stays wedged across retries until it is REBOOTED, so it isn't a one-off crash: push
registration takes the app down every time.

Two things about the shape, both forced:

1. **The guard swizzles rather than overrides**, because Swift cannot inspect a null existential
   without tripping the same crash. Replacing the IMP with a block typed `NSError?` puts the check
   below the bridge, where nil is representable.
2. **It is installed from a `willFinishLaunchingWithOptions` override.** The template already
   overrides `didFinishLaunchingWithOptions` (a second one wouldn't compile) and `init()` can't be
   overridden across modules — `ExpoAppDelegate.init()` is `public`, not `open`.

`withRemoteNotificationErrorGuard.test.ts` runs the patch against the real SDK 56 template
(`__fixtures__/expo-sdk56-bare-AppDelegate.swift`) and pins the anchors; the plugin throws when they
stop matching, so a template change fails `expo prebuild` instead of silently dropping the guard.
Only the macOS lane can prove the injected Swift compiles.
