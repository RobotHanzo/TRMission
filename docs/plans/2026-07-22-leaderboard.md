# Leaderboard feature

## Context

TRMission has no player-skill or standings concept today — `apps/server/src/ratings/*` is an
unrelated 1–5 star app-feedback endpoint. `MatchHistoryDoc` (`apps/server/src/persistence/types.ts`)
already archives every completed game's `players`, `winners`, and `finalScores` and its own doc
comment says it's "for history listing + leaderboards" — this feature is the leaderboards half of
that promise, finally built.

Per your answers: three ranking metrics coexist (win count, games played, and an Elo-style rating —
the rating is the "main" one, described as a ranking-points system), each available both **all-time**
and **seasonal**, **registered users only** (guests/bots excluded), surfaced on **web + mobile**
(shared via `@trm/client-core`, following the exact pattern already used for History) and as a
**read-only admin dashboard view** (mirroring `RatingsView`).

Nothing here backfills historical games — the leaderboard starts tracking from the day it ships.
Two defaults I'm setting without a specific ask (called out so you can redirect at approval):
**seasons are stateless calendar months** (`YYYY-MM` in UTC — no season-config collection, no
rollover job, no admin action needed: a season simply exists the moment a game completes in it),
and **no minimum-games floor** on the rating leaderboard for v1 (you can filter client-side later
since `gamesPlayed` is stored per scope regardless).

## Data model (new collection: `playerLeaderboardStats`)

One doc per `(userId, scope)`, `scope` is `'allTime'` or `` `season:${YYYY-MM}` ``:

```ts
interface PlayerStatsDoc {
  _id: string;          // `${userId}:${scope}`
  userId: string;
  scope: string;         // 'allTime' | 'season:2026-07'
  rating: number;        // Elo-style, default 1500
  gamesPlayed: number;
  wins: number;
  losses: number;
  version: number;       // optimistic-concurrency counter for the rating CAS retry
  updatedAt: Date;
}
```

Indexes: `{scope:1, rating:-1}`, `{scope:1, wins:-1}`, `{scope:1, gamesPlayed:-1}` (leaderboard
reads), `{userId:1}` (my-standing + account-deletion cascade).

A second tiny collection, `leaderboardClaims` (`{_id: gameId, claimedAt: Date}`), gives idempotency
for free: `insertOne` either succeeds once (first time this game is processed) or throws a
duplicate-key error (already processed) — no flag needs adding to `MatchHistoryDoc`, and
`HistoryRepo`/`MongoGameStore` stay completely untouched.

## Rating algorithm (`apps/server/src/leaderboard/elo.ts`, pure + unit-tested)

Not placed in `@trm/shared` — per that package's own CLAUDE.md, shared is for things that must
stay identical *across* engine/wire/DB/UI; Elo is computed and consumed only inside the server, so
it stays local, same as e.g. `dashboard.ts`'s permission math stays in `packages/shared` only
because admin UI and server both need it (Elo has no second consumer).

**Multiplayer pairwise Elo** (a standard generalization for >2 participants): each participant is
compared against every *other rated* participant as an independent pairwise Elo match using each
side's current rating, `expected = 1/(1+10^((theirRating-mine)/400))`, `actual` = 1/0.5/0 for
win/tie/loss (ties = same equivalence group in `FinalScoreboard.ranking`). Delta = `k * mean(actual
- expected)` over all *rated* opponents (bots/guests are simply never included as participants, so
a player whose only "opponents" are bots/guests gets an empty opponent set and a delta of exactly
0 — no special-case code needed, and no farming-by-stomping-bots).

