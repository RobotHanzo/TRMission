# Random Events System (隨機事件) — Design

**Date:** 2026-07-04
**Status:** Approved
**Expansion implemented:** 2026-07-11 (the 13-event future catalog)

## Goal

TRMission games play out identically-shaped every time: same rule set, same phases, from genesis to
GAME_OVER. Random Events adds seeded, table-top-flavored variance — typhoons closing lines, a viral
check-in station, a charter-train bounty — so repeat games feel different without touching the core
rules of claiming routes, building stations, or completing tickets. The system had to fit the repo's
hardest constraints unmodified: a pure deterministic engine (seeded counter PRNG only, zero wall-clock
or unseeded randomness), structural hidden information (`redactFor` is the only egress), digest-verified
replay, and the existing `RuleParams` → `RoomSettings` → `GameSettings` variant pipeline. Mechanics here
are abstractly inspired by other train/board games and general game-design literature; every event name,
description, and visual is original TRMission content — no wording or art is copied from any source.

## Decision (settled with the user)

1. **Opt-in room option with intensity levels** — `eventsMode: 'off' | 'light' | 'moderate' | 'intense'`
   (typhoon-warning flavored labels: 關閉／輕度／中度／強烈), default `'off'`.
2. **Per-account gated feature, default OFF** (revised 2026-07-05) — `randomEvents` in `@trm/shared`'s
   `USER_FEATURES` (same dashboard-granted, per-request-checked mechanism as `mapBuilder`/
   `replayReview`) gates whether a room's HOST may turn the option on; the server enforces it (a
   settings PATCH turning it on 403s `FEATURE_DISABLED` unless the host holds the feature; UI hiding
   is never trusted on its own). Originally shipped as a single server-wide env var
   (`TRM_RANDOM_EVENTS_ENABLED`) — superseded because enablement needs to vary per account, not just
   per deployment.
3. **Forecast + surprises** — restrictive/mixed events (typhoons, sky lantern, aftershock) are
   telegraphed one full round ahead; purely positive events (hotspot, charter, gala, stamp rally) fire
   as surprises at round start with no warning.
4. **The initial v1 slice contained 8 no-new-action events**, none adding a player action, phase, or
   proto command. The remaining 13 researched events were subsequently implemented as the expansion
   described below, bringing the playable catalog to all 21 events.
5. **Seeded schedule at genesis, engine-internal architecture** — `initGame` draws the whole event
   timeline from the seeded PRNG onto `GameState` once, at genesis; rounds tick inside `endTurn`; the
   forecast is purely a redaction window. The realtime hub (`ws/hub.ts`) needed zero changes — it
   already fans out whatever `redactFor` projects.

## Design principles

Research across other train-game variants, other board games, Taiwan railway culture, and game-design
literature produced principles baked into every one of the 8 v1 events (and into the future catalog):

- **Input randomness only.** An event may never undo a committed action, destroy an already-claimed
  route, or discard cards from a hand — it only changes what's available or how much things cost/score
  going forward.
- **Telegraph constraints, surprise gifts.** Anything that takes an option away (closures,
  suspensions, surcharges) is announced a round ahead so players can route around it; anything that
  only adds value (bonuses, free stuff) arrives unannounced.
- **Symmetric targeting.** Events target regions, specific routes/cities, or the whole table — never a
  specific seat. No event singles out "the leader" or "the last-place player."
- **Every constraint pairs with an opportunity.** A typhoon closes routes, but reopening them pays a
  first-claimer bonus; a day off blocks claims, but widens the draw.
- **Bounded swing.** No single event is worth much more than one strong turn (roughly 4–7 points) —
  events add texture, not a way to blow the game open.
- **Quiet endgame.** No fresh surprise fires once the game is winding down (see the quiet-endgame
  predicate below) — the final turns play out on rules everyone already knows.
- **Auditable fairness.** The entire timeline is decided once, from the seed, at genesis — nothing is
  adjudicated live, so a contested game can always be replayed and inspected byte-for-byte.

## The 8 v1 events

All mechanics below are verified against the landed `packages/engine/src/events/{schedule,runtime,
effects}.ts` and `reduce.ts` — not the original proposal, where the two differ the code is what's
described.

| #   | Event                    | 中文         | Arrival                     | Mechanics as implemented                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | ------------------------ | ------------ | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Typhoon Landfall         | 颱風登陸     | Telegraphed (1 round ahead) | Picks one eligible region (≥3 touching routes) and `2 + nextInt(2)` (2 or 3) of its touching routes, shuffled; those **unclaimed** routes close for 2 rounds (`claimPreconditions` rejects with `ROUTE_CLOSED_BY_EVENT`). Already-claimed routes in the set are simply untouched. On expiry, any of those routes still unclaimed rolls into `reopenBonus`; the **first** claim of a reopened route (including a tunnel commit) earns a separate itemized `EVENT_BONUS{kind:TYPHOON_LANDFALL, reason:REOPEN, points:2}`, consumed idempotently (a second claimer of its double-route sibling earns nothing). |
| 2   | Typhoon Day Off          | 颱風假       | Telegraphed                 | 1 round: **all** route claims and station builds are suspended (`EVENT_CLAIMS_SUSPENDED` / `EVENT_STATIONS_SUSPENDED`); a drawing player's turn-ending limit becomes 3 picks instead of 2 (`dayOffExtraDraw` adds +1) — a first-pick blind locomotive still ends the draw immediately (existing variant), and a face-up locomotive is still legal only as the first pick.                                                                                                                                                                                                                                   |
| 3   | Sky Lantern Night        | 天燈之夜     | Telegraphed                 | Picks one eligible region and `3 + nextInt(2)` (3 or 4) of its touching routes, shuffled — a random subset, mirroring Typhoon Landfall's mechanic (never the whole touching set). Affected for 2 rounds: claiming one costs `route.length + 1` cards (locomotives still wild; the extra card, not an extra train car — `validateRoutePayment`'s `extraCards` param), and its `pointsAwarded` is doubled (`skyLanternDoubles`). A tunnel's reveal-phase surcharge (`extraRequired`) is unaffected — only the base payment carries the +1.                                                                    |
| 4   | Aftershock Advisory      | 餘震特報     | Telegraphed                 | 1 round: `beginTunnel` reveals `ruleParams.tunnelRevealCount + 1` = 4 cards instead of 3. Aborting (not committing) the tunnel draws one blind consolation card for the aborting player (silently skipped if deck + discard are both empty) before the turn ends.                                                                                                                                                                                                                                                                                                                                           |
| 5   | Viral Hotspot            | 爆紅打卡站   | Surprise                    | Picks one city with ≥2 incident routes (drawable at most twice across the whole schedule). Permanent, instant (`durationRounds: 0`): each claim touching the city adds `+level` (the marker's current level) to the claimer, one itemized `EVENT_BONUS{reason:HOTSPOT}` per marked endpoint; the marker itself bumps by 1 on each schedule firing, capped at level 2 (`Math.min(2, …)`).                                                                                                                                                                                                                    |
| 6   | Charter Special          | 觀光專開列車 | Surprise                    | Picks the first (sorted-then-shuffled) city pair with a BFS hop distance ≥ 4 on the route graph; reward is `6 + nextInt(5)` = 6–10 points. Open for 4 rounds. At the moment it opens, if any player's **own** route network (no station borrowing) already connects the pair, the earliest-seated such player wins it immediately. Otherwise it's first-come: the first claim/tunnel-commit that connects the pair via the claimer's own network wins it (one claim can win several open charters at once, awarded in schedule order); an unclaimed charter simply expires.                                 |
| 7   | Railway Anniversary Gala | 鐵路節慶典   | Surprise                    | Instant: every player, in turn order, draws one blind card (real deck draw — reshuffle events fire normally if the deck runs out). A zero-cost station window opens for **exactly the gala's own round** — the first `BUILD_STATION` with an empty (zero-card) payment, by anyone, bypasses normal payment validation and consumes the window game-wide; a paid station never consumes it.                                                                                                                                                                                                                  |
| 8   | Stamp Rally Week         | 鐵道集章週   | Surprise                    | 3 rounds: on each claim (or tunnel commit), every endpoint city that is NEW to the claimer's own network (snapshotted just before the claim) scores `+1`, one itemized `EVENT_BONUS{reason:STAMP}` per new city (a claim whose both endpoints were already in the claimer's network, e.g. the double-route-sibling edge case, scores 0).                                                                                                                                                                                                                                                                    |

