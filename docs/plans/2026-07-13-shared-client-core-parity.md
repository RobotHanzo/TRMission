# Mobile ≥ web: shared headless core + phased parity roadmap

## Context

The mobile app (`apps/mobile`) severely underperforms `apps/web`: whole features missing, barebones
chrome (literal default Expo icon/splash, inconsistent hardcoded styling), tutorial correctness
bugs (no action blockers; missing animations), and unfinished in-game feedback (stale "lands in
Task 10/11" comments). A 26-agent gap analysis (7 explorers → synthesis → adversarial verify; 90
raw findings → 41 deduped gaps) confirmed **18 critical/high gaps + 23 medium/low items**.

**Architecture pivot (user decision, overrides current CLAUDE.md doctrine):** stop duplicating
client code twice. Build a **shared headless core package** — logic/stores/net/tutorial/i18n/tokens
written once — while rendering stays platform-native (DOM/SVG on web, RN/Skia on mobile) wherever
native code wins on performance, aesthetics, or features. Extraction happens as a **prerequisite
phase** so every feature phase builds shared-first. The tutorial byte-copy parity tests
(`parity.spec.ts`) are replaced by real imports. Both Vite and Metro already consume raw-TS
`@trm/*` packages, so the new package is zero bundler infra.

Scope decisions (user): full phased roadmap; random-event overlays, history+replay, encyclopedia,
and spectating all in scope; original branding assets designed in-repo (no copied artwork).

## Phase 1 — Critical tutorial bug fixes (fast, ships before the refactor)

