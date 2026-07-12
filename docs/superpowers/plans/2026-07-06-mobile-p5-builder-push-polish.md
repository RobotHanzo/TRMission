# Mobile P5 — Builder WebView, Push Client, Haptics, Tablet Polish, Self-Hosted OTA

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **REGROUND BEFORE EXECUTING:** this plan was written at spec time (2026-07-06). Before executing, re-verify library versions, file anchors, and the Consumes list against the then-current repo — prior phases will have moved things.

**Goal:** Finish the mobile client's v1 feature set on top of the P1–P4 app: the map-builder WebView (with the one remaining server endpoint — the web-session handoff), full push-notification client wiring against the already-shipped server push stack, haptics behind a settings toggle, tablet/large-screen polish, and a self-hosted OTA update pipeline (expo-open-ota + expo-updates code signing + a GitHub Actions publish lane).

**Architecture:** One server change only (Task 1): `GET /api/v1/auth/mobile-web-handoff?code=…` converts a Bearer-minted single-use code into the normal Strict refresh cookie and 302s to `/maps`, so the `react-native-webview` builder rides the live web origin with a real web session — no token ever appears in a WebView URL that persists (the code is single-use and dies on redemption). Everything else is client/ops: `expo-notifications` **native** device tokens registered against the existing `POST/DELETE /api/v1/me/devices`; haptics as a pure `GameEvent → cue` mapping fired off the game store's `lastBatch` channel; tablet behavior audited via `useWindowDimensions`-driven tiers (never device class); OTA served by an expo-open-ota container beside the existing compose stack with our own code-signing certificate baked into the binary. The server push fan-out, FCM/APNs transports, localization, and dead-token pruning are **already implemented and tested** — the app only registers tokens and handles notifications.

**Tech Stack:** Expo SDK 56 (RN 0.85, React 19.2, New Architecture, Hermes) in `apps/mobile` (`@trm/mobile`, from P1); jest-expo + `@testing-library/react-native` for app tests; NestJS + nestjs-zod + vitest/supertest/mongodb-memory-server for the server task; `react-native-webview`, `expo-notifications`, `expo-haptics`, `expo-screen-orientation`, `expo-updates`, `@react-native-community/netinfo`, `@react-native-async-storage/async-storage`; expo-open-ota (Docker) for updates; GitHub Actions for the OTA lane.

## Global Constraints

- **Monorepo pins:** Yarn 4 via Corepack with the **node-modules linker** (required by Metro); server runs via **swc, never tsx/esbuild**; `apps/web` stays on **Vite ^5**; the 6th card colour is **PURPLE, never PINK**; engine purity rules are untouchable (nothing in this plan touches `@trm/engine`).
- **Never `git add -A` / `git add .`** — stage only files this plan touches (other agents may share the worktree).
- **zh-Hant primary + en** for every user-facing string (app UI and push interactions). Push notification *content* is localized server-side already — do not re-localize it client-side.
- Server work follows the P0 idioms exactly: zod DTOs + `apiSchema()` (one zod source for validation AND OpenAPI), e2e via `createTestApp` (`apps/server/test/app.ts`), run with `yarn workspace @trm/server test --run <substring>`.
- Load-bearing strings (must byte-match across plans): header `x-trm-client: mobile`, deep-link path `/m/callback`, handoff route `/api/v1/auth/mobile-web-handoff`, web builder path `/maps`, device routes `POST/DELETE /api/v1/me/devices`, version gate `GET /version/mobile`.
- Mobile tests run with jest-expo: `yarn workspace @trm/mobile test <pattern>` (jest path-regex filter). Native modules (`expo-notifications`, `expo-haptics`, `react-native-webview`, `@react-native-community/netinfo`, `expo-screen-orientation`, `expo-apple-authentication`) are always `jest.mock`ed — device-only behavior is covered by the manual matrix, logic is covered by tests.
- Hidden-information posture is unchanged: nothing in this plan serializes `GameState`; the WebView receives only a single-use code; push payloads carry only `{kind, gameId, roomCode?}` (already the server contract).

### Assumed P1–P4 artifacts (verify each at reground; every one has a verification command)

| Consumed name | Contract | Verify |
|---|---|---|
| `@trm/mobile` workspace | Expo app at `apps/mobile`, jest-expo configured, `test` script | `yarn workspace @trm/mobile test --listTests` |
| `apps/mobile/src/net/rest.ts` | Port of web `net/rest.ts`: `req<T>(method, path, body?)` against `/api/v1`, Bearer + single-flight refresh, `api.*` methods incl. `api.mobileCarry(): Promise<{code:string}>` (P1 OAuth flow uses it) | `rg "mobileCarry|function req" apps/mobile/src/net` |
| `SERVER_ORIGIN` | The API/web origin constant the app targets (P1 config) | `rg "SERVER_ORIGIN|serverOrigin" apps/mobile/src` |
| `apps/mobile/src/store/session.ts` | zustand session: `user: PublicUser & { features?: UserFeature[] }`, `accessToken`, `signOut()` | `rg "features" apps/mobile/src/store/session.ts` |
| `apps/mobile/src/store/game.ts` | P2 port of web `store/game.ts` — includes `lastBatch: EventBatch` (`{seq, events: GameEvent[]}`) and `useGameStore` | `rg "lastBatch" apps/mobile/src/store/game.ts` |
| React Navigation root | `navigationRef` (createNavigationContainerRef) + route names `Home`, `Room` (`{code}`), `Game` (`{gameId}`), `Settings` | `rg "navigationRef|createNavigationContainerRef" apps/mobile/src` |
| `apps/mobile/src/screens/SettingsScreen.tsx` | P1 settings screen (rows list) | `ls apps/mobile/src/screens` |
| Layout tier helper | P2 pure function mapping width→`'compact'|'twoPane'|'threePane'` (<700 / 700–1000 / ≥1000 dp) | `rg -n "700" apps/mobile/src --glob '*.ts*'` |
| Expo config | `apps/mobile/app.config.ts` (or `app.json`) with `ios.supportsTablet: true` | `ls apps/mobile/app.*` |
| SIWA sign-in | P1 uses `expo-apple-authentication`; session records the entry method (`signInMethod`) | `rg "signInMethod|apple-authentication" apps/mobile/src` |
| i18n | P1 i18next setup `apps/mobile/src/i18n/` with `zh-Hant` + `en` resource tables | `ls apps/mobile/src/i18n` |
| Game-over UI | P2/P3 game-over panel inside the native GameStage (mount point for the push prompt) | `rg -il "gameEnded|GameOver" apps/mobile/src` |

If an assumed name moved, adapt the import path — the *contract* is binding, the path is not.

---

### Task 1: Server — `GET /api/v1/auth/mobile-web-handoff` (the only new server endpoint)

The builder WebView needs the app's native session to become a normal web cookie session on the same origin. The mint side already exists: `POST /api/v1/auth/mobile/carry` (Bearer) mints a single-use `'carry'` code in `MobileCodeRepo` (`apps/server/src/auth/mobile-code.repo.ts`). We add the redeem side: a top-level browser navigation that redeems the carry code, sets the normal Strict `trm_refresh` cookie (a **new** session family — the app's body-token family is untouched), and 302s to `/maps`. Reusing kind `'carry'` keeps this to exactly one new endpoint and zero repo changes: both mint paths are Bearer-authenticated self-issuance, both are single-use `findOneAndDelete`, and a code spent on one surface is dead on the other.

**Files:**
- Modify: `apps/server/src/auth/auth.controller.ts` (add one GET route after `mobileExchange`, ~line 262; update the `mobile/carry` `@ApiOperation` summary)
- Create: `apps/server/test/mobile-web-handoff.e2e.spec.ts`

**Interfaces:**
- Consumes: `MobileCodeRepo.redeem('carry', code)` (single-use), `UserRepo.findById`, `AuthService.issueFor(user)`, `AuthConfig.redirectBase` / `webCallback({error})`, `setRefresh(res, token)` (all already injected into `AuthController` — no constructor/module change).
- Produces: `GET /api/v1/auth/mobile-web-handoff?code=<carry code>` → on success `Set-Cookie: trm_refresh=…` (Strict, path `/api/v1/auth`) + `302 ${redirectBase}/maps`; on invalid/expired/replayed code `302 ${redirectBase}/login/callback?error=invalid_code` (no cookie); on issuance failure (e.g. account disabled mid-flight) `302 …/login/callback?error=server_error`. Excluded from OpenAPI (browser navigation, not JSON — same as the OAuth routes).

- [ ] **Step 1: Write the failing e2e test**

Create `apps/server/test/mobile-web-handoff.e2e.spec.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createTestApp, refreshCookie, OAUTH_TEST_CONFIG, type TestApp } from './app';

let mongod: MongoMemoryServer;
let t: TestApp;
const server = () => t.app.getHttpServer();
const locationOf = (res: { headers: Record<string, unknown> }): string =>
  String(res.headers.location ?? '');

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  // OAUTH_TEST_CONFIG pins redirectBase to http://localhost:5173 so Location asserts are exact.
  t = await createTestApp({
    mongod,
    dbName: 'trm-test-web-handoff',
    authConfig: OAUTH_TEST_CONFIG,
  });
}, 60_000);
afterAll(async () => {
  await t.close();
  await mongod.stop();
});

describe('GET /api/v1/auth/mobile-web-handoff (builder WebView session handoff)', () => {
  it('redeems a carry code into the Strict refresh cookie and lands on /maps', async () => {
    const guest = await request(server())
      .post('/api/v1/auth/guest')
      .set('x-trm-client', 'mobile')
      .send({ displayName: 'Builder' })
      .expect(201);

    const carry = await request(server())
      .post('/api/v1/auth/mobile/carry')
      .set('Authorization', `Bearer ${guest.body.accessToken}`)
      .expect(201);

    const res = await request(server())
      .get('/api/v1/auth/mobile-web-handoff')
      .query({ code: carry.body.code })
      .expect(302);
    expect(locationOf(res)).toBe('http://localhost:5173/maps');
    const cookie = refreshCookie(res);
    expect(cookie).toContain('trm_refresh=');

    // The cookie is a real web session: the cookie-transport refresh path accepts it.
    await request(server()).post('/api/v1/auth/refresh').set('Cookie', cookie).expect(200);

    // The app's own body-token family is untouched (the handoff mints a NEW family).
    await request(server())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: guest.body.refreshToken })
      .expect(200);
  });

  it('codes are single-use: a replay gets an error redirect and no cookie', async () => {
    const guest = await request(server())
      .post('/api/v1/auth/guest')
      .set('x-trm-client', 'mobile')
      .send({})
      .expect(201);
    const carry = await request(server())
      .post('/api/v1/auth/mobile/carry')
      .set('Authorization', `Bearer ${guest.body.accessToken}`)
      .expect(201);

    await request(server())
      .get('/api/v1/auth/mobile-web-handoff')
      .query({ code: carry.body.code })
      .expect(302);
    const replay = await request(server())
      .get('/api/v1/auth/mobile-web-handoff')
      .query({ code: carry.body.code })
      .expect(302);
    expect(locationOf(replay)).toBe('http://localhost:5173/login/callback?error=invalid_code');
    expect(refreshCookie(replay)).toBe('');
  });

  it('missing or garbage codes get the error redirect, never a 500 or a cookie', async () => {
    const missing = await request(server()).get('/api/v1/auth/mobile-web-handoff').expect(302);
    expect(locationOf(missing)).toBe('http://localhost:5173/login/callback?error=invalid_code');
    expect(refreshCookie(missing)).toBe('');

    const garbage = await request(server())
      .get('/api/v1/auth/mobile-web-handoff')
      .query({ code: 'not-a-real-code' })
      .expect(302);
    expect(locationOf(garbage)).toBe('http://localhost:5173/login/callback?error=invalid_code');
    expect(refreshCookie(garbage)).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/server test --run mobile-web-handoff`