## Architecture as built

### Genesis schedule generation

`packages/engine/src/events/schedule.ts` — `generateSchedule(board, ruleParams, rng)` runs as **genesis
step (8)**, appended after every other RNG-consuming step in `setup.ts`:

```ts
// packages/engine/src/setup.ts (initGame's documented RNG order)
// (1) turn-order shuffle (optional) → (2) deck shuffle → (3) hand deals (no RNG) →
// (4) market fill (no RNG at start) → (5) long-ticket shuffle → (6) short-ticket shuffle →
// (7) initial ticket-offer deals (no RNG, pop from top) →
// (8) random-event schedule — draws ZERO when `eventsMode` is off/absent, so an off-mode
//     genesis produces a byte-identical rng counter to a pre-events (v4) game.
const [events, rngAfterEvents] = generateSchedule(board, ruleParams, rng);
```

`generateSchedule` returns `[undefined, rng]` untouched for `mode === undefined || mode === 'off'` — the
load-bearing property that keeps off-mode byte-identical. When on, the draw order is fixed:

1. **First `startRound`** — one draw: `Math.max(2, firstStartBase + nextInt(gapSpan))`, where
   `firstStartBase` is `light 4 / moderate 3 / intense 2`. The `max(2, …)` floor means no entry can
   start on round 1 (a telegraphed round-2 start has no round-1 tick to announce it — it just begins
   un-announced; this is intended, not a bug).
