# iOS Liquid Glass bottom tab bar

## Context

The earlier change this session (commit `4aabddd`) put a translucent/blurred treatment on the
**top** native-stack header for pushed screens. The user clarified with a screenshot (GitHub
Mobile) that what they actually want is a **floating bottom tab bar** — the native iOS 26 Liquid
Glass tab bar (rounded pill, translucent, icons+labels, e.g. Home/Inbox/Explore/Copilot) — as the
primary way to reach the homepage's sibling pages, not a header tweak.

User decisions made this session:
- Tab set: **Home, Encyclopedia, Leaderboard, Settings** (4 tabs). History stays a push-in from
  Home, same as Room/Game/Replay/Builder today.
- Build it on **real native Liquid Glass** (not a JS/BlurView lookalike): `react-native-bottom-tabs`
  (Callstack) renders an actual native `UITabBarController` on iOS — which iOS 26 automatically
  renders with its system Liquid Glass material, no manual opt-in — and a Material3 tab bar on
  Android. Confirmed via its CHANGELOG or `usage-with-react-navigation.mdx`
  (`callstack/react-native-bottom-tabs` GitHub repo): `tabBarInactiveTintColor` is ignored on iOS≥26
  because the system owns Liquid Glass tinting/glow, `minimizeBehavior` and `renderBottomAccessoryView`
  are iOS-26-specific, matching the screenshot's floating "New Session" accessory.

This trades higher fidelity for higher risk: it adds real native (Swift/Kotlin) code, needs an Expo
prebuild + a real device/CI build to verify (unavailable from this Windows session — same residual
gap already flagged for the Liquid Glass `.icon` and header work), and — critically — native tab
bars don't run in a browser, so the project's `react-native-web` Playwright test harness
(`yarn workspace @trm/mobile web`, used heavily for agent-driven testing per `apps/mobile/CLAUDE.md`)
needs a plain-JS fallback tab bar just to keep working at all.

## Key library facts (verified via npm + GitHub, since these packages aren't installed yet)

- `react-native-bottom-tabs@1.4.0` (peer: `react`, `react-native` — permissive) — the native tab
  bar primitive. Ships an `app.plugin.js` Expo config plugin (must register it in `app.config.ts`).
- `@bottom-tabs/react-navigation@1.4.0` — the React Navigation adapter:
  `createNativeBottomTabNavigator()`. Peer: `@react-navigation/native >=7` (currently resolved
  `7.3.7`; the OTHER new peer requirement below needs `>=7.3.13`, so bump the range).
- `@react-navigation/bottom-tabs@7.18.13` (peer: `@react-navigation/native ^7.3.13`,
  `react-native-screens >=4.0.0` — we have 4.25.2) — the classic JS-rendered tab bar, used **only**
  as the web-platform fallback (per the library's own `web-platform-support.md`: "uses native
  platform primitives... not available on web").
- Icons: `tabBarIcon` returns an `ImageSource`/`AppleIcon`, not a React element — lucide-react-native
  components can't be passed directly. Use `{ sfSymbol: 'house' }` etc. on iOS (zero asset cost, and
  what makes the Liquid Glass tint/glow work correctly per the docs), and a small pre-generated PNG
  per tab for Android + the web fallback.
- Bump `@react-navigation/native` (`^7.1.6` → `^7.3.13`) and keep `@react-navigation/native-stack`
  aligned; re-run `yarn install`.

## Architecture

Follow the project's existing `.native`/`.web` Metro-split convention (already used for
`net/secureStore`, `board/BoardCanvas`, etc. — see `apps/mobile/CLAUDE.md`) so only the tab-bar
component itself forks, not all of `navigation.tsx`:

- **New** `apps/mobile/src/navigation/HomeTabs.tsx` (native): `createNativeBottomTabNavigator()`
  with 4 `Tab.Screen`s — Home/`HomeScreen`, Encyclopedia/`EncyclopediaScreen`,
  Leaderboard/`LeaderboardScreen`, Settings/`SettingsScreen`. `tabBarIcon` per screen:
  `Platform.OS === 'ios' ? { sfSymbol: '<name>' } : require('<generated png>')`. No
  `renderBottomAccessoryView` for now — TRMission has no single obvious universal primary action
  like GitHub's "New Session"; skip it rather than force one in.
