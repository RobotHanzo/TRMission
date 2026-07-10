# GA Analytics Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a typed client-side analytics layer (`track()` over Cloudflare Zaraz's `zaraz.track`) plus SPA `page_view` and ~36 curated GA4 events across the whole `apps/web` funnel, without ever leaking secret game state.

**Architecture:** A single new module `apps/web/src/lib/analytics.ts` exposes a `track(name, params)` typed against an `AnalyticsEvents` map (the map is the leak guard — params are safe primitives only). Delivery is `window.zaraz?.track` with a `gtag` fallback and a safe no-op in dev/tests. Call sites are one-liners in existing handlers, placed at store choke points where one exists (auth in `session.ts`; game lifecycle in `GameStage`). Gameplay events fire only when `GameStage` is **not** in sandbox mode, so tutorial/encyclopedia/replay never pollute analytics.

**Tech Stack:** React 18 + Vite 5 + TypeScript, zustand stores, vitest + @testing-library/react, protobuf-es (`@trm/proto` `GameSnapshot`).

## Global Constraints

- **`apps/web` pins Vite `^5`** (vitest 2 compatibility) — do not bump to Vite 6.
- **Never inflate the main bundle from `features/builder/`** — its call sites (Task 8) must stay inside the existing lazy route chunk; do not import `MapsScreen`/`ShareStage` eagerly.
- **Analytics is an egress surface.** No param may carry secret game state (hand, held ticket id/value, deck/market card identity, seed, opponent secret) or PII (email, display name, **chat message text**). This is enforced structurally by the `AnalyticsEvents` type — never widen a param to `string`/`unknown` to smuggle such a value.
- **Gameplay events fire only when `!sandbox`** in `GameStage` (`game_start`, `game_first_action`, `game_complete`, `route_claimed`, in-game `chat_send`).
- `Date.now()` is allowed in these files — this is the app layer, not `@trm/engine`; no determinism rule applies.
- **Naming is hybrid:** GA4 recommended names (`login`, `sign_up`, `tutorial_begin`, `tutorial_complete`) where the semantics match 1:1; readable custom `snake_case` otherwise.
- **Git:** conventional-commit messages; end each commit body with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. **Stage only the files this plan touches — never `git add -A`/`git add .`** (multiple agents share this worktree). Stay on `main`.
- **Validation commands** (run from repo root): `yarn workspace @trm/web test --run <substr>` (one suite), `yarn typecheck`, `yarn lint`, `yarn format:check`.

## File Structure

- **Create** `apps/web/src/lib/analytics.ts` — `track`, `trackPageView`, `AnalyticsEvents`, ambient `window.zaraz`/`window.gtag` types, `SCREEN_TO_PATH`. One responsibility: the analytics contract + delivery.
- **Create** `apps/web/src/lib/analytics.test.ts` — wrapper unit tests.
- **Create** `apps/web/src/hooks/usePageViewTracking.ts` + `.test.ts` — fire `page_view` on `useUi` view change (skip admin views).
- **Modify** call sites: `App.tsx`, `store/session.ts`, `store/ui.ts`, `screens/LoginCallback.tsx`, `screens/GameStage.tsx`, `screens/GameScreen.tsx`, `screens/HomeScreen.tsx`, `screens/RoomScreen.tsx`, `screens/WelcomeScreen.tsx`, `screens/HistoryScreen.tsx`, `screens/ReplayScreen.tsx`, `components/ScoreBoard.tsx`, `components/ChatPanel.tsx`, `components/AppHeader.tsx`, `components/SettingsModal.tsx`, `features/tutorial/TutorialScreen.tsx`, `features/replay/ReplayShare.tsx`, `features/builder/MapsScreen.tsx`, `features/builder/editor/stages/ShareStage.tsx`, `net/connection.ts`.
- **Modify tests:** `store/session.test.ts`, `screens/GameStage.*.test.tsx`.

---

### Task 1: Analytics wrapper module

**Files:**
- Create: `apps/web/src/lib/analytics.ts`
- Test: `apps/web/src/lib/analytics.test.ts`

**Interfaces:**
- Produces: `track<K extends keyof AnalyticsEvents>(name: K, params: AnalyticsEvents[K]): void`; `trackPageView(screen: View): void`; `interface AnalyticsEvents` (see below); `type AnalyticsEventName = keyof AnalyticsEvents`.

- [ ] **Step 1: Write the failing test** — `apps/web/src/lib/analytics.test.ts`

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { track, trackPageView } from './analytics';

declare global {
  // eslint-disable-next-line no-var
  var zaraz: { track: (n: string, p?: unknown) => void } | undefined;
  // eslint-disable-next-line no-var
  var gtag: ((...args: unknown[]) => void) | undefined;
}