2. **Per slot** — category (weighted draw) → kind → kind-specific targets → next start, repeated
   for as long as `startRound <= SCHEDULE_ROUND_CAP` (300 — comfortably beyond any realistic game;
   greedy-policy playtests top out around 70-75 rounds). There is no longer a fixed total-entry
   budget per game: the schedule keeps generating events for the whole game, and intensity instead
   tunes _frequency_ via `gapSpan` (the width of the random gap added between an event's start and
   the next one's) — a smaller span means shorter average gaps, i.e. denser play. A prior revision
   capped generation at a fixed `count` (2/4/6) of entries within a 20-round window, which meant every
   real game (which routinely runs 45-75+ rounds) went quiet for its entire back half once that count
   was exhausted; this was a bug, not a design choice, and is what the round-cap/`gapSpan` rework below
   fixes.

```ts
// packages/engine/src/events/schedule.ts
const SCHEDULE_ROUND_CAP = 300;

const MODE_TUNING: Record<Exclude<EventsMode, 'off'>, ModeTuning> = {
  light: { firstStartBase: 4, gapSpan: 6, weights: { positive: 3, mixed: 1, restrictive: 1 } },
  moderate: { firstStartBase: 3, gapSpan: 4, weights: { positive: 2, mixed: 2, restrictive: 2 } },
  intense: { firstStartBase: 2, gapSpan: 2, weights: { positive: 2, mixed: 3, restrictive: 3 } },
};

const CATEGORY_KINDS = {
  positive: ['VIRAL_HOTSPOT', 'CHARTER_SPECIAL', 'RAILWAY_GALA', 'STAMP_RALLY'],
  mixed: ['SKY_LANTERN', 'AFTERSHOCK'],
  restrictive: ['TYPHOON_LANDFALL', 'TYPHOON_DAY_OFF'],
};

const DURATIONS = {
  TYPHOON_LANDFALL: 2,
  TYPHOON_DAY_OFF: 1,
  SKY_LANTERN: 2,
  AFTERSHOCK: 1,
  RAILWAY_GALA: 1,
  STAMP_RALLY: 3,
  CHARTER_SPECIAL: 4,
  VIRAL_HOTSPOT: 0,
};

const TELEGRAPHED = new Set(['TYPHOON_LANDFALL', 'TYPHOON_DAY_OFF', 'SKY_LANTERN', 'AFTERSHOCK']); // == restrictive ∪ mixed, exactly; positive kinds are always surprises
```

If a weighted category draw lands on a category with no placeable kind on this board (e.g. a sparse
custom map with no region ≥3 touching routes), it's dropped and a fresh weighted draw is taken over the
remaining categories; if none remain, generation stops early for that game — this is the sparse-map
fallback, and it never throws.

- **Target selection.** Region eligibility (typhoon/sky-lantern) = regions with **≥3 touching routes**
  (a route touches a region iff either endpoint city has it), sorted by region name for determinism.
  Typhoon picks `2 + nextInt(2)` routes from a Fisher-Yates shuffle of the region's touching routes;
  sky-lantern picks `3 + nextInt(2)` (3 or 4) from the same kind of shuffle — a random subset, not the
  whole touching set. Hotspot eligibility = cities with **≥2 incident routes**, excluding
  ones already drawn twice this schedule. Charter eligibility = any city pair reachable with an
  unweighted BFS hop distance **≥ 4**, found by shuffling all city ids and taking the first qualifying
  pair in shuffle order; reward `6 + nextInt(5)`. None of this touches `@trm/map-data` — corridors are
  derived on the fly from each `CityDef.region`, so zero map-data edits and zero `CONTENT_HASH` churn;
  a sparse/custom map with no eligible target for a kind simply excludes that kind from the draw.
- **Next start round** = `start + occupancy + 1 + nextInt(gapSpan)`, where `occupancy` is `1` for a
  positive (surprise) kind or the kind's `durationRounds` otherwise — so restrictive/mixed windows
  never overlap by construction (positive kinds only "occupy" the round they start on) — and
  `gapSpan` is the per-mode frequency knob (`light 6 / moderate 4 / intense 2`, i.e. average extra
  gap `2.5 / 1.5 / 0.5` rounds): the narrower the span, the tighter events pack together.
- **Cap.** Generation stops once the next slot's `startRound` would exceed `SCHEDULE_ROUND_CAP` (300).
  This is generously past any realistic game length purely as a genesis-time loop bound — it is not a
  per-game entry budget, so a long game keeps getting new events for as long as it runs.

### `EventsState` + `GameState.events`

`packages/engine/src/types/events-state.ts`:

```ts
export type RandomEventKind =
  | 'TYPHOON_LANDFALL'
  | 'TYPHOON_DAY_OFF'
  | 'VIRAL_HOTSPOT'
  | 'CHARTER_SPECIAL'
  | 'SKY_LANTERN'
  | 'AFTERSHOCK'
  | 'RAILWAY_GALA'
  | 'STAMP_RALLY';

export interface EventScheduleEntry {
  readonly id: string; // 'ev1', 'ev2', … in schedule order
  readonly kind: RandomEventKind;
  readonly startRound: number;
  readonly durationRounds: number; // 0 = instant/permanent (VIRAL_HOTSPOT)
  readonly telegraphed: boolean;
  readonly routeIds?: readonly RouteId[];
  readonly region?: string;
  readonly cityId?: CityId;
  readonly charter?: { readonly a: CityId; readonly b: CityId; readonly points: number };
}

export interface ActiveEvent {
  readonly id: string;
  readonly kind: RandomEventKind;
  readonly endsAfterRound: number;
  readonly routeIds?: readonly RouteId[];
  readonly region?: string;
}

export interface CharterContract {
  readonly id: string;
  readonly a: CityId;
  readonly b: CityId;
  readonly points: number;
  readonly expiresAfterRound: number;
  readonly wonBy: PlayerId | null;
}

export interface EventsState {
  readonly mode: Exclude<EventsMode, 'off'>;
  readonly roundIndex: number; // 1 when play begins
  readonly nextIdx: number; // next unprocessed schedule entry
  readonly schedule: readonly EventScheduleEntry[]; // HIDDEN — never projected wholesale
  readonly suppressed: readonly string[]; // entry ids skipped by quiet-endgame
  readonly active: readonly ActiveEvent[];
  readonly hotspots: Readonly<Record<string, number>>; // cityId → 1|2, permanent
  readonly charters: readonly CharterContract[]; // open + won, until expiry
  readonly reopenBonus: readonly RouteId[]; // typhoon routes carrying +2 first-claim
  readonly freeStation?: { readonly untilRound: number };
}
```

`GameState.events?: EventsState` is a single **optional** field, conditionally spread in `initGame`
only when the schedule generator returns one — `stableStringify` drops `undefined` keys, so an off-mode
digest carries no `events` key at all, and `ENGINE_VERSION` **4 → 5** is behaviorally off-mode-identical
to v4. Every gate in the engine treats `state.events === undefined` the same as `mode === 'off'`, so an
in-flight v4 game recovers safely under the v5 binary (`packages/engine/test/off-mode-identity.spec.ts`
freezes exactly this guarantee — a golden action log + final state captured on pre-events `main`, replayed
and asserted deep-equal except `engineVersion`/`ruleParams.eventsMode`).

Stamp Rally needed no dedicated per-player state: "new city" is derived by diffing pre-claim vs.
post-claim `state.ownership` (via `playerNetworkCities`), not stored.

### Round semantics: `endTurn` → `tickRound`

`packages/engine/src/turn.ts` `endTurn` (unchanged shape otherwise) gained one block, gated on
`next.events !== undefined && nextIdx === 0` (a full turn-order wrap — one round completed), placed
**after** the all-PASS/endgame termination early-return so events never process on the game-ending turn:

```ts
// packages/engine/src/turn.ts
if (next.events && nextIdx === 0) {
  const bumped: GameState = {
    ...next,
    events: { ...next.events, roundIndex: next.events.roundIndex + 1 },
  };
  const tick = tickRound(board, bumped);
  next = tick.state;
  events.push(...tick.events);
}
events.push({ e: 'TURN_STARTED', player: nextPlayer, orderIndex: nextIdx, visibility: 'PUBLIC' });
```

`endTurn` (the caller) owns the `roundIndex` increment — it bumps the counter **before** calling
`tickRound`, so `tickRound` reads (never mutates) the round about to be played. `tickRound`
(`packages/engine/src/events/runtime.ts`) runs three phases in this fixed order, batched into the
action's event list as:

```
… TURN_ENDED, EVENT_ENDED*, EVENT_STARTED* (+ any gala CARD_DRAWN_BLIND), EVENT_ANNOUNCED?, TURN_STARTED …
```

with rule-7.5's forced ticket re-draw still emitted **last**, on the post-tick state:

- **(a) END** — every `ActiveEvent` whose `endsAfterRound < roundIndex` expires (`EVENT_ENDED`); an
  expiring `TYPHOON_LANDFALL`'s still-unclaimed routes roll into `reopenBonus`; charters past their
  `expiresAfterRound` and never won are dropped (won ones are kept forever, by design — see M3);
  a stale `freeStation` (`untilRound < roundIndex`) is stripped entirely (never left `undefined`, for
  clone/digest hygiene).
- **(b) START** — every schedule entry whose `startRound === roundIndex` begins: `EVENT_STARTED` is
  emitted, then its instant transition runs (gala: one blind draw per player in turn order + opens the
  free-station window for exactly this round; hotspot: bump the marker, capped at 2; charter: open the
  contract, with the at-open award check in turn order). A **surprise** (non-telegraphed) entry due to
  start during quiet-endgame is instead pushed onto `suppressed` and skipped — a **telegraphed** entry
  that reached START always begins (it was already checked, and either announced or suppressed, one
  round earlier — the announce decision is never reneged).
- **(c) ANNOUNCE** — the next unprocessed schedule entry, if telegraphed and its `startRound ===
roundIndex + 1`, is announced (`EVENT_ANNOUNCED`) unless the game is in quiet-endgame, in which case
  it's suppressed instead (recorded in `suppressed`, `nextIdx` advanced past it — the only ANNOUNCE path
  that advances `nextIdx`; a normal announcement leaves `nextIdx` in place so START picks the same entry
  up exactly one round later).

**Quiet-endgame predicate** (`isQuietEndgame`, pure, state-only):

```ts
// packages/engine/src/events/runtime.ts
export function isQuietEndgame(state: GameState): boolean {
  if (state.endgame.triggered) return true;
  let min = Infinity;
  for (const p of Object.values(state.players)) if (p.trainCars < min) min = p.trainCars;
  return min <= state.ruleParams.endgameTrainThreshold + 8;
}
```

### Rule enforcement — `events/effects.ts` + `reduce.ts` gates