- **New** `apps/mobile/src/navigation/HomeTabs.web.tsx`: the same 4 screens via
  `@react-navigation/bottom-tabs`'s `createBottomTabNavigator()` — plain JS tab bar, PNG icons only
  (no glass, no sfSymbol), purely so the RNW Playwright harness keeps reaching these 4 screens.
- **`navigation.tsx`**: the outer `Stack.Navigator` keeps its current shape unchanged. The `"Home"`
  `Stack.Screen`'s `component` changes from `HomeScreen` to the new `HomeTabs` (imported from
  `./navigation/HomeTabs`; Metro resolves native vs. `.web` automatically). Route name stays
  `"Home"` — preserves `navigation.navigate('Home')` in
  `features/tutorial/TutorialScreen.tsx:172` and the `linking` config in `App.tsx` (which only maps
  `Room: 'room/:code'`, untouched). `headerShown: false` stays.
- Room/Game/OfflineSetup/OfflineGame/Tutorial/Builder/History/Replay stay exactly where they are in
  the outer stack. Standard React Navigation nested-navigator bubbling means
  `navigation.navigate('Room', ...)` called from inside `HomeScreen` (now nested
  Stack → Tabs → Home) still resolves to the outer stack's `Room` screen and replaces the whole
  surface — i.e. the floating tab bar disappears while in Room/Game/etc., matching how GitHub hides
  its tab bar behind a pushed PR view. No linking/back-behavior changes needed.
- Icon assets: extend `apps/mobile/scripts/gen-brand-assets.js` (reuses its existing
  `@resvg/resvg-js` pipeline) to emit 4 small single-colour template PNGs — house (Home), book
  (Encyclopedia — same glyph the old pill row used for it), trophy (Leaderboard), gear (Settings) —
  for Android + the web fallback's `tabBarIcon`.
- Expo config: add `react-native-bottom-tabs`'s `app.plugin.js` to `app.config.ts`'s `plugins`
  array so `expo prebuild` wires native autolinking.

## Cleanup from the previous (superseded) change

`useGlassHeaderPad()` + the conditional spacer `View` are now dead weight in the 3 screens that
become tab roots — once `SettingsScreen`/`LeaderboardScreen`/`EncyclopediaScreen` render under
`createNativeBottomTabNavigator` instead of the outer native-stack, there's no `HeaderHeightContext`
ancestor, so the hook always resolves to 0. Remove the hook call + spacer from those 3 files.
**Keep it** in `RoomScreen.tsx`, `HistoryScreen.tsx`, `ReplayScreen.tsx`, `BuilderScreen.tsx` — they
stay pushed screens in the outer stack and still get the translucent glass **header** from the
previous commit (that part of the earlier work is still correct/wanted, just not what the user was
picturing for Home's own siblings).

Trim `HomeScreen.tsx`'s bottom `linkPills` row: drop the Encyclopedia/Leaderboard/Settings entries
(now reachable from the tab bar directly — duplicating them as in-content links would be confusing,
same reason GitHub doesn't also link to Explore from inside its Home feed). Keep History + Builder
(still push-only / feature-gated, no tab slot).

## Content insets under the floating bar

`react-native-bottom-tabs`'s own docs say tab content is auto-inset for the bar height (no manual
offset needed for typical ScrollView/FlatList content); `useBottomTabBarHeight()` /
`BottomTabBarHeightContext` are available if a screen needs to manually place something above the
bar. Don't add manual bottom padding anywhere pre-emptively — verify on-device first, and only reach
for the hook if content is actually seen clipped under the bar.

## Verification (what I can and can't confirm from here)

- `yarn workspace @trm/mobile typecheck` / `lint` / `test` (full suite) after the change.
- Run the RNW web harness and Playwright-drive it to confirm Home/Encyclopedia/Leaderboard/Settings
  are still reachable via the JS fallback tab bar (functional smoke — glass isn't expected on web).
- **Cannot verify from this session**: actual Liquid Glass rendering on iOS 26, native module
  linking under Expo SDK 56 / RN 0.85 (the library's own devDependency pin is RN 0.81 — peer range
  is permissive but untested by us against 0.85), the Expo config-plugin/prebuild wiring, and tab
  bar content-inset correctness on a real notch/home-indicator device. Needs the `mobile-ios.yml` /
  `mobile-android.yml` CI build plus a real device or simulator pass, same residual-risk shape as
  the two previous iOS-chrome changes this session.
