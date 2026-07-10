# Google Analytics event taxonomy — design

## Goal

The web app (`apps/web`) loads Google Analytics via **Cloudflare Zaraz, injected at the edge** —
nothing in the repo references `gtag`/`dataLayer`/`zaraz` (verified: no matches in `apps/web`). So
today GA sees only Zaraz's automatic hard-navigation pageview and **zero custom events**, and in a
Vite SPA that means every screen after the landing page is invisible.

Add a small, typed analytics layer plus call sites that emit a curated set of events spanning the
whole funnel — acquisition → activation → engagement → retention — including gameplay/balance
signals. Naming is **hybrid**: GA4 *recommended* event names where the semantics match 1:1
(`login`, `sign_up`, `tutorial_begin`, `tutorial_complete`), readable custom `snake_case` for
everything else. All three taxonomy tiers are wired in this slice.

## Non-goals / out of scope

- **No per-turn event stream.** Individual draws / keeps / payments are not emitted; per-game
  aggregates ride on `game_complete`, plus one `game_first_action` activation ping and (for
  balance data) `route_claimed`. This keeps GA out of flood territory for a game that is hundreds
  of moves long.
- **No analytics for sandbox play.** Tutorial, encyclopedia, and replay run real gameplay through
  the same `GameStage`/`GameCommands`; none of it is real usage, so gameplay events never fire in
  sandbox mode (see §Sandbox gating).
- **No maintainer/admin surface.** `adminReplay` / `adminSpectate` routes (dashboard-ticket only)
  are excluded.
- **No server-side analytics, no new backend, no Mongo.** This is a client-only concern.
- **No client-side consent gate.** Consent is a Zaraz-layer responsibility (see §Consent).
- **No account-identity / `user_id` stitching** in this slice — events are anonymous;
  Zaraz/GA's own client id is the only identity. (A future `user_id` from the session is a
  possible follow-up but is deliberately deferred for privacy simplicity.)

## Guardrails (binding for this codebase)

The system is built around hidden information and a single `redactFor` egress choke point. **The
analytics layer is another egress surface and is held to the same standard.**

1. **No secret game state in any param** — never a hand, held ticket id/value, deck/market card
   identity, `seed`, opponent secret, or per-action card colours. Enforced *structurally*: event
   params are a typed map of safe primitives (counts, enums, booleans, already-public ids), so a
   caller *cannot* pass game state — the types don't permit it.
2. **No PII / no free text** — never an email, display name, or **chat message text**. Chat emits
   only `{ kind, context }`. IDs appear only where already public to the client (e.g. `map_id`).
3. **Bounded volume** — no per-turn events (see Non-goals).

## The wrapper — `apps/web/src/lib/analytics.ts` (new)

A single typed entry point plus the event→params contract.

```ts
// The event contract: every event name maps to its exact, safe param shape.
// Params are constrained to primitives — this map is the leak guard.
export interface AnalyticsEvents {
  // --- auth (GA4 recommended names where 1:1) ---
  login: { method: 'guest' | 'password' | 'google' | 'oauth' };
  sign_up: { method: 'password' };
  guest_upgrade: Record<string, never>;
  logout: Record<string, never>;

  // --- navigation ---
  page_view: { screen: string; page_path: string; page_title: string };

  // --- lobby / matchmaking ---
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

  // --- in-game (LIVE only, never sandbox) ---
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

  // --- end-of-game ---
  rating_submit: { stars: number };
  rematch_vote: { wants: boolean };
  play_again: Record<string, never>;
  discord_click: { source: 'welcome' | 'endgame' | 'header' };

  // --- onboarding ---
  tutorial_begin: { scope: 'full' | 'core' };
  tutorial_complete: Record<string, never>;
  welcome_shown: Record<string, never>;
  encyclopedia_open: Record<string, never>;

  // --- replay ---
  replay_open: { source: 'history' | 'link' };
  replay_share_change: { visibility: 'private' | 'link' };

  // --- builder ---
  map_create: Record<string, never>;
  map_fork: { map_id: string };
  map_clone: Record<string, never>;
  map_share_mint: { map_id: string };
  map_testplay: { map_id: string };
  map_delete: Record<string, never>;

  // --- settings ---
  settings_change: {
    setting: 'locale' | 'theme' | 'board_layout' | 'colorblind' | 'sound';
    value: string;
  };
  room_settings_change: { setting: string };
}

export function track<K extends keyof AnalyticsEvents>(name: K, params: AnalyticsEvents[K]): void;
```