`packages/engine/src/events/effects.ts` is the **single source of truth** shared by the reducer's
accept/reject gates and the `hasAnyLegalMove` / payment-enumerator mirrors, so PASS legality (and the
bot/legal-actions surface) can never diverge from what the reducer actually accepts. Every helper is
total for `state.events === undefined` (returns the off-mode answer): `closedRouteIds`/`isRouteClosed`,
`claimsSuspended`/`stationsSuspended`, `skyLanternSurcharge`/`skyLanternDoubles`, `tunnelRevealExtra`,
`dayOffExtraDraw`, `takeReopenBonus` (the one state-mutating helper — idempotent removal), plus the
positive-event queries `hotspotLevel`, `stampRallyActive`, `freeStationAvailable`/`consumeFreeStation`,
`playerOwnEdges`/`playerNetworkCities`. `citiesConnected` (own-edges-only union-find, no station
borrowing) lives in `graph/connectivity.ts` to reuse the existing union-find rather than duplicate it.

Gate wiring in `reduce.ts`:

- `claimPreconditions` rejects a closed route with `ROUTE_CLOSED_BY_EVENT` (checked after
  ownership/lock, before the double-route sibling check) — covers both a normal claim and a tunnel
  begin, since both funnel through it.
- `applyClaimRoute` rejects with `EVENT_CLAIMS_SUSPENDED` up front during a day off; threads
  `skyLanternSurcharge` into `validateRoutePayment` (`extraCards` param — inflates the required card
  count, not the train-car count).
- `applyClaimEffects` (shared by a normal claim **and** a tunnel commit) doubles `pointsAwarded` when
  `skyLanternDoubles`, then emits event bonuses **after** `ROUTE_CLAIMED` in a fixed order —
  **REOPEN → HOTSPOT → STAMP → CHARTER** — each banking straight into `routePoints`:
  - REOPEN: `takeReopenBonus` — first claimer of a reopened route only, +2, idempotent.
  - HOTSPOT: `+level` per endpoint carrying a marker, endpoints iterated sorted by cityId.
  - STAMP: `+1` per endpoint new to the claimer's pre-claim network (only while a stamp rally runs).
  - CHARTER: every open, un-won charter the claimer's own network now connects, awarded in
    `charters`-array order (one claim can win several).
- `beginTunnel`'s reveal count is `ruleParams.tunnelRevealCount + tunnelRevealExtra(state)`.
- `applyResolveTunnel`'s **abort** branch draws one blind consolation card while aftershock is active
  (silently skipped if deck + discard are both empty), then ends the turn as usual.
- `applyBuildStation` rejects with `EVENT_STATIONS_SUSPENDED` during a day off; accepts an **empty**
  payment iff `freeStationAvailable(state)`, consuming the window (`consumeFreeStation`) and emitting
  `EVENT_BONUS{kind:RAILWAY_GALA, reason:FREE_STATION, points:0}` right after `STATION_BUILT`. A paid
  station never touches the flag.
- `hasAnyLegalMove` mirrors every gate above exactly: skips the station loop when stations are
  suspended (except the free-station short-circuit, which wins over the paid-cost check but loses to
  day-off suspension); skips the whole claim loop when claims are suspended; otherwise skips closed
  routes and prices sky-lantern routes at `length + surcharge`. `legalActions`/`enumerateClaimPayments`
  generate the matching surcharged/zero-cost candidates so the reducer's own filter, not a hand-written
  legality function, is what ultimately decides — this agreement is guarded by
  `events-property.spec.ts` (`PASS ∈ legalActions ⟺ !hasAnyLegalMove`, and PASS is the **sole** legal
  action when true, at every reachable `AWAIT_ACTION` across every intensity × player count).

### Redaction

`RedactedView.events?` (`packages/engine/src/types/view.ts`), built by `projectEvents` inside
`redactFor` (`selectors.ts`) — **viewer-independent** (a spectator sees the identical block a seated
player does):

```ts
readonly events?: {
  readonly mode: Exclude<EventsMode, 'off'>;
  readonly roundIndex: number;
  readonly active: readonly ActiveEvent[];
  readonly forecast: {                         // only the announced next telegraphed entry, else null
    readonly id: string; readonly kind: RandomEventKind;
    readonly startRound: number; readonly durationRounds: number;
    readonly routeIds?: readonly RouteId[]; readonly region?: string; readonly cityId?: CityId;
  } | null;
  readonly hotspots: readonly { readonly cityId: CityId; readonly level: number }[]; // sorted
  readonly charters: readonly CharterContract[];
  readonly reopenBonusRouteIds: readonly RouteId[];
  readonly closedRouteIds: readonly RouteId[];   // resolved: unclaimed routes of active typhoons only
  readonly freeStationAvailable: boolean;
  readonly lanternHost: LanternHostState | null;
  readonly lanternPendingRelocation: LanternRelocationState | null;
  readonly luckyContracts: readonly LuckyContract[];
  readonly repairedRouteIds: readonly RouteId[];
  readonly eventDraft: EventDraftState | null;
  readonly pendingHiveDraw: PendingHiveDraw | null;
  readonly boringActive: boolean;                // marker depth remains hidden
  readonly nightMarketSwapAvailable: boolean;
};
```

The **hidden schedule, `nextIdx`, and `suppressed` never leave the engine** — only currently-live
effects plus the one-round forecast window are ever projected. `RedactedView.settings.eventsMode`
(defaulting to `'off'` when `ruleParams.eventsMode` is `undefined`, covering v4 recovery) is always
present, on or off. `redact.spec.ts` pins: a future unannounced entry's id/routeIds/cityId/charter
cities never appear in `JSON.stringify(redactFor(...))` for any seat or the spectator; `forecast` is
non-null exactly during its one-round announced window; live effects (hotspots/charters/closed routes)
surface identically for every viewer.

### Wire shapes

`packages/proto/proto/trmission/v1/common.proto` — generic, forward-compatible event identity (a
string `kind`, not one message per event). The expansion retained that generic event envelope while
adding the phase/action/resource messages required by its genuinely new interactions:

```proto
message GameSettings {
  bool unlimited_station_borrow = 1;
  bool second_draw_after_blind_rainbow = 2;
  bool no_unfinished_ticket_penalty = 3;
  bool double_route_single_for23 = 4;
  string events_mode = 5; // "off" | "light" | "moderate" | "intense"
}

message HotspotMarker {
  string city_id = 1;
  uint32 level = 2;
}

message CharterContract {
  string id = 1;
  string city_a = 2;
  string city_b = 3;
  uint32 points = 4;
  uint32 expires_after_round = 5;
  string won_by_player_id = 6; // "" = open
}

message RandomEventInfo {
  string id = 1;
  string kind = 2;
  uint32 start_round = 3;
  uint32 duration_rounds = 4;
  uint32 ends_after_round = 5;  // 0 when N/A (forecast/instant)
  repeated string route_ids = 6;
  string region = 7;
  string city_id = 8;
  CharterContract charter = 9;  // unset unless CHARTER_SPECIAL
}

message RandomEventsState {
  string mode = 1;
  uint32 round_index = 2;
  repeated RandomEventInfo active = 3;
  RandomEventInfo forecast = 4;              // unset when nothing announced
  repeated HotspotMarker hotspots = 5;
  repeated CharterContract charters = 6;
  repeated string reopen_bonus_route_ids = 7;
  repeated string closed_route_ids = 8;
  bool free_station_available = 9;
}

message GameSnapshot {
  // … fields 1–21 unchanged …
  GameSettings game_settings = 21;
  RandomEventsState random_events = 22; // unset when the feature is off
}
```

