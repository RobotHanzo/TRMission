# Mobile build-number scheme

One monotonically increasing integer, **BUILD_NUMBER**, shared by both platforms per release:

- Android `versionCode` = BUILD_NUMBER
- iOS `CFBundleVersion` (buildNumber) = BUILD_NUMBER
- Marketing version (`versionName` / `CFBundleShortVersionString`) is independent semver (1.0.0, 1.0.1, …).

CI is the only place BUILD_NUMBER is assigned: the release workflows derive it from the
release tag (`mobile-v<semver>+<build>`; the `+<build>` suffix is the integer) and inject it
via `app.config.ts` env at `expo prebuild` time. Local dev builds use BUILD_NUMBER=1 and are
never shipped.

The server's `MOBILE_MIN_BUILD` (served by `GET /version/mobile`, checked at app boot)
lives in the SAME number space. Rules:

1. `MOBILE_MIN_BUILD` may only ever increase.
2. Raise it to build N only when every build < N can no longer talk to the deployed
   server (wire/protocol/auth break) — it is a compatibility floor, not a nudge.
3. Raise it AFTER build N has ≥ 7 days of store availability, except for security fixes.
4. OTA (expo-updates, runtimeVersion fingerprint) never substitutes for the gate: an OTA
   update cannot cross a native runtimeVersion, and the gate must assume store binaries.

Rehearsal procedure (staging): set MOBILE_MIN_BUILD to current+1 → app boot shows the
forced-update screen with a working store link → reset. This rehearsal is a launch-gate
item (see the P6 plan, Task 11).