**Delivery.** `track` calls `window.zaraz?.track?.(name, params)`, falling back to
`window.gtag?.('event', name, params)`. When neither exists (local dev, jsdom tests) it is a safe
no-op; in `import.meta.env.DEV` it also `console.debug`s the event so devs can watch events fire. No
custom queue — Zaraz's edge stub already buffers pre-init `track` calls. A minimal ambient type for
`window.zaraz` / `window.gtag` lives in this file (or `vite-env.d.ts`).

**Why a wrapper, not call-`zaraz`-directly:** one typed choke point gives compile-time event/param
safety (the leak guard), a testable seam, and a single place to swap delivery if Zaraz is ever
replaced.

## SPA `page_view`

Zaraz's automatic pageview fires only on hard navigation; this app is a `pushState` SPA driven by a
`view` enum in `store/ui.ts`, so subsequent screens never fire one. Fix:

- An effect in `App.tsx` calls `track('page_view', …)` whenever the `useUi` `view` changes (initial
  mount included).
- **`page_path` is the route *template*, not the live URL** — `/room/:code` and `/replay/:gameId`
  are normalized so room codes / game ids never enter page paths (cardinality + those ids ride on
  `game_start` / `replay_open` instead). A `screen → template` map (derived from the `View` enum,
  mirroring the path map in `store/ui.ts:27-43`) lives in `analytics.ts` as a `trackPageView(view)`
  helper. `screen` (the raw view enum) is the intended reporting dimension.
- **Ops note (external, one toggle):** disable Zaraz's *automatic* GA4 pageview in the Cloudflare
  Zaraz GA4 tool config so the landing page isn't double-counted; the effect then owns all
  pageviews. Code is correct with or without this — the toggle only dedupes the first hit.

## Sandbox gating

Tutorial, encyclopedia, and replay drive **real** gameplay through the same `GameStage` and
`GameCommands` interface as live play, backed by `net/sandboxSocket.ts` instead of `net/socket.ts`.
None of it is real usage. Therefore **every gameplay event fires only when `GameStage` is not in
sandbox mode**: `game_start`, `game_first_action`, `game_complete`, `route_claimed`, and the
in-game `chat_send`. `GameStage` already carries a `sandbox` flag; all gameplay `track` calls are
guarded by `!sandbox`. Tutorial/replay have their own intended events (`tutorial_*`, `replay_open`).

## Event catalog & placement

All ~36 events, with the trigger the exploration located. Store-level **choke points** are used
where one call site catches every UI entry (auth in `session.ts`; game start/end derived from the
snapshot); everything else is a one-liner in the existing handler.