`packages/proto/proto/trmission/v1/server.proto` — four new frames, all PUBLIC (no per-recipient
hidden info, unlike the ticket/hand events above them), plus four new `GameEvent` oneof cases
immediately after `game_ended = 20`:

```proto
message RandomEventAnnounced { RandomEventInfo info = 1; }
message RandomEventStarted   { RandomEventInfo info = 1; }
message RandomEventEnded     { string id = 1; string kind = 2; }
message RandomEventBonus {
  string kind = 1;
  string reason = 2;    // "HOTSPOT"|"REOPEN"|"STAMP"|"CHARTER"|"FREE_STATION"
  string player_id = 3;
  int32 points = 4;
  string route_id = 5;  // "" when not applicable
  string city_id = 6;   // "" when not applicable
}

message GameEvent {
  oneof event {
    // … cases 1–20 unchanged …
    RandomEventAnnounced random_event_announced = 21;
    RandomEventStarted random_event_started = 22;
    RandomEventEnded random_event_ended = 23;
    RandomEventBonus random_event_bonus = 24;
  }
}
```

Three new `RejectionCode` values, mirroring the engine's `RuleViolationCode` 1:1 (the standard
shared-errors → proto → codec → i18n 4-layer chain): `REJECTION_CODE_ROUTE_CLOSED_BY_EVENT = 126`,
`REJECTION_CODE_EVENT_CLAIMS_SUSPENDED = 127`, `REJECTION_CODE_EVENT_STATIONS_SUSPENDED = 128`.
`PROTOCOL_VERSION` **2 → 3** (`packages/proto/src/index.ts`).

`packages/codec/src/random-events.ts` (new, shared by `snapshot.ts` and `events.ts`) holds the mapping
helpers: `charterToPb`, `activeEventToInfo`, `forecastToInfo`, `randomEventsToPb`, `announcedToInfo`,
`startedToInfo`, plus a local `endsAfterRound(startRound, durationRounds)` resolver
(`durationRounds > 0 ? startRound + durationRounds - 1 : 0`) reused for both `EVENT_STARTED`'s
`ends_after_round` and its nested charter's `expires_after_round`. `packages/codec/src/events.ts`'s four
`EVENT_ANNOUNCED/STARTED/ENDED/BONUS` cases wrap into their `GameEvent` oneof case (`randomEventAnnounced`
… `randomEventBonus`); `packages/codec/src/snapshot.ts`'s `viewToSnapshot` projects `view.events` →
`randomEvents` (`undefined` when the view carries none) and `view.settings.eventsMode` →
`gameSettings.eventsMode` unconditionally (including `"off"`).

### Feature-flag + config chain (revised 2026-07-05 — see decision #2)

- `packages/shared/src/features.ts`: `USER_FEATURES` gains `'randomEvents'`, alongside `mapBuilder`/
  `replayReview` — one array, no separate taxonomy, so the server guard, the admin UI, and the web
  client can't drift.
- `apps/server/src/lobby/room.repo.ts`: `RoomSettings.eventsMode: EventsMode`;
  `DEFAULT_ROOM_SETTINGS.eventsMode = 'off'`.
- Zod: `eventsMode: z.enum(['off','light','moderate','intense'])` added to `GameSettingsSchema`
  (`lobby.schemas.ts`), so the PATCH partial and `RoomViewSchema.settings` echo it automatically.
- `apps/server/src/lobby/lobby.service.ts`: `assertEventsAllowed(userId)` (same strict-gate shape as
  `assertCustomMapAllowed`/`mapBuilder`) throws `featureDisabled('randomEvents')` (403
  `FEATURE_DISABLED`) when the caller lacks the feature. `updateSettings` calls it whenever a patch
  sets `eventsMode !== 'off'`; a patch to `'off'` is always allowed. `start()`'s `ruleParams` merge
  downgrades silently: `eventsMode: eventsAllowed ? s.eventsMode : 'off'` (checked against the host,
  who is also the caller of `start()`) — a room configured before the feature is revoked is never
  stranded; the started game's `game_settings.events_mode` always shows the truth. Started games are
  never retroactively affected by a later grant/revoke.
- No server-wide flag, no `GET /rooms/config` endpoint — a room's viewers already learn whether
  _they_ hold the feature from `PublicUser.features` (`GET /auth/me`), the same signal `mapBuilder`
  uses.
- `apps/server/src/history/history.repo.ts`: `REPLAY_COMPATIBLE_ENGINE_VERSIONS: readonly number[] =
[4, 5]` replaces the old strict `engineVersion !== ENGINE_VERSION` gate — v5 replays a v4 action log
  identically (v5 only adds inert genesis fields that draw zero extra RNG for a v4-configured game).

### Web surfaces

Everything is driven exclusively from `snapshot.randomEvents` / `snapshot.gameSettings.eventsMode` and
the four event frames arriving in the store's `lastBatch` — the client never recomputes schedule/rule
truth, only mirrors the server's payment/legality predicates for optimistic UI.

