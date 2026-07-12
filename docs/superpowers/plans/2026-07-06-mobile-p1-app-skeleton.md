# Mobile P1 — Expo App Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **REGROUND BEFORE EXECUTING:** this plan was written at spec time (2026-07-06). Before executing, re-verify the current Expo SDK / React Native / React Navigation versions (the plan pins SDK 56 / RN 0.85 / React 19.2 / RN-Navigation 7 — bump to whatever is current-stable and adjust peer ranges), and re-verify the web `net/rest.ts`, `net/socket.ts`, and `store/session.ts` anchors named in each task (P0 already reshaped auth; a later refactor may move lines). Everything else — the P0 server contracts, the monorepo pins, the shim list — is stable.

**Goal:** Stand up `apps/mobile` — an Expo React Native app that reuses the pure-TS packages, authenticates against the P0 mobile server surface (guest / password / Google / Apple / Discord), sits an authenticated user in a lobby room on-device, registers for push, and ships three GitHub Actions build lanes — ending at a placeholder game screen that P2 replaces.

**Architecture:** A new Yarn workspace consuming the TS-source internal packages through Metro's monorepo + package-exports resolution (no build step, matching how Vite consumes them for web). The net layer is a faithful port of the web client with two deltas: an **absolute** API/WS base (the app is not served same-origin) and the **token-in-body** refresh transport (P0-a `x-trm-client: mobile`) backed by `expo-secure-store` instead of a cookie. Auth screens drive the P0 credential/handoff routes. React Navigation 7 native-stack (not Expo Router — few screens, heavily custom UI, and SDK 56's Expo Router forks React Navigation's primitives). CI uses Continuous Native Generation (`expo prebuild` in the workflow; `android/`/`ios/` never committed) with self-managed signing — no EAS.

**Tech Stack:** Expo SDK 56 (RN 0.85, React 19.2, New Architecture, Hermes), React Navigation 7 native-stack, zustand + immer, react-i18next + `@formatjs/intl-pluralrules`, `expo-secure-store`, `expo-auth-session`, `expo-apple-authentication`, `@react-native-google-signin/google-signin`, `expo-notifications`, `expo-linking`, `@react-native-community/netinfo`, `@bufbuild/protobuf` + `@trm/*` workspace packages; jest-expo + `@testing-library/react-native`; GitHub Actions + fastlane (match/gym/pilot/supply).

## Global Constraints

- **Yarn 4, `nodeLinker: node-modules`** (already set in `.yarnrc.yml`) — Metro cannot resolve PnP; this is the required linker. Workspace deps materialize as symlinks Metro reads via `watchFolders`.
- **Metro package-exports ON** (default RN ≥ 0.79 / Metro ≥ 0.82) — the `@trm/*` packages and `@bufbuild/protobuf` publish `exports` maps with no `main` fallback, so exports resolution is mandatory. Do not disable `resolver.unstable_enablePackageExports`.
- **Three runtime shims are load-bearing** (audit-verified): a UTF-8 `TextDecoder` polyfill (protobuf-es binary codec needs it on Hermes), `@formatjs/intl-pluralrules` (i18next zh/en plurals — Hermes `Intl.PluralRules` is incomplete), and `ws.binaryType = 'arraybuffer'` (RN defaults it to `undefined`). Plus the engine `cloneState` `structuredClone` fallback.
- **Mobile client header is `x-trm-client: mobile`**; the OAuth deep-link path is exactly **`/m/callback`**; custom scheme is **`trmission://`** — these strings match the landed P0 server.
- **No EAS, no Expo push service, no SaaS** — builds via GitHub Actions + fastlane match; OTA (P5) is self-hosted; push (P0 server) is direct FCM/APNs. The app only _registers native device tokens_.
- **6th card colour is PURPLE** everywhere (never PINK). Seat colours are abstract indices 0–4, coloured client-side. **zh-Hant primary + en fallback.**
- Never `git add -A` — stage only the files each task lists (this worktree is shared).
- Engine purity holds: no `Date`/`Math.random`/unseeded randomness reaches `@trm/engine`; the `cloneState` fallback must keep golden-replay digests byte-identical.

---

### Task 1: Workspace scaffold + turbo wiring

**Files:**

