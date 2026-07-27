# Web harness internals (`apps/mobile/src/web/`)

App-wide context: `apps/mobile/CLAUDE.md` (how to run it, and the rules for driving it with
Playwright). This doc is how the react-native-web bundle is _built_. **It is a test surface, not a
shipped one** — never trade native quality for it.

## Entry ordering (`index.ts` web branch)

CanvasKit must finish loading before the app graph EVALUATES (Skia's web modules read
`global.CanvasKit` at import), so App is `require`d only after `LoadSkiaWeb` resolves.
`scripts/setup-web.js` copies `canvaskit.wasm` → `public/` (gitignored); the `web` script runs it
automatically. Sentry init is skipped entirely on this surface.

## Alerts (`alertShim.ts`)

RNW's `Alert.alert` is a silent no-op, so `alertShim.ts` (installed from the web entry branch) maps
it onto `window.confirm`/`window.alert` — OK runs the LAST non-cancel button, Cancel the
`style: 'cancel'` one.

## Platform splits

Metro resolves `.web.ts(x)` on web; jest/native never see them — they're typechecked standalone.
Each is documented in its own area's doc:

| Split                                             | Doc                            |
| ------------------------------------------------- | ------------------------------ |
| `net/secureStore.web.ts`                          | `../net/CLAUDE.md`             |
| `offline/localStore.web.ts`                       | `../offline/CLAUDE.md`         |
| `screens/builderWebView.web.tsx` (iframe)         | `../screens/CLAUDE.md`         |
| `board/BoardCanvas.web.tsx` + `board/webFonts.ts` | `../board/CLAUDE.md`           |
| `components/game/CardRowScroll.web.tsx`           | `../components/game/CLAUDE.md` |
| `ads/googleMobileAds.web.ts`                      | `../ads/CLAUDE.md`             |

Gated to `null` on web like under Expo Go: `push/expoNotifications.ts`, `auth/googleSigninModule.ts`.
Apple auth needs no gate (`requireOptionalNativeModule` stub; `isAvailableAsync()` → false).

**`ads/googleMobileAds.web.ts` must stay a real file split**, not just a `Platform.OS` branch: Metro
still resolves the `require()` inside such a branch when bundling for web, and
`react-native-google-mobile-ads` imports `react-native/Libraries/…` internals that Expo's web
resolver rejects — the whole web bundle fails to build.