Expected: FAIL — `GET /api/v1/auth/mobile-web-handoff` 404s (route does not exist).

- [ ] **Step 3: Implement the endpoint**

In `apps/server/src/auth/auth.controller.ts`, add after the `mobileExchange` method (all dependencies — `mobileCodes`, `users`, `auth`, `authConfig` — are already constructor-injected; `Get`, `Query`, `Res`, `ApiExcludeEndpoint` are already imported):

```ts
  @Get('mobile-web-handoff')
  @ApiExcludeEndpoint()
  /**
   * Builder-WebView session handoff (browser navigation, not JSON). The app minted a
   * single-use carry code over Bearer (POST /auth/mobile/carry); redeeming it here mints a
   * NEW web session family and sets the normal Strict refresh cookie, then lands on /maps.
   * The app's own body-token family is never touched. Errors redirect (never 500 a
   * top-level navigation) with no cookie.
   */
  async mobileWebHandoff(
    @Query('code') code: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const userId = await this.mobileCodes.redeem('carry', code);
    const user = userId ? await this.users.findById(userId) : null;
    if (!user) {
      res.redirect(this.authConfig.webCallback({ error: 'invalid_code' }));
      return;
    }
    try {
      const issued = await this.auth.issueFor(user);
      this.setRefresh(res, issued.refreshToken);
      res.redirect(`${this.authConfig.redirectBase}/maps`);
    } catch {
      // e.g. account disabled between mint and redeem.
      res.redirect(this.authConfig.webCallback({ error: 'server_error' }));
    }
  }
```

Update the carry endpoint's summary so the OpenAPI doc reflects both uses:

```ts
  @ApiOperation({
    summary:
      'Mint a single-use carry code: mobile OAuth guest-upgrade, or the builder-WebView web-session handoff',
  })
```

- [ ] **Step 4: Run tests to verify they pass, plus the untouched suites**

Run: `yarn workspace @trm/server test --run mobile-web-handoff`
Expected: PASS (all three tests)
Run: `yarn workspace @trm/server test --run auth-mobile`
Expected: PASS (carry/exchange/OAuth handoff semantics unchanged)
Run: `yarn workspace @trm/server test --run auth.e2e`
Expected: PASS (web cookie flows unchanged)

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/auth/auth.controller.ts apps/server/test/mobile-web-handoff.e2e.spec.ts
git commit -m "feat(server): builder-WebView session handoff via single-use carry code"
```

---

### Task 2: Mobile — dependencies + persisted settings store

Foundation for Tasks 3–8: install the P5 native modules with `expo install` (it pins SDK-56-compatible versions — never hand-pin these), and add the persisted settings store the push/haptics toggles live on.

**Files:**
- Modify: `apps/mobile/package.json` (via `expo install`, not by hand)
- Create: `apps/mobile/src/store/settings.ts`
- Create: `apps/mobile/src/store/settings.test.ts`

**Interfaces:**
- Consumes: nothing from P1 beyond the workspace itself.
- Produces: `useSettings` zustand store, persisted to AsyncStorage under key `trm-settings`:
  `{ haptics: boolean (default true); notifications: boolean (default false); pushPromptSeen: boolean (default false); setHaptics(v); setNotifications(v); markPushPromptSeen() }`. Consumed by Tasks 4–7.

- [ ] **Step 1: Install the P5 dependencies**

Run (each lets Expo choose the SDK-matched version):

```bash
yarn workspace @trm/mobile exec expo install react-native-webview @react-native-community/netinfo expo-notifications expo-haptics expo-screen-orientation expo-updates @react-native-async-storage/async-storage
```

Then: `yarn install` (settle the lockfile) and `yarn workspace @trm/mobile test --listTests` (jest still boots).
If P1 already installed any of these (reground: check `apps/mobile/package.json`), `expo install` is idempotent — it only aligns versions.

- [ ] **Step 2: Write the failing store test**

Create `apps/mobile/src/store/settings.test.ts`:

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSettings } from './settings';

// jest-expo ships an AsyncStorage mock via the package's own jest preset;
// if the resolver complains, add '@react-native-async-storage/async-storage/jest/async-storage-mock'
// to moduleNameMapper (documented in the package README).

describe('settings store', () => {
  it('defaults: haptics on, notifications off, prompt unseen', () => {
    const s = useSettings.getState();
    expect(s.haptics).toBe(true);
    expect(s.notifications).toBe(false);
    expect(s.pushPromptSeen).toBe(false);
  });

  it('setters flip and persist', async () => {
    useSettings.getState().setHaptics(false);
    useSettings.getState().setNotifications(true);
    useSettings.getState().markPushPromptSeen();
    expect(useSettings.getState().haptics).toBe(false);
    expect(useSettings.getState().notifications).toBe(true);
    expect(useSettings.getState().pushPromptSeen).toBe(true);
    // persist middleware writes asynchronously; flush microtasks then check storage.
    await new Promise((r) => setTimeout(r, 0));
    const raw = await AsyncStorage.getItem('trm-settings');
    expect(raw).toContain('"haptics":false');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `yarn workspace @trm/mobile test settings.test`
Expected: FAIL — `Cannot find module './settings'`.

- [ ] **Step 4: Implement the store**

Create `apps/mobile/src/store/settings.ts`:

```ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Device-local preferences (NOT account preferences — those live on the server via
 * PATCH /auth/me/preferences). Haptics/notifications are per-device by nature.
 */
interface SettingsState {
  /** Haptic feedback on game beats (route claim, tunnel reveal, ticket completion, game end). */
  haptics: boolean;
  /** User intent for push. Actual delivery also needs OS permission + a registered token. */
  notifications: boolean;
  /** The contextual post-first-game permission prompt fires at most once. */
  pushPromptSeen: boolean;
  setHaptics(v: boolean): void;
  setNotifications(v: boolean): void;
  markPushPromptSeen(): void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      haptics: true,
      notifications: false,
      pushPromptSeen: false,
      setHaptics: (haptics) => set({ haptics }),
      setNotifications: (notifications) => set({ notifications }),
      markPushPromptSeen: () => set({ pushPromptSeen: true }),
    }),
    { name: 'trm-settings', storage: createJSONStorage(() => AsyncStorage) },
  ),
);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `yarn workspace @trm/mobile test settings.test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/package.json yarn.lock apps/mobile/src/store/settings.ts apps/mobile/src/store/settings.test.ts
git commit -m "feat(mobile): P5 native deps + persisted device settings store"
```

---

### Task 3: Mobile — Builder WebView screen, feature gate, offline banner

`react-native-webview` loading the **live web origin's** `/maps` through the Task 1 handoff. Entry is hidden without the `mapBuilder` feature (`user.features` from `/auth/me` — cosmetic; the server 403s regardless, same posture as web). The builder requires network by design — offline shows the branded banner, never a broken WebView.