1. **Action-gate enforcement** — root cause:
   [apps/mobile/src/screens/GameStage.tsx:138](apps/mobile/src/screens/GameStage.tsx#L138) ORs the
   gate into one `boardCanAct` flag and never filters targets, vs web's independent flags +
   per-target guards ([web GameStage.tsx:250-321](apps/web/src/screens/GameStage.tsx#L250-L321)).
   - Add a **pure helper** `gateAllowsTarget(gate, kind, id)` in `game/actionGate.ts` (written
     identically on both apps so Phase 2 lifts it into the core unchanged; web's inline guards in
     `pickRoute`/`pickCity` refactor onto it).
   - Mobile GameStage: split `boardCanClaim`/`boardCanBuildStation`; `BoardView` takes both flags
     and dispatches route-taps vs city-taps per kind; wrap `flow.pickRoute`/`flow.pickCity` with
     the helper. `useClaimFlow` stays gate-free.
   - Tests: port `GameStage.gate.test.tsx` semantics to jest-expo; extend
     `TutorialScreen.walkthrough.test.tsx` (CLAIM_ROUTE beat must reject other routes AND all
     cities, and vice versa).
2. **Payment-hint redirect**: add web's `onPendingClaim` to mobile `GameStageProps`;
   `TutorialScreen` tracks it → coachmark `tutorial.payHint` + spotlight
   `TUTORIAL_ANCHORS.paymentOptions` (string + anchor already exist unused).

## Phase 2 — `@trm/client-core` extraction (prerequisite for all feature phases)

New workspace package `packages/client-core` (TS-source exports like `@trm/shared`; depends on
proto/shared/map-data/engine/codec; `react`, `zustand`, `i18next` as **peerDependencies** — first
task: verify web/mobile react + zustand versions are compatible, align if not). Wire turbo, eslint,
vitest. Migrate **one module at a time, both apps' suites green after each move**:

- **Net**: REST client core with a platform adapter (`baseUrl`, credentials mode vs token-in-body
  refresh, token persistence, `x-trm-client` header) — collapses web
  [rest.ts](apps/web/src/net/rest.ts) and mobile [rest.ts](apps/mobile/src/net/rest.ts) including
  all shared types; `GameSocket` factory (URL + `binaryType` config — mobile is already a verbatim
  port).
- **Stores**: game store, session-store core (platform auth methods injected), moderation store,
  preference/ui-prefs shape + `applyPreferences`.
- **Game view logic**: `actionGate` (incl. Phase 1 helper), `useClaimFlow` (its own comment says
  device-independent), payments/tickets/events helpers, `turnStatus()`, `chatPresets`,
  haptic/sound **cue tables**, animation-event derivations.
- **Tutorial core**: `types.ts`, `curriculum.ts` (+ `encyclopediaEntries()`), `focus.ts`,
  `useScenarioPlayer.ts`, tutorial i18n — real imports on both apps; **delete both
  `parity.spec.ts` byte-copy contracts**. Anchor-id strings become a single source of truth (web
  CSS selectors + mobile registry ids).
- **i18n bundles**: zh-Hant/en resources shared as data; each app keeps its own i18next init +
  platform-only keys.
- **Design tokens**: TS token module (light + dark palettes — web already has both via its theme
  setting) as the single source; web gains a parity test `tokens.css` ↔ module (like the existing
  `tokens-parity.test.ts` pattern); mobile consumes directly.
- **Docs**: update root/web/mobile `CLAUDE.md` — replace the "duplicate UI/UX" doctrine with the
  shared-core architecture and the "platform-native rendering where it wins" rule.

## Phase 3 — Branding + design system (the "barebones" fix)

1. `apps/mobile/src/theme` consumes `@trm/client-core` tokens via a `useTheme()` hook keyed on the
   (currently dead) `ui.theme` state + system scheme — **dark mode actually renders**. Kill stray
   `#1f6feb` literals (LoginScreen.tsx:145,156; HomeScreen.tsx:206,218; RoomScreen.tsx:116;
   TutorialScreen.tsx:217) in favour of `--tr-blue #0f5fa6`.
2. **App icon + splash** (currently literal Expo template art): design original vector mark
   (train/rail motif on the map palette), export icon/adaptive-icon/splash PNGs to
   `apps/mobile/assets/`; add `icon`/`splash`/`android.adaptiveIcon`/`userInterfaceStyle` to
   `app.config.ts`; gate boot with `expo-splash-screen` (`preventAutoHideAsync` → `hideAsync`
   after the restore chain).
3. **Chrome restyle** (Home/Login/Room/Settings/Boot/OfflineSetup): brand wordmark (web
   `BrandBanner.tsx` as reference), Login map-backdrop (blur over the existing static
   `MapSceneSkia` picture, mirroring web `MapBackdrop.tsx`), token-driven cards/elevation,
   lucide-react-native icons, real empty/loading/error states.
4. **Native polish** (mobile-only wins): animated native-stack transitions, chrome haptics,
   edge-to-edge + status-bar per theme.

## Phase 4 — Game feel: animations, sound, status

Modal/HUD animation uses plain RN `Animated` (the `TutorialSpotlight.tsx` idiom; Reanimated stays
board/gesture-only). All respect `useReducedMotion`. Cues exist in the shared cue tables — most
gaps are "nothing calls it".

1. **Turn/connection banner**: wire the dead `turnStatus()` into a persistent banner.
2. **Tunnel reveal** (`TunnelModal.tsx`): staggered flip-in + `tunnelDraw`/`tunnelSuccess`/
   `tunnelPayment` cues (mirror web timings).
3. **Ticket flows**: deal-in stagger + sound; fly-to-missions confirm (existing `animTargets`
   registry); ticket-completion confetti.
4. **Endgame** (`ScoreBoard.tsx`): confetti, 5-star rating with per-gameId dedupe + submit,
   Discord CTA; endgame-warning throb. One shared RN confetti component (reused by 3/4 and the
   tutorial finale).
5. **Board feedback on Skia**: market-slot flip-in, turn-cue pulse, route-claim glow bloom,
   station-build pop.
6. **Tutorial visual pass** (`TutorialOverlay.tsx` has zero animation primitives): coachmark
   entrance slide+scale, per-beat specimen/body fades (already `key={beat.id}`-remounted),
   animated progress width, "your turn" pulse, finale pop + confetti; spotlight ring
   glow/breathing; specimen crossfade.
7. **Random-event board overlays** (whole game mode invisible on mobile;
   [BoardView.tsx:286-291](apps/mobile/src/board/BoardView.tsx#L286) admits it): extract web
   `Board.tsx`'s event→overlay **derivations into client-core**, then render mobile-natively in
   `MapSceneSkia`/`RouteLayer` — typhoon swirl + desaturation, reopened chip, sky-lantern/harvest
   highlights, hotspot badge, charter/lucky chips, lantern-host, procession trail, bento/
   night-market badges — LOD-aware, and **outside the cached static Picture** (or invalidating on
   the right slice only).
8. **Cue coverage audit**: diff every web animation/sound event against mobile drivers; close
   silent no-ops (unregistered animTargets).

## Phase 5 — Online lobby parity

Server needs **zero changes** — every endpoint exists.

1. Lobby REST methods/types land in **client-core** (from web
   [rest.ts:358-380](apps/web/src/net/rest.ts#L358-L380)): `addBot`/`removeBot`/`kickPlayer`/
   `spectate`/`watchRoom`/`rejoinRoom`/`transferOwnership`/`closeRoom`/`sendRoomChat`/
   `updateRoomSettings`/`getPublicRooms`; correct types (`RoomMember.isBot?/difficulty?`,
   `RoomChatEntry.presetId?/text?`, `RoomView.spectators`, `RoomSettings`). Web switches to the
   shared client as part of the move. Extract web `RoomScreen`'s `poll()` semantics
   ([web RoomScreen.tsx:104-205](apps/web/src/screens/RoomScreen.tsx#L104-L205)) into a shared
   lobby-polling state machine (CLOSED → home, kicked detection via `wasPresent`, ApiError
   400/403/404 branches, full-room → spectate notice).
2. Mobile `RoomScreen` UI: bot add/remove + difficulty (owner-only); room-settings sheet (map
   picker official/custom, `RULE_TOGGLES` triples from web RoomScreen.tsx:243-260, events-mode,
   visibility, allowSpectating → `PATCH /rooms/:code/settings`; port any missing `setting*`/
   `eventsMode_*`/`visibility_*` i18n keys); lobby chat (shared presets); kick/transfer/close with
   confirm sheets (`PlayerActionSheet` pattern); copy code + native share sheet + deep link
   `trmission://room/CODE` via navigation linking.
3. **Spectating**: public-rooms browser on Home, spectate/watch join flow; mobile GameStage's
   spectator conventions already exist.

## Phase 6 — Missing screens & account lifecycle

1. **History + Replay**: replay-player **logic in client-core** (engine stepping, perspective
   re-projection, silent-seek vs animated-forward semantics — port from web
   `features/replay/useReplayPlayer.ts`; web refactors onto it, suite stays green). Mobile:
   `HistoryScreen` (FlatList) + `ReplayScreen` through the existing sandbox GameStage machinery
   (`redactFor`/`viewToSnapshot`, as `localGameSession`/tutorial already do).
2. **Encyclopedia**: mobile screen consuming the now-shared `encyclopediaEntries()`: chapter list +
   auto-playing sandbox demos with play/pause/step/replay (reuse `sandboxSocket`); entries from
   Home and in-game menu.
3. **Welcome/onboarding** first-run screen (web `WelcomeScreen.tsx` content).
4. **Guest upgrade**: Home card + inline form calling the existing `session.upgrade()`
   ([session.ts:111](apps/mobile/src/store/session.ts#L111)).
5. **Login screen**: honor server auth-config (only enabled methods) + custom guest display name.
6. **Settings completion**: theme/language/colour-blind/sound+volume/board-layout controls — store
   shape already mirrors web; RN controls using web `SettingsModal.tsx` option lists/i18n keys.

## Phase 7 — Performance + verification

1. **Static-map Picture re-record scoping**: re-record only on claim/station/geometry-affecting
   slices, not every gameplay event.
2. **Raster snapshot lifecycle**: explicit disposal (~67MB/settle observed) + fast-fling outrun
   mitigation.
3. **Tutorial spotlight scrim**: cache the parsed Skia path (re-parsed per frame during glides).
4. **Hygiene**: FlatList for chat/log/history, zustand selector granularity, log "jump to latest".
5. **On-device pass** (user-assisted): profile mid-range Android; verify the recent
   texture-compositing/LOD/Picture-cache commits hold on device.

## Cross-cutting rules

- Per phase: `yarn typecheck && yarn lint && yarn test` (all touched workspaces — **web + mobile +
  client-core every time once Phase 2 lands**), then commit (never `git add -A`; stage own files
  only). `graphify update .` after each phase.
- Extraction discipline: move modules verbatim first, de-dupe second; a module move that breaks
  either app's suite doesn't land.
- Plain RN `Animated` for low-frequency UI; Reanimated only for UI-thread board/gesture work;
  never per-frame JS styles. Expo Go guards for new native-module imports (the
  `push/expoNotifications.ts` lazy pattern); new jest mocks follow existing `__mocks__` setup.
- Every new string in zh-Hant (primary) + en. No copied artwork — original assets only. PURPLE
  never PINK; seat colours stay abstract indices. client-core must not import react-dom or
  react-native.

## Verification

- **Phase 1**: jest-expo gate tests + full tutorial lesson on device/Expo Go, attempting
  mis-clicks on every await beat.
- **Phase 2**: entire repo suite (`yarn test`, `yarn typecheck`) after every module move; web
  behavior unchanged (its tests are the regression gate); mobile jest-expo suite green.
- **Phases 3–6**: per-surface manual smoke on device vs a local dev server with the web client in
  the other seat (tutorial, offline game, room: bots/settings/chat/kick/spectate, history/replay,
  settings incl. dark mode + colour-blind).
- **Phase 7**: on-device profiling (user) with before/after frame timings during board gestures
  and event bursts.