| Event | GA4 name? | Trigger (`file:line`) | Params |
|---|---|---|---|
| `page_view` | recommended | `App.tsx` effect on `view` change | screen, page_path, page_title |
| `login` | recommended | `store/session.ts:67/68/69` + `screens/LoginCallback.tsx:23` | method |
| `sign_up` | recommended | `store/session.ts:70` (register) | method: password |
| `guest_upgrade` | custom | `store/session.ts:72` (`screens/HomeScreen.tsx:48`) | — |
| `logout` | custom | `store/session.ts:73` | — |
| `room_create` | custom | `screens/HomeScreen.tsx:170` | — |
| `room_join` | custom | `screens/HomeScreen.tsx:181` / `:299` / `:240` | via |
| `spectate_start` | custom | `screens/HomeScreen.tsx:301` (watch) | — |
| `practice_start` | custom | `screens/HomeScreen.tsx:136` | — |
| `bot_add` | custom | `screens/RoomScreen.tsx:509` | difficulty |
| `room_leave` | custom | `screens/RoomScreen.tsx:291` (`onLeaveClick`) | — |
| `game_start` | custom | derived, `store/game.ts` first live snapshot (once per `gameId`) | counts, map_*, events_mode, is_spectator, is_practice |
| `game_first_action` | custom | first local command in `screens/GameStage.tsx` (once, `!sandbox`) | action |
| `game_complete` | custom | `screens/GameStage.tsx` effect on `Phase.GAME_OVER` (once, `!sandbox`) | won, score, counts, duration_sec, tickets_completed, longest_path, is_spectator, map_id |
| `route_claimed` | custom | `screens/GameStage.tsx:246` (`confirmPayment`, CLAIM_ROUTE, `!sandbox`) | length, is_tunnel, is_ferry, map_id |
| `chat_send` | custom | `components/ChatPanel.tsx:58/67` (game, `!sandbox`); `screens/RoomScreen.tsx:624/627` (lobby) | kind, context |
| `reconnect` | custom | `net/connection.ts:25` (resync after drop) | — |
| `session_replaced` | custom | `screens/GameScreen.tsx:135` | — |
| `rating_submit` | custom | `components/ScoreBoard.tsx:305` | stars |
| `rematch_vote` | custom | `components/ScoreBoard.tsx:282` | wants |
| `play_again` | custom | `components/ScoreBoard.tsx:287` | — |
| `discord_click` | custom | `components/ScoreBoard.tsx:315` / `screens/WelcomeScreen.tsx:110` / `components/AppHeader.tsx:246` | source |
| `tutorial_begin` | recommended | `features/tutorial/TutorialScreen.tsx:27/31` | scope |
| `tutorial_complete` | recommended | `features/tutorial/TutorialScreen.tsx:141` | — |
| `welcome_shown` | custom | `screens/WelcomeScreen.tsx` render (once) | — |
| `encyclopedia_open` | custom | `components/AppHeader.tsx:239/176`, `screens/HomeScreen.tsx:310` | — |
| `replay_open` | custom | `screens/ReplayScreen.tsx` load effect, once — `source` from entry | source |
| `replay_share_change` | custom | `features/replay/ReplayShare.tsx:50/55` | visibility |
| `map_create` | custom | `features/builder/MapsScreen.tsx:86` | — |
| `map_fork` | custom | `features/builder/MapsScreen.tsx:54` | map_id |
| `map_clone` | custom | `features/builder/MapsScreen.tsx:117` | — |
| `map_share_mint` | custom | `features/builder/editor/stages/ShareStage.tsx:78` | map_id |
| `map_testplay` | custom | `features/builder/editor/stages/ShareStage.tsx:87` | map_id |
| `map_delete` | custom | `features/builder/MapsScreen.tsx:150` | — |
| `settings_change` | custom | `components/SettingsModal.tsx:114/124/137/148/163` | setting, value |
| `room_settings_change` | custom | `screens/RoomScreen.tsx:454` (+ map/events/visibility segmenteds) | setting |