**Files:**
- Create: `apps/mobile/src/screens/BuilderScreen.tsx`
- Create: `apps/mobile/src/screens/BuilderScreen.test.tsx`
- Modify: `apps/mobile/src/navigation/RootNavigator.tsx` (register the `Builder` route — reground for the actual navigator file)
- Modify: `apps/mobile/src/screens/HomeScreen.tsx` (feature-gated entry — reground for where P1 put secondary entries; mirror web's AppHeader placement)
- Modify: `apps/mobile/src/i18n/` resource tables (keys below)

**Interfaces:**
- Consumes: `api.mobileCarry(): Promise<{code: string}>` (P1), `SERVER_ORIGIN` (P1), `useSession` `user.features` (P1), Task 1's handoff URL contract, `@react-native-community/netinfo`, i18n `t()`.
- Produces: route `Builder` (no params); helper `useCanBuild(): boolean` exported from `BuilderScreen.tsx` for the entry gate.

- [ ] **Step 1: Write the failing tests**

Create `apps/mobile/src/screens/BuilderScreen.test.tsx`:

```tsx
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';

// Native modules: mock before importing the screen.
const mockWebView = jest.fn(() => null);
jest.mock('react-native-webview', () => ({ WebView: (p: unknown) => mockWebView(p) }));

let netState = { isConnected: true };
jest.mock('@react-native-community/netinfo', () => ({
  useNetInfo: () => netState,
}));

const mobileCarry = jest.fn();
jest.mock('../net/rest', () => ({
  api: { mobileCarry: (...a: unknown[]) => mobileCarry(...a) },
  SERVER_ORIGIN: 'https://play.example',
}));

import BuilderScreen from './BuilderScreen';

describe('BuilderScreen', () => {
  beforeEach(() => {
    mockWebView.mockClear();
    mobileCarry.mockReset();
    netState = { isConnected: true };
  });

  it('mints a fresh carry code and points the WebView at the handoff URL', async () => {
    mobileCarry.mockResolvedValue({ code: 'abc123' });
    render(<BuilderScreen />);
    await waitFor(() => expect(mockWebView).toHaveBeenCalled());
    const props = mockWebView.mock.calls.at(-1)![0] as { source: { uri: string } };
    expect(props.source.uri).toBe(
      'https://play.example/api/v1/auth/mobile-web-handoff?code=abc123',
    );
    expect(mobileCarry).toHaveBeenCalledTimes(1);
  });

  it('offline: renders the branded banner, never mounts the WebView', () => {
    netState = { isConnected: false };
    render(<BuilderScreen />);
    expect(screen.getByTestId('builder-offline')).toBeTruthy();
    expect(mockWebView).not.toHaveBeenCalled();
  });

  it('carry mint failure renders the error state (no WebView with a broken URL)', async () => {
    mobileCarry.mockRejectedValue(new Error('401'));
    render(<BuilderScreen />);
    await waitFor(() => expect(screen.getByTestId('builder-error')).toBeTruthy());
    expect(mockWebView).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn workspace @trm/mobile test BuilderScreen`
Expected: FAIL — `Cannot find module './BuilderScreen'`.

- [ ] **Step 3: Implement the screen**

Create `apps/mobile/src/screens/BuilderScreen.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useNetInfo } from '@react-native-community/netinfo';
import { useTranslation } from 'react-i18next';
import { api, SERVER_ORIGIN } from '../net/rest';
import { useSession } from '../store/session';

/** Entry gate: mirror of web's useHasFeature('mapBuilder') — cosmetic; server 403s regardless. */
export function useCanBuild(): boolean {
  return useSession((s) => !!s.user?.features?.includes('mapBuilder'));
}

/**
 * The map builder is the live web app in a WebView ("WebView now, native later" — spec §7).
 * Session handoff: mint a single-use carry code over Bearer, then load
 * GET /api/v1/auth/mobile-web-handoff?code=… — the server sets the normal Strict refresh
 * cookie inside the WebView's cookie store and 302s to /maps. A fresh code is minted on
 * every mount (codes are single-use); old web session families age out server-side.
 */
export default function BuilderScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const net = useNetInfo();
  const [handoffUrl, setHandoffUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const online = net.isConnected !== false;

  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    setFailed(false);
    api
      .mobileCarry()
      .then(({ code }) => {
        if (cancelled) return;
        setHandoffUrl(
          `${SERVER_ORIGIN}/api/v1/auth/mobile-web-handoff?code=${encodeURIComponent(code)}`,
        );
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [online]);

  if (!online) {
    return (
      <View style={styles.center} testID="builder-offline">
        <Text style={styles.title}>{t('builder.offlineTitle')}</Text>
        <Text style={styles.body}>{t('builder.offlineBody')}</Text>
      </View>
    );
  }
  if (failed) {
    return (
      <View style={styles.center} testID="builder-error">
        <Text style={styles.title}>{t('builder.errorTitle')}</Text>
        <Text style={styles.body}>{t('builder.errorBody')}</Text>
      </View>
    );
  }
  if (!handoffUrl) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }
  return (
    <WebView
      source={{ uri: handoffUrl }}
      // iOS: WKWebView shares NSHTTPCookieStorage so the Strict cookie set by the 302 sticks.
      sharedCookiesEnabled
      // Android: allow the same-origin refresh cookie inside the WebView.
      thirdPartyCookiesEnabled
      startInLoadingState
      // The builder is a same-origin SPA; external links (if any) stay inside — acceptable for v1.
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
  title: { fontSize: 18, fontWeight: '600' },
  body: { fontSize: 14, textAlign: 'center', opacity: 0.7 },
});
```

Register the route in the P1 navigator (reground for exact file):

```tsx
<Stack.Screen name="Builder" component={BuilderScreen} options={{ title: t('builder.title') }} />
```

Home entry (feature-gated, hidden entirely without the grant — mirror web AppHeader behavior):

```tsx
const canBuild = useCanBuild();
// …in the secondary-actions block:
{canBuild ? (
  <Pressable onPress={() => navigation.navigate('Builder')} accessibilityRole="button">
    <Text>{t('builder.entry')}</Text>
  </Pressable>
) : null}
```

i18n keys (add to both locale tables; zh-Hant is primary):

```ts
// zh-Hant
builder: {
  title: '地圖工房',
  entry: '地圖工房',
  offlineTitle: '需要網路連線',
  offlineBody: '地圖工房在線上網頁中編輯，離線時無法使用。',
  errorTitle: '無法開啟地圖工房',
  errorBody: '登入交接失敗，請稍後再試。',
},
// en
builder: {
  title: 'Map Studio',
  entry: 'Map Studio',
  offlineTitle: 'You are offline',
  offlineBody: 'The map studio runs on the live website and needs a connection.',
  errorTitle: 'Could not open the map studio',
  errorBody: 'The session handoff failed — please try again.',
},
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn workspace @trm/mobile test BuilderScreen`
Expected: PASS (3 tests)
Run: `yarn workspace @trm/mobile test` and `yarn typecheck`
Expected: PASS / clean

- [ ] **Step 5: Manual smoke (dev loop)**

With the server + web running (`docker compose up -d mongo`, `yarn workspace @trm/server dev`, `yarn workspace @trm/web dev`) and an Android emulator (`yarn workspace @trm/mobile exec expo run:android`): sign in on a **feature-granted** account (grant `mapBuilder` from the dashboard), open the Builder entry, verify the WebView lands signed-in on `/maps` (not the login screen), and that airplane mode shows the offline banner instead.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/screens/BuilderScreen.tsx apps/mobile/src/screens/BuilderScreen.test.tsx apps/mobile/src/navigation/RootNavigator.tsx apps/mobile/src/screens/HomeScreen.tsx apps/mobile/src/i18n
git commit -m "feat(mobile): map-builder WebView with web-session handoff and feature gate"
```

(Adjust the navigator/home paths to the regrounded reality before staging.)

---

### Task 4: Mobile — push registration lifecycle (token ↔ `/me/devices`)

The server contract is live and tested: `POST /api/v1/me/devices {platform:'ios'|'android', token}` (204, idempotent, token follows the account) and `DELETE /api/v1/me/devices {token}` (204). The client registers the **native** device token (`getDevicePushTokenAsync` — never the Expo push token; there is no Expo Push Service in this stack), re-registers on token rotation, and deregisters **before** logout revokes the Bearer.

**Files:**
- Create: `apps/mobile/src/push/registration.ts`
- Create: `apps/mobile/src/push/registration.test.ts`
- Modify: `apps/mobile/src/net/rest.ts` (add `registerDevice`/`removeDevice` — P1 file, reground)
- Modify: `apps/mobile/src/store/session.ts` (call sites: after sign-in restore, before sign-out — reground)

**Interfaces:**
- Consumes: `expo-notifications` (`getPermissionsAsync`, `getDevicePushTokenAsync`, `addPushTokenListener`, `setNotificationChannelAsync`, `AndroidImportance`), P1 `req` helper, `useSettings.notifications` (Task 2).
- Produces:
  - `api.registerDevice(platform: 'ios' | 'android', token: string): Promise<void>` → `POST /me/devices`
  - `api.removeDevice(token: string): Promise<void>` → `DELETE /me/devices`
  - `registerDeviceForPush(): Promise<boolean>` — no-ops (false) without OS permission; registers + remembers the token.
  - `unregisterDeviceForPush(): Promise<void>` — DELETEs the remembered token (call while still authenticated).
  - `watchTokenRotation(): () => void` — re-registers on platform token rotation; returns unsubscribe.
  - `syncPushRegistration(): Promise<void>` — the one entry point session code calls: registers iff `settings.notifications && permission granted`.

- [ ] **Step 1: Write the failing tests**

Create `apps/mobile/src/push/registration.test.ts`:

```ts
const getPermissionsAsync = jest.fn();
const getDevicePushTokenAsync = jest.fn();
const addPushTokenListener = jest.fn(() => ({ remove: jest.fn() }));
const setNotificationChannelAsync = jest.fn();
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: (...a: unknown[]) => getPermissionsAsync(...a),
  getDevicePushTokenAsync: (...a: unknown[]) => getDevicePushTokenAsync(...a),
  addPushTokenListener: (...a: unknown[]) => addPushTokenListener(...a),
  setNotificationChannelAsync: (...a: unknown[]) => setNotificationChannelAsync(...a),
  AndroidImportance: { DEFAULT: 3 },
}));

const registerDevice = jest.fn().mockResolvedValue(undefined);
const removeDevice = jest.fn().mockResolvedValue(undefined);
jest.mock('../net/rest', () => ({
  api: {
    registerDevice: (...a: unknown[]) => registerDevice(...a),
    removeDevice: (...a: unknown[]) => removeDevice(...a),
  },
}));
jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));

import {
  registerDeviceForPush,
  unregisterDeviceForPush,
  watchTokenRotation,
} from './registration';