- `apps/web/src/net/rest.ts`: `RoomSettings.eventsMode: EventsMode`.
- `apps/web/src/screens/RoomScreen.tsx`: `useHasFeature('randomEvents')` (same hook `mapBuilder` uses)
  drives `showEventsPicker` — a `Segmented<EventsMode>` intensity control (關閉/輕度/中度/強烈) inside
  the game-settings fieldset, wired through the existing `setSetting({ eventsMode })` patch path
  (non-host / post-start disables it like every other setting). Shown to the host only while they
  hold the feature; shown read-only to a non-host once the room's `eventsMode` is already non-`'off'`
  (so it's never a mystery mid-configuration), hidden otherwise.
- `apps/web/src/game/events.ts` (new): the single snapshot-driven derivation module — `EVENT_KINDS`,
  `eventNameKey`/`eventDescKey` (i18n key builders), `closedRouteIds`/`reopenBonusRouteIds`/
  `skyLanternRouteIds` (route-id sets), `skyLanternSurcharge`/`freeStationAvailable` (exact mirrors of
  the engine predicates, consumed by the payment enumerators below), `hotspotLevels` (city→level map),
  `roundsLeft(info, roundIndex) = ends_after_round − round_index + 1` (null for instants/forecasts),
  `isCharterOpen`, `eventRejectionHintKey` (maps the three `errors:*` rejection messageKeys to nested
  i18n keys).
- `apps/web/src/components/EventsPanel.tsx` (new): compact side-rail card, renders only when
  `snapshot.randomEvents` is set — intensity chip, one row per active event (name + affected summary +
  rounds-left), one row per charter (open/won), a dimmed forecast row, a free-station row.
- `apps/web/src/components/EventBanner.tsx` (new): a prominent, skippable START banner (modelled on
  `EndgameWarning`) plus `EventToasts` — a stacked, self-expiring set of forecast-announcement and
  claim-bonus toasts, cued from the store the same way `EndgameWarning` is (`lastBatch`-driven, so a
  reconnect's log-only history backfill never replays a banner).
- `apps/web/src/game/payments.ts`: `enumerateRoutePayments(hand, route, extraCards = 0)` /
  `routeShortfall(hand, route, extraCards = 0)` (surcharged required size = `route.length +
extraCards`); `enumerateStationPayments(hand, cost, freeStation = false)` prepends the empty
  `{ color: null, colorCount: 0, locomotives: 0 }` payment only while the gala window is open — an
  exact mirror of `applyBuildStation`'s empty-payment branch.
- `apps/web/src/screens/GameStage.tsx`: threads `skyLanternSurcharge(...)` into the route payment
  helpers and `freeStationAvailable(...)` into the station ones; slots `<EventsPanel/>` at the top of
  the side rail (both rail and tray layouts) and into the phone dock's Players tab; a rejection toast
  renders the localized event-error message via `eventRejectionHintKey`, falling back to the generic
  `actionRejected`.
- `apps/web/src/game/logModel.ts` + `apps/web/src/components/LogPanel.tsx`: four new log kinds —
  `eventAnnounced`/`eventStarted` → `alert`, `eventBonus` → `highlight`, `eventEnded` → `normal`.
- `apps/web/src/components/Board.tsx`: overlays derived purely from `snapshot.randomEvents` — closed
  routes desaturated with a typhoon glyph (non-claimable, `data-closed`); sky-lantern routes warm-glow
  (`data-sky`); reopened routes get a +2 chip (`data-reopen`); hotspot cities get a +1/+2 badge
  (`data-hotspot`); open-charter endpoints get a dashed contract ring (`data-charter`).

## i18n

`apps/web/src/i18n/index.ts`, zh-Hant (primary) + en side by side. A representative slice of the
landed keys:

| Key                                                                            | zh-Hant                                                                                                                                            | en                                                                                                                                                         |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `settingRandomEvents`                                                          | 隨機事件                                                                                                                                           | Random events                                                                                                                                              |
| `settingRandomEventsDesc`                                                      | 以颱風警報為靈感的隨機事件：封線、加分與驚喜                                                                                                       | Typhoon-warning inspired events: closures, bonuses and surprises                                                                                           |
| `eventsMode_off` / `_light` / `_moderate` / `_intense`                         | 關閉 / 輕度 / 中度 / 強烈                                                                                                                          | Off / Light / Moderate / Intense                                                                                                                           |
| `events.panelTitle`                                                            | 事件                                                                                                                                               | Events                                                                                                                                                     |
| `events.forecast`                                                              | 預報                                                                                                                                               | Forecast                                                                                                                                                   |
| `events.startsNextRound`                                                       | 下一輪開始                                                                                                                                         | Starts next round                                                                                                                                          |
| `events.roundsLeft`                                                            | 剩 {{n}} 輪                                                                                                                                        | {{n}} rounds left                                                                                                                                          |
| `events.reopenBonus`                                                           | 重新通車 +2                                                                                                                                        | Reopened +2                                                                                                                                                |
| `events.freeStation`                                                           | 本輪首座車站免費                                                                                                                                   | First station this round is free                                                                                                                           |
| `events.charterOpen`                                                           | 連接 {{a}}–{{b}} 得 {{pts}} 分                                                                                                                     | Connect {{a}}–{{b}} for {{pts}} pts                                                                                                                        |
| `events.charterWon`                                                            | {{name}} 完成觀光專列                                                                                                                              | {{name}} completed the charter                                                                                                                             |
| `events.affectedRoutes`                                                        | {{n}} 條路線                                                                                                                                       | {{n}} routes                                                                                                                                               |
| `events.TYPHOON_LANDFALL.name` / `.desc`                                       | 颱風登陸 / 封閉部分路線；恢復通車後首位鋪設者可得 +2 分                                                                                            | Typhoon Landfall / Closes some routes; the first to rebuild a reopened route scores +2                                                                     |
| `events.TYPHOON_DAY_OFF.name` / `.desc`                                        | 颱風假 / 本輪不可佔領路線，但每回合可多抽一張車廂卡                                                                                                | Typhoon Day Off / No route claims this round, but everyone draws an extra card                                                                             |
| `events.SKY_LANTERN.name` / `.desc`                                            | 天燈之夜 / 指定路線分數加倍，但佔領需多付一張車廂卡                                                                                                | Sky Lantern Night / Featured routes score double but cost one extra card to claim                                                                          |
| `events.AFTERSHOCK.name` / `.desc`                                             | 餘震特報 / 隧道試掘多亮一張牌；放棄時可補抽一張                                                                                                    | Aftershock Advisory / Tunnels reveal one more card; abort to draw a consolation card                                                                       |
| `events.VIRAL_HOTSPOT.name` / `.desc`                                          | 爆紅打卡站 / 該車站永久獲得打卡標記；每次連接依標記等級得 +1 分，最高疊加至 2 級                                                                   | Viral Hotspot / A station permanently gains a marker; every claim touching it scores +1 per marker level, stacking up to level 2                           |
| `events.CHARTER_SPECIAL.name` / `.desc`                                        | 觀光專開列車 / 以自己的路網連接指定兩座城市即可得分                                                                                                | Charter Special / Connect two named cities with your own network to score                                                                                  |
| `events.RAILWAY_GALA.name` / `.desc`                                           | 鐵路節慶典 / 全體玩家抽牌，本輪首座車站免費興建                                                                                                    | Railway Anniversary Gala / Everyone draws, and this round's first station is free                                                                          |
| `events.STAMP_RALLY.name` / `.desc`                                            | 鐵道集章週 / 本輪每連接一座新車站可 +1 分                                                                                                          | Stamp Rally Week / Score +1 for each new city you connect this round                                                                                       |
| `errors.routeClosedByEvent`                                                    | 此路線因颱風暫時封閉                                                                                                                               | This route is closed by the typhoon                                                                                                                        |
| `errors.eventClaimsSuspended`                                                  | 颱風假：本輪不可佔領路線                                                                                                                           | Typhoon day off: no route claims this round                                                                                                                |
| `errors.eventStationsSuspended`                                                | 颱風假：本輪不可建車站                                                                                                                             | Typhoon day off: no stations this round                                                                                                                    |
| `log.eventAnnounced`                                                           | 預報：{{event}} 即將來臨                                                                                                                           | Forecast: {{event}} is coming                                                                                                                              |
| `log.eventStarted` / `.eventEnded`                                             | {{event}} 開始 / {{event}} 結束                                                                                                                    | {{event}} started / {{event}} ended                                                                                                                        |
| `log.eventBonus.HOTSPOT` / `.REOPEN` / `.STAMP` / `.CHARTER` / `.FREE_STATION` | 打卡熱點 +{{points}}（{{city}}）/ 重新通車 +{{points}}（{{route}}）/ 集章 +{{points}}（{{city}}）/ 觀光專列完成 +{{points}} / 免費車站（{{city}}） | Hotspot +{{points}} ({{city}}) / Reopened +{{points}} ({{route}}) / Stamp +{{points}} ({{city}}) / Charter completed +{{points}} / Free station ({{city}}) |

## Testing

**Engine** (`packages/engine/test/`):

- `off-mode-identity.spec.ts` — the frozen v4 golden (action log + final state captured on pre-events
  `main`); replayed under v5 and asserted deep-equal except `engineVersion`/`ruleParams.eventsMode`.
  Guards off-mode behavior and v4-in-flight recovery.
- `events-schedule.spec.ts` — genesis determinism (off mode consumes zero RNG draws, no `events` key);
  the schedule keeps generating well past a typical 45-75 round game instead of stopping after an
  initial handful; higher intensity yields more entries over the same span (frequency, not a fixed
  total); first-start bounds; gap ≥ occupancy + 1; non-overlapping restrictive/mixed windows;
  telegraphed/duration tables; charter ≥4 hops; typhoon routes touch their region; sparse-board
  fallback (never throws).
- `events-rounds.spec.ts` — round ticking incl. all-PASS/endgame edge cases; announce → start → end
  ordering and the exact batch order; quiet-endgame suppression; an announced-telegraphed entry always
  starts; no tick on the game-ending turn; the gala free-station window closing after exactly its own
  round; rule-7.5's forced re-draw staying last.
- `events-typhoon.spec.ts`, `events-dayoff.spec.ts`, `events-skylantern.spec.ts`,
  `events-aftershock.spec.ts` — the four restrictive/mixed rules, each with its own claim/reject/
  reveal/abort/legal-move cases.
- `events-hotspot.spec.ts`, `events-charter.spec.ts`, `events-gala.spec.ts`,
  `events-stamprally.spec.ts` — the four positive rules, each with award/edge-case/legal-move cases.
- `events-expansion.spec.ts` — direct mechanics coverage for all 13 expansion events, including the
  three mandatory phases, draft-resume/forced-ticket interaction, tunnel-base locomotive scoring,
  hidden marker expiry, public resources, and deferred procession scoring.
- `events-property.spec.ts` — greedy games to `GAME_OVER` at every intensity × 2/3/4 players, asserting
  at every `AWAIT_ACTION`: `legalActions` non-empty, and `PASS ∈ legalActions ⟺ !hasAnyLegalMove` (and
  PASS is the sole legal action when true) — the top risk (bot/legal-move divergence) covered
  exhaustively.
- `variants-determinism.spec.ts` — the `eventsMode: 'intense'` full-game replay-digest identity case
  (added alongside the existing variant cases).
- `redact.spec.ts` — a future unannounced entry never appears in any viewer's projected JSON; forecast
  appears exactly in its one-round announced window; hotspots/charters/closed-routes surface once
  active; spectator parity with seated players.

**Wire** (`packages/codec/test/codec.spec.ts`, `apps/server/test/codec.spec.ts`): a full-events-block
snapshot round-trip through `toBinary`/`fromBinary`; a no-events-block (`off`) case; all four event
frames round-tripped (incl. a charter sub-message, instant `ends_after_round: 0`, the expansion
follow-up frames, and every `EVENT_BONUS` reason); the 126–136 rejection-code mapping; a byte-level leak test in
`apps/server/test/codec.spec.ts` that serializes a schedule with a distinctive future, non-telegraphed
entry and asserts none of its ids/city/route strings appear in any recipient's serialized bytes, while
confirming live effects still do surface.

**Server e2e** (`apps/server/test/`): `lobby-events.e2e.spec.ts` (flag off/on, PATCH 403/200, the
flag-flip start-time downgrade); `wire-game-events.e2e.spec.ts` (an intense game over the hub for 3
players + a spectator — every recipient gets the event frames, and a byte-level leak check on hidden
schedule entries derived from live session state); `bots-events.e2e.spec.ts` (an all-bot intense game
runs to `GAME_OVER` without stalling, undowngraded `events.mode`, and a pure digit-for-digit replay);
`history-replay-compat.spec.ts` (the current-major-only `[8]` allowlist; stateful expansion phases make
v7 logs intentionally non-replayable under v8).

**Web** (`apps/web/src/`): `game/events.test.ts` (all names, descriptions, bonus reasons, recycle
reasons, and rejection keys), `game/payments.test.ts` (all payment modifiers), `game/logModel.test.ts`
(generic and expansion-specific frames), `components/EventsPanel.test.tsx`, `components/Board.test.tsx`
(persistent markers, procession trail, lucky pair, and region/route overlays), `screens/RoomScreen.test.tsx`
(picker hidden/shown, host-editable, read-only non-host). Replay smoke: the existing
`features/replay/useReplayPlayer.test.ts` passes unchanged (the shared logModel/banner path needed no
replay-specific fix); a dedicated events-mode replay fixture was not built (noted as a gap, not a bug —
see Concerns in the M6 task report).

## Expansion catalog (implemented 2026-07-11)

These are the 13 events originally retained as a future catalog. The table preserves the research
sketch and the cross-layer machinery that guided implementation; the resolved rules immediately below
are authoritative where a sketch was ambiguous.

| Event                        | 中文           | Mechanic sketch                                                                                                                                         | Extra machinery needed                                                                                                                                                                                          |
| ---------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lantern Host City            | 燈會主辦城     | A roaming +6 marker; whoever scores it relocates it into their own network; a game-long race.                                                           | A relocation follow-up sub-action (new phase step) + a new `RandomEventKind` + proto/bot awareness of the extra step.                                                                                           |
| Bento Rush                   | 排骨便當開賣   | Collect city tokens; spend a token as +2 points or as a 1-card wild in a claim payment.                                                                 | A token inventory on `EventsState`/`PlayerState`; a payment-shape extension in both payment enumerators (engine `selectors.ts` + web `game/payments.ts`) and the proto `Payment` message; bot awareness.        |
| Slope Repair Order           | 邊坡搶修令     | Spend a turn + 2 matching cards to repair a closed route (+3); otherwise it stays closed 3 rounds.                                                      | A brand-new `REPAIR` action end to end: reducer case, `legalActions` candidate, `scoreAction` (bot heuristic), proto client command, a new rejection code.                                                      |
| Station-Front Night Market   | 站前夜市開張   | Swap one hand card for one "market" card as a free pre-action near the event city.                                                                      | A free-action turn sub-step (doesn't consume the main action) + a once-per-turn marker on `PlayerState`/turn state.                                                                                             |
| Goddess Procession           | 遶境進香       | A 5-city palanquin advances one city per round; a claim at its current city draws a card + a "blessing" token; most blessings at game end scores +4.    | Path/position state on `EventsState` + a round-advance rule inside `tickRound` + deferred (end-game) scoring; a heavier board UI (the procession's current city + trail).                                       |
| Spring Festival Rush         | 春節返鄉潮     | 2 rounds: turn order reverses; ticket draws offer 4-keep-1 instead of the normal count.                                                                 | A turn-order scheduler change inside `endTurn` (interacts with the endgame countdown — care needed); a parameterized ticket-offer count threaded through `offerTickets`.                                        |
| Rolling-Stock Allocation Day | 配車調度日     | A reverse-score-order draft of one perk (a claim discount / draw 2 / a one-time event-repair permit).                                                   | A new draft `Phase` (blocks normal turns until every player has picked) + a perk inventory + a bot draft policy.                                                                                                |
| Hive of Sparks               | 蜂炮試膽       | A push-your-luck draw: flip up to 4 cards, but two consecutive same-colour cards bust the draw down to 1 kept card.                                     | A multi-step draw sub-action (a new phase, since it isn't resolved in one reducer call) + proto command/event + bot risk policy.                                                                                |
| Breakthrough Boring Machine  | 潛盾機貫通     | From reveal onward, tunnels only reveal 2 cards (down from 3); a marker card is buried in the bottom third of the deck to track when the effect lapses. | A deck marker-card mechanism (position-in-deck tracking) — new to the engine's deck model.                                                                                                                      |
| Interim Operations Report    | 期中營運報告   | A one-off scoring pulse at a scheduled round: current longest trail +3; +1 per every 3 routes a player has claimed.                                     | Deck markers (to fire mid-deck) + a mid-game budgeted call into the longest-trail solver (today only computed at game end — a budget/perf concern).                                                             |
| Harvest Festival Express     | 豐年祭加開列車 | 3 rounds: east-coast (region-filtered) claims +1; the face-up market refreshes early on any 3-of-a-colour showing.                                      | A market-refresh rule extension (`refillMarket`'s recycle condition) — otherwise reuses the existing region-filtered bonus pattern from Stamp Rally/Hotspot. Feasible as a near-v1 slice.                       |
| All Seats Reserved           | 全車對號入座   | 1 round: face-up locomotives become untakeable; playing an extra locomotive into a claim scores +2.                                                     | A face-up-card validation flag (mirrors the day-off suspension pattern) + a surcharge/bonus branch in `applyClaimRoute`. Feasible as a near-v1 slice.                                                           |
| Lucky Ticket Stub            | 吉祥票根       | First player to connect an authored "auspicious" city pair with their own network scores +5.                                                            | The pair must be authored content, not derived — a new field in `@trm/map-data` (bumps `CONTENT_HASH`), unlike every v1 target which is derived from existing `region`/graph data. Feasible as a near-v1 slice. |

### Resolved expansion rules

- **Lantern Host City** is a one-per-game positive surprise. Claiming a route touching the current
  host awards +6, then pauses turn completion for a mandatory relocation to a different city in the
  claimant's post-claim network. The public marker remains in play for the rest of the game.
- **Bento Rush** is a 3-round positive city event. A claim touching the event city gains one public
  bento token. One token may be spent in a later claim either as a one-card wild or, with the normal
  payment still made, for +2 points.
- **Slope Repair Order** is telegraphed and closes one route for 3 rounds. A player may spend their
  turn and two matching cards to reopen it for +3; a saved repair permit substitutes for both cards.
- **Station-Front Night Market** is a 2-round positive city event. A player whose own network reaches
  that city may, once before their main action each turn, exchange one hand card directly with one
  face-up market slot.
- **Goddess Procession** follows a seeded contiguous five-city path for 5 rounds, advancing once per
  round. A claim touching its current city draws one blind card and gains one public blessing. At game
  end, every tied blessing leader (when the maximum is nonzero) scores +4. Path enumeration at genesis
  is capped at a deterministic 20,000 canonical paths (`PROCESSION_PATH_CAP`) so a dense custom map
  cannot stall game start; the official map (~1.2k paths) never hits the cap.
- **Spring Festival Rush** is telegraphed for 2 rounds. Turn-index traversal reverses while it is live,
  and every destination-ticket draw offers up to four cards with a minimum keep of one.
- **Rolling-Stock Allocation Day** is a one-per-game positive surprise. Players draft in ascending
  route-score order (later turn-order position breaks ties) and choose one perk: a one-use one-card
  claim discount, two immediate blind draws, or a one-use card-free event repair permit.
- **Hive of Sparks** is a 1-round positive action option. Starting it reveals one card; the player may
  stop or continue up to four. Two consecutive cards of the same colour bust the attempt to the first
  card only; stopping, reaching four, or exhausting the draw pool keeps every revealed card.
- **Breakthrough Boring Machine** is a one-per-game positive surprise. Tunnels reveal two cards while
  it is live. A hidden marker is deterministically buried in the bottom third of the current deck; the
  effect ends when that many real cards have been drawn, and the marker never enters card counts.
- **Interim Operations Report** is an instant scheduled scoring pulse. Each player scores +1 per three
  claimed routes; every tied current longest-trail leader with a nonzero trail also scores +3.
- **Harvest Festival Express** lasts 3 rounds in a seeded region. Claims touching that region score
  +1, and a face-up market containing any three cards of one colour recycles immediately.
- **All Seats Reserved** is telegraphed for 1 round. Face-up locomotives cannot be taken. A claim whose
  base payment uses more locomotives than the route's printed ferry minimum scores +2; tunnel reveal
  surcharge cards do not count toward this test.
- **Lucky Ticket Stub** opens a permanent first-to-connect race for a seeded pair from the map's
  authored `auspiciousPairs`. Own-route connectivity only is used; the first connector scores +5.
  Each authored pair opens at most one race per game — once every pair has been drawn, the kind
  leaves the schedule pool (a repeat would hand its +5 to an already-connected player for free).

## Out of scope

- Bot bonus-chasing heuristics — bots stay legal-move-only under every event (`legalActions` already
  reflects every gate/candidate), with no event-aware scoring tuned into `policy.ts`.
- Maintainer dashboard event views (a LIVE game's `events` state is not surfaced to `apps/admin` beyond
  what already exists structurally-safe there).
- Event stats/achievements (no aggregate tracking of how often an event fired or its impact on a
  player's final score).
- Sound design beyond whatever the existing start/bonus animation hooks already trigger.