- **Team games**: reduce each team to one virtual participant (`rating` = average of its *rated*
  members' current ratings in that scope, `rank` from `teamRanking`), run the same pairwise formula
  between teams, then apply the resulting team delta identically to every rated member — mirrors
  the engine's own "team is a unit" posture (`packages/engine/src/teams.ts`).
- **K-factor**: provisional `40` for a player/scope's first 20 games, `20` after — read off the
  same rating doc already being fetched, no extra query.
- Win/loss/games-played counters are simple, not Elo-gated: every *rated* participant gets
  `gamesPlayed += 1` and `wins += 1` xor `losses += 1` regardless of whether their opponents were
  bots (so a solo-vs-bots regular still shows up on the games-played/win-count boards — only the
  *rating* board requires a rated opponent to move at all).

**Eligibility ("rated")**: `!isBotId(id)` (from `@trm/bots`, already the exclusion idiom used in
`purge.service.ts`/`push.service.ts`) **and** the id resolves to a `UserDoc` with `isGuest === false`
(one batched `users.find` lookup, same shape as `HistoryRepo.displayNames`). A guest or bot seat
never gets a `PlayerStatsDoc` row at all.

## Server wiring — hook point and idempotency

`GameHub.applyPrepared` (`apps/server/src/ws/hub.ts:895-922`) is the single choke point already
calling `store.recordCompletion(...)` non-fatally whenever `prepared.state.turn.phase ===
'GAME_OVER'` — true for every path that can end a game (human/bot/timeout moves, the voluntary
`END_GAME`). Add a second, equally non-fatal, fire-and-forget call right after it:

```ts
if (this.store && prepared.state.turn.phase === 'GAME_OVER') {
  try { await this.store.recordCompletion(match.session.gameId, prepared.state); } catch { /* ... */ }
  void this.leaderboard?.onGameOver(match.session.gameId).catch(() => {});
}
```

`leaderboard` is a new optional field on `GameHubOptions`, typed as a small plain-object sink
(`{ onGameOver(gameId: string): Promise<void> }`) — the exact same "hub stays framework-free, the
module adapts a Nest service into a plain sink" idiom already used for `push` in
`apps/server/src/game/game.module.ts:57-62`. `GameModule`'s factory gets `LeaderboardService`
injected alongside `PushService` and wires `leaderboard: { onGameOver: (id) =>
leaderboardService.onGameOver(id) }`.

`LeaderboardService.onGameOver(gameId)` is self-contained and self-verifying, so it's safe to call
speculatively (including on a maintainer-terminated game, where the race against `recordCompletion`
means no archive exists):

1. Try to claim (`leaderboardClaims.insertOne`) — already-claimed or a Mongo duplicate-key error ⇒
   return.
2. `historyRepo.get(gameId)` — no `matchHistory` doc (terminated race, or archive genuinely never
   written) ⇒ return. This is also what makes the hook safe to call even if `applyPrepared` ever
   fired GAME_OVER more than once for the same game.
3. Compute `season:${currentSeasonId(doc.completedAt)}` (pure `YYYY-MM` UTC formatter).
4. Batch-resolve rated participants, compute per-user outcomes + Elo deltas as above.
5. Write: `gamesPlayed`/`wins`/`losses` via a single optimistic read-modify-`findOneAndUpdate`
   keyed on `version` (a few retries on CAS conflict) per `(userId, scope)` — folded into the same
   write as the rating update rather than a separate atomic `$inc`, so one code path handles both
   fields together and K-factor selection reads the same doc it's about to update.

This never touches `MongoGameStore`/`GameStorePort` (persistence stays a pure storage port) and
never sits on the hot path the client waits on (fire-and-forget, matching how push notifications are
already treated as an ancillary side effect of the same broadcast).

## REST API (`apps/server/src/leaderboard/`)

New Nest module: `leaderboard.repo.ts` (the two collections + indexes + query/cascade methods),
`leaderboard.service.ts` (`onGameOver` orchestration + the read paths), `leaderboard.schemas.ts`
(zod, mirroring `history.schemas.ts`), `leaderboard.controller.ts`, `leaderboard.module.ts`.

- `GET /api/v1/leaderboard?scope=allTime|season&metric=rating|wins|gamesPlayed&limit=&cursor=` —
  cursor-paginated top list (`{userId, displayName, rank, rating, gamesPlayed, wins, losses}[]`),
  same cursor idiom as `dashboard-ratings.service.ts`/`persistence/cursor.ts`.
- `GET /api/v1/leaderboard/me?scope=&metric=` — the caller's own standing even off the visible
  page (`countDocuments({scope, [metric]: {$gt: mine}}) + 1` for rank — fine at this scale).
- Guard: plain `AccessTokenGuard` (guests *can view*, matching History's "signed in, any account"
  precedent — they just never appear as rows themselves).
- Cascade: `AccountDeletionService` (`apps/server/src/account/account-deletion.service.ts`) gets a
  new `leaderboard: LeaderboardRepo` dependency and a `deleteByUser` call alongside the existing
  `ratings.deleteByUser`/`customMaps.deleteByOwner` lines.

## Admin dashboard (read-only, mirrors `RatingsView`)

- New `leaderboard.read` permission in `packages/shared/src/dashboard.ts`'s `DASHBOARD_PERMISSIONS`
  + `VIEWER_PERMISSIONS` (same tier as `ratings.read`).
- `apps/server/src/dashboard/dashboard-leaderboard.service.ts` +
  `dashboard-leaderboard.controller.ts` under `api/v1/dashboard/leaderboard`, gated
  `@RequirePermission('leaderboard.read')`, reusing `LeaderboardRepo`'s query methods plus
  display-name resolution (same pattern as `dashboard-ratings.service.ts`).
- `apps/admin/src/views/LeaderboardView.tsx` mirrors `RatingsView.tsx` (cursor-paginated table +
  scope/metric selector), registered in the admin router/sidebar the same way `RatingsView` is.

## Web + Mobile (shared client-core, screen logic stays per-platform — the History precedent)

`packages/client-core`'s shared surface for History is *only* the REST method + wire types + i18n
namespace — both `HistoryScreen.tsx`s independently fetch-in-`useEffect` and render natively. This
feature follows that exact division:

- `packages/client-core/src/net/restTypes.ts` + `rest.ts`: add `LeaderboardEntry`,
  `LeaderboardScope`, `LeaderboardMetric`, `LeaderboardPage` types and `api.leaderboard(params)` /
  `api.myLeaderboardStanding(params)`, appended to `buildApi()` exactly like the existing
  `// ── history / replay ──` section (`rest.ts:250`) — no other wiring needed, both apps get it
  through their existing `client.api`.
- i18n: new `packages/client-core/src/i18n/locales/{en,zh-Hant}/leaderboard.ts` namespace (zh-Hant
  first, en `satisfies TranslationShape<typeof zh>` — the file's own convention), registered in both
  locale aggregators. Neither app needs its own override file — both import it straight through
  (the mobile pattern for `history`), unless implementation turns up an admin-only or
  web-only string, in which case it layers the way `apps/web/src/i18n/en/history.ts` does.
- **Web**: `store/ui.ts` gets `'leaderboard'` added to the `View` union, a `LEADERBOARD_PATH`
  constant, an `enterLeaderboard()` action, and the matching `isHomeColdLoadPath` /
  `syncFromUrl` / `navigateAfterAuth` branches — all copied from the `history` entries at
  `ui.ts:41/95/342-346/399-403/469-477` (auth-gated the same way). `App.tsx` gets a
  `view === 'leaderboard' && <LeaderboardScreen />` branch, directly imported (not lazy) —
  History isn't lazy either, since it carries no heavy engine dependency. `AppHeader.tsx` gets a
  `Trophy`-icon nav entry in both the phone-menu and desktop branches, next to History's
  (`user && !onAuthScreen && !inGame` gating, no feature flag). New
  `apps/web/src/screens/LeaderboardScreen.tsx` + `styles/leaderboard.css` mirror
  `HistoryScreen.tsx`/`history.css`, with a scope toggle (All-Time / This Season) and a metric
  toggle (Rating / Wins / Games), the signed-in user's own row highlighted, and their rank shown
  even if off-page (via `api.myLeaderboardStanding`).
- **Mobile**: `navigation.tsx` gets `Leaderboard: undefined` on `RootStackParamList` and a
  `<Stack.Screen name="Leaderboard" .../>` registered in the authed branch next to `History`
  (`navigation.tsx:111-115`). `HomeScreen.tsx` gets a `leaderboardLink` following the exact
  `historyLink` shape (`HomeScreen.tsx:450-458`, `testID="home-leaderboard"`,
  `navigation.navigate('Leaderboard')`), dropped into both the wide-grid and phone-stack render
  spots next to `historyLink`. New `apps/mobile/src/screens/LeaderboardScreen.tsx` mirrors
  `apps/mobile/src/screens/HistoryScreen.tsx` (FlatList + theme tokens), same scope/metric toggle.

## Testing

- `apps/server/test/leaderboard-elo.spec.ts` — pure unit tests for the Elo function: 2p, 3-way tie,
  4p free-for-all, 2-team averaging, provisional-vs-stable K-factor.
- `apps/server/test/leaderboard.e2e.spec.ts` — drives a real bot game to completion through the
  existing e2e harness (same shape as `bots.e2e.spec.ts`) and asserts: a human winner's stats row is
  created/updated in both `allTime` and the current season scope; bot seats never get a row; a
  guest third-wheel never gets a row and doesn't block the registered players' updates; a
  maintainer-terminated game produces no stats row; calling the hook twice for one game only applies
  once (claim idempotency).
- `apps/server/test/dashboard-leaderboard.e2e.spec.ts` mirrors `dashboard-ratings.e2e.spec.ts`
  (permission-gating + pagination).
- Extend `apps/server/test/account-delete.e2e.spec.ts` to assert the cascade deletes leaderboard
  rows.
- Web/mobile: no dedicated test file exists today for `HistoryScreen` on either platform, so I'll
  match that existing coverage level for `LeaderboardScreen` rather than introduce a new testing
  tier — a smoke test only if one turns out cheap to add alongside it.

## Verification

`yarn workspace @trm/server test --run leaderboard` for the new suites,
`yarn workspace @trm/server test --run account-delete` for the cascade,
`yarn typecheck` + `yarn lint` repo-wide, then a manual pass: `docker compose up -d mongo` +
`yarn workspace @trm/server dev` + `yarn workspace @trm/web dev`, play a 2-human + bot game to
completion, confirm the new nav entry shows the game reflected on both the rating and win-count
boards, then repeat the same check on `yarn workspace @trm/mobile web`.
