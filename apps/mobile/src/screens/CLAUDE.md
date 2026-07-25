# Screens (`apps/mobile/src/screens/`)

App-wide context: `apps/mobile/CLAUDE.md`. Board internals: `../board/CLAUDE.md`.

## GameStage — the P3/P4 seam (`GameStage.tsx`)

Web-compatible `snapshot`/`commands` (`GameCommands` — live `GameSocket` or the offline/tutorial
sandbox) plus `sandbox`/`frameTarget`/`overlay`/`spotlightCities`/`actionGate`. Adaptive tiers by
width (`stageLayout.ts`): compact <700dp docks the HUD under a full-bleed board; 700–999 two-pane
(rail ↔ comms tabs); ≥1000 three-pane (dedicated comms column). Don't change this surface without
checking the offline (P3, `../offline/CLAUDE.md`) and tutorial (P4, `../features/tutorial/CLAUDE.md`)
callers.

**Drivers** mounted once in GameStage: `useAnimationDriver` (store→store; card flights/sweeps/
floats/banners render in `components/game/AnimationLayer.tsx` via the measured `animTargets`
registry), `useSoundDriver` (expo-audio port — SDK 56 removed expo-av; same `SoundPlayer` interface
as web), and `useHaptics` (`../game/CLAUDE.md`).

Live Activities are driven from **GameScreen**, never GameStage (the offline sandbox and tutorial
also render GameStage) — see `apps/mobile/modules/live-activity/CLAUDE.md`.

## Map builder (`BuilderScreen.tsx`)

Feature-gated by `user.features` containing `mapBuilder` (`useCanBuild`). The builder itself is
the web app inside a `react-native-webview` (`sharedCookiesEnabled` + `thirdPartyCookiesEnabled`):
the screen fetches a single-use carry code (`api.mobileCarry()`) and points the WebView at
`GET ${SERVER_ORIGIN}/api/v1/auth/mobile-web-handoff?code=…`, which converts it into a normal
Strict-cookie web session and 302s to `/maps` — the one sanctioned native→web session handoff.
Offline/error/loading states have testIDs `builder-offline`/`builder-error`.

## Settings (`SettingsScreen.tsx`)

Rows and the store behind them: `../store/CLAUDE.md`.
