# iOS Live Activities — game progress on the Dynamic Island (issue #43)

A Live Activity per online game: whose turn it is (with "your turn" called out), the viewer's own
trains + score, the last-round flag, and a live turn countdown — on the lock screen, in the Dynamic
Island, and on the notch-less banner.

## Why the server is in scope

A Live Activity is only worth having when the app **isn't** in front of you, which is exactly when
JS is suspended and cannot update it. A foreground-only implementation would freeze on "waiting for
Alice" and then keep saying that after it became your turn — actively misleading. So the activity's
ActivityKit **push token** goes to the server, and the hub pushes `apns-push-type: liveactivity`
updates on every turn change to players whose socket is gone (the same "socketless" rule the
your-turn alert already uses, so volume stays inside Apple's update budget).

The `Text(timerInterval:)` countdown means the widget also animates itself between pushes.

## Content contract (the one seam that must not drift)

Static `ActivityAttributes` — fixed at start by the app, so the server never needs names or copy:
`roomCode`, `mySeat`, `playerNames[]`, `seatColors[]`, and the **localized strings** the widget
renders (i18n stays in i18next; the widget only formats).

Dynamic `ContentState` — pushable by app _or_ server, numbers and booleans only:
`currentSeat` (-1 = nobody), `myTrains`, `myScore`, `finalTurnsRemaining` (0 = not last round),
`over`, `turnEndsAt` (epoch seconds, 0 = no clock).

Swift `ContentState` keys ⇄ the APNs `content-state` JSON ⇄ the TS `LiveActivityContent` type are
one contract in three places. `apnsLiveActivityBody` is exported pure and pinned by a spec.

## Phases

1. **Native** — a local Expo module (`modules/live-activity`, iOS-only) wrapping ActivityKit
   (`start`/`update`/`end`/`areEnabled` + a `pushTokenUpdates` event), the widget sources
   (`ios-live-activity/`), and a config plugin (`plugins/withLiveActivity.js`) that injects the
   widget-extension target into the CNG-generated Xcode project (pbxproj surgery via the `xcode`
   package that `@expo/config-plugins` already ships) and copies the shared attributes file into
   both targets — one declaration in git, copied every prebuild, so the two targets can't drift.
2. **Mobile JS** — a pure snapshot→content model (`game/liveActivity.ts`), the driver
   (`game/useLiveActivity.ts`, mounted from `GameScreen` so sandbox/tutorial stages never start
   one), push-token registration, and a Settings toggle (default on).
3. **Server** — `liveActivities` token registry (12h TTL = ActivityKit's own ceiling),
   `ApnsTransport.sendLiveActivity`, `PushService.updateLiveActivities` (per-recipient content),
   and a `PushSink.liveActivity` trigger fired off the same commit fan-out as the your-turn push.
   Hidden info: a row whose `userId` isn't seated in that game is filtered out at push time, so a
   forged registration can never receive another game's state.
4. **Delivery** — the widget needs its own App ID + provisioning profile: Matchfile app id list,
   the beta lane's manual-signing flip + gym export mapping, a post-prebuild target assertion in
   `mobile-ios.yml`, and the ASC setup runbook.

## Not in scope

Push-to-start (iOS 17.2+ `pushToStartToken`) — the app starts the activity while you're in the
game, which covers every path into one. Android has no equivalent surface.