describe('analytics.track', () => {
  beforeEach(() => {
    (window as unknown as { zaraz?: unknown }).zaraz = undefined;
    (window as unknown as { gtag?: unknown }).gtag = undefined;
  });
  afterEach(() => vi.restoreAllMocks());

  it('forwards to zaraz.track when present', () => {
    const spy = vi.fn();
    (window as unknown as { zaraz: unknown }).zaraz = { track: spy };
    track('login', { method: 'guest' });
    expect(spy).toHaveBeenCalledWith('login', { method: 'guest' });
  });

  it('falls back to gtag when zaraz is absent', () => {
    const spy = vi.fn();
    (window as unknown as { gtag: unknown }).gtag = spy;
    track('room_create', {});
    expect(spy).toHaveBeenCalledWith('event', 'room_create', {});
  });

  it('is a safe no-op when neither exists', () => {
    expect(() => track('logout', {})).not.toThrow();
  });

  it('trackPageView normalizes the path to the route template', () => {
    const spy = vi.fn();
    (window as unknown as { zaraz: unknown }).zaraz = { track: spy };
    trackPageView('room');
    expect(spy).toHaveBeenCalledWith(
      'page_view',
      expect.objectContaining({ screen: 'room', page_path: '/room/:code' }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/web test --run analytics`
Expected: FAIL — cannot resolve `./analytics`.

- [ ] **Step 3: Write minimal implementation** — `apps/web/src/lib/analytics.ts`

```ts
// Client-side analytics. GA4 is loaded by Cloudflare Zaraz at the edge, so events are sent through
// `zaraz.track` (which fans out to the GA4 Managed Component). This module is the ONLY analytics
// egress; its typed event map is the leak guard — params are safe primitives, never game secrets.
import type { View } from '../store/ui';

/** Every event name → its exact, safe param shape. Do NOT widen a value to carry game state/PII. */
export interface AnalyticsEvents {
  // auth
  login: { method: 'guest' | 'password' | 'google' | 'oauth' };
  sign_up: { method: 'password' };
  guest_upgrade: Record<string, never>;
  logout: Record<string, never>;
  // navigation
  page_view: { screen: string; page_path: string; page_title: string };
  // lobby
  room_create: Record<string, never>;
  room_join: { via: 'code' | 'public_list' | 'rejoin' };
  spectate_start: Record<string, never>;
  practice_start: Record<string, never>;
  bot_add: { difficulty: 'EASY' | 'MEDIUM' | 'HARD' };
  room_leave: Record<string, never>;
  game_start: {
    player_count: number;
    human_count: number;
    bot_count: number;
    map_source: 'official' | 'custom';
    map_id?: string;
    events_mode: string;
    is_spectator: boolean;
    is_practice?: boolean;
  };
  // in-game (LIVE only)
  game_first_action: { action: string };
  game_complete: {
    won: boolean;
    final_score: number;
    player_count: number;
    bot_count: number;
    duration_sec?: number;
    tickets_completed?: number;
    longest_path: boolean;
    is_spectator: boolean;
    map_id?: string;
  };
  route_claimed: { length: number; is_tunnel: boolean; is_ferry: boolean; map_id?: string };
  chat_send: { kind: 'text' | 'preset'; context: 'lobby' | 'game' };
  reconnect: Record<string, never>;
  session_replaced: Record<string, never>;
  // end-of-game
  rating_submit: { stars: number };
  rematch_vote: { wants: boolean };
  play_again: Record<string, never>;
  discord_click: { source: 'welcome' | 'endgame' | 'header' };
  // onboarding
  tutorial_begin: { scope: 'full' | 'core' };
  tutorial_complete: Record<string, never>;
  welcome_shown: Record<string, never>;
  encyclopedia_open: Record<string, never>;
  // replay
  replay_open: { source: 'history' | 'link' };
  replay_share_change: { visibility: 'private' | 'link' };
  // builder
  map_create: Record<string, never>;
  map_fork: { map_id: string };
  map_clone: Record<string, never>;
  map_share_mint: { map_id: string };
  map_testplay: { map_id: string };
  map_delete: Record<string, never>;
  // settings
  settings_change: {
    setting: 'locale' | 'theme' | 'board_layout' | 'colorblind' | 'sound';
    value: string;
  };
  room_settings_change: { setting: string };
}

export type AnalyticsEventName = keyof AnalyticsEvents;

interface ZarazLike {
  track?: (name: string, params?: Record<string, unknown>) => void;
}
type GtagLike = (command: 'event', name: string, params?: Record<string, unknown>) => void;

function sink(): { zaraz?: ZarazLike; gtag?: GtagLike } {
  if (typeof window === 'undefined') return {};
  const w = window as unknown as { zaraz?: ZarazLike; gtag?: GtagLike };
  return { zaraz: w.zaraz, gtag: w.gtag };
}

export function track<K extends AnalyticsEventName>(name: K, params: AnalyticsEvents[K]): void {
  const p = params as Record<string, unknown>;
  if (import.meta.env.DEV) console.debug('[analytics]', name, p);
  const { zaraz, gtag } = sink();
  if (zaraz?.track) zaraz.track(name, p);
  else if (gtag) gtag('event', name, p);
}

/** Screen → route template. Room codes / game ids are intentionally NOT interpolated, so page paths
 *  stay low-cardinality; those ids ride on domain events (`game_start`, `replay_open`) instead. */
const SCREEN_TO_PATH: Record<View, string> = {
  home: '/',
  room: '/room/:code',
  game: '/room/:code',
  tutorial: '/tutorial',
  login: '/login',
  loginCallback: '/login/callback',
  history: '/history',
  replay: '/replay/:gameId',
  adminReplay: '/admin-replay/:gameId',
  adminSpectate: '/admin-spectate/:gameId',
  maps: '/maps',
  mapEditor: '/maps/:id/edit',
};

export function trackPageView(screen: View): void {
  track('page_view', {
    screen,
    page_path: SCREEN_TO_PATH[screen] ?? '/',
    page_title: typeof document === 'undefined' ? '' : document.title,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @trm/web test --run analytics`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/analytics.ts apps/web/src/lib/analytics.test.ts
git commit -m "feat(web): add typed analytics wrapper over zaraz.track"
```

---

### Task 2: SPA page_view on route change

**Files:**
- Create: `apps/web/src/hooks/usePageViewTracking.ts`
- Test: `apps/web/src/hooks/usePageViewTracking.test.ts`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: `trackPageView` (Task 1), `useUi` `view` field.
- Produces: `usePageViewTracking(): void`.

- [ ] **Step 1: Write the failing test** — `apps/web/src/hooks/usePageViewTracking.test.ts`

```ts
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useUi } from '../store/ui';
import { usePageViewTracking } from './usePageViewTracking';

const track = vi.hoisted(() => vi.fn());
vi.mock('../lib/analytics', () => ({ trackPageView: (s: string) => track(s) }));

afterEach(() => {
  track.mockClear();
  useUi.setState({ view: 'home' });
});

describe('usePageViewTracking', () => {
  it('fires on mount and on each view change, skipping admin views', () => {
    renderHook(() => usePageViewTracking());
    expect(track).toHaveBeenLastCalledWith('home');

    act(() => useUi.setState({ view: 'room' }));
    expect(track).toHaveBeenLastCalledWith('room');

    track.mockClear();
    act(() => useUi.setState({ view: 'adminReplay' }));
    expect(track).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/web test --run usePageViewTracking`
Expected: FAIL — cannot resolve `./usePageViewTracking`.

- [ ] **Step 3: Write minimal implementation** — `apps/web/src/hooks/usePageViewTracking.ts`

```ts
import { useEffect } from 'react';
import { useUi } from '../store/ui';
import { trackPageView } from '../lib/analytics';

// Maintainer-only routes are excluded from product analytics.
const SKIP = new Set(['adminReplay', 'adminSpectate']);

/** Fire a GA `page_view` on every SPA view change (Zaraz's automatic pageview only fires on hard
 *  navigation, so client-side route changes are otherwise invisible). */
export function usePageViewTracking(): void {
  const view = useUi((s) => s.view);
  useEffect(() => {
    if (SKIP.has(view)) return;
    trackPageView(view);
  }, [view]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @trm/web test --run usePageViewTracking`
Expected: PASS.

- [ ] **Step 5: Wire it into `App.tsx`**

In `apps/web/src/App.tsx`, add the import and call the hook once inside the `App` component body (top level, next to the other hooks near `restore()`):

```ts
import { usePageViewTracking } from './hooks/usePageViewTracking';
```

```ts
  usePageViewTracking();
```

- [ ] **Step 6: Typecheck + lint**

Run: `yarn typecheck && yarn lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/hooks/usePageViewTracking.ts apps/web/src/hooks/usePageViewTracking.test.ts apps/web/src/App.tsx
git commit -m "feat(web): fire GA page_view on SPA route changes"
```

---

### Task 3: Auth events (login / sign_up / guest_upgrade / logout)

**Files:**
- Modify: `apps/web/src/store/session.ts`
- Modify: `apps/web/src/screens/LoginCallback.tsx`
- Test: `apps/web/src/store/session.test.ts`

**Interfaces:**
- Consumes: `track` (Task 1).

- [ ] **Step 1: Write the failing test** — add to `apps/web/src/store/session.test.ts`

```ts
import { track } from '../lib/analytics';
vi.mock('../lib/analytics', () => ({ track: vi.fn() }));

// ...inside the existing describe (adapt api mocking to match this file's existing pattern):
it('emits login {method:guest} on playAsGuest success', async () => {
  await useSession.getState().playAsGuest('Ada');
  expect(track).toHaveBeenCalledWith('login', { method: 'guest' });
});

it('emits sign_up {method:password} on register success', async () => {
  await useSession.getState().register('a@b.co', 'pw123456', 'Ada');
  expect(track).toHaveBeenCalledWith('sign_up', { method: 'password' });
});
```

(If `session.test.ts` already mocks `../net/rest`, reuse that mock so `api.guest`/`api.register` resolve; do not add a second `vi.mock` for rest.)

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/web test --run session`
Expected: FAIL — `track` not called.

- [ ] **Step 3: Implement** — `apps/web/src/store/session.ts`

Add the import:

```ts
import { track } from '../lib/analytics';
```

Give `run` an optional success hook and fire it inside the try (only on success):

```ts
  const run = async (
    action: () => Promise<{ user: PublicUser }>,
    onSuccess?: () => void,
  ): Promise<void> => {
    set({ loading: true, error: null });
    try {
      const r = await action();
      set({ user: r.user, loading: false });
      hydratePrefs(r.user);
      onSuccess?.();
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
    }
  };
```

Pass the event per method:

```ts
    playAsGuest: (name) =>
      run(() => api.guest(name?.trim() || undefined), () => track('login', { method: 'guest' })),
    login: (email, password) =>
      run(() => api.login(email.trim(), password), () => track('login', { method: 'password' })),
    loginWithGoogleCredential: (credential) =>
      run(() => api.googleCredential(credential), () => track('login', { method: 'google' })),
    register: (email, password, displayName) =>
      run(
        () => api.register(email.trim(), password, displayName.trim()),
        () => track('sign_up', { method: 'password' }),
      ),
    upgrade: (email, password) =>
      run(() => api.upgrade(email.trim(), password), () => track('guest_upgrade', {})),
```

In `logout()`, after clearing state, fire logout:

```ts
    async logout() {
      set({ user: null, accessToken: null });
      track('logout', {});
      await api.logout().catch(() => undefined);
    },
```

- [ ] **Step 4: Wire OAuth-redirect login** — `apps/web/src/screens/LoginCallback.tsx`

In the success branch (where `navigateAfterAuth()` runs after `restore()` succeeds, ~line 23), emit a coarse OAuth login (provider + new-vs-returning aren't known on this path — accepted limitation):

```ts
import { track } from '../lib/analytics';
```

```ts
      track('login', { method: 'oauth' });
      navigateAfterAuth();
```

- [ ] **Step 5: Run tests + typecheck**

Run: `yarn workspace @trm/web test --run session && yarn typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/store/session.ts apps/web/src/screens/LoginCallback.tsx apps/web/src/store/session.test.ts
git commit -m "feat(web): track auth events (login/sign_up/guest_upgrade/logout)"
```

---

### Task 4: Game lifecycle events + sandbox gating

**Files:**
- Modify: `apps/web/src/store/ui.ts` (add `isPractice` flag + setter)
- Modify: `apps/web/src/screens/GameStage.tsx`
- Test: `apps/web/src/screens/GameStage.gate.test.tsx` (or the nearest existing `GameStage.*.test.tsx`)

**Interfaces:**
- Consumes: `track` (Task 1); `GameSnapshot` fields `players[]` (`{id,seat,...}`), `you`, `gameSettings.eventsMode`, `phase`, `finalScores` (`players[].total/ticketsCompleted/longestBonus`, `ranking[].playerIds`), `contentHash`.
- Produces (from `ui.ts`): `isPractice: boolean`, `setPractice(v: boolean): void` (consumed by Task 5's `startPractice`).

- [ ] **Step 1: Add the `isPractice` flag to `ui.ts`**

In `apps/web/src/store/ui.ts`, add to the store state interface, the initial state, and the actions (mirror the existing flat state fields):

```ts
  // Analytics: set true by the practice-vs-bots flow so game_start can tag the match.
  isPractice: boolean;
  setPractice(isPractice: boolean): void;
```

```ts
  isPractice: false,
  setPractice: (isPractice) => set({ isPractice }),
```

- [ ] **Step 2: Write the failing gating test** — `apps/web/src/screens/GameStage.gate.test.tsx` (add cases; reuse the file's existing render helper + GAME_OVER snapshot factory)

```ts
import { track } from '../lib/analytics';
vi.mock('../lib/analytics', () => ({ track: vi.fn() }));

it('sandbox GAME_OVER fires NO gameplay events', () => {
  renderGameStage({ sandbox: true, snapshot: gameOverSnapshot() });
  expect(track).not.toHaveBeenCalledWith('game_complete', expect.anything());
  expect(track).not.toHaveBeenCalledWith('game_start', expect.anything());
});

it('live GAME_OVER fires game_complete exactly once', () => {
  const { rerender } = renderGameStage({ sandbox: false, snapshot: gameOverSnapshot() });
  rerender(<GameStage {...propsWith(gameOverSnapshot())} />); // a re-render must not double-fire
  const calls = (track as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter(
    (c) => c[0] === 'game_complete',
  );
  expect(calls).toHaveLength(1);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `yarn workspace @trm/web test --run GameStage.gate`
Expected: FAIL — `game_complete` never fired (or fired in sandbox).

- [ ] **Step 4: Implement in `GameStage.tsx`**

Add imports (Task 1 `track`; `useUi` and `Phase` are already imported):

```ts
import { track } from '../lib/analytics';
import { resolveContentMeta } from '../game/contentCache'; // see note below
```

Note: for `map_source`/`map_id`, use whatever the file already has to resolve `snapshot.contentHash` (this component already renders through the active catalog). If a synchronous helper isn't already in scope, derive `map_source` as `'official'` when `contentCache` reports the hash as a bundled official map and `'custom'` otherwise, and `map_id` as the official mapId or the `contentHash`. Keep it a pure read — do not add a fetch.

Add a helper and effects near the top of the component body (after the existing hooks). `gameId` from `useUi` is the once-per-game key:

```ts
  const gameId = useUi((s) => s.gameId);
  const isPractice = useUi((s) => s.isPractice);
  const startedRef = useRef<string | null>(null);
  const completedRef = useRef<string | null>(null);
  const startMsRef = useRef<number>(0);

  // Player-count + spectator derivation shared by start/complete.
  const counts = () => {
    const players = snapshot.players ?? [];
    const bot_count = players.filter((p) => p.id.startsWith('bot:')).length;
    return { player_count: players.length, bot_count, human_count: players.length - bot_count };
  };
  const isSpectator = !snapshot.you;
  const mapId = snapshot.contentHash; // refine to official mapId when resolvable (see note)
  const mapSource: 'official' | 'custom' = 'custom'; // set 'official' when contentCache says so

  // game_start — once per live gameId.
  useEffect(() => {
    if (sandbox || !gameId || startedRef.current === gameId) return;
    startedRef.current = gameId;
    startMsRef.current = Date.now();
    track('game_start', {
      ...counts(),
      map_source: mapSource,
      map_id: mapId,
      events_mode: snapshot.gameSettings?.eventsMode ?? 'off',
      is_spectator: isSpectator,
      is_practice: isPractice,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sandbox, gameId]);

  // game_complete — once per live gameId when the game reaches GAME_OVER.
  useEffect(() => {
    if (sandbox || !gameId || snapshot.phase !== Phase.GAME_OVER || completedRef.current === gameId)
      return;
    completedRef.current = gameId;
    const me = snapshot.you?.playerId;
    const fs = snapshot.finalScores;
    const mine = fs?.players.find((p) => p.playerId === me);
    const won = !!me && !!fs?.ranking?.[0]?.playerIds.includes(me);
    track('game_complete', {
      won,
      final_score: mine?.total ?? 0,
      ...counts(),
      duration_sec: startMsRef.current ? Math.round((Date.now() - startMsRef.current) / 1000) : undefined,
      tickets_completed: mine?.ticketsCompleted,
      longest_path: (mine?.longestBonus ?? 0) > 0,
      is_spectator: isSpectator,
      map_id: mapId,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sandbox, gameId, snapshot.phase]);
```

For **game_first_action**, wrap the incoming commands once so the first live move fires it. Change the destructured prop from `commands` to `commands: rawCommands`, then build a memoized wrapper that all existing `commands?.…()` call sites transparently use:

```ts
  const firstActionRef = useRef<string | null>(null);
  const commands = useMemo(() => {
    if (sandbox || !rawCommands) return rawCommands;
    const fire = (action: string) => {
      if (firstActionRef.current === gameId) return;
      firstActionRef.current = gameId;
      track('game_first_action', { action });
    };
    return {
      ...rawCommands,
      drawBlind: () => { fire('draw_blind'); return rawCommands.drawBlind(); },
      drawFaceUp: (slot: number) => { fire('draw_faceup'); return rawCommands.drawFaceUp(slot); },
      drawTickets: () => { fire('draw_tickets'); return rawCommands.drawTickets(); },
      keepInitialTickets: (ids: string[]) => { fire('keep_initial'); return rawCommands.keepInitialTickets(ids); },
      keepTickets: (ids: string[]) => { fire('keep_tickets'); return rawCommands.keepTickets(ids); },
      claimRoute: (routeId: string, payment) => { fire('claim_route'); return rawCommands.claimRoute(routeId, payment); },
      buildStation: (cityId: string, payment) => { fire('build_station'); return rawCommands.buildStation(cityId, payment); },
      resolveTunnel: (commit: boolean, extra?) => { fire('resolve_tunnel'); return rawCommands.resolveTunnel(commit, extra); },
    } as typeof rawCommands;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawCommands, sandbox, gameId]);
```

(Match the exact method signatures in `net/commands.ts` `GameCommands`; the spread preserves `chat`/`chatPreset`/`cameraUpdate`/`pass` unwrapped so only real moves trigger `game_first_action`.)

For **route_claimed**, in the existing `confirmPayment` handler (~line 246), where a route claim commits and the `claim.route` `RouteDef` is in scope, add (live only):

```ts
      if (!sandbox && claim.kind === 'route') {
        track('route_claimed', {
          length: claim.route.length,
          is_tunnel: !!claim.route.isTunnel,
          is_ferry: (claim.route.ferryLocos ?? 0) > 0,
          map_id: snapshot.contentHash,
        });
      }
```

(Confirm the `RouteDef` field names `length`/`isTunnel`/`ferryLocos` against `@trm/map-data`; adjust if the local `claim.route` uses different accessors.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `yarn workspace @trm/web test --run GameStage`
Expected: PASS (gating + once-per-game).

- [ ] **Step 6: Typecheck + lint**

Run: `yarn typecheck && yarn lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/store/ui.ts apps/web/src/screens/GameStage.tsx apps/web/src/screens/GameStage.gate.test.tsx
git commit -m "feat(web): track game lifecycle (start/first-action/complete/route) live-only"
```

---

### Task 5: Lobby & matchmaking events

**Files:**
- Modify: `apps/web/src/screens/HomeScreen.tsx`, `apps/web/src/screens/RoomScreen.tsx`

**Interfaces:**
- Consumes: `track` (Task 1); `useUi().setPractice` (Task 4).

- [ ] **Step 1: Add the calls** (each is one line inside the named handler; `import { track } from '../lib/analytics';` at the top of each file, and `useUi`'s `setPractice` where noted)

`HomeScreen.tsx`:
- In `create()` (~:170), after `createRoom` succeeds, before/at `enterRoom(code)`: `track('room_create', {});`
- In `join()` (~:181), on a successful join: `track('room_join', { via: 'code' });`
- Public-list open (~:299) `onClick`: `track('room_join', { via: 'public_list' });`
- Rejoin-banner (~:240) `onClick`: `track('room_join', { via: 'rejoin' });`
- `watch()` (~:157) success (~:301 entry): `track('spectate_start', {});`
- `startPractice()` (~:136): before navigating, `useUi.getState().setPractice(true); track('practice_start', {});`
- Encyclopedia open (~:310): `track('encyclopedia_open', {});`

`RoomScreen.tsx`:
- `addBot(d)` (~:509): `track('bot_add', { difficulty: d });`
- `onLeaveClick` (~:291): `track('room_leave', {});`
- Each settings mutation (`setSetting` at map/rules/events/visibility, ~:397/:454/:468/:493): `track('room_settings_change', { setting: '<field>' });` where `<field>` is the setting key being changed (`'map'`, `'unlimitedStationBorrow'`, `'eventsMode'`, `'visibility'`, …).
- Lobby chat send free-text (~:624): `track('chat_send', { kind: 'text', context: 'lobby' });`
- Lobby chat preset (~:627): `track('chat_send', { kind: 'preset', context: 'lobby' });`

Reset the practice flag when a live game_start has consumed it is unnecessary; instead clear it on leaving the game path — add to `RoomScreen`'s leave/close and on entering a non-practice room: `useUi.getState().setPractice(false)` in `HomeScreen.create()` and `join()` (so a normal room isn't mislabeled). Add `track` import + this one `setPractice(false)` line to `create()`/`join()`.

- [ ] **Step 2: Typecheck + lint**

Run: `yarn typecheck && yarn lint`
Expected: PASS.

- [ ] **Step 3: Run web suite (no regressions)**

Run: `yarn workspace @trm/web test --run HomeScreen && yarn workspace @trm/web test --run RoomScreen`
Expected: PASS (existing tests unaffected).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/screens/HomeScreen.tsx apps/web/src/screens/RoomScreen.tsx
git commit -m "feat(web): track lobby/matchmaking events"
```

---

### Task 6: In-game comms & connection events

**Files:**
- Modify: `apps/web/src/components/ChatPanel.tsx`, `apps/web/src/net/connection.ts`, `apps/web/src/screens/GameScreen.tsx`

**Interfaces:**
- Consumes: `track` (Task 1). `ChatPanel` gates on the same sandbox notion used elsewhere in-game.

- [ ] **Step 1: Add the calls**

`ChatPanel.tsx` — `import { track } from '../lib/analytics';`. The in-game chat is only real usage outside sandbox; `ChatPanel` renders inside `CommsPanel`. Gate on a `sandbox` prop if the component already receives one, else on the presence of the live socket (`getSocket()` is truthy for live). In `send()` (~:58): `track('chat_send', { kind: 'text', context: 'game' });` and in `sendPreset` (~:67): `track('chat_send', { kind: 'preset', context: 'game' });` — only when not sandbox.

`net/connection.ts` — `import { track } from '../lib/analytics';`. In the resync-after-drop path (~:25, where a dropped socket successfully re-fetches a ticket and resyncs on a fresh snapshot): `track('reconnect', {});`. Guard so it fires only on an actual reconnect (a prior disconnect happened), not the initial connect.

`GameScreen.tsx` — `import { track } from '../lib/analytics';`. Where `sessionReplaced` becomes true and the modal shows (~:135): `track('session_replaced', {});` (fire once, e.g. in the effect that reacts to the `sessionReplaced` flag).

- [ ] **Step 2: Typecheck + lint**

Run: `yarn typecheck && yarn lint`
Expected: PASS.

- [ ] **Step 3: Run affected suites**

Run: `yarn workspace @trm/web test --run ChatPanel && yarn workspace @trm/web test --run GameScreen`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/ChatPanel.tsx apps/web/src/net/connection.ts apps/web/src/screens/GameScreen.tsx
git commit -m "feat(web): track in-game chat, reconnect, session-replaced"
```

---

### Task 7: End-of-game & app-chrome events

**Files:**
- Modify: `apps/web/src/components/ScoreBoard.tsx`, `apps/web/src/screens/WelcomeScreen.tsx`, `apps/web/src/components/AppHeader.tsx`

**Interfaces:**
- Consumes: `track` (Task 1).

- [ ] **Step 1: Add the calls** (each file gets `import { track } from '...';`)

`ScoreBoard.tsx`:
- `submitRating()` success (~:305 button → the `submitRating` fn ~:92, after `api.submitRating` resolves): `track('rating_submit', { stars });`
- Rematch vote (~:282) `onVote(!myVote)`: `track('rematch_vote', { wants: !myVote });`
- Play again (~:287) `onPlayAgain`: `track('play_again', {});`
- Discord CTA (~:315) `openDiscord`: `track('discord_click', { source: 'endgame' });`

`WelcomeScreen.tsx`:
- On mount, once (impression): `track('welcome_shown', {});` (a `useEffect(() => { track('welcome_shown', {}); }, [])`).
- Discord CTA (~:110): `track('discord_click', { source: 'welcome' });`

`AppHeader.tsx`:
- Encyclopedia open (desktop ~:239 / phone ~:176): `track('encyclopedia_open', {});`
- Discord (~:246): `track('discord_click', { source: 'header' });`

- [ ] **Step 2: Typecheck + lint**

Run: `yarn typecheck && yarn lint`
Expected: PASS.

- [ ] **Step 3: Run affected suites**

Run: `yarn workspace @trm/web test --run ScoreBoard && yarn workspace @trm/web test --run AppHeader`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/ScoreBoard.tsx apps/web/src/screens/WelcomeScreen.tsx apps/web/src/components/AppHeader.tsx
git commit -m "feat(web): track end-of-game and app-chrome events"
```

---

### Task 8: Onboarding, replay, builder & settings events

**Files:**
- Modify: `apps/web/src/features/tutorial/TutorialScreen.tsx`, `apps/web/src/store/ui.ts`, `apps/web/src/screens/ReplayScreen.tsx`, `apps/web/src/features/replay/ReplayShare.tsx`, `apps/web/src/features/builder/MapsScreen.tsx`, `apps/web/src/features/builder/editor/stages/ShareStage.tsx`, `apps/web/src/components/SettingsModal.tsx`

**Interfaces:**
- Consumes: `track` (Task 1). `ui.ts` gains a transient `replaySource` set by `enterReplay`, read+cleared by `ReplayScreen`.

- [ ] **Step 1: `ui.ts` — replay source flag**

Add state `replaySource: 'history' | 'link' | null` (initial `null`) with `set({ replaySource: 'history' })` inside `enterReplay(...)` and a `consumeReplaySource()` action that returns the current value and resets it to `null`. Keep it in the flat store shape like the other fields.

- [ ] **Step 2: Add the call sites** (each file: `import { track } from '...';`)

`TutorialScreen.tsx`:
- Scope pick (~:27 full / :31 core): `track('tutorial_begin', { scope: 'full' });` / `{ scope: 'core' }`.
- `finishTutorial` (~:141): `track('tutorial_complete', {});`

`ReplayScreen.tsx`:
- On successful replay load (once, in the load effect): `const source = useUi.getState().consumeReplaySource() ?? 'link'; track('replay_open', { source });`

`ReplayShare.tsx`:
- Visibility change (~:50/:55) `change()`: `track('replay_share_change', { visibility });` (the new value).

`MapsScreen.tsx`:
- `create()` (~:86): `track('map_create', {});`
- `doFork` (~:54): `track('map_fork', { map_id: mapId });`
- `doClone` (~:117) success: `track('map_clone', {});`
- Delete (~:150 → `remove` ~:101) success: `track('map_delete', {});`

`ShareStage.tsx`:
- `mintShare` (~:78) success: `track('map_share_mint', { map_id: id });`
- `createRoomWithMap` (~:87): `track('map_testplay', { map_id: id });`

`SettingsModal.tsx`:
- `chooseTheme` (~:114): `track('settings_change', { setting: 'theme', value: theme });`
- `chooseLocale` (~:124): `track('settings_change', { setting: 'locale', value: locale });`
- `chooseLayout` (~:137): `track('settings_change', { setting: 'board_layout', value: layout });`
- `chooseColorBlind` (~:148): `track('settings_change', { setting: 'colorblind', value: String(on) });`
- `setSoundEnabled` (~:163): `track('settings_change', { setting: 'sound', value: String(enabled) });`

- [ ] **Step 3: Typecheck + lint (verify builder stays lazy)**

Run: `yarn typecheck && yarn lint`
Expected: PASS. Confirm no new eager import of `MapsScreen`/`ShareStage` was introduced (they must stay in the lazy chunk — `track` is imported *inside* those already-lazy files, which is fine).

- [ ] **Step 4: Run affected suites**

Run: `yarn workspace @trm/web test --run SettingsModal && yarn workspace @trm/web test --run ReplayScreen`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/tutorial/TutorialScreen.tsx apps/web/src/store/ui.ts apps/web/src/screens/ReplayScreen.tsx apps/web/src/features/replay/ReplayShare.tsx apps/web/src/features/builder/MapsScreen.tsx apps/web/src/features/builder/editor/stages/ShareStage.tsx apps/web/src/components/SettingsModal.tsx
git commit -m "feat(web): track onboarding, replay, builder, settings events"
```

---

### Task 9: Full validation & build

**Files:** none (verification only).

- [ ] **Step 1: Full web test suite**

Run: `yarn workspace @trm/web test`
Expected: PASS (all suites).

- [ ] **Step 2: Repo-wide gates**

Run: `yarn typecheck && yarn lint && yarn format:check`
Expected: PASS. If `format:check` flags files, run `yarn format` and amend the last commit or add a `style` commit.

- [ ] **Step 3: Production build (bundle sanity)**

Run: `yarn workspace @trm/web build`
Expected: PASS; no main-bundle size regression attributable to `features/builder/` (its analytics calls live in the existing lazy chunk).

- [ ] **Step 4: Manual smoke (optional but recommended)**

`yarn workspace @trm/server dev` + `yarn workspace @trm/web dev`, open the app with devtools console open, and confirm `[analytics]` debug lines fire on: a screen navigation (`page_view`), guest login (`login {method:guest}`), creating a room (`room_create`), and a tutorial start (`tutorial_begin`). Confirm **no** gameplay event fires while stepping through the tutorial.

- [ ] **Step 5: Final commit (if Step 2 produced formatting changes only)**

```bash
git add -u apps/web/src
git commit -m "style(web): format analytics wiring"
```

---

## Self-Review

**Spec coverage:** wrapper §The wrapper → Task 1; `page_view` §SPA page_view → Task 2; auth events → Task 3; sandbox gating + game lifecycle §Sandbox gating/§Event catalog → Task 4; lobby → Task 5; in-game comms/connection → Task 6; end-of-game/chrome → Task 7; onboarding/replay/builder/settings → Task 8; testing §Testing → Tasks 1–4 + Task 9; guardrails → Global Constraints + the typed `AnalyticsEvents` map; consent §Consent → no code (Zaraz layer), noted; known limitations §OAuth → Task 3 Step 4. All ~36 catalog events map to a task.

**Placeholder scan:** no TBD/TODO. The only deliberately deferred derivations (`map_source`/`map_id` official-vs-custom resolution in Task 4; exact `RouteDef`/`GameCommands` field names) carry an explicit "confirm against the type and adjust" instruction with the concrete field names to expect — not vague hand-waving.

**Type consistency:** `track`/`trackPageView`/`AnalyticsEvents` names match across tasks; `setPractice`/`isPractice` (Task 4) consumed in Task 5; `replaySource`/`consumeReplaySource` (Task 8) defined and consumed within Task 8; event names + param shapes in every call site match the `AnalyticsEvents` map in Task 1.