- Create: `apps/mobile/package.json`, `apps/mobile/app.config.ts`, `apps/mobile/tsconfig.json`, `apps/mobile/babel.config.js`, `apps/mobile/index.ts`, `apps/mobile/App.tsx`, `apps/mobile/.gitignore`
- Modify: `package.json` (root — confirm `apps/*` is in `workspaces`), `turbo.json` (ensure `test`/`typecheck`/`lint` pipelines reach the new workspace)
- Modify: `.gitignore` (root — ignore `apps/mobile/{android,ios,.expo}`)

**Interfaces:**

- Produces: workspace **`@trm/mobile`** with scripts `start`/`android`/`ios`/`typecheck`/`lint`/`test`; `expo.extra.serverOrigin` + `expo.extra.buildNumber` read via `expo-constants` in Task 3.

- [ ] **Step 1: Confirm the workspace glob + create the package manifest**

Read root `package.json` `workspaces` — it globs `apps/*` and `packages/*` already (web/admin/server live there). Create `apps/mobile/package.json`:

```json
{
  "name": "@trm/mobile",
  "version": "0.0.0",
  "private": true,
  "main": "index.ts",
  "scripts": {
    "start": "expo start",
    "android": "expo run:android",
    "ios": "expo run:ios",
    "prebuild": "expo prebuild --clean",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src",
    "test": "jest"
  },
  "dependencies": {
    "@trm/codec": "workspace:*",
    "@trm/engine": "workspace:*",
    "@trm/map-data": "workspace:*",
    "@trm/proto": "workspace:*",
    "@trm/shared": "workspace:*",
    "@bufbuild/protobuf": "^2.12.1",
    "@formatjs/intl-pluralrules": "^5.4.4",
    "@react-native-async-storage/async-storage": "^2.2.0",
    "@react-native-community/netinfo": "^11.4.1",
    "@react-navigation/native": "^7.1.6",
    "@react-navigation/native-stack": "^7.3.10",
    "@react-native-google-signin/google-signin": "^15.0.0",
    "expo": "~56.0.0",
    "expo-apple-authentication": "~8.0.0",
    "expo-auth-session": "~7.0.0",
    "expo-constants": "~18.0.0",
    "expo-crypto": "~15.0.0",
    "expo-linking": "~8.0.0",
    "expo-notifications": "~0.32.0",
    "expo-secure-store": "~15.0.0",
    "expo-status-bar": "~3.0.0",
    "i18next": "^24.2.0",
    "immer": "^10.1.1",
    "react": "19.2.0",
    "react-dom": "19.2.0",
    "react-i18next": "^15.4.0",
    "react-native": "0.85.0",
    "react-native-safe-area-context": "^5.6.0",
    "react-native-screens": "^4.16.0",
    "zustand": "^5.0.2"
  },
  "devDependencies": {
    "@testing-library/react-native": "^13.0.0",
    "@types/react": "~19.2.0",
    "eslint": "^9.0.0",
    "jest": "^30.0.0",
    "jest-expo": "~56.0.0",
    "typescript": "^5.7.3"
  }
}
```

(At reground, run `npx create-expo-app@latest --template` in a scratch dir to read the exact current peer versions and reconcile — pin to what `expo install --check` accepts for the current SDK. The workspace `@trm/*` + protobuf lines are stable.)

- [ ] **Step 2: app.config.ts (identity, scheme, plugins, extra)**

```ts
import type { ExpoConfig } from 'expo/config';

// Build number is the forced-update gate axis (compared against GET /version/mobile.minBuild).
// Bump it on every store submission; keep it in lockstep with versionCode/buildNumber in P6.
const BUILD_NUMBER = 1;

const config: ExpoConfig = {
  name: 'TRMission',
  slug: 'trmission',
  scheme: 'trmission', // trmission:// OAuth deep-link fallback (P0 accepts it)
  version: '0.1.0',
  orientation: 'default', // tablets unlock; phone default is portrait (enforced per-screen in P2)
  newArchEnabled: true,
  ios: {
    bundleIdentifier: 'tw.trmission.app',
    supportsTablet: true, // iPad; requireFullScreen deliberately unset (iPadOS 26 ignores it)
    associatedDomains: ['applinks:trmission.example'], // real origin filled in P6
  },
  android: {
    package: 'tw.trmission.app',
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: [{ scheme: 'https', host: 'trmission.example', pathPrefix: '/m/callback' }],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
  },
  plugins: [
    'expo-secure-store',
    'expo-apple-authentication',
    ['@react-native-google-signin/google-signin', {}],
    'expo-notifications',
  ],
  extra: {
    serverOrigin: process.env.TRM_SERVER_ORIGIN ?? 'http://localhost:3001',
    buildNumber: BUILD_NUMBER,
  },
};

export default config;
```

