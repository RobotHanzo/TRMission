# TRMission native mobile app (Android + iOS, phones + tablets) — design

**Date:** 2026-07-06 · **Status:** approved (design); implementation plan to follow

## Problem

TRMission is web-only. We want real store presence on the Apple App Store and Google Play,
native-quality UI on phones and tablets, and capabilities the browser can't deliver well
(push turn-reminders, haptics, offline play). A WebView wrap was considered and rejected as
the primary path (native-quality UI + offline-first goals); it remains the documented
fallback should the native path stall.

## Confirmed decisions

- **Plan A: React Native + Expo native app** in a new `apps/mobile` workspace, reusing the
  pure-TS shared packages. Not a Capacitor/WebView wrap.
- **Offline vs bots ships in v1** (local engine + extracted bot policy).
- **Push notifications + haptics in v1.**
- **Tutorial is in v1**, rebuilt natively.
- **Map builder is in v1 as an embedded WebView** of the live web builder; a native rebuild
  is deferred to v2 pending mobile-authoring usage data ("WebView now, native later").
- **No paid SaaS in the delivery chain**: GitHub Actions for CI/builds/submission,
  self-hosted OTA update server, direct APNs/FCM push. Expo the *framework* is allowed;
  EAS Build, EAS Update, and the Expo Push Service are not used.
- Replay viewer deferred to v1.1; native builder rebuild deferred to v2; spectating and
  pass-and-play out of scope.

## Research grounding (fact-checked mid-2026)

Full digest lives with the session research; load-bearing verified facts:

- All five shared packages (`@trm/shared`, `engine`, `map-data`, `proto`, `codec`) are pure
  runtime-agnostic TS — no Node, no DOM. The SHA-256 digest is vendored pure JS with its own
  UTF-8 encoder. They run on Hermes with three shims (below). Metro (Expo SDK 52+)
  auto-configures Yarn-workspace monorepos and compiles TS-source packages directly; the
  repo's `nodeLinker: node-modules` is required and already set.
- ~4.5–5k LOC of `apps/web` logic ports nearly as-is (`store/game`, `net/rest`,
  `net/socket`, `game/*` helpers, `i18n`, `theme`). The DOM view layer (~34k LOC, 19.4k of
  it the builder) does not.
- The bot brain (`apps/server/src/bots/policy.ts`) imports only engine + shared and is a
  deterministic function of `state + botId` — extractable to a package.
- The WS plane (ticket-in-`ClientHello`, binary protobuf) is already native-safe; the auth
  plane is not: refresh token exists only as a `SameSite=Strict` httpOnly cookie, OAuth
  hands off sessions only via that cookie, the Google credential verifier pins a single web
  audience, and **no account-deletion endpoint exists**.
- Store constraints: Apple 4.8 → offering Google/Discord login requires Sign in with Apple
  (or equivalent privacy-preserving login). Apple 5.1.1(v) + Google → in-app account
  deletion, plus a public web deletion URL for Play's Data-safety form. Apple 1.2 / Play
  UGC → chat and shared custom maps need report/block/moderation affordances. iPadOS 26
  ignores `UIRequiresFullScreen` (apps must survive live window resizing); Android 16
  (target API 36 mandatory by 2026-08-31) ignores orientation/resizability locks on
  ≥600dp screens. New *personal* Play accounts need a 12-tester × 14-day closed test before
  production access; organization accounts (D-U-N-S) are exempt.
- Expo SDK 56 (RN 0.85, React 19.2, New Architecture mandatory, Hermes v1 default) is the
  current baseline. `@shopify/react-native-skia` 2.x needs RN ≥ 0.79 / React ≥ 19; SVG-based
  RN rendering degrades during interaction in the high-hundreds of nodes (the board renders
  ~550–900), so Skia is the primary renderer.
- Guest accounts are hard-deleted 30 days after creation regardless of activity
  (`guestExpiresAt` TTL is never extended) — hostile to mobile guest-first onboarding.

## Scope

**v1:** auth (guest, email/password, Google, Discord, Sign in with Apple), lobby/rooms,
native game UI, offline vs bots, tutorial, builder (WebView), history list, push, haptics,
phone + tablet adaptive layouts, zh-Hant + en, both stores.

**Out of v1:** replay viewer (v1.1 — same sandbox pattern as the native GameStage), native
builder rebuild (v2), spectating, pass-and-play, any monetization.

## Architecture

```
REUSED AS-IS (packages):  engine · shared · map-data · proto · codec · bots (new, extracted)
PORTED (~5k LOC logic):   store/game · net/rest · net/socket · game/* helpers · i18n · theme
BUILT NATIVE:             board (Skia) · screens · game dock/hand UI · tutorial overlay · animations
EMBEDDED WEBVIEW:         map builder (loads the live web origin)
```