describe('push registration lifecycle', () => {
  beforeEach(() => jest.clearAllMocks());

  it('registers the native token when permission is granted (and creates the Android channel)', async () => {
    getPermissionsAsync.mockResolvedValue({ granted: true });
    getDevicePushTokenAsync.mockResolvedValue({ type: 'android', data: 'fcm-token-1' });
    await expect(registerDeviceForPush()).resolves.toBe(true);
    expect(setNotificationChannelAsync).toHaveBeenCalledWith('default', expect.anything());
    expect(registerDevice).toHaveBeenCalledWith('android', 'fcm-token-1');
  });

  it('no-ops without permission', async () => {
    getPermissionsAsync.mockResolvedValue({ granted: false });
    await expect(registerDeviceForPush()).resolves.toBe(false);
    expect(registerDevice).not.toHaveBeenCalled();
  });

  it('unregister DELETEs the remembered token exactly once', async () => {
    getPermissionsAsync.mockResolvedValue({ granted: true });
    getDevicePushTokenAsync.mockResolvedValue({ type: 'android', data: 'fcm-token-2' });
    await registerDeviceForPush();
    await unregisterDeviceForPush();
    expect(removeDevice).toHaveBeenCalledWith('fcm-token-2');
    await unregisterDeviceForPush(); // second call: nothing remembered
    expect(removeDevice).toHaveBeenCalledTimes(1);
  });

  it('token rotation re-registers the NEW token', async () => {
    getPermissionsAsync.mockResolvedValue({ granted: true });
    getDevicePushTokenAsync.mockResolvedValue({ type: 'android', data: 'fcm-token-3' });
    await registerDeviceForPush();
    watchTokenRotation();
    const cb = addPushTokenListener.mock.calls[0]![0] as (t: unknown) => void;
    cb({ type: 'android', data: 'fcm-token-4' });
    await new Promise((r) => setTimeout(r, 0));
    expect(registerDevice).toHaveBeenLastCalledWith('android', 'fcm-token-4');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn workspace @trm/mobile test push/registration`
Expected: FAIL — `Cannot find module './registration'`.

- [ ] **Step 3: Implement**

Add to `apps/mobile/src/net/rest.ts` (inside the `api` object, matching the ported `req` idiom):

```ts
  /** Register this device's NATIVE push token (FCM/APNs — server speaks both directly). */
  registerDevice: (platform: 'ios' | 'android', token: string) =>
    req<void>('POST', '/me/devices', { platform, token }),
  /** Unregister on sign-out or when the user turns notifications off. */
  removeDevice: (token: string) => req<void>('DELETE', '/me/devices', { token }),
```

Create `apps/mobile/src/push/registration.ts`:

```ts
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from '../net/rest';
import { useSettings } from '../store/settings';

/** The token we last told the server about — needed to DELETE it while still authenticated. */
let lastRegisteredToken: string | null = null;

const platform = (): 'ios' | 'android' => (Platform.OS === 'ios' ? 'ios' : 'android');

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  // Android 8+ requires a channel before any notification can display.
  await Notifications.setNotificationChannelAsync('default', {
    name: 'TRMission',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

/**
 * Register the native device token with the server. Returns false (and does nothing)
 * without OS permission — permission REQUESTS only ever come from the contextual
 * prompt (Task 5) or the settings toggle (Task 7), never implicitly.
 */
export async function registerDeviceForPush(): Promise<boolean> {
  const perms = await Notifications.getPermissionsAsync();
  if (!perms.granted) return false;
  await ensureAndroidChannel();
  const token = await Notifications.getDevicePushTokenAsync();
  const data = String(token.data);
  await api.registerDevice(platform(), data);
  lastRegisteredToken = data;
  return true;
}

/** Call BEFORE the session is revoked — the DELETE needs the Bearer. Safe to call twice. */
export async function unregisterDeviceForPush(): Promise<void> {
  const token = lastRegisteredToken;
  lastRegisteredToken = null;
  if (!token) return;
  try {
    await api.removeDevice(token);
  } catch {
    // Best-effort: a dead token also gets pruned server-side on first failed send.
  }
}

/** FCM/APNs rotate tokens; keep the registry current. Returns the unsubscribe. */
export function watchTokenRotation(): () => void {
  const sub = Notifications.addPushTokenListener((t) => {
    void (async () => {
      const data = String(t.data);
      if (!data || data === lastRegisteredToken) return;
      try {
        await api.registerDevice(platform(), data);
        lastRegisteredToken = data;
      } catch {
        // Retried on next syncPushRegistration.
      }
    })();
  });
  return () => sub.remove();
}

/** Idempotent session-lifecycle hook: register iff the user wants push AND the OS allows it. */
export async function syncPushRegistration(): Promise<void> {
  if (!useSettings.getState().notifications) return;
  await registerDeviceForPush().catch(() => undefined);
}
```

Wire the session lifecycle in `apps/mobile/src/store/session.ts` (P1 file — reground exact shape):
- after a successful sign-in **and** after a successful boot-time session restore: `void syncPushRegistration();`
- in `signOut()`, **before** calling `api.logout(...)`: `await unregisterDeviceForPush();`
- at app root (where P1 mounts AppState/NetInfo listeners): `useEffect(() => watchTokenRotation(), [])`.

- [ ] **Step 4: Run tests**

Run: `yarn workspace @trm/mobile test push/registration`
Expected: PASS (4 tests)
Run: `yarn workspace @trm/mobile test` (full app suite — session wiring didn't break P1 tests)
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/push/registration.ts apps/mobile/src/push/registration.test.ts apps/mobile/src/net/rest.ts apps/mobile/src/store/session.ts
git commit -m "feat(mobile): native push token registration lifecycle"
```

---

### Task 5: Mobile — notification handling: contextual prompt, foreground suppression, tap deep-link

Three behaviors: (a) the OS permission prompt fires **contextually after the player's first finished game**, never at boot (spec §5); (b) a foreground notification for the game currently on screen is suppressed; (c) tapping a notification deep-links into the room/game (warm and cold start).

**Files:**
- Create: `apps/mobile/src/push/notifications.ts`
- Create: `apps/mobile/src/push/notifications.test.ts`
- Create: `apps/mobile/src/push/PushPrompt.tsx`
- Create: `apps/mobile/src/push/PushPrompt.test.tsx`
- Modify: `apps/mobile/src/App.tsx` (or P1's root component — install handler + response listeners)
- Modify: P2's `GameScreen` (set/clear the active game id on focus/blur; mount `<PushPrompt />` in the game-over panel — reground both anchors)
- Modify: `apps/mobile/src/i18n/` (keys below)

**Interfaces:**
- Consumes: server push payload contract `data: { kind: 'your_turn' | 'game_started' | 'game_over', gameId: string, roomCode?: string }` (`apps/server/src/push/push.service.ts` — `game_started` is the only kind carrying `roomCode`); P1 `navigationRef` + routes `Room {code}` / `Game {gameId}`; Task 2 `useSettings`; Task 4 `registerDeviceForPush`.
- Produces:
  - `setActiveGameId(id: string | null)` — GameScreen focus/blur hook point.
  - `installNotificationHandler()` — foreground display policy (suppress when the notification's `gameId` is on screen).
  - `navigateForPush(nav, data)` — pure-ish dispatcher, unit-tested.
  - `installNotificationTapHandling(nav): () => void` — warm-tap listener + cold-start `getLastNotificationResponseAsync`.
  - `<PushPrompt />` — one-shot contextual card for the game-over panel.

- [ ] **Step 1: Write the failing tests**

Create `apps/mobile/src/push/notifications.test.ts`:

```ts
const setNotificationHandler = jest.fn();
const addNotificationResponseReceivedListener = jest.fn(() => ({ remove: jest.fn() }));
const getLastNotificationResponseAsync = jest.fn().mockResolvedValue(null);
jest.mock('expo-notifications', () => ({
  setNotificationHandler: (...a: unknown[]) => setNotificationHandler(...a),
  addNotificationResponseReceivedListener: (...a: unknown[]) =>
    addNotificationResponseReceivedListener(...a),
  getLastNotificationResponseAsync: (...a: unknown[]) => getLastNotificationResponseAsync(...a),
}));

import {
  installNotificationHandler,
  navigateForPush,
  setActiveGameId,
  type PushData,
} from './notifications';

const notif = (data: Record<string, unknown>) =>
  ({ request: { content: { data } } }) as never;

describe('foreground display policy', () => {
  it('suppresses the banner for the game currently on screen, shows it otherwise', async () => {
    installNotificationHandler();
    const handler = setNotificationHandler.mock.calls[0]![0] as {
      handleNotification: (n: unknown) => Promise<{ shouldShowBanner: boolean }>;
    };
    setActiveGameId('g1');
    expect((await handler.handleNotification(notif({ kind: 'your_turn', gameId: 'g1' }))).shouldShowBanner).toBe(false);
    expect((await handler.handleNotification(notif({ kind: 'your_turn', gameId: 'g2' }))).shouldShowBanner).toBe(true);
    setActiveGameId(null);
    expect((await handler.handleNotification(notif({ kind: 'your_turn', gameId: 'g1' }))).shouldShowBanner).toBe(true);
  });
});

describe('navigateForPush', () => {
  const nav = { navigate: jest.fn(), isReady: () => true };
  beforeEach(() => nav.navigate.mockClear());

  it('game_started goes to the room (the game screen needs the room ticket flow)', () => {
    navigateForPush(nav as never, { kind: 'game_started', gameId: 'g1', roomCode: 'ABCD' } as PushData);
    expect(nav.navigate).toHaveBeenCalledWith('Room', { code: 'ABCD' });
  });

  it('your_turn / game_over go to the game by id', () => {
    navigateForPush(nav as never, { kind: 'your_turn', gameId: 'g1' } as PushData);
    expect(nav.navigate).toHaveBeenCalledWith('Game', { gameId: 'g1' });
  });

  it('garbage payloads are ignored', () => {
    navigateForPush(nav as never, {} as PushData);
    expect(nav.navigate).not.toHaveBeenCalled();
  });
});
```

Create `apps/mobile/src/push/PushPrompt.test.tsx`:

```tsx
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

const requestPermissionsAsync = jest.fn();
jest.mock('expo-notifications', () => ({
  requestPermissionsAsync: (...a: unknown[]) => requestPermissionsAsync(...a),
}));
const registerDeviceForPush = jest.fn().mockResolvedValue(true);
jest.mock('./registration', () => ({
  registerDeviceForPush: (...a: unknown[]) => registerDeviceForPush(...a),
}));

import { useSettings } from '../store/settings';
import PushPrompt from './PushPrompt';

describe('PushPrompt (contextual, one-shot)', () => {
  beforeEach(() => {
    useSettings.setState({ notifications: false, pushPromptSeen: false });
    jest.clearAllMocks();
  });

  it('accept: requests OS permission, registers, flips the toggle, never shows again', async () => {
    requestPermissionsAsync.mockResolvedValue({ granted: true });
    render(<PushPrompt />);
    fireEvent.press(screen.getByTestId('push-prompt-accept'));
    await Promise.resolve();
    expect(requestPermissionsAsync).toHaveBeenCalled();
    expect(useSettings.getState().pushPromptSeen).toBe(true);
  });

  it('dismiss: marks seen without requesting anything', () => {
    render(<PushPrompt />);
    fireEvent.press(screen.getByTestId('push-prompt-dismiss'));
    expect(requestPermissionsAsync).not.toHaveBeenCalled();
    expect(useSettings.getState().pushPromptSeen).toBe(true);
  });

  it('renders nothing once seen', () => {
    useSettings.setState({ pushPromptSeen: true });
    render(<PushPrompt />);
    expect(screen.queryByTestId('push-prompt-accept')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn workspace @trm/mobile test push/notifications push/PushPrompt`
Expected: FAIL — modules don't exist.

- [ ] **Step 3: Implement**

Create `apps/mobile/src/push/notifications.ts`:

```ts
import * as Notifications from 'expo-notifications';
import type { NavigationContainerRefWithCurrent } from '@react-navigation/native';

/** Server payload contract (apps/server/src/push/push.service.ts): data = {kind, gameId, roomCode?}. */
export interface PushData {
  kind?: 'your_turn' | 'game_started' | 'game_over';
  gameId?: string;
  roomCode?: string;
}

/** The single definition of "this game is on screen". GameScreen sets on focus, clears on blur. */
let activeGameId: string | null = null;
export const setActiveGameId = (id: string | null): void => {
  activeGameId = id;
};

/** Foreground policy: never banner the game the player is already looking at. */
export function installNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async (n) => {
      const data = (n.request.content.data ?? {}) as PushData;
      const suppress = typeof data.gameId === 'string' && data.gameId === activeGameId;
      return {
        shouldShowBanner: !suppress,
        shouldShowList: !suppress,
        shouldPlaySound: !suppress,
        shouldSetBadge: false,
      };
    },
  });
}

type Nav = Pick<NavigationContainerRefWithCurrent<Record<string, object | undefined>>, 'navigate' | 'isReady'>;

/**
 * Tap → screen. game_started lands on the ROOM (its screen owns the join/ticket flow);
 * your_turn / game_over land on the game — GameScreen re-mints its own ws ticket from the
 * gameId via the P2 rejoin path, identical to a foreground reconnect.
 */
export function navigateForPush(nav: Nav, data: PushData): void {
  if (!nav.isReady()) return;
  if (data.kind === 'game_started' && data.roomCode) {
    nav.navigate('Room', { code: data.roomCode });
  } else if ((data.kind === 'your_turn' || data.kind === 'game_over') && data.gameId) {
    nav.navigate('Game', { gameId: data.gameId });
  }
}

/** Warm-start taps + the cold-start tap (the response that launched the process). */
export function installNotificationTapHandling(nav: Nav): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
    navigateForPush(nav, (resp.notification.request.content.data ?? {}) as PushData);
  });
  void Notifications.getLastNotificationResponseAsync().then((resp) => {
    if (resp) navigateForPush(nav, (resp.notification.request.content.data ?? {}) as PushData);
  });
  return () => sub.remove();
}
```

Create `apps/mobile/src/push/PushPrompt.tsx`:

```tsx
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../store/settings';
import { registerDeviceForPush } from './registration';

/**
 * Contextual permission ask (spec §5): shown in the game-over panel after the player's
 * FIRST finished game — the moment "get told when it's your turn" is self-explanatory.
 * Never shown at boot; never shown twice.
 */
export default function PushPrompt(): React.JSX.Element | null {
  const { t } = useTranslation();
  const seen = useSettings((s) => s.pushPromptSeen);
  const markSeen = useSettings((s) => s.markPushPromptSeen);
  const setNotifications = useSettings((s) => s.setNotifications);
  if (seen) return null;

  const accept = async (): Promise<void> => {
    markSeen();
    const perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) return; // fully functional without push; alerts stay in-app only
    setNotifications(true);
    await registerDeviceForPush();
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t('push.promptTitle')}</Text>
      <Text style={styles.body}>{t('push.promptBody')}</Text>
      <View style={styles.row}>
        <Pressable testID="push-prompt-dismiss" onPress={markSeen}>
          <Text style={styles.dismiss}>{t('push.promptDismiss')}</Text>
        </Pressable>
        <Pressable testID="push-prompt-accept" onPress={() => void accept()}>
          <Text style={styles.accept}>{t('push.promptAccept')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, padding: 16, gap: 8, backgroundColor: 'rgba(127,127,127,0.12)' },
  title: { fontSize: 16, fontWeight: '600' },
  body: { fontSize: 13, opacity: 0.75 },
  row: { flexDirection: 'row', justifyContent: 'flex-end', gap: 24, marginTop: 4 },
  dismiss: { opacity: 0.6 },
  accept: { fontWeight: '600' },
});
```

Root wiring (P1 root component — reground the file):

```tsx
useEffect(() => {
  installNotificationHandler();
  return installNotificationTapHandling(navigationRef);
}, []);
```

GameScreen wiring (P2 file — reground): on focus `setActiveGameId(gameId)`, on blur/unmount `setActiveGameId(null)` (use `useFocusEffect`); mount `<PushPrompt />` inside the game-over panel below the scoreboard.

i18n keys:

```ts
// zh-Hant
push: {
  promptTitle: '輪到你時通知你?',
  promptBody: '開啟通知後,即使離開遊戲畫面,也會在輪到你、對局開始或結束時提醒你。',
  promptAccept: '開啟通知',
  promptDismiss: '先不用',
},
// en
push: {
  promptTitle: 'Get turn reminders?',
  promptBody: "We'll notify you when it's your turn, or when a game starts or ends — even when the app is in the background.",
  promptAccept: 'Enable notifications',
  promptDismiss: 'Not now',
},
```

- [ ] **Step 4: Run tests**

Run: `yarn workspace @trm/mobile test push/`
Expected: PASS (registration + notifications + PushPrompt suites)

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/push/notifications.ts apps/mobile/src/push/notifications.test.ts apps/mobile/src/push/PushPrompt.tsx apps/mobile/src/push/PushPrompt.test.tsx apps/mobile/src/App.tsx apps/mobile/src/i18n
git commit -m "feat(mobile): contextual push prompt, foreground suppression, tap deep-links"
```

(Also stage the regrounded GameScreen file touched for `setActiveGameId` + the prompt mount.)

---

### Task 6: Mobile — haptics on game beats (behind the settings toggle)

Spec §5 list, exactly: **route claim, tunnel reveal, ticket completion, game end**. Pure mapping from the game store's `lastBatch` event channel (the same once-per-batch `seq` idiom web animations use), fired through `expo-haptics`, gated on `useSettings.haptics`.

**Files:**
- Create: `apps/mobile/src/game/haptics.ts`
- Create: `apps/mobile/src/game/haptics.test.ts`
- Create: `apps/mobile/src/game/useHaptics.ts`
- Modify: P2's GameStage root component (one `useHaptics()` call — reground the file)

**Interfaces:**
- Consumes: `GameEvent` from `@trm/proto` (protobuf-es oneof: `event.case` ∈ `'routeClaimed' | 'tunnelRevealed' | 'ticketCompleted' | 'gameEnded' | …`), P2 `useGameStore` + `EventBatch` (`lastBatch`), Task 2 `useSettings`.
- Produces: `cuesForEvents(events): HapticCue[]` (pure), `useHaptics(): void` (subscribe-and-fire hook).

- [ ] **Step 1: Write the failing test for the pure mapping**

Create `apps/mobile/src/game/haptics.test.ts`:

```ts
import { create } from '@bufbuild/protobuf';
import {
  GameEventSchema,
  RouteClaimedSchema,
  TunnelRevealedSchema,
  TicketCompletedSchema,
  GameEndedSchema,
  CardsDrawnSchema,
} from '@trm/proto';
import { cuesForEvents } from './haptics';

// NOTE: exact message/schema export names come from packages/proto/src/gen — verify with
//   rg "RouteClaimedSchema|TunnelRevealedSchema" packages/proto/src/gen
// (they are generated; regenerate with `yarn workspace @trm/proto generate` if missing).

const ev = (kase: string, schema: never) =>
  create(GameEventSchema, { event: { case: kase as never, value: create(schema, {}) } });

describe('cuesForEvents', () => {
  it('maps exactly the four spec beats and ignores everything else', () => {
    const events = [
      ev('routeClaimed', RouteClaimedSchema as never),
      ev('cardsDrawn', CardsDrawnSchema as never), // no cue
      ev('tunnelRevealed', TunnelRevealedSchema as never),
      ev('ticketCompleted', TicketCompletedSchema as never),
      ev('gameEnded', GameEndedSchema as never),
    ];
    expect(cuesForEvents(events)).toEqual([
      'route-claim',
      'tunnel-reveal',
      'ticket-complete',
      'game-end',
    ]);
  });

  it('empty batch → no cues', () => {
    expect(cuesForEvents([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/mobile test game/haptics`
Expected: FAIL — `Cannot find module './haptics'` (or a schema-name import error — fix the import names against `packages/proto/src/gen` first; the test must fail on the missing module, not on wrong proto names).

- [ ] **Step 3: Implement**

Create `apps/mobile/src/game/haptics.ts`:

```ts
import type { GameEvent } from '@trm/proto';

/** The four haptic beats from the spec (§5) — nothing else ever vibrates. */
export type HapticCue = 'route-claim' | 'tunnel-reveal' | 'ticket-complete' | 'game-end';

const CUE_BY_CASE: Partial<Record<string, HapticCue>> = {
  routeClaimed: 'route-claim',
  tunnelRevealed: 'tunnel-reveal',
  ticketCompleted: 'ticket-complete',
  gameEnded: 'game-end',
};

/** Pure event→cue mapping so it's testable without any native module. */
export function cuesForEvents(events: readonly GameEvent[]): HapticCue[] {
  const cues: HapticCue[] = [];
  for (const e of events) {
    const cue = e.event.case ? CUE_BY_CASE[e.event.case] : undefined;
    if (cue) cues.push(cue);
  }
  return cues;
}
```

Create `apps/mobile/src/game/useHaptics.ts`:

```ts
import { useEffect, useRef } from 'react';
import * as Haptics from 'expo-haptics';
import { useGameStore } from '../store/game';
import { useSettings } from '../store/settings';
import { cuesForEvents, type HapticCue } from './haptics';

const FIRE: Record<HapticCue, () => Promise<void>> = {
  'route-claim': () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
  'tunnel-reveal': () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
  'ticket-complete': () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  'game-end': () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),
};

/** Mount once inside GameStage. Fires once per event batch (lastBatch.seq idiom). */
export function useHaptics(): void {
  const enabled = useSettings((s) => s.haptics);
  const batch = useGameStore((s) => s.lastBatch);
  const lastSeq = useRef(0);
  useEffect(() => {
    if (!batch || batch.seq === lastSeq.current) return;
    lastSeq.current = batch.seq;
    if (!enabled) return;
    for (const cue of cuesForEvents(batch.events)) {
      void FIRE[cue]().catch(() => undefined); // haptics are cosmetic; never surface errors
    }
  }, [batch, enabled]);
}
```

Mount `useHaptics()` at the top of P2's GameStage root component (works for online, offline, and tutorial sessions alike — they all flow through the same store).

- [ ] **Step 4: Run tests**

Run: `yarn workspace @trm/mobile test game/haptics`
Expected: PASS
Run: `yarn workspace @trm/mobile test`
Expected: PASS (GameStage snapshot/behavior tests unaffected — jest-expo mocks expo-haptics)

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/game/haptics.ts apps/mobile/src/game/haptics.test.ts apps/mobile/src/game/useHaptics.ts
git commit -m "feat(mobile): haptic cues for the four game beats behind a settings toggle"
```

(Also stage the regrounded GameStage file with the one-line hook mount.)

---

### Task 7: Mobile — Settings screen: notifications toggle, haptics toggle, account deletion

The settings screen grows three rows. Notifications ON requests permission (opening OS settings if permanently denied), registers, and flips the setting; OFF deregisters the token. Deletion drives `DELETE /api/v1/auth/me` with a fresh SIWA `authorizationCode` when the account signed in with Apple (Apple 5.1.1(v)/TN3194 — revocation is best-effort server-side).

**Files:**
- Create: `apps/mobile/src/account/deleteAccount.ts`
- Create: `apps/mobile/src/account/deleteAccount.test.ts`
- Create: `apps/mobile/src/screens/settings/NotificationsRow.tsx`
- Create: `apps/mobile/src/screens/settings/NotificationsRow.test.tsx`
- Modify: `apps/mobile/src/screens/SettingsScreen.tsx` (add the three rows — reground layout)
- Modify: `apps/mobile/src/net/rest.ts` (add `deleteAccount`)
- Modify: `apps/mobile/src/i18n/` (keys below)

**Interfaces:**
- Consumes: `DELETE /api/v1/auth/me` `{appleAuthorizationCode?}` (P0-c, live); `expo-apple-authentication` (`signInAsync`, `isAvailableAsync`); P1 session store (`signOut`, and the recorded `signInMethod` — if P1 did not record it, add `signInMethod: 'guest' | 'password' | 'google' | 'discord' | 'apple' | null` to the session store as part of this task, set at each sign-in call site); Tasks 2/4 stores + registration.
- Produces: `api.deleteAccount(appleAuthorizationCode?: string): Promise<void>`; `deleteAccountFlow(): Promise<'deleted' | 'cancelled' | 'failed'>`; `<NotificationsRow />`, haptics `Switch` row, destructive deletion row.

- [ ] **Step 1: Write the failing tests**

Create `apps/mobile/src/account/deleteAccount.test.ts`:

```ts
const signInAsync = jest.fn();
const isAvailableAsync = jest.fn().mockResolvedValue(true);
jest.mock('expo-apple-authentication', () => ({
  signInAsync: (...a: unknown[]) => signInAsync(...a),
  isAvailableAsync: (...a: unknown[]) => isAvailableAsync(...a),
}));
const deleteAccount = jest.fn().mockResolvedValue(undefined);
jest.mock('../net/rest', () => ({ api: { deleteAccount: (...a: unknown[]) => deleteAccount(...a) } }));
const unregisterDeviceForPush = jest.fn().mockResolvedValue(undefined);
jest.mock('../push/registration', () => ({
  unregisterDeviceForPush: (...a: unknown[]) => unregisterDeviceForPush(...a),
}));
const signOutLocal = jest.fn().mockResolvedValue(undefined);
jest.mock('../store/session', () => ({
  useSession: { getState: () => ({ signInMethod: currentMethod, clearLocalSession: signOutLocal }) },
}));
let currentMethod: string | null = 'password';

import { performAccountDeletion } from './deleteAccount';

describe('performAccountDeletion', () => {
  beforeEach(() => jest.clearAllMocks());

  it('non-Apple accounts: deletes without any SIWA round-trip', async () => {
    currentMethod = 'password';
    await expect(performAccountDeletion()).resolves.toBe('deleted');
    expect(signInAsync).not.toHaveBeenCalled();
    expect(deleteAccount).toHaveBeenCalledWith(undefined);
    expect(unregisterDeviceForPush).toHaveBeenCalled(); // token gone before the account is
    expect(signOutLocal).toHaveBeenCalled();
  });

  it('Apple accounts: re-auths and forwards the fresh authorizationCode', async () => {
    currentMethod = 'apple';
    signInAsync.mockResolvedValue({ authorizationCode: 'fresh-code' });
    await expect(performAccountDeletion()).resolves.toBe('deleted');
    expect(deleteAccount).toHaveBeenCalledWith('fresh-code');
  });

  it('Apple re-auth cancelled → server deletion still proceeds without the code (best-effort revocation)', async () => {
    currentMethod = 'apple';
    signInAsync.mockRejectedValue(Object.assign(new Error('cancelled'), { code: 'ERR_REQUEST_CANCELED' }));
    await expect(performAccountDeletion()).resolves.toBe('deleted');
    expect(deleteAccount).toHaveBeenCalledWith(undefined);
  });

  it('server failure → failed, local session untouched', async () => {
    currentMethod = 'password';
    deleteAccount.mockRejectedValueOnce(new Error('409 maintainer'));
    await expect(performAccountDeletion()).resolves.toBe('failed');
    expect(signOutLocal).not.toHaveBeenCalled();
  });
});
```

Create `apps/mobile/src/screens/settings/NotificationsRow.test.tsx`:

```tsx
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

const requestPermissionsAsync = jest.fn();
jest.mock('expo-notifications', () => ({
  requestPermissionsAsync: (...a: unknown[]) => requestPermissionsAsync(...a),
}));
const registerDeviceForPush = jest.fn().mockResolvedValue(true);
const unregisterDeviceForPush = jest.fn().mockResolvedValue(undefined);
jest.mock('../../push/registration', () => ({
  registerDeviceForPush: (...a: unknown[]) => registerDeviceForPush(...a),
  unregisterDeviceForPush: (...a: unknown[]) => unregisterDeviceForPush(...a),
}));

import { useSettings } from '../../store/settings';
import NotificationsRow from './NotificationsRow';

describe('NotificationsRow', () => {
  beforeEach(() => {
    useSettings.setState({ notifications: false });
    jest.clearAllMocks();
  });

  it('toggling ON requests permission then registers', async () => {
    requestPermissionsAsync.mockResolvedValue({ granted: true });
    render(<NotificationsRow />);
    fireEvent(screen.getByTestId('notifications-switch'), 'valueChange', true);
    await waitFor(() => expect(registerDeviceForPush).toHaveBeenCalled());
    expect(useSettings.getState().notifications).toBe(true);
  });

  it('permission denied leaves the toggle OFF', async () => {
    requestPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
    render(<NotificationsRow />);
    fireEvent(screen.getByTestId('notifications-switch'), 'valueChange', true);
    await waitFor(() => expect(requestPermissionsAsync).toHaveBeenCalled());
    expect(useSettings.getState().notifications).toBe(false);
    expect(registerDeviceForPush).not.toHaveBeenCalled();
  });

  it('toggling OFF deregisters the device token', async () => {
    useSettings.setState({ notifications: true });
    render(<NotificationsRow />);
    fireEvent(screen.getByTestId('notifications-switch'), 'valueChange', false);
    await waitFor(() => expect(unregisterDeviceForPush).toHaveBeenCalled());
    expect(useSettings.getState().notifications).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn workspace @trm/mobile test deleteAccount NotificationsRow`
Expected: FAIL — modules don't exist.

- [ ] **Step 3: Implement**

Add to `apps/mobile/src/net/rest.ts`:

```ts
  /** Store-mandated in-app account deletion (Apple 5.1.1(v) / Play). Irreversible. */
  deleteAccount: (appleAuthorizationCode?: string) =>
    req<void>(
      'DELETE',
      '/auth/me',
      appleAuthorizationCode ? { appleAuthorizationCode } : undefined,
    ),
```

Create `apps/mobile/src/account/deleteAccount.ts`:

```ts
import * as AppleAuthentication from 'expo-apple-authentication';
import { Platform } from 'react-native';
import { api } from '../net/rest';
import { unregisterDeviceForPush } from '../push/registration';
import { useSession } from '../store/session';

export type DeletionOutcome = 'deleted' | 'cancelled' | 'failed';

/**
 * Account deletion, store-compliant:
 *  1. Apple-linked accounts re-auth via SIWA for a FRESH authorizationCode so the server
 *     can revoke Apple tokens (TN3194). Cancellation of the re-auth does NOT block deletion —
 *     revocation is best-effort by design (the server treats the code as optional).
 *  2. Device push token is deregistered while the Bearer still works.
 *  3. DELETE /auth/me cascades server-side; only then is the local session cleared.
 * Maintainers get a 409 until dashboard access is revoked — surfaced as 'failed'.
 */
export async function performAccountDeletion(): Promise<DeletionOutcome> {
  let appleAuthorizationCode: string | undefined;
  const method = useSession.getState().signInMethod;
  if (method === 'apple' && Platform.OS === 'ios' && (await AppleAuthentication.isAvailableAsync())) {
    try {
      const cred = await AppleAuthentication.signInAsync();
      appleAuthorizationCode = cred.authorizationCode ?? undefined;
    } catch {
      // User cancelled the re-auth sheet: proceed without the code.
    }
  }
  try {
    await unregisterDeviceForPush();
    await api.deleteAccount(appleAuthorizationCode);
  } catch {
    return 'failed';
  }
  await useSession.getState().clearLocalSession();
  return 'deleted';
}
```

(`clearLocalSession` = P1's "wipe secure-store refresh token + in-memory state WITHOUT calling `/auth/logout`" path — the session is already dead server-side after deletion. Reground; if P1 only has `signOut()`, split the local-wipe half out.)

Create `apps/mobile/src/screens/settings/NotificationsRow.tsx`:

```tsx
import React, { useState } from 'react';
import { Alert, Linking, Switch, Text, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../../store/settings';
import { registerDeviceForPush, unregisterDeviceForPush } from '../../push/registration';

export default function NotificationsRow(): React.JSX.Element {
  const { t } = useTranslation();
  const enabled = useSettings((s) => s.notifications);
  const setNotifications = useSettings((s) => s.setNotifications);
  const [busy, setBusy] = useState(false);

  const onToggle = async (next: boolean): Promise<void> => {
    setBusy(true);
    try {
      if (next) {
        const perm = await Notifications.requestPermissionsAsync();
        if (!perm.granted) {
          if (perm.canAskAgain === false) {
            // Permanently denied: the only path is the OS settings screen.
            Alert.alert(t('settings.pushDeniedTitle'), t('settings.pushDeniedBody'), [
              { text: t('common.cancel'), style: 'cancel' },
              { text: t('settings.openSystemSettings'), onPress: () => void Linking.openSettings() },
            ]);
          }
          return; // toggle stays off
        }
        setNotifications(true);
        await registerDeviceForPush();
      } else {
        setNotifications(false);
        await unregisterDeviceForPush();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <View accessibilityRole="switch" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text>{t('settings.notifications')}</Text>
      <Switch
        testID="notifications-switch"
        value={enabled}
        disabled={busy}
        onValueChange={(v) => void onToggle(v)}
      />
    </View>
  );
}
```

In `SettingsScreen.tsx` add (following the P1 row idiom):
- `<NotificationsRow />`;
- a haptics row — plain `Switch` bound to `useSettings` `haptics`/`setHaptics` (`testID="haptics-switch"`, label `t('settings.haptics')`);
- a destructive "delete account" row (hidden for guests — a guest has nothing to delete that TTL won't reap; reground: `user.isGuest`): two-step `Alert.alert` confirm (`settings.deleteConfirmTitle` / `Body`, destructive style), then `performAccountDeletion()`; on `'failed'` show `settings.deleteFailed`.

i18n keys:

```ts
// zh-Hant
settings: {
  notifications: '推播通知',
  haptics: '震動回饋',
  deleteAccount: '刪除帳號',
  deleteConfirmTitle: '確定要刪除帳號嗎?',
  deleteConfirmBody: '此動作無法復原。你的個人資料將被刪除,對局紀錄將匿名化。',
  deleteConfirmAction: '永久刪除',
  deleteFailed: '刪除失敗。若你是維護者,請先解除儀表板權限後再試一次。',
  pushDeniedTitle: '通知權限已關閉',
  pushDeniedBody: '請在系統設定中允許 TRMission 的通知。',
  openSystemSettings: '開啟系統設定',
},
common: { cancel: '取消' },
// en
settings: {
  notifications: 'Push notifications',
  haptics: 'Haptic feedback',
  deleteAccount: 'Delete account',
  deleteConfirmTitle: 'Delete your account?',
  deleteConfirmBody: 'This cannot be undone. Your profile is deleted and match records are anonymized.',
  deleteConfirmAction: 'Delete forever',
  deleteFailed: 'Deletion failed. Maintainers must have dashboard access revoked first.',
  pushDeniedTitle: 'Notifications are blocked',
  pushDeniedBody: 'Allow notifications for TRMission in the system settings.',
  openSystemSettings: 'Open settings',
},
common: { cancel: 'Cancel' },
```

(Merge `common.cancel` only if P1 doesn't already define it — reground.)

- [ ] **Step 4: Run tests**

Run: `yarn workspace @trm/mobile test deleteAccount NotificationsRow`
Expected: PASS
Run: `yarn workspace @trm/mobile test`
Expected: PASS (SettingsScreen tests updated if P1 snapshot-tested the row list)

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/account/deleteAccount.ts apps/mobile/src/account/deleteAccount.test.ts apps/mobile/src/screens/settings/NotificationsRow.tsx apps/mobile/src/screens/settings/NotificationsRow.test.tsx apps/mobile/src/screens/SettingsScreen.tsx apps/mobile/src/net/rest.ts apps/mobile/src/i18n
git commit -m "feat(mobile): settings toggles for push/haptics and store-compliant account deletion"
```

---

### Task 8: Mobile — tablet & large-screen polish (iPadOS 26 / Android 16)

iPadOS 26 ignores `UIRequiresFullScreen` and Android 16 ignores orientation/resizability locks on ≥600dp screens — layouts must tolerate **live resizing** and the tier logic must be pure width math. This task pins the config, adds the phone-only portrait lock, locks the tier thresholds with tests at real device dimensions, and produces the screenshot-prep checklist P6 will consume.

**Files:**
- Create: `apps/mobile/src/app/useOrientationPolicy.ts`
- Create: `apps/mobile/src/app/orientationPolicy.test.ts`
- Create: `apps/mobile/src/app/layoutTiers.test.ts`
- Modify: `apps/mobile/app.config.ts` (audit/pin — reground `app.json` vs `app.config.ts`)
- Modify: P1 root component (mount `useOrientationPolicy()`)
- Create: `docs/mobile/store-screenshots.md`

**Interfaces:**
- Consumes: P2 layout tier helper (assumed `layoutTier(width: number)`, thresholds <700 / 700–1000 / ≥1000 — reground the real export), `expo-screen-orientation`, `useWindowDimensions`.
- Produces: `useOrientationPolicy(): void` (phones <600dp smallest-side lock portrait; tablets unlocked); config pins; the P6 screenshot checklist.

- [ ] **Step 1: Write the failing tests**

Create `apps/mobile/src/app/orientationPolicy.test.ts`:

```ts
const lockAsync = jest.fn().mockResolvedValue(undefined);
const unlockAsync = jest.fn().mockResolvedValue(undefined);
jest.mock('expo-screen-orientation', () => ({
  lockAsync: (...a: unknown[]) => lockAsync(...a),
  unlockAsync: (...a: unknown[]) => unlockAsync(...a),
  OrientationLock: { PORTRAIT_UP: 1 },
}));

let dims = { width: 390, height: 844 };
jest.mock('react-native', () => ({
  useWindowDimensions: () => dims,
}));

import { renderHook } from '@testing-library/react-native';
import { useOrientationPolicy } from './useOrientationPolicy';

describe('useOrientationPolicy', () => {
  beforeEach(() => jest.clearAllMocks());

  it('phone (smallest side < 600dp): locks portrait', () => {
    dims = { width: 390, height: 844 }; // iPhone-class
    renderHook(() => useOrientationPolicy());
    expect(lockAsync).toHaveBeenCalledWith(1);
    expect(unlockAsync).not.toHaveBeenCalled();
  });

  it('tablet (smallest side ≥ 600dp): unlocked', () => {
    dims = { width: 1024, height: 768 }; // iPad landscape
    renderHook(() => useOrientationPolicy());
    expect(unlockAsync).toHaveBeenCalled();
    expect(lockAsync).not.toHaveBeenCalled();
  });
});
```

Create `apps/mobile/src/app/layoutTiers.test.ts` (adjust the import to P2's real export — this test EXISTS to freeze the thresholds against tablet regressions):

```ts
import { layoutTier } from '../game/layout'; // ← reground: P2's tier helper

describe('layout tiers at real device widths (spec §2: compact <700, two-pane 700–1000, three-pane ≥1000)', () => {
  const cases: Array<[number, string, ReturnType<typeof layoutTier>]> = [
    [360, 'small Android phone portrait', 'compact'],
    [390, 'iPhone portrait', 'compact'],
    [674, 'iPad Stage Manager narrow window', 'compact'],
    [744, 'iPad mini portrait', 'twoPane'],
    [834, 'iPad Air portrait', 'twoPane'],
    [980, 'Android tablet split-screen', 'twoPane'],
    [1024, 'iPad landscape / Stage Manager wide', 'threePane'],
    [1194, 'iPad Pro 11" landscape', 'threePane'],
    [1366, 'iPad Pro 13" landscape', 'threePane'],
  ];
  it.each(cases)('%idp (%s) → %s', (width, _label, tier) => {
    expect(layoutTier(width)).toBe(tier);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn workspace @trm/mobile test app/orientationPolicy app/layoutTiers`
Expected: FAIL — `useOrientationPolicy` doesn't exist (the tier test may already pass — that's fine, it's a regression pin; if the tier helper name differs, fix the import, not the thresholds).

- [ ] **Step 3: Implement**

Create `apps/mobile/src/app/useOrientationPolicy.ts`:

```ts
import { useEffect } from 'react';
import { useWindowDimensions } from 'react-native';
import * as ScreenOrientation from 'expo-screen-orientation';

/**
 * Phones (smallest side < 600dp) are portrait-locked; tablets stay unlocked.
 * NOTE this is a preference, not a guarantee: iPadOS 26 ignores requireFullScreen and
 * Android 16 ignores orientation locks on ≥600dp screens — every layout must survive live
 * resizing regardless (which is why tiers derive from useWindowDimensions, never device class).
 */
export function useOrientationPolicy(): void {
  const { width, height } = useWindowDimensions();
  const isPhone = Math.min(width, height) < 600;
  useEffect(() => {
    if (isPhone) {
      void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    } else {
      void ScreenOrientation.unlockAsync();
    }
  }, [isPhone]);
}
```

Mount it once in the P1 root component.

Audit `apps/mobile/app.config.ts` and pin (add/verify each — these are P1's to own, P5's to enforce):

```ts
  orientation: 'default',          // never 'portrait' globally — tablets rotate; phones lock at runtime
  ios: {
    supportsTablet: true,
    // requireFullScreen intentionally ABSENT (deprecated; iPadOS 26 ignores it — we must resize).
  },
  plugins: [
    // reground: if P1 already uses expo-build-properties, merge; Android 16 = target API 36,
    // mandatory for Play updates from 2026-08-31.
    ['expo-build-properties', { android: { targetSdkVersion: 36, compileSdkVersion: 36 } }],
    // …existing P1 plugins…
  ],
```

Create `docs/mobile/store-screenshots.md`:

```markdown
# Store screenshot prep (consumed by P6)

## Required sets

| Store | Set | Size/device | Notes |
|---|---|---|---|
| App Store | iPhone 6.9" | 1320×2868 (iPhone 17 Pro Max class) | portrait |
| App Store | iPad 13" | 2064×2752 | landscape + portrait |
| Play | Phone | 1080×1920 min | portrait |
| Play | 7" tablet | per current Play console spec | required for tablet listing quality |
| Play | 10" tablet | per current Play console spec | required for tablet listing quality |

## Capture matrix (run before P6)

- Simulators/emulators: iPhone Pro Max class, iPad Pro 13", Pixel phone class, Pixel Tablet.
- Locales: capture EVERY shot in **zh-Hant first**, then en (store listings are bilingual).
- Scenes (same order in both locales): Home (offline banner visible in airplane mode variant),
  Room lobby with bots, mid-game board (three-pane on tablets, dock on phones), tunnel reveal
  moment, game-over scoreboard, map studio (WebView, feature-granted account).
- Tablet shots must show the ≥1000dp three-pane tier; verify by width, not device name.
- Stage Manager: capture one resized-window shot for internal QA (not for the store) to prove
  live-resize survival.

## Manual large-screen audit checklist (P5 exit criteria)

- [ ] iPad: drag between full screen / Split View / Stage Manager widths — tiers switch
      compact↔twoPane↔threePane with no clipped dock, no stuck gesture state.
- [ ] iPad: rotation unlocked everywhere; no layout assumes portrait.
- [ ] Android tablet (or resizable emulator, 600dp+): freeform resize + split-screen — same.
- [ ] Android 16 emulator: orientation lock request is IGNORED by the OS on ≥600dp — app
      renders correctly anyway.
- [ ] Phones: portrait lock holds; landscape never renders half-initialized.
```

- [ ] **Step 4: Run tests**

Run: `yarn workspace @trm/mobile test app/`
Expected: PASS
Run: `yarn workspace @trm/mobile test` and `yarn typecheck`
Expected: PASS / clean

- [ ] **Step 5: Manual audit**

Execute the checklist in `docs/mobile/store-screenshots.md` §"Manual large-screen audit" on the device matrix (iPad + Android tablet emulator minimum). File follow-up issues for any tier bug found in P2 components rather than hot-fixing board internals here — unless the fix is pure layout CSS/flex, in which case fix and note it in the commit.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/app/useOrientationPolicy.ts apps/mobile/src/app/orientationPolicy.test.ts apps/mobile/src/app/layoutTiers.test.ts apps/mobile/app.config.ts docs/mobile/store-screenshots.md
git commit -m "feat(mobile): tablet polish - orientation policy, tier pins, target API 36, screenshot prep"
```

---

### Task 9: Ops — self-hosted OTA server (expo-open-ota) + update code signing

Self-hosted `expo-updates` per spec §10: an **expo-open-ota** container beside the existing compose stack, our own code-signing certificate embedded in the binary (installed apps only accept bundles we signed), `runtimeVersion: fingerprint` so an OTA can never land on an incompatible native build. **No EAS anywhere.** Apple 3.3.2-compliant: JS/assets only.

**Files:**
- Modify: `docker-compose.yml` (new `ota` service + volume)
- Modify: `apps/mobile/app.config.ts` (`updates` + `runtimeVersion` blocks)
- Create: `apps/mobile/certs/` (certificate committed; private key **never** committed)
- Modify: `.gitignore` (private-key dir)
- Create: `docs/mobile/ota.md` (runbook — grows in Task 10)

**Interfaces:**
- Consumes: the expo-open-ota published Docker image + its documented env contract (pinned in Step 1 — upstream moves faster than this plan); `expo-updates` config schema (`updates.url`, `updates.codeSigningCertificate`, `updates.codeSigningMetadata`, `runtimeVersion.policy`).
- Produces: `ota` compose service (profile `full`) serving the expo-updates protocol; certificate at `apps/mobile/certs/certificate.pem` referenced from app config; runbook.

- [ ] **Step 1: Pin the upstream contract (do NOT skip — the compose env block depends on it)**

Run and record the answers **into `docs/mobile/ota.md`** before writing any config:

```bash
gh api repos/axelmarciano/expo-open-ota/releases/latest --jq .tag_name
curl -fsSL https://raw.githubusercontent.com/axelmarciano/expo-open-ota/main/README.md | head -n 200
```

Record: (1) the exact Docker image reference + tag, (2) the container's listen port, (3) the env var names for: public base URL, storage backend selection (we need the **local filesystem** backend on a named volume), code-signing private-key location, channel configuration, (4) the manifest endpoint path the app must call (`updates.url`), (5) the documented publish/upload mechanism (CLI or HTTP — Task 10 consumes this). If expo-open-ota's current release is missing any of these (e.g. it dropped local storage), fall back to Expo's reference `custom-expo-updates-server` (same protocol, static-directory storage) and note the swap in the runbook — the rest of this task is unchanged either way.

- [ ] **Step 2: Generate the code-signing material**

```bash
yarn workspace @trm/mobile exec npx expo-updates codesigning:generate \
  --key-output-directory certs/keys \
  --certificate-output-directory certs \
  --certificate-validity-duration-years 10 \
  --certificate-common-name "TRMission OTA"
yarn workspace @trm/mobile exec npx expo-updates codesigning:configure \
  --certificate-input-directory certs \
  --key-input-directory certs/keys
```

Then add to `.gitignore`:

```
# OTA code-signing PRIVATE key (cert is committed; key lives in GH secret + OTA server secret)
apps/mobile/certs/keys/
```

Store the private key in: (a) the GitHub Actions secret `OTA_CODE_SIGNING_PRIVATE_KEY` (if the pinned publish mechanism signs at publish time) **or** (b) the OTA server's mounted secret (if the pinned mechanism signs at serve time) — whichever Step 1 recorded; document the choice in the runbook. Verify `apps/mobile/certs/certificate.pem` exists and `git status` shows **no** file under `certs/keys/` staged.

- [ ] **Step 3: App config — updates block**

In `apps/mobile/app.config.ts` (the `codesigning:configure` command from Step 2 writes most of this — verify and normalize):

```ts
  updates: {
    // Manifest endpoint from Step 1; the origin is a deploy-time repo variable so dev builds
    // can point at a local container. NEVER default to an EAS URL.
    url: process.env.TRM_OTA_URL ?? 'http://localhost:3005/<manifest-path-from-step-1>',
    enabled: true,
    checkAutomatically: 'ON_LOAD',
    // Launch waits 0ms for the check: stale-while-revalidate. A downloaded update applies on
    // the NEXT cold start. The forced-update gate (GET /version/mobile) still runs every boot.
    fallbackToCacheTimeout: 0,
    codeSigningCertificate: './certs/certificate.pem',
    codeSigningMetadata: { keyid: 'main', alg: 'rsa-v1_5-sha256' },
  },
  runtimeVersion: { policy: 'fingerprint' },
```

- [ ] **Step 4: Compose service**

Add to `docker-compose.yml` (fill image/port/env names from Step 1's pinned record — the shape below is binding, the names come from upstream):

```yaml
  # Self-hosted expo-updates server (spec §10). JS/asset updates only (Apple 3.3.2);
  # native changes ship through the stores and are fenced by runtimeVersion=fingerprint.
  ota:
    profiles: ['full']
    image: <IMAGE_REF_FROM_STEP_1>
    environment:
      # From the Step-1 pinned env contract:
      #  - public base URL  = ${TRM_OTA_URL origin}
      #  - storage backend  = local filesystem on /data (the named volume below)
      #  - code-signing key = /run/secrets mount below (only if upstream signs at serve time)
      #  - channels         = production, preview
      <ENV_FROM_STEP_1>: <VALUE>
    volumes:
      - trm-ota-data:/data
    ports:
      - '3005:<CONTAINER_PORT_FROM_STEP_1>'
    restart: unless-stopped
```

…and `trm-ota-data:` under the top-level `volumes:` key.

- [ ] **Step 5: Verify**

Run: `docker compose --profile full config -q`
Expected: exit 0 (compose file valid).
Run: `docker compose --profile full up -d ota` then `curl -si "http://localhost:3005/<manifest-path>?runtime-version=probe&channel-name=production" -H "expo-protocol-version: 1"`
Expected: an expo-updates-protocol response (404/NoUpdateAvailable for an unknown runtime is fine; a connection refusal or HTML error page is not).
Run: `yarn workspace @trm/mobile test` and `yarn typecheck`
Expected: PASS / clean (app.config change is inert to tests).

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml apps/mobile/app.config.ts apps/mobile/certs/certificate.pem .gitignore docs/mobile/ota.md
git commit -m "feat(ops): self-hosted expo-open-ota service with signed updates and fingerprint runtime"
```

---

### Task 10: CI — `mobile-ota.yml` publish lane + OTA runbook (forced-update interplay, fallbacks)

The publish lane exports the JS bundle and pushes it to the OTA server on demand — **JS-only releases**. Anything that changes the native fingerprint (new native module, SDK bump, config-plugin change) is *automatically* fenced: the update's fingerprint runtime version won't match older binaries, so they ignore it and pick the change up via the store lanes (P6's `mobile-android.yml` / `mobile-ios.yml`).

**Files:**
- Create: `.github/workflows/mobile-ota.yml`
- Modify: `docs/mobile/ota.md` (complete the runbook)

**Interfaces:**
- Consumes: Step-1-of-Task-9 pinned publish mechanism; repo variable `TRM_OTA_URL`; secrets `OTA_CODE_SIGNING_PRIVATE_KEY` (+ whatever auth the pinned upload needs, e.g. an OTA server admin token).
- Produces: workflow `mobile-ota.yml` (manual dispatch + `mobile-ota-v*` tags); the complete OTA runbook.

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/mobile-ota.yml`:

```yaml
# Publishes a JS-ONLY over-the-air update to the self-hosted expo-open-ota server.
# Never used for native changes: runtimeVersion=fingerprint means a bundle exported from a
# tree whose native fingerprint differs from the installed binary is simply ignored by it.
# Store binaries ship via mobile-android.yml / mobile-ios.yml (P6).
name: mobile-ota
on:
  workflow_dispatch:
    inputs:
      channel:
        description: 'Update channel'
        type: choice
        options: [production, preview]
        default: preview
  push:
    tags: ['mobile-ota-v*']

concurrency:
  group: mobile-ota-${{ github.ref }}
  cancel-in-progress: false

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: corepack enable
      - run: yarn install --immutable
      # proto codegen must exist before any workspace build (src/gen is gitignored).
      - run: yarn workspace @trm/proto generate
      - run: yarn typecheck
      - name: Export the update bundle
        working-directory: apps/mobile
        env:
          TRM_OTA_URL: ${{ vars.TRM_OTA_URL }}
        run: npx expo export --platform ios --platform android --output-dir dist
      - name: Record the fingerprint runtime version (traceability)
        working-directory: apps/mobile
        run: npx @expo/fingerprint . | tee fingerprint.json
      - name: Publish to the OTA server
        working-directory: apps/mobile
        env:
          TRM_OTA_URL: ${{ vars.TRM_OTA_URL }}
          OTA_CODE_SIGNING_PRIVATE_KEY: ${{ secrets.OTA_CODE_SIGNING_PRIVATE_KEY }}
          OTA_UPLOAD_TOKEN: ${{ secrets.OTA_UPLOAD_TOKEN }}
          CHANNEL: ${{ inputs.channel || 'production' }}
        # EXACT command comes from the Task 9 Step 1 pinned publish mechanism
        # (expo-open-ota's documented CLI/endpoint). It must consume ./dist, $CHANNEL,
        # and the code-signing key; record the final command in docs/mobile/ota.md.
        run: <PINNED_PUBLISH_COMMAND>
      - uses: actions/upload-artifact@v4
        with:
          name: ota-bundle-${{ github.run_number }}
          path: |
            apps/mobile/dist
            apps/mobile/fingerprint.json
          retention-days: 30
```

- [ ] **Step 2: Validate the YAML**

Run: `npx --yes js-yaml .github/workflows/mobile-ota.yml > /dev/null && echo OK`
Expected: `OK` (parses cleanly). Then replace `<PINNED_PUBLISH_COMMAND>` with the Task 9 Step 1 record — the workflow must contain **no placeholder** when committed; if Task 9 fell back to `custom-expo-updates-server`, the publish step becomes an `rsync`/`scp` of `dist/` into the server's `updates/<runtimeVersion>/<timestamp>/` layout (its documented directory protocol).

- [ ] **Step 3: Complete the runbook**

Extend `docs/mobile/ota.md` with (write these sections in full — they are the P5 deliverable for §10's "documented interplay"):

```markdown
## Forced-update gate vs OTA (who wins, and why both exist)

Two independent mechanisms, deliberately non-overlapping:

1. `GET /version/mobile` → `{minBuild, commitHash}` — checked at EVERY boot before anything
   else. `nativeBuildVersion < minBuild` ⇒ the forced-update screen (store link). OTA can
   NEVER satisfy this gate: an OTA update changes the JS bundle, never the native
   buildNumber/versionCode. Raise `MOBILE_MIN_BUILD` only when old binaries must die
   (breaking wire/native change).
2. expo-updates + fingerprint runtimeVersion — delivers JS fixes to COMPATIBLE binaries
   only. A bundle exported from a tree with a different native fingerprint is invisible to
   the installed app; there is no override. OTA is an optimization, never a compatibility
   escape hatch.

Decision table:
- JS-only bugfix → OTA (this workflow), optionally also a store release later.
- Native change (new module / SDK / config plugin) → store lanes; OTA lane will no-op for
  old binaries by construction.
- Old binaries must be forced off (server contract break) → store release + raise
  MOBILE_MIN_BUILD after propagation.

## Rollback

Publish the previous known-good export to the same channel (updates are immutable;
"rollback" = publish an older bundle as the newest update). The signed manifest prevents
anyone else from doing this to our users.

## Fallbacks (spec §10)

- **custom-expo-updates-server** (Expo's reference implementation): same protocol, static
  directory storage, publish = copy `dist/` into `updates/<runtimeVersion>/<timestamp>/`.
  Swap the compose image + the workflow publish step; app config unchanged.
- **Store-only**: set `updates.enabled: false` in app.config.ts and ship through the store
  lanes exclusively. The forced-update gate works regardless — OTA was never load-bearing.
```

- [ ] **Step 4: Verify + commit**

Run: `npx --yes js-yaml .github/workflows/mobile-ota.yml > /dev/null && echo OK`
Expected: `OK`, and `rg "PINNED_PUBLISH_COMMAND" .github/workflows/mobile-ota.yml` returns nothing.

```bash
git add .github/workflows/mobile-ota.yml docs/mobile/ota.md
git commit -m "ci(mobile): self-hosted OTA publish lane + forced-update/OTA runbook"
```

---

### Task 11: Full regression + docs sweep

**Files:**
- Modify: `CLAUDE.md` (root — mobile paragraph)
- Modify: `apps/server/CLAUDE.md` (auth section — handoff sentence)
- Modify: `docs/TODO.md` (only if a P5 item was consciously deferred — otherwise untouched)

- [ ] **Step 1: Run every gate**

Run: `yarn workspace @trm/server test`
Expected: all specs PASS (including `mobile-web-handoff`, `auth-mobile`, `auth.e2e`, `push` suites).
Run: `yarn workspace @trm/mobile test`
Expected: PASS.
Run: `yarn typecheck` && `yarn lint` && `yarn format:check`
Expected: clean.
Run: `yarn test`
Expected: PASS across all workspaces (proto codegen runs first via turbo).

- [ ] **Step 2: Document**

`apps/server/CLAUDE.md` — append to the **Mobile transport** passage in the `src/auth/` bullet:

```markdown
  The builder WebView's session handoff is `GET /api/v1/auth/mobile-web-handoff?code=` —
  it redeems the same single-use carry code (`POST /auth/mobile/carry` over Bearer), mints a
  NEW web session family, sets the normal Strict refresh cookie, and 302s to `/maps`
  (errors 302 to `/login/callback?error=…`, never a 500 on a top-level navigation). It is
  the one sanctioned way a native session becomes a web cookie session.
```

Root `CLAUDE.md` — in the "Server env vars" mobile paragraph, append one sentence:

```markdown
The builder WebView converts a carry code into a web cookie session via
`GET /auth/mobile-web-handoff` (302 → `/maps`).
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md apps/server/CLAUDE.md
git commit -m "docs: document the builder-WebView session handoff"
```