- [ ] **Step 3: tsconfig, babel, entry, placeholder App**

`apps/mobile/tsconfig.json`:

```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": { "strict": true, "jsx": "react-jsx", "skipLibCheck": true },
  "include": ["src", "App.tsx", "index.ts", "app.config.ts"]
}
```

`apps/mobile/babel.config.js`:

```js
module.exports = (api) => {
  api.cache(true);
  return { presets: ['babel-preset-expo'] };
};
```

`apps/mobile/index.ts` (shims MUST import before anything touches protobuf/i18n — Task 2 fills `./src/shims`):

```ts
import './src/shims';
import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
```

`apps/mobile/App.tsx` (temporary — replaced in Task 8):

```tsx
import { StatusBar } from 'expo-status-bar';
import { Text, View } from 'react-native';

export default function App() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>TRMission</Text>
      <StatusBar style="auto" />
    </View>
  );
}
```

`apps/mobile/.gitignore` and a root `.gitignore` line: `apps/mobile/android/`, `apps/mobile/ios/`, `apps/mobile/.expo/`.

- [ ] **Step 4: Install + typecheck the empty workspace**

Run: `yarn install`
Run: `yarn workspace @trm/mobile typecheck`
Expected: PASS (empty `src`; App.tsx compiles).

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/package.json apps/mobile/app.config.ts apps/mobile/tsconfig.json apps/mobile/babel.config.js apps/mobile/index.ts apps/mobile/App.tsx apps/mobile/.gitignore .gitignore package.json turbo.json yarn.lock
git commit -m "feat(mobile): scaffold the Expo app workspace"
```

---

### Task 2: Metro monorepo config + runtime shims + engine clone fallback

**Files:**

- Create: `apps/mobile/metro.config.js`, `apps/mobile/src/shims.ts`, `apps/mobile/src/shims.test.ts`
- Modify: `packages/engine/src/serialize.ts` (`cloneState` structuredClone fallback)

**Interfaces:**

- Produces: a Metro config that resolves `@trm/*` TS source from the repo root; `src/shims.ts` (side-effecting) installing `TextDecoder` + `Intl.PluralRules`; `cloneState` that runs on Hermes.
- Consumes: `@trm/engine`'s `cloneState`, `@bufbuild/protobuf` binary codec.

- [ ] **Step 1: Metro config (monorepo watchFolders + node_modules roots + exports)**

`apps/mobile/metro.config.js`:

```js
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);
// Watch the whole monorepo so Metro picks up the TS-source @trm/* packages.
config.watchFolders = [workspaceRoot];
// Resolve deps from the app first, then the hoisted root — Yarn node-modules layout.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// The @trm/* packages export raw TS via an `exports` map with no `main` — exports resolution
// (default on modern Metro) is required. Assert it rather than assume, to fail loud on a bump.
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
```

- [ ] **Step 2: Write the failing shim test**

`apps/mobile/src/shims.test.ts`:

```ts
import './shims';

describe('runtime shims', () => {
  it('provides a UTF-8 TextDecoder (protobuf-es needs it on Hermes)', () => {
    const bytes = new TextEncoder().encode('台鐵任務');
    expect(new TextDecoder('utf-8').decode(bytes)).toBe('台鐵任務');
  });

  it('provides Intl.PluralRules (i18next plurals)', () => {
    expect(typeof Intl.PluralRules).toBe('function');
    expect(new Intl.PluralRules('en').select(1)).toBe('one');
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `yarn workspace @trm/mobile test shims`
Expected: FAIL (jsdom-less RN env: `TextDecoder` and/or `Intl.PluralRules` absent, or the file doesn't exist yet).

- [ ] **Step 4: Implement `src/shims.ts`**

```ts
// Load-bearing on Hermes — imported first from index.ts, before any protobuf/i18n use.
import '@formatjs/intl-pluralrules/polyfill';
import '@formatjs/intl-pluralrules/locale-data/en';
import '@formatjs/intl-pluralrules/locale-data/zh';

// protobuf-es's binary codec lazily reaches for globalThis.TextEncoder/TextDecoder.
// Hermes ships TextEncoder but not a spec TextDecoder. Provide a minimal UTF-8 one.
import { TextDecoder as PolyfillTextDecoder } from '@bufbuild/protobuf/wire'; // fallback if present

if (typeof globalThis.TextDecoder === 'undefined') {
  // Prefer a real polyfill package at reground (e.g. @bacons/text-decoder or fast-text-encoding);
  // this inline decoder covers the UTF-8 path protobuf-es exercises. Verify at reground that the
  // chosen package registers TextDecoder('utf-8', { fatal: true }) — protobuf-es constructs that.
  globalThis.TextDecoder = PolyfillTextDecoder as unknown as typeof TextDecoder;
}
```

(Reground note: if `@bufbuild/protobuf/wire` does not re-export a decoder in the then-current version, add `@bacons/text-decoder` to deps and `import '@bacons/text-decoder/install'` here — the CONTRACT is "a global `TextDecoder` that decodes UTF-8 with `{ fatal: true }`". The test in Step 2 is the gate.)

- [ ] **Step 5: Engine `cloneState` Hermes fallback**

Read `packages/engine/src/serialize.ts` `cloneState`. Replace the bare `structuredClone(state)` with a guarded fallback (GameState is documented JSON-safe):

```ts
// structuredClone is absent on Hermes (RN). GameState is JSON-safe by construction, so a
// JSON round-trip is an exact clone there. Digests stay byte-identical (golden-replay gate).
const clone = <T>(v: T): T =>
  typeof structuredClone === 'function' ? structuredClone(v) : (JSON.parse(JSON.stringify(v)) as T);

export function cloneState(state: GameState): GameState {
  return clone(state);
}
```

- [ ] **Step 6: Run engine goldens + shim test**

Run: `yarn workspace @trm/engine test`
Expected: PASS (golden-replay digests unchanged — the JSON path only runs where structuredClone is absent; on Node it still uses structuredClone).
Run: `yarn workspace @trm/mobile test shims`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/metro.config.js apps/mobile/src/shims.ts apps/mobile/src/shims.test.ts packages/engine/src/serialize.ts
git commit -m "feat(mobile): Metro monorepo config + Hermes runtime shims"
```

---

### Task 3: Config module + i18n bootstrap

**Files:**

- Create: `apps/mobile/src/config.ts`, `apps/mobile/src/i18n/index.ts`, `apps/mobile/src/i18n/index.test.ts`

**Interfaces:**

- Produces: `SERVER_ORIGIN: string`, `API_BASE = ${SERVER_ORIGIN}/api/v1`, `WS_URL = ${ws-scheme}://…/ws`, `BUILD_NUMBER: number` (from `expo-constants` extra); `i18n` initialized with zh-Hant primary + en, `compatibilityJSON` set for the pluralrules shim. **P2 consumes `SERVER_ORIGIN`; P5 consumes `SERVER_ORIGIN`.**

- [ ] **Step 1: Config module**

```ts
import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra ?? {}) as {
  serverOrigin?: string;
  buildNumber?: number;
};

/** Absolute origin of the TRMission server (the app is not served same-origin). */
export const SERVER_ORIGIN = extra.serverOrigin ?? 'http://localhost:3001';
export const API_BASE = `${SERVER_ORIGIN}/api/v1`;
export const WS_URL = `${SERVER_ORIGIN.replace(/^http/, 'ws')}/ws`;
/** This binary's build number — the axis GET /version/mobile.minBuild gates against. */
export const BUILD_NUMBER = extra.buildNumber ?? 0;
```

- [ ] **Step 2: Failing i18n test** — assert a known zh-Hant key resolves and en fallback works. Seed `src/i18n/index.ts` with a minimal `home.title` in both locales (copy the key style from `apps/web/src/i18n/index.ts`; full string parity is not required in P1 — screens add keys as they land).

```ts
import i18n from './index';
it('defaults to zh-Hant and falls back to en', () => {
  expect(i18n.t('home.title')).toBe('台鐵任務');
  i18n.changeLanguage('en');
  expect(i18n.t('home.title')).toBe('TRMission');
});
```

- [ ] **Step 3: Run → FAIL. Step 4: Implement `src/i18n/index.ts`**

```ts
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// compatibilityJSON v4 pairs with the @formatjs/intl-pluralrules shim (loaded in src/shims.ts).
void i18n.use(initReactI18next).init({
  compatibilityJSON: 'v4',
  lng: 'zh-Hant',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  resources: {
    'zh-Hant': { translation: { home: { title: '台鐵任務' } } },
    en: { translation: { home: { title: 'TRMission' } } },
  },
});

