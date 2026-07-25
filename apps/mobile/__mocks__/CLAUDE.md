# Jest mocks (`apps/mobile/__mocks__/`)

App-wide context: `apps/mobile/CLAUDE.md`. Test split: pure logic is vitest `*.spec.ts`, RN
components are jest-expo `*.test.tsx` — keep the globs disjoint. jest stays on **29**
(`jest-expo@56` is a jest-29 preset).

- Hand-rolled mocks for `@shopify/react-native-skia` (component stubs + truthy `SkPath`) and
  `lucide-react-native` (Proxy stubs — it ships `.mjs` outside the transform), the official
  `react-native-reanimated/mock`, and a composed `../jest.resolver.js` (worklets
  `.native`-extension strip + the RN resolver) so reanimated 4 imports run under jest-expo.
  gesture-handler is covered by jest-expo's own setup.
- `expo.js` forces `isRunningInExpoGo()` false under jest (jest-expo's own native-module automock
  otherwise reports `ExpoGo` present) while delegating every other export to the real `expo`
  package — don't narrow that mock further without checking who else imports from `expo`
  (e.g. `expo-sqlite` pulls `requireNativeModule` through it). Why the Expo Go gate exists:
  `../src/push/CLAUDE.md`.
