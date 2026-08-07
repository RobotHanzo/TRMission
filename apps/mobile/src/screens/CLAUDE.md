# Screens (`apps/mobile/src/screens/`)

App-wide context: `apps/mobile/CLAUDE.md`. Board internals: `../board/CLAUDE.md`.

## GameStage — the P3/P4 seam (`GameStage.tsx`)

Web-compatible `snapshot`/`commands` (`GameCommands` — live `GameSocket` or the offline/tutorial
sandbox) plus `sandbox`/`frameTarget`/`overlay`/`spotlightCities`/`actionGate`. Adaptive tiers by
width (`stageLayout.ts`): compact <700dp docks the HUD under a full-bleed board; 700–999 two-pane
(rail ↔ comms tabs); ≥1000 three-pane (dedicated comms column). Don't change this surface without
checking the offline (P3, `../offline/CLAUDE.md`) and tutorial (P4, `../features/tutorial/CLAUDE.md`)
callers.

**The dock has no Draw tab** (issue #79; the web still splits one out). Each deck sits in the tab
holding what it deals: the train-card deck + face-up market head the **Cards** tab above the hand,
and the mission deck's draw button closes the **Missions** tab under the kept missions. Two things
follow. The market stays FIRST in the Cards tab so a tutorial/demo spotlight on it is never pushed
below the dock's fold, and the hand under it collapses to `PlayerHand`'s brief reading
(`../components/game/CLAUDE.md`) so both fit. Whenever a beat's expected action names a deck, the
tab it opens must match: the gate effect here and `EncyclopediaScreen`'s `HUD_SELECTOR_TAB` are the
two places that map, and both key off the curriculum's own selector/expect strings.

**Drivers** mounted once in GameStage: `useAnimationDriver` (store→store; card flights/sweeps/
floats/banners render in `components/game/AnimationLayer.tsx` via the measured `animTargets`
registry), `useSoundDriver` (a binding of the shared driver in `@trm/client-core/sound` over the
expo-audio `SoundPlayer` — SDK 56 removed expo-av), and `useHaptics` (`../game/CLAUDE.md`).

Live Activities are driven from **GameScreen**, never GameStage (the offline sandbox and tutorial
also render GameStage) — see `apps/mobile/modules/live-activity/CLAUDE.md`.

## First entry (`WelcomeScreen.tsx` + `../HomeRoot.tsx`, issue #59)

The `Home` root-stack route renders **`HomeRoot`**, not `HomeTabs`: it reads the tutorial-completion
and per-account `trm.welcome.seen.v1` flags, then mounts either the welcome takeover or the tab bar
(paper-blank for the frame in between, so neither surface flashes). Every path out of the takeover
writes the seen flag. Keep the takeover **outside** the tab navigator — onboarding asks a question
with three answers on screen, and a tab bar under it offers four more destinations that all silently
skip it. That placement is also what keeps first-run ad-free (see Ads below) by construction.

## Map builder (`BuilderScreen.tsx`)

Feature-gated by `user.features` containing `mapBuilder` (`useCanBuild`). The builder itself is
the web app inside a `react-native-webview` (`sharedCookiesEnabled` + `thirdPartyCookiesEnabled`):
the screen fetches a single-use carry code (`api.mobileCarry()`) and points the WebView at
`GET ${SERVER_ORIGIN}/api/v1/auth/mobile-web-handoff?code=…`, which converts it into a normal
Strict-cookie web session and 302s to `/maps` — the one sanctioned native→web session handoff.
Offline/error/loading states have testIDs `builder-offline`/`builder-error`.

## Settings (`SettingsScreen.tsx` + `settings/`, issue #47)

A grouped **index** plus one pushed page per group, all inside the Settings tab's **own native
stack** (`settings/SettingsNavigator.tsx`, routes in `SettingsStackParamList`). Nested in the tab,
not the root stack, so drilling in keeps the floating tab bar — and the six leaf routes stay out of
the root param list. Header theming mirrors `navigation.tsx` (Liquid Glass on iOS); the index hides
the header because it carries its own title.

`SettingsScreen` is the index only. Every row states its **current value** next to a dashed
timetable leader (the `theme/gameChrome` idiom), so the added layer hides no answer — keep that
property when adding a group. **Help & support is the one row that isn't a pushed page**: it opens
the web app's `/support` (`../support.ts`) in an in-app browser, the same way `../legal.ts` opens
the policy pages — that page is the App Store / Play support URL, so its FAQ and contact form live
in exactly one place rather than being reimplemented natively. Pages: `AppearanceScreen`, `SoundScreen`, `NotificationsScreen`,
`PrivacyScreen`, `AccountScreen`, `AboutScreen`, built from `settings/chrome.tsx`
(`SettingsPage` / `SettingsGroup` / `SettingsRow` / `ChoiceRow` / `NavRow`). About's `UpdateRow` is
the on-demand OTA check (`../ota.ts`, mechanism in `docs/mobile/ota.md`) — the same check the app
runs at every cold start, collapsed into one press plus an opt-in restart.

Rows divide themselves with a top hairline unless passed `first`, so a group whose members are
conditionally hidden (`AdPrivacyRow`, the `adFree` switch, `LiveActivityRow`) must have the
**screen** decide which one leads — see `PrivacyScreen`. Store behind the rows:
`../store/CLAUDE.md`; the ad rows: `../ads/CLAUDE.md`; the quiet-while-playing rule:
`../push/CLAUDE.md`.

## Lobby game settings (`room/RoomSettingsPanel.tsx`, issue #64)

The room's settings are the same layered board, built from the **same `settings/chrome.tsx`
primitives** — index rows stating each group's current value, one page per group. Which groups
exist, their order, and how each value reads come from `@trm/client-core`'s `roomSettingsMenu`,
shared with `apps/web`'s `components/RoomSettingsPanel.tsx`; only the rendering is per-platform.
A group's page is a **Modal, not a pushed route**: `RoomScreen` owns the poll that keeps
`settings` live, so the page has to render inside it. Everyone can open a group and read it —
`locked` (non-host, or a started room) makes the controls read-only rather than hiding them, and
the index says why.

## Ads

`<AdBanner />` docks on the four **browse** screens only — Home (the welcome takeover is a separate
screen and never gets one), `EncyclopediaIndex` (not the player), Leaderboard, History — and
`OfflineGameScreen` fires the one
interstitial when a FINISHED game is left. Every other screen is deliberately ad-free; that list is
a policy boundary, so read `../ads/CLAUDE.md` before adding a placement.