export default i18n;
```

- [ ] **Step 5: Run → PASS. Step 6: Commit** (`feat(mobile): config module + i18n bootstrap`).

---

### Task 4: REST client port (token transport + secure store)

**Files:**

- Create: `apps/mobile/src/net/rest.ts`, `apps/mobile/src/net/rest.test.ts`, `apps/mobile/src/net/secureStore.ts`

**Interfaces:**

- Consumes: `API_BASE` (Task 3); `expo-secure-store`.
- Produces: **`api`** object (`config`, `guest`, `login`, `register`, `upgrade`, `me`, `googleCredential`, `appleCredential`, `mobileCarry`, `mobileExchange`, `deleteAccount`, `getRoom(code)`, `getMyRooms`, `getTicket(code)`, `mapContent(hash)`, `registerDevice`, `removeDevice`, `logout`), `setAccessToken`, `setOnTokenChange`, `req<T>`, `ApiError`, and the types `PublicUser`, `UserPreferences`, `AuthResult`, `AuthConfig`. **P2 consumes `api.getTicket`/`api.getRoom`/`api.mapContent` + `req`; P5 consumes `req`/`api.mobileCarry`/`api.registerDevice`/`api.removeDevice`/`api.deleteAccount`.**

- [ ] **Step 1: Secure-store wrapper** (`secureStore.ts`) — `getRefreshToken()/setRefreshToken(t)/clearRefreshToken()` over `expo-secure-store` under key `trm.refresh`.

- [ ] **Step 2: Failing test** (`rest.test.ts`) — mock global `fetch`; assert (a) a call sends `Authorization: Bearer` + `x-trm-client: mobile`, (b) a 401 triggers exactly one `POST /auth/refresh` with `{refreshToken}` from secure store and retries, (c) two concurrent 401s share ONE refresh (single-flight — a second rotation trips server reuse detection). Mock `expo-secure-store`.

- [ ] **Step 3: Run → FAIL. Step 4: Implement `rest.ts`** — port `apps/web/src/net/rest.ts` (read it) with these deltas:
  - absolute base: `raw(path)` fetches `${API_BASE}${path}` (no `credentials: 'include'`).
  - every request sets header **`x-trm-client: mobile`**.
  - `tryRefresh()` reads the refresh token from secure store and `POST /auth/refresh {refreshToken}`, then persists the rotated `refreshToken` from the body (body-in → body-out) and updates the in-memory access token. Keep the exact single-flight structure (`refreshing` promise) from the web source.
  - issuance helpers (`guest`/`login`/`register`/`upgrade`/`googleCredential`/`appleCredential`/`mobileExchange`) capture BOTH `accessToken` and `refreshToken` (the latter to secure store — this is the mobile analogue of the web cookie).
  - `logout()` → `POST /auth/logout {refreshToken}` then `clearRefreshToken()`.
  - lobby/game/device helpers map to the routes confirmed in the server (`GET /rooms/:code`, `GET /rooms/mine`, `POST /rooms/:code/ticket`, `GET /maps/content/:hash`, `POST|DELETE /me/devices`).

```ts
// shape of the mobile capture (contrast web's captureToken which only took accessToken):
async function captureAuth(r: AuthResult): Promise<AuthResult> {
  setAccessToken(r.accessToken);
  if (r.refreshToken) await setRefreshToken(r.refreshToken);
  onToken?.(r.accessToken);
  return r;
}
```

- [ ] **Step 5: Run → PASS. Step 6: Commit** (`feat(mobile): REST client with token-transport refresh`).

---

### Task 5: WebSocket client port

**Files:**

- Create: `apps/mobile/src/net/socket.ts`, `apps/mobile/src/net/socket.test.ts`

**Interfaces:**

- Consumes: `WS_URL` (Task 3), `@trm/proto`, `@trm/shared`.
- Produces: **`GameSocket`** (ctor `(ticket, handlers, url?)`, `connect`/`close`/command senders), **`SocketStatus`**, **`SocketHandlers`**, **`ChatContent`**, **`PaymentInit`**, **`CameraViewInit`**. **P2 consumes all of these.**

- [ ] **Step 1: Failing test** — construct a `GameSocket` against a fake `WebSocket` (inject via a `WebSocketCtor` param or global stub); assert `binaryType` is set to `'arraybuffer'` on connect, the first frame is a `ClientHello` carrying the ticket + `PROTOCOL_VERSION`, and a `SESSION_REPLACED_CLOSE_CODE` close does not reconnect.

- [ ] **Step 2: Run → FAIL. Step 3: Implement** — port `apps/web/src/net/socket.ts` (read it) verbatim except:
  - drop `defaultWsUrl()`'s `location` use; default the `url` param to `WS_URL` from config.
  - keep `ws.binaryType = 'arraybuffer'` (RN honors it on iOS/Android; the web already sets it — this is the one line the audit flagged as must-be-explicit).
  - RN's `WebSocket`, `setInterval`, `setTimeout` are all present; the backoff/heartbeat/dispatch logic is unchanged.

- [ ] **Step 4: Run → PASS. Step 5: Commit** (`feat(mobile): protobuf WebSocket client`).

---

### Task 6: Session store + boot restore

**Files:**

- Create: `apps/mobile/src/store/session.ts`, `apps/mobile/src/store/ui.ts`, `apps/mobile/src/store/session.test.ts`

**Interfaces:**

- Consumes: `api` + `setOnTokenChange` (Task 4).
- Produces: **`useSession`** (`user`, `accessToken`, `loading`, `booting`, `error`, `restore`, `playAsGuest`, `login`, `register`, `upgrade`, `loginWithGoogleCredential`, `loginWithAppleCredential`, `signInMethod`, `signOut`, `savePreferences`, `clearError`, `clearLocalSession`) and **`useUi`** (locale + prefs). **P5 consumes `user.features`, `signOut`, `signInMethod`, `clearLocalSession`.**

- [ ] **Step 1: Failing test** — with a mocked `api`, assert `playAsGuest` sets `user` and `restore()` on a stored refresh token resolves `user` via `api.me()` (the mobile boot path: try secure-store refresh → `me()`).

- [ ] **Step 2: Run → FAIL. Step 3: Implement** — port `apps/web/src/store/session.ts` (read it). Deltas: `restore()` first checks secure store has a refresh token (skip the `me()` probe when absent → `booting:false, user:null` fast); add `loginWithAppleCredential(identityToken, fullName?)`; track `signInMethod: 'guest'|'password'|'google'|'apple'|'discord'|null` (P5's account-deletion flow branches on `apple`); `signOut()` calls `api.logout()` + `clearLocalSession()` (clears in-memory token + secure store). `useUi` is a slimmed port of the web ui store's locale/colour-blind/prefs fields backed by AsyncStorage (routing/layout fields are P2's concern).

- [ ] **Step 4: Run → PASS. Step 5: Commit** (`feat(mobile): session store with secure-store restore`).

---

### Task 7: Auth screens (all five methods)

**Files:**

- Create: `apps/mobile/src/screens/LoginScreen.tsx`, `apps/mobile/src/auth/google.ts`, `apps/mobile/src/auth/discord.ts`, `apps/mobile/src/auth/discord.test.ts`

**Interfaces:**

- Consumes: `useSession` (Task 6), `api.mobileCarry`/`api.mobileExchange` (Task 4), `expo-auth-session`, `expo-apple-authentication`, `@react-native-google-signin/google-signin`, `expo-linking`.
- Produces: `LoginScreen` (guest, email/password login+register toggle, Google button, Apple button on iOS, Discord button); `signInWithDiscord()` (the carry→system-browser→deep-link→exchange flow).

- [ ] **Step 1: Failing test for the Discord handoff** (`discord.test.ts`) — the sequence is pure enough to unit-test with mocks: `api.mobileCarry()` → build `${API_BASE}/auth/oauth/discord/start?client=mobile&carry=<code>` → `WebBrowser.openAuthSessionAsync(url, 'trmission://')` resolves with a `.../m/callback?code=<c>` (or `trmission://…`) URL → parse `code` → `api.mobileExchange(code)` → session set. Assert the exact URL built and that `mobileExchange` is called with the parsed code.