State model unchanged: server snapshots are authoritative; the mobile client mirrors them in
the same zustand `store/game.ts`. Offline games feed the same store through the same
projection (`redactFor` → `viewToSnapshot`), so the game UI cannot tell online from offline —
the pattern the web replay feature already proves.

### Toolchain

- **Expo SDK 56+** (RN 0.85, React 19.2 — same React major as web), New Architecture,
  Hermes, in a new `apps/mobile` Yarn workspace wired into turbo.
- **React Navigation 7** (native-stack). Not Expo Router: few screens, heavily custom UI,
  and SDK 56's Expo Router forks React Navigation's primitives so the two don't mix.
- **`@trm/bots` (new package):** move `apps/server/src/bots/{policy,types}.ts` (pure:
  imports only engine + shared) into `packages/bots`; server imports switch to the package;
  bot tests move with it. No behavior change.
- **Runtime shims** (app entry, all audit-verified): UTF-8 `TextDecoder` polyfill
  (protobuf-es binary codec needs it on Hermes), `@formatjs/intl-pluralrules` (i18next
  zh/en plurals), explicit `ws.binaryType = 'arraybuffer'`. Plus one engine tweak:
  `cloneState`'s `structuredClone` gains a portable fallback (GameState is JSON-safe).

## Components

### 1. Board — Skia canvas (the core new component)

Single Skia `<Canvas>` rendering geography → routes → cities → overlays from the same
`ContentCatalog`/`RouteGeometry` data as the web; the path/slot/tie math in `@trm/map-data`
and `game/boardView.ts` is pure and ports untouched.

- **Gestures:** `react-native-gesture-handler` Pan + Pinch via `Gesture.Simultaneous`,
  transform in Reanimated shared values on the UI thread. Camera-follow and glow-timer
  orchestration port from `Board.tsx`.
- **Hit-testing:** manual (Skia has no per-element onPress): invert the view transform,
  point-in-geometry tests against route slot polygons and city marker radii. Pure
  functions, unit-tested without a device.
- **LOD/labels:** the web's `--inv-scale`/`data-zoom` CSS system becomes derived values from
  the zoom scale (same math, no DOM). Labels via Skia Paragraph API with system CJK fonts
  (PingFang / Noto).
- **Fallback stance:** react-native-svg is the insurance if Skia hits a wall (~600–900
  nodes is borderline but survivable with a single-transform pan). Not planned.

### 2. Screens, layout, tablets

Login → Home → Room → Game → History → Settings, plus Tutorial and Builder. Game UI mirrors
the web's proven tiers, driven by `useWindowDimensions` (never static device class):
compact <700dp = full-bleed board + tabbed bottom dock; 700–1000dp = two-pane;
≥1000dp = three-pane. Orientation unlocked on tablets, portrait-default on phones.
`ios.supportsTablet: true`, no `requireFullScreen` (deprecated/ignored on iPadOS 26); layouts
must tolerate live resizing (iPad multitasking/Stage Manager, Android 16 large-screen rules).

### 3. Auth & networking (server foundation — benefits web too)

- **Body-token refresh:** `POST /auth/refresh` gains a body-token variant (SessionRepo
  rotation is already transport-agnostic). Mobile stores the refresh token in
  `expo-secure-store` (Keychain/Keystore) and single-flights refresh (double rotation trips
  family reuse-detection). Web's cookie path unchanged.
- **Mobile OAuth handoff (one pattern for all redirect providers):** system browser
  (`expo-auth-session` / ASWebAuthenticationSession / Custom Tabs) → existing server OAuth
  flow → mobile-aware callback 302s to a Universal Link / App Link
  (`https://<origin>/m/callback?code=…`) carrying a **one-time code** → app exchanges at
  `POST /auth/mobile/exchange` for `{user, accessToken, refreshToken}`. Server serves
  `apple-app-site-association` + `assetlinks.json` under `/.well-known/`; `trmission://`
  custom scheme as fallback.
- **Google primary path:** native Google Sign-In SDK → ID token →
  existing `POST /auth/oauth/google/credential`, with the verifier's accepted audience
  extended to a list (web + iOS + Android client IDs).
- **Sign in with Apple (Apple 4.8 requirement):** `expo-apple-authentication` → new server
  route verifying Apple identity tokens against Apple JWKS → converges on `resolveAccount`
  email-binding. Hide-My-Email relay addresses are treated as verified emails; they won't
  cross-link with other providers (accepted, documented). Account deletion calls Apple's
  token-revocation endpoint.