**`game_start` / `game_complete` param sourcing.** Both derive from the authoritative snapshot in
`store/game.ts`: `player_count`/`human_count`/`bot_count` from the snapshot's players (bots via the
`bot:` id prefix), `is_spectator` from whether the local viewer holds a seat, `map_id` from the
snapshot `contentHash` resolved through the content cache, `map_source` from whether that hash is a
bundled official map. `won`/`final_score`/`longest_path`/`tickets_completed` come from the
GAME_OVER snapshot's scoring. `duration_sec` is `now − <game-start timestamp captured client-side
when game_start fires>` (client wall-clock is fine here — this is the app, not the engine, so no
determinism constraint applies). `is_practice` is set from a `useUi` flag written by the
`startPractice` flow (best-effort; omitted if unknown).

`game_start` fires **once per distinct `gameId`** (guarded), so a reconnect/resync that re-delivers
the "first" snapshot does not re-emit it. `replay_open` is emitted from a single place —
`ReplayScreen`'s successful-load effect (once) — with `source: 'history'` when reached via
`enterReplay` (a transient flag the navigator sets) and `source: 'link'` for a cold `/replay/:id`
URL load; `HistoryScreen`'s row click only navigates, it does not emit, so a history-originated open
is never double-counted.

## Known limitations (accepted for this slice)

- **OAuth-redirect sign-in is coarse.** Google-redirect (fallback) and Discord return via
  `/login/callback` → `restore()`, which knows neither the provider nor whether the account is
  new. Those fire `login { method: 'oauth' }` and **do not emit `sign_up`** for first-time OAuth
  users. Reliable paths: email/password `login`/`sign_up`, and Google One-Tap/GSI credential which
  fires `login { method: 'google' }`. A follow-up could thread `?provider=` + an `isNew` flag
  through the server callback; out of scope now.
- **`map_share_mint` / `replay_share_change`** are kept as distinct custom events rather than folded
  into GA4's recommended `share` event, for cleaner per-action reporting. Trivially switchable
  later if unified `share` reporting is preferred.

## Consent

Consent is handled at the **Zaraz layer**: if Cloudflare Zaraz's Consent Management Platform is
enabled, it gates/queues `zaraz.track` automatically with no code change here. Taiwan's PDPA and any
consent policy are therefore a Zaraz-config decision, noted here so it isn't assumed to live in the
app. The wrapper adds no second consent mechanism.

## Testing

- **`analytics.test.ts`** (new, unit): `track` forwards to `window.zaraz.track` when present; falls
  back to `window.gtag` when only that exists; is a safe no-op when neither exists; `trackPageView`
  produces the normalized route template (e.g. a `/room/ABCD` view → `page_path: '/room/:code'`).
- **Representative wiring tests only** (mock the `analytics` module, assert calls — not all 36 call
  sites): (a) auth events fire with the correct `method` from `store/session.ts`; (b) **sandbox
  `GameStage` play fires no gameplay events** (the gating guard); (c) `game_complete` fires exactly
  once on entering GAME_OVER. The typed event map + the wrapper test cover correctness of the rest.
- No snapshot/golden changes; no server, engine, shared, or proto tests touched.

## Implementation surface (`apps/web` only)

**New**
1. `src/lib/analytics.ts` — `track`, `trackPageView`, `AnalyticsEvents`, ambient `window` types.
2. `src/lib/analytics.test.ts`.

**Edited (call sites — mostly one line each)**
3. `src/App.tsx` — `page_view` effect on view change.
4. `src/store/session.ts` — auth events (`login`/`sign_up`/`guest_upgrade`/`logout`).
5. `src/screens/LoginCallback.tsx` — OAuth `login { method: 'oauth' }`.
6. `src/store/game.ts` — `game_start` derivation (first live snapshot) + capture start timestamp.
7. `src/screens/GameStage.tsx` — `game_complete`, `game_first_action`, `route_claimed` (all
   `!sandbox`).
8. `src/screens/HomeScreen.tsx` — `room_create`, `room_join`, `spectate_start`, `practice_start`,
   `encyclopedia_open`.
9. `src/screens/RoomScreen.tsx` — `bot_add`, `room_leave`, `room_settings_change`, lobby `chat_send`.
10. `src/components/ChatPanel.tsx` — in-game `chat_send` (`!sandbox`).
11. `src/net/connection.ts` — `reconnect`.
12. `src/screens/GameScreen.tsx` — `session_replaced`.
13. `src/components/ScoreBoard.tsx` — `rating_submit`, `rematch_vote`, `play_again`, `discord_click`.
14. `src/screens/WelcomeScreen.tsx` — `welcome_shown`, `discord_click { source: 'welcome' }`.
15. `src/components/AppHeader.tsx` — `encyclopedia_open`, `discord_click { source: 'header' }`.
16. `src/features/tutorial/TutorialScreen.tsx` — `tutorial_begin`, `tutorial_complete`.
17. `src/store/ui.ts` — `is_practice` flag (set by the `startPractice` flow, read by `game_start`)
    and a transient `replaySource` flag set by `enterReplay`.
18. `src/screens/ReplayScreen.tsx` — `replay_open` (once, `source` from `replaySource` else `link`).
19. `src/features/replay/ReplayShare.tsx` — `replay_share_change`.
20. `src/features/builder/MapsScreen.tsx` — `map_create`/`map_fork`/`map_clone`/`map_delete`.
21. `src/features/builder/editor/stages/ShareStage.tsx` — `map_share_mint`, `map_testplay`.
22. `src/components/SettingsModal.tsx` — `settings_change`.
23. Representative wiring tests alongside the touched files (session, GameStage sandbox-gating).

## Success criteria

- `window.zaraz.track` (or `gtag` fallback) receives a `page_view` on every SPA screen change, with
  a **normalized** `page_path` (no room codes / game ids) and the `screen` enum.
- Each catalog event fires from its trigger with exactly the typed params; no event can carry a
  hand, ticket, seed, email, display name, or chat text (enforced by the type map).
- **Sandbox play (tutorial / encyclopedia / replay) emits no gameplay events**; a live game emits
  `game_start` once at start and `game_complete` once at GAME_OVER.
- `yarn workspace @trm/web test`, `yarn lint`, `yarn typecheck`, and `yarn format:check` pass. No
  main-bundle regression from `builder` (the builder call sites live inside its existing lazy chunk;
  `analytics.ts` is tiny and shared).