- [ ] **Step 2: Run → FAIL. Step 3: Implement**
  - `auth/discord.ts` — `signInWithDiscord()` per the sequence above using `expo-auth-session`'s `WebBrowser.openAuthSessionAsync` (ASWebAuthenticationSession on iOS / Custom Tabs on Android) with the `trmission://` return; parse via `expo-linking`.
  - `auth/google.ts` — `@react-native-google-signin/google-signin`: configure with the iOS/Android client ids (from `app.config` extra or a constants module), `signIn()` → `idToken` → `useSession.loginWithGoogleCredential(idToken)` (P0 accepts native-app audiences via `GOOGLE_MOBILE_CLIENT_IDS`).
  - `LoginScreen.tsx` — guest button (`playAsGuest`), email/password form (`login`/`register` toggle), Google button, Apple button rendered only on `Platform.OS === 'ios'` via `expo-apple-authentication` → `loginWithAppleCredential(identityToken, fullName)`, Discord button → `signInWithDiscord()`. Show `error` from the session store; disable while `loading`.

- [ ] **Step 4: Run → PASS. Step 5: Commit** (`feat(mobile): auth screens (guest/password/Google/Apple/Discord)`).

---

### Task 8: Navigation + version-gate boot + lobby screens

**Files:**

- Create: `apps/mobile/src/navigation.tsx`, `apps/mobile/src/screens/BootScreen.tsx`, `apps/mobile/src/screens/HomeScreen.tsx`, `apps/mobile/src/screens/RoomScreen.tsx`, `apps/mobile/src/screens/GamePlaceholderScreen.tsx`, `apps/mobile/src/version.ts`, `apps/mobile/src/version.test.ts`
- Modify: `apps/mobile/App.tsx` (mount navigation + boot)