- **Account deletion (both stores):** `DELETE /auth/me` — anonymize `matchHistory`
  references, delete the user doc, revoke all sessions. Exposed in-app and via a public web
  URL (declared in Play's Data-safety form).
- **Guest TTL fix:** refresh extends `guestExpiresAt` (activity-based expiry).
- **WS plane:** zero changes (ticket-in-ClientHello is native-safe).

### 4. Offline vs bots

`LocalGameSession` in `apps/mobile` mirrors the server's prepare→commit loop: seed from
`expo-crypto` (randomness stays outside the engine, as on the server), `reduce()` applies
the human's actions, `@trm/bots` `chooseBotAction` drives 1–4 bot seats,
`redactFor(human)` → `viewToSnapshot` feeds the standard game store/GameStage. Persistence
is event-sourced like the server: config + action log appended to expo-sqlite,
digest-verified on resume; a digest mismatch discards the tail. Offline games use bundled
official maps. Airplane-mode posture (Apple 4.2 review): Home offers Play-vs-Bots +
Tutorial offline with a branded offline banner over online features.

On-device GameState holds bot hands in cleartext; offline anti-cheat is an explicit
non-goal (casual, no rankings).

### 5. Push & haptics (direct platform APIs, no SaaS relay)

Server `PushService` speaks **FCM HTTP v1** (service-account JWT — `google-auth-library` is
already a server dependency) and **APNs HTTP/2** (.p8 token auth) directly. Client uses
`expo-notifications` **native** device tokens (`getDevicePushTokenAsync`), registered per
device via new `POST/DELETE /me/devices`. Triggers: **your-turn** (only when the player has
no live sockets — the hub already knows), **game started**, **game over**.
`google-services.json` + APNs entitlements wired via prebuild config. Haptics
(`expo-haptics`): route claim, tunnel reveal, ticket completion, game end — behind a
settings toggle.

### 6. Tutorial (native rebuild)

Curriculum/beat model and local game simulation are pure and port as-is. The DOM spotlight
(`querySelector`/`getBoundingClientRect`) becomes ref-registered targets measured with
`measureInWindow`; coachmarks/Specimens re-render as RN views. Fully offline-capable.

### 7. Builder (embedded WebView)

`react-native-webview` loading the **deployed web origin's** `/maps` — always current, no
store review for builder iterations, zero divergence. Cookie auth works because the WebView
shares the API's origin. Session handoff: native session mints a one-time code → WebView
opens `/auth/mobile-web-handoff?code=…` → server sets the normal refresh cookie → redirects
to `/maps`. Same `mapBuilder` feature gate; entry hidden without it. Google-login-in-WebView
never arises (the session arrives via handoff).

### 8. Ops, lifecycle, compliance

- **Version gate:** `GET /version/mobile` → `{minBuild}` checked at boot → forced-update
  screen. Protects the continuously-deployed server from stale store binaries.
- **Socket lifecycle:** AppState listener — background = expect drop; foreground = re-mint
  ticket + reconnect + resync (existing machinery). NetInfo drives offline UI states.
- **UGC package (Apple 1.2 / Play UGC):** report-player + block-player (client-side mute;
  reports surfaced in the existing dashboard), report-custom-map-by-code, moderation
  contact in store listings. **Recommendation:** land the pending preset-chat-messages plan
  before submission — preset-only chat shrinks the moderation surface dramatically.
- **Store logistics (start immediately — long lead times):** Apple Developer ($99/yr),
  Play Console ($25 once; personal account ⇒ 12-tester × 14-day closed test, org account ⇒
  D-U-N-S), EU DSA trader declaration (non-trader while non-monetized), Play tablet
  screenshots (7" + 10"), age-rating questionnaires.

### 9. Build & release — GitHub Actions, self-managed signing (no EAS)

Continuous Native Generation: `expo prebuild` generates `android/`/`ios/` in CI; never
committed.

- `mobile-ci.yml` (ubuntu): typecheck / lint / jest on PRs, in the turbo pipeline.
- `mobile-android.yml` (ubuntu): prebuild → Gradle `bundleRelease` signed with a keystore
  from GitHub secrets → AAB artifact → on release tags, fastlane `supply` to the Play
  internal track.
- `mobile-ios.yml` (macOS runner): prebuild → fastlane `gym` → fastlane `pilot` to
  TestFlight, App Store Connect API key in secrets. Signing via **fastlane match**
  (certificates encrypted in a private repo). Note: GitHub-hosted macOS runners bill
  minutes at 10× Linux on private repos; a self-hosted Mac runner is a drop-in swap later.
- **Dev loop (Windows workstation):** Android local (`expo run:android` + emulator); iOS
  dev/test builds come off the CI lane and install via TestFlight internal testing.

### 10. OTA — self-hosted expo-updates server (no EAS Update)

`expo-updates` speaks a published protocol and accepts any conforming server. Deploy
**expo-open-ota** (open-source, self-hostable, pluggable storage) as a container beside the
existing server stack, with **update code-signing** enabled using our own certificate baked
into the binary (installed apps only accept bundles we signed). `mobile-ota.yml` runs
`expo export` and publishes JS-only releases; `runtimeVersion` (fingerprint policy)
guarantees an OTA never lands on an incompatible native binary. Apple 3.3.2 compliant
(JS/assets only). Fallbacks: Expo's reference `custom-expo-updates-server`, or store-only
updates — OTA is an optimization, and the forced-update gate works regardless.

## Data flow (deltas only — server flow unchanged)

- **Online game:** REST ticket → WS `ClientHello` → per-viewer snapshots → `store/game` →
  native GameStage. Identical to web minus DOM.
- **Offline game:** UI action → `LocalGameSession.apply` (engine `reduce`) → append action
  to sqlite log → bot turns via `@trm/bots` → `redactFor(human)` → same store → same UI.
- **Auth:** secure-store refresh token → body-token `/auth/refresh` → in-memory access
  token → Bearer REST (unchanged guard). OAuth via system browser + one-time-code deep
  link; Google/Apple native SDKs short-circuit to credential routes.
- **Push:** hub detects turn for a socketless player → PushService → FCM v1 / APNs HTTP/2 →
  device.

## Error handling & edge cases

- **Reconnect:** foregrounding re-mints the 45s ws ticket and resyncs on a fresh snapshot;
  stale `stateVersion` snapshots dropped (existing semantics).
- **Refresh races:** single-flight refresh; on family-reuse revocation → sign-in screen with
  a non-destructive explanation.
- **Offline resume:** digest-verified replay of the local log; mismatch discards the tail
  (never crashes into a corrupt game); storage-full surfaces a "can't save" banner and
  keeps the in-memory game alive.
- **Push permission denied:** app fully functional; turn alerts degrade to in-app only;
  registry entry removed.
- **Forced update:** boot gate shows a store-link screen when `build < minBuild`; OTA
  channel can never bypass `runtimeVersion` compatibility.
- **Deep-link failures:** if Universal/App Link verification is unavailable, the
  `trmission://` scheme fallback completes the OAuth exchange.
- **WebView builder offline:** builder entry shows the offline banner (it requires the live
  origin by design).

## Testing

- Pure logic stays **vitest**: packages (existing golden-replay digest CI gates),
  hit-testing math, LocalGameSession (digest-verified replay tests reusing the golden
  harness), `@trm/bots` extraction (tests move unchanged).
- `apps/mobile` components: **jest-expo** + `@testing-library/react-native` (vitest doesn't
  cover RN).
- Server foundation: extend existing e2e suites (body-token refresh, mobile exchange, SIWA
  verify, deletion, device registry, version gate).
- Manual device matrix pre-submission: small Android phone, Android tablet, iPhone, iPad
  (incl. Stage Manager resize). Maestro E2E smoke flows as a stretch goal.

## Phases (overlapping; ~5–7.5 months to both stores)

| Phase | Work | Duration |
|---|---|---|
| P0 | Server foundation: auth variants, SIWA, deletion, push (FCM/APNs), version gate, guest TTL — parallel with P1 | 4–6 wks |
| P1 | Expo skeleton: workspace, shims, CI workflows, auth screens, lobby | 3–4 wks |
| P2 | Skia board + native game stage (long pole) | 6–8 wks |
| P3 | Offline vs bots | 2–3 wks |
| P4 | Tutorial rebuild | 2–3 wks |
| P5 | Builder WebView, push wiring, haptics, tablet polish, OTA server | 3–4 wks |
| P6 | Compliance, store assets, closed test, signing/release lanes, submission | 2–4 wks |

Play closed test (if personal account) runs during P4–P6. Store accounts, D-U-N-S decision,
and DSA declaration start at P0.

## Risks & mitigations

- **Skia board is new ground** → geometry/hit-test math is pure and pre-testable; SVG
  fallback documented; build the board spike first inside P2.
- **Second UI to maintain forever** → shared packages + ported logic keep rules/protocol
  single-sourced; only the view layer duplicates.
- **IP exposure on commercial storefronts** (Ticket to Ride mechanics reimplementation;
  stores have low-friction takedown channels) → clean-room posture is the defense
  (original map/art/names/rules text; mechanics uncopyrightable); accepted as business
  risk, not technically mitigable.
- **Mid-game continuity:** backgrounding kills sockets; no turn timers/AFK handling exists,
  so a backgrounded player stalls tables → push mitigates in v1; turn-timer/AFK feature
  flagged as a roadmap item (not in this spec's scope).
- **Apple review variance** (4.8 SIWA, 5.1.1(v), 1.2 UGC) → all three addressed
  structurally in P0/P6; preset chat recommended pre-submission.
- **macOS runner cost** → cap iOS CI to release branches/tags; self-hosted Mac runner is a
  drop-in later.

## Out of scope

Replay viewer (v1.1), native builder rebuild (v2), spectating, pass-and-play, turn
timers/AFK handling (separate roadmap item), monetization, Expo Router migration.