**Interfaces:**

- Consumes: `useSession`, `api` (`getMyRooms`, `getRoom`, room create/join/ready/start — confirm the exact route helpers exist from Task 4), `BUILD_NUMBER`, `SERVER_ORIGIN`.
- Produces: **`RootNavigator`** with routes `Boot`, `Login`, `Home`, `Room` (params `{ code }`), `Game` (params `{ roomCode }` — a placeholder screen P2 replaces); `checkForcedUpdate()`. **P2 registers the real `Game` screen; P2/P3/P4 add routes to this navigator.**

- [ ] **Step 1: Failing test for the version gate** (`version.test.ts`) — `checkForcedUpdate(BUILD_NUMBER)` calls `GET /version/mobile`; when `minBuild > BUILD_NUMBER` returns `{ mustUpdate: true }`, else `{ mustUpdate: false }`. Mock `fetch`.

- [ ] **Step 2: Run → FAIL. Step 3: Implement**
  - `version.ts` — `checkForcedUpdate(build)` hitting `${SERVER_ORIGIN}/version/mobile` (this route is outside `/api/v1` — it's a health route; use `SERVER_ORIGIN` directly).
  - `BootScreen` — on mount: `checkForcedUpdate` → if `mustUpdate`, render a store-link update wall; else `useSession.restore()` → navigate to `Home` (authed) or `Login`.
  - `navigation.tsx` — native-stack with the five routes; deep-link config (`expo-linking`) mapping `trmission://` and the `/m/callback` universal link (the OAuth return is handled in Task 7 via `openAuthSessionAsync`, but registering the prefix lets a cold-start deep link resolve).
  - `HomeScreen` — "Play" (list `getMyRooms`, create/join room), sign-out; a placeholder "Play vs Bots" button that P3 wires. `RoomScreen` — room detail (members, ready toggle, host start), on game start navigate to `Game`. `GamePlaceholderScreen` — a labeled placeholder ("game screen — P2").
  - `App.tsx` — `SafeAreaProvider` + `NavigationContainer` + `RootNavigator`.

- [ ] **Step 4: Run → PASS + typecheck. Step 5: Commit** (`feat(mobile): navigation, version gate, lobby screens`).

---

### Task 9: Push device registration on login

**Files:**

- Create: `apps/mobile/src/push/register.ts`, `apps/mobile/src/push/register.test.ts`
- Modify: `apps/mobile/src/store/session.ts` (register on auth, unregister on sign-out)

**Interfaces:**

- Consumes: `api.registerDevice`/`removeDevice` (Task 4), `expo-notifications`.
- Produces: `registerDeviceForPush()` (permission → `getDevicePushTokenAsync()` → `POST /me/devices {platform, token}`), `unregisterDeviceForPush()`. **P5 owns the full push-client lifecycle (contextual prompt timing, foreground suppression, tap deep-links); P1 only ensures a logged-in device is registered so the P0 server can reach it.**

- [ ] **Step 1: Failing test** — mock `expo-notifications` (granted permission, a fake device token) + `api`; assert `registerDeviceForPush()` calls `api.registerDevice('ios'|'android', token)` with `Platform.OS`, and is a no-op when permission is denied.

- [ ] **Step 2: Run → FAIL. Step 3: Implement** `register.ts` (native token, not Expo push token — `getDevicePushTokenAsync`); call it after a successful auth in the session store and `unregisterDeviceForPush()` in `signOut`. Keep the contextual-prompt polish for P5 — P1 may prompt at first login (documented; P5 refines to post-first-game).

- [ ] **Step 4: Run → PASS. Step 5: Commit** (`feat(mobile): register native push token on login`).

---

### Task 10: GitHub Actions build lanes (self-managed signing, no EAS)

**Files:**

- Create: `.github/workflows/mobile-ci.yml`, `.github/workflows/mobile-android.yml`, `.github/workflows/mobile-ios.yml`, `apps/mobile/fastlane/Fastfile`, `apps/mobile/fastlane/Matchfile`, `apps/mobile/fastlane/Appfile`
- Modify: `apps/server/CLAUDE.md` or a new `apps/mobile/CLAUDE.md` (document the lanes + required secrets)

**Interfaces:**

- Produces: three CI lanes; **P5 adds `mobile-ota.yml`; P6 uses the Android/iOS lanes for store submission.**

- [ ] **Step 1: CI lane** (`mobile-ci.yml`, ubuntu) — on PRs touching `apps/mobile/**` or `packages/**`: checkout, setup-node 22 + Corepack/Yarn, `yarn install --immutable`, then `yarn workspace @trm/mobile typecheck && lint && test`. (No device build — fast gate.)

```yaml
name: mobile-ci
on:
  pull_request:
    paths: ['apps/mobile/**', 'packages/**', '.github/workflows/mobile-ci.yml']
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: corepack enable
      - run: yarn install --immutable
      - run: yarn workspace @trm/mobile typecheck
      - run: yarn workspace @trm/mobile lint
      - run: yarn workspace @trm/mobile test
```

- [ ] **Step 2: Android lane** (`mobile-android.yml`, ubuntu) — on `release/*` branches or tags: install, `yarn workspace @trm/mobile prebuild -p android`, decode the keystore from `secrets.ANDROID_KEYSTORE_BASE64`, Gradle `bundleRelease` signed via `secrets.ANDROID_KEYSTORE_PASSWORD`/`KEY_ALIAS`/`KEY_PASSWORD`, upload the `.aab` as an artifact. (P6 flips the final step to `fastlane supply` to the Play internal track.)

- [ ] **Step 3: iOS lane** (`mobile-ios.yml`, **macos-latest**) — gated to `release/*`/tags only (macOS runners bill 10× — cap them): install, `prebuild -p ios`, `fastlane match appstore --readonly` (certs in a private repo via `secrets.MATCH_GIT_URL`/`MATCH_PASSWORD`), `fastlane gym`, `fastlane pilot upload` to TestFlight with an App Store Connect API key (`secrets.ASC_KEY_ID`/`ASC_ISSUER_ID`/`ASC_KEY_P8`). Fastfile/Matchfile/Appfile encode these lanes.

- [ ] **Step 4: Validate workflow syntax** — Run: `yarn dlx @action-validator/cli .github/workflows/mobile-ci.yml` (or equivalent lint), and confirm the referenced secrets are enumerated in the docs file. (No live build runs in this task — a real build requires the native projects, which CI generates; a dry `expo prebuild` locally on the reground machine is the smoke test.)

- [ ] **Step 5: Document + commit** — write `apps/mobile/CLAUDE.md` (workspace overview: Expo/RN pins, the three shims, Metro config rationale, the net-layer deltas from web, the CI lanes + required secrets list, the "no EAS/self-managed signing" pin). Commit:

```bash
git add .github/workflows/mobile-ci.yml .github/workflows/mobile-android.yml .github/workflows/mobile-ios.yml apps/mobile/fastlane apps/mobile/CLAUDE.md
git commit -m "ci(mobile): GitHub Actions build lanes with self-managed signing"
```

---

### Task 11: Full-workspace regression + docs

- [ ] **Step 1: Gates** — Run: `yarn workspace @trm/mobile test` (all specs PASS), `yarn workspace @trm/mobile typecheck` (clean), `yarn typecheck` (whole monorepo — the engine `serialize.ts` edit must not break any consumer), `yarn workspace @trm/engine test` (goldens PASS).
- [ ] **Step 2: Root docs** — add a `apps/mobile` bullet to root `CLAUDE.md` monorepo-layout section (one line: "React Native + Expo client; reuses the TS packages; auth against the mobile server surface"). Note the `TRM_SERVER_ORIGIN` env for pointing the app at a server.
- [ ] **Step 3: Commit** (`docs: note the apps/mobile workspace in the monorepo layout`).
