# Random Events System (隨機事件) — Design + Implementation Plan

## Context

TRMission games currently play out identically-shaped every time. The user wants a
**randomly-triggering event system** for variety and Taiwan-railway flavor — typhoons closing
lines, festival bonuses, charter trains. Research across ToR variants, other board games, Taiwan
railway culture, and game-design literature produced 8 governing principles and a 21-event
catalog. V1 ships the system + 8 curated "no-new-action" events; the other 13 are documented for
future slices. Everything respects the repo's load-bearing constraints: pure deterministic engine
(seeded counter PRNG only), structural hidden info (`redactFor` is the only egress),
digest-verified replays, variants riding the `RuleParams` → `RoomSettings` → `GameSettings`
pipeline.

## Decisions (settled with the user)

1. **Opt-in room option with intensity levels** — `eventsMode: 'off'|'light'|'moderate'|'intense'`
   (typhoon-warning flavored: 關閉／輕度／中度／強烈), default `off`.
2. **Server feature flag, default OFF** — `TRM_RANDOM_EVENTS_ENABLED === '1'` gates whether users
   can see/configure the option at all; server enforces (UI hiding is not enough).
3. **Forecast + surprises** — restrictive/mixed events telegraphed one full round ahead; purely
   positive events fire as surprises at round start.
4. **V1 = 8 starter events**, none adding player actions/phases. All 21 documented for the future.
5. **Seeded schedule at genesis** — `initGame` draws the whole timeline from the seeded PRNG onto
   `GameState`; rounds tick in `endTurn`; forecast is a redaction window. Hub untouched.

## Design principles (bake into the M7 design doc)

Input randomness only (never undo committed actions / destroy claimed routes / discard from
hands) · telegraph constraints, surprise gifts · symmetric targeting (regions/deck/global, never a
seat) · every constraint pairs with an opportunity · bounded swing (≤ ~one good turn, ≈4–7 pts) ·
quiet endgame · auditable fairness (timeline decided at seed time).

## Architecture (verified against code by a Plan agent; code wins over earlier briefing)

### Feature flag

- `apps/server/src/config/env.ts`: `randomEvents: process.env.TRM_RANDOM_EVENTS_ENABLED === '1'`
  (**default OFF** — inverted vs the `!== '0'` auth idiom).
- New injectable `LobbyConfig` (`apps/server/src/lobby/lobby-config.ts`) on the `AuthConfig`
  pattern (`@Optional()` overrides for tests); injected into `LobbyService`/`LobbyController`.
- Web read surface: **new `GET /api/v1/rooms/config`** → `{ randomEventsEnabled }` (no existing
  lobby config endpoint; declare before the `':code'` route like `'mine'`).
- Enforcement: `updateSettings` rejects `eventsMode != 'off'` with 403 when flag off;
  `LobbyService.start` **silently downgrades** to `'off'` if the flag flipped between configure
  and start (deterministic; snapshot `game_settings.events_mode` shows the truth; rejection would
  strand ready rooms on ops flips). Started games are never affected by the flag.
- Web: RoomScreen fetches the config; intensity picker rendered only when `true` (missing ⇒ hidden).

### Config chain

`RuleParams.eventsMode` + `EventsMode` type (`packages/shared/src/constants.ts`, default `'off'`)
→ `RoomSettings.eventsMode` (`apps/server/src/lobby/room.repo.ts`) → zod enum in
`lobby.schemas.ts` → merge in `LobbyService.start` → `GameConfig.ruleParams` → `initGame` →
engine gates on `state.ruleParams.eventsMode` → `RedactedView.settings` → proto
`GameSettings.events_mode` → web RoomScreen (**not** SettingsModal — that's user prefs; room rule
toggles live in `apps/web/src/screens/RoomScreen.tsx` `RULE_TOGGLES` fieldset, ~L190–392).
`StoredConfig.ruleParams` is a `Partial<RuleParams>` passthrough — persistence needs no changes.

### Engine state (`ENGINE_VERSION` 4 → 5)

`GameState` gains **one optional field** `events?: EventsState` — conditional spread, only when
mode ≠ off. `stableStringify` drops `undefined` keys, so off-mode digests contain no events keys.
All gates read "undefined ⇒ off" so in-flight v4 games recover safely under the v5 binary.

New `packages/engine/src/types/events-state.ts`:
- `RandomEventKind` = `TYPHOON_LANDFALL | TYPHOON_DAY_OFF | VIRAL_HOTSPOT | CHARTER_SPECIAL |
  SKY_LANTERN | AFTERSHOCK | RAILWAY_GALA | STAMP_RALLY`.
- `EventScheduleEntry { id, kind, startRound, durationRounds, telegraphed, routeIds?, region?,
  cityId?, charter?{a,b,points} }` — **the schedule array is hidden info, like the seed**.
- `EventsState { mode, roundIndex, nextIdx, schedule, suppressed[], active: ActiveEvent[],
  hotspots: Record<cityId, 1|2>, charters: CharterContract[], reopenBonus: RouteId[],
  freeStation?: {untilRound} }`.
- Stamp Rally needs no per-player state — "network cities" derive from `state.ownership`
  pre/post-claim.

### Corridors/regions — derive from existing `CityDef.region`

All 39 Taiwan cities (and custom-map `CityDraft`s) already carry an authored `region`
(`North`, `Central-West`, `Interior`, `East-Rift`, …). A route touches region R iff either
endpoint has it; eligible regions = those with ≥3 touching routes (sorted for determinism).
**Zero map-data edits, zero CONTENT_HASH churn.** Fallbacks: kinds without valid targets on a
custom map are excluded from the draw; sparse maps simply never roll typhoon/sky-lantern.

### Schedule generation — new `packages/engine/src/events/schedule.ts`

Runs as genesis step **(8)** at the END of `setup.ts`'s documented RNG order; **zero draws when
off**. Count: light 2 / moderate 4 / intense 6. First start: light `4+nextInt(2)` / moderate
`3+nextInt(2)` / intense `2+nextInt(2)` (min 2 so telegraphs always fit). Per slot: weighted
category draw (positive/mixed/restrictive = 3/1/1 light, 2/2/2 moderate, 2/3/3 intense) → kind →
targets (typhoon: region + `2+nextInt(2)` shuffled touching routes; sky lantern: region + resolved
route list; hotspot: city with ≥2 incident routes, respecting the level-2 cap; charter: first
shuffled pair with BFS hop distance ≥ 4, `points = 6+nextInt(5)`) → next start =
`start + occupancy + 1 + nextInt(2)` (restrictive/mixed windows non-overlapping by construction;
positives occupy 1). Cap `startRound ≤ 20`. Durations: landfall 2, day-off 1, sky-lantern 2,
aftershock 1, gala 1, stamp rally 3, charter 4 (passive), hotspot instant/permanent.

**Quiet endgame** (deterministic, state-only): `quiet = endgame.triggered ||
min(trainCars) <= endgameTrainThreshold + 8`. Telegraphed entries decide at **announce** time
(once announced they always start — never renege on a forecast); surprises decide at **start**
time. Suppressed ids recorded in `suppressed`.

### Round semantics — `endTurn` (`packages/engine/src/turn.ts:22-80`)

`roundIndex` starts at 1 (set at genesis). In `endTurn`, after the existing endgame/termination
logic (no event processing on the game-ending turn), when `nextIdx === 0`: `roundIndex++`, then
pure `tickRound(board, state)` from new `packages/engine/src/events/runtime.ts`:
(a) **end** expiring actives (`EVENT_ENDED`; typhoon moves unclaimed routes → `reopenBonus`;
expire un-won charters; drop stale `freeStation`), (b) **start** due entries (`EVENT_STARTED`;
gala deals 1 blind card per player in turn order via `drawOne` + private `CARD_DRAWN_BLIND`;
hotspot bumps level; charter opens **and immediately awards if someone already connects it**, in
turn order), (c) **announce** next telegraphed entry starting next round (`EVENT_ANNOUNCED`).
Wire order per action: `…TURN_ENDED, EVENT_ENDED*, EVENT_STARTED*, EVENT_ANNOUNCED?,
TURN_STARTED…`; rule-7.5 forced ticket re-draw stays last. `endTurn` may now consume deck/RNG —
still pure.

### Rule enforcement (reduce.ts + new `packages/engine/src/events/effects.ts`)

Helpers: `closedRouteIds`, `claimsSuspended`, `stationsSuspended`, `skyLanternSurcharge`,
`tunnelRevealCount`, `dayOffDrawLimit`, `freeStationAvailable`, `applyClaimEventEffects`.

| Event | Enforcement |
|---|---|
| Typhoon closure | `claimPreconditions` rejects closed routes → `ROUTE_CLOSED_BY_EVENT`; **`hasAnyLegalMove` (reduce.ts:666-693) must mirror it** or PASS legality diverges and players/bots strand. Reopen +2 on first claim (incl. tunnel commit) via `reopenBonus`, emits `EVENT_BONUS{REOPEN}`. |
| Day Off | Claim/station rejected → `EVENT_CLAIMS_SUSPENDED`/`EVENT_STATIONS_SUSPENDED`; draw limit +1 (3 picks; face-up loco rules unchanged); `hasAnyLegalMove` skips claim/station while suspended. |
| Sky Lantern | Cost = length **+1** of the paid colour (locos ok): `extraCards` param through `validateRoutePayment` (payments.ts) AND **both payment enumerators** — engine `enumeratePayments` (selectors.ts) and web `apps/web/src/game/payments.ts` — else zero claim candidates are generated in-region (enumerate-then-filter). Points doubled via `pointsOverride` on `applyClaimEffects` (rides `ROUTE_CLAIMED.pointsAwarded`). Tunnel surcharge applies to base payment only. |
| Aftershock | `beginTunnel` reveals ruleParams+1 cards; abort path (`applyResolveTunnel !commit`, reduce.ts:496-511 — verified: revealed→discard, hand untouched) draws 1 blind consolation card before `endTurn`. |
| Hotspot | Post-claim: +level per marked endpoint → `EVENT_BONUS{HOTSPOT}`. |
| Charter | Post-claim/tunnel-commit while open: own-edges-only union-find (reuse `graph/connectivity.ts`; station borrows excluded in v1, documented) → `wonBy`, +points, `EVENT_BONUS{CHARTER}`. |
| Gala station | `applyBuildStation` accepts the empty payment when `freeStationAvailable`, consumes it, `EVENT_BONUS{FREE_STATION}`; zero-payment candidate added in `legalActions` + web `enumerateStationPayments`. |
| Stamp Rally | Post-claim: each endpoint not in pre-claim network → +1, `EVENT_BONUS{STAMP}`. |

All bonuses land in `PlayerState.routePoints` (existing running score); each is an itemized
`EVENT_BONUS` event. New engine events (`types/events.ts`): `EVENT_ANNOUNCED`, `EVENT_STARTED`,
`EVENT_ENDED`, `EVENT_BONUS{reason: HOTSPOT|REOPEN|STAMP|CHARTER|FREE_STATION}` — all PUBLIC.

### Redaction

`RedactedView` gains optional `events` block: `{ mode, roundIndex, active[], forecast (ONLY the
announced next telegraphed entry, else null), hotspots[], charters[], reopenBonusRouteIds[],
closedRouteIds[] (resolved), freeStationAvailable }`. **`schedule`/`nextIdx`/`suppressed` never
leave the engine.** Spectators get the same public block. Admin dashboard is already structurally
safe (`dashboard-games.service.ts` never returns GameState; withholds even the seed for LIVE) —
add a leak test only. `RedactedView.settings` gains `eventsMode`.

### Wire (generic messages; string `kind` for forward-compat with the 13 future events)

`common.proto`: `HotspotMarker`, `CharterContract`, `RandomEventInfo { id, kind, start_round,
duration_rounds, ends_after_round, route_ids[], region, city_id, charter }`,
`RandomEventsState { mode, round_index, active[], forecast, hotspots[], charters[],
reopen_bonus_route_ids[], closed_route_ids[], free_station_available }`;
`GameSettings.events_mode = 5`; `GameSnapshot.random_events = 22` (unset when off).
`server.proto`: `RandomEventAnnounced/Started/Ended/Bonus`, GameEvent oneof cases 21–24.
`RejectionCode` 126–128: `ROUTE_CLOSED_BY_EVENT`, `EVENT_CLAIMS_SUSPENDED`,
`EVENT_STATIONS_SUSPENDED` (4-layer 1:1: shared errors.ts → proto → codec map → i18n).
`PROTOCOL_VERSION` 2→3. Regenerate via `yarn workspace @trm/proto generate`.
Codec: 4 cases in `packages/codec/src/events.ts`, events block in `snapshot.ts`, rejection map.

### Bots

No new actions ⇒ `chooseBotAction`/`scoreAction` unchanged; legality inherited via
`legalActions`. Risk guard: property tests assert `PASS ∈ legalActions ⟺ !hasAnyLegalMove` at
every step so the hub's PASS fallback (`hub.ts:664`) never stalls.

### Web

Snapshot-driven; the client re-derives nothing (closed routes, resolved region route lists,
hotspots, charters all arrive on the snapshot).
- `net/rest.ts`: `RoomSettings.eventsMode`, `api.getRoomsConfig()`.
- `RoomScreen.tsx`: flag-gated intensity `Segmented` picker in the game-settings fieldset.
- New `components/EventsPanel.tsx` (active events + dimmed forecast row) and
  `components/EventBanner.tsx` (EndgameWarning pattern; cue via `store/animations.ts` from
  `lastBatch`; lighter Toast for announce/bonus).
- `game/logModel.ts` + `LogPanel.tsx`: 4 new LogKinds (announce/start = `alert`, bonus =
  `highlight`, end = `normal`).
- `Board.tsx`/`RouteShape.tsx`: closed-route hatching + typhoon chip, "+2" reopen chip, hotspot
  city badge, sky-lantern region tint, charter chip.
- `GameStage.tsx` + `game/payments.ts`: per-route surcharge + free-station zero payment.
- Replay viewer works unmodified (replays re-run `initGame` → identical schedule → same
  snapshots); only logModel cases + banner cue are additive.

### Versioning / migration

`ENGINE_VERSION` 5 (off-mode **behaviorally** identical to v4 — digest changes only via
`engineVersion` + `ruleParams.eventsMode`; no pinned digest constants exist in tests, verified).
`SCHEMA_VERSION` stays 1; CONTENT_HASH unchanged. In-flight v4 games recover under v5 (snapshot
overwrites state; gates treat `eventsMode === undefined` as off). History `replayable` flag:
`history.repo.ts:67` strict-equality would flip old games to non-replayable — **adopt the
compat allowlist `REPLAY_COMPATIBLE_ENGINE_VERSIONS = [4, 5]`** (sound: v5 replays v4 logs
identically; only a benign finalDigest warn fires).

## V1 starter events (8)

| # | Event | 中文 | Arrival | Effect |
|---|-------|------|---------|--------|
| 1 | Typhoon Landfall | 颱風登陸 | Telegraphed | 2–3 seeded UNCLAIMED routes in one seeded region close for 2 rounds; claimed routes untouched. After reopening, first claim of each +2. |
| 2 | Typhoon Day Off | 颱風假 | Telegraphed | 1 round: no claims/stations; draw turns get 1 extra pick (3 total; face-up loco still ends turn). |
| 3 | Sky Lantern Night | 天燈之夜 | Telegraphed | 2 rounds: region routes score DOUBLE but cost +1 matching card (locos ok). |
| 4 | Aftershock Advisory | 餘震特報 | Telegraphed | 1 round: tunnels reveal 4 cards (not 3); aborting draws 1 blind consolation card. |
| 5 | Viral Hotspot | 爆紅打卡站 | Surprise | Seeded city permanently +1 per touching claim (stacks to 2). |
| 6 | Charter Special | 觀光專開列車 | Surprise | Public contract: connect two seeded cities (BFS ≥ 4 apart) for 6–10 pts, first-come; expires after 4 rounds. |
| 7 | Railway Anniversary Gala | 鐵路節慶典 | Surprise | Instant: everyone draws 1 blind card; next round first station built by anyone is free. |
| 8 | Stamp Rally Week | 鐵道集章週 | Surprise | 3 rounds: each NEW city added to your network +1 immediately. |

## Future catalog (documented, NOT in v1 — include in the M7 design doc)

| Event | 中文 | Sketch | Extra machinery |
|-------|------|--------|-----------------|
| Lantern Host City | 燈會主辦城 | Roaming +6 marker; scorer relocates it into own network; game-long race. | Relocation follow-up action (new phase) + proto + bots. |
| Bento Rush | 排骨便當開賣 | Collect city tokens; spend as +2 pts or 1-card wild in a claim. | Token inventory; payment extension in both enumerators + proto Payment + bots. |
| Slope Repair Order | 邊坡搶修令 | Spend a turn + 2 matching cards to repair a route (+3) else it closes 3 rounds. | New REPAIR action (reducer/legalActions/scoreAction/proto/rejections). |
| Station-Front Night Market | 站前夜市開張 | Swap 1 hand card for 1 market card as a free pre-action near the city. | Free-action turn sub-step + once-per-turn marker. |
| Goddess Procession | 遶境進香 | 5-city palanquin advances each round; claims at its city draw a card + blessing; most blessings +4. | Path state + round-advance + deferred scoring; heavy UI. |
| Spring Festival Rush | 春節返鄉潮 | 2 rounds: reversed turn order; ticket draws offer 4-keep-1. | Turn-order scheduler change (endgame-countdown risk); parameterized offers. |
| Rolling-Stock Allocation Day | 配車調度日 | Reverse-score-order draft of one perk (claim discount / draw 2 / event-repair permit). | New draft Phase + perk inventory + bot draft policy. |
| Hive of Sparks | 蜂炮試膽 | Push-your-luck draw: flip up to 4, consecutive same colour busts to 1 kept. | Multi-step draw sub-action (new phase) + proto + bots. |
| Breakthrough Boring Machine | 潛盾機貫通 | From reveal, tunnels reveal only 2 cards; era card buried in bottom deck third. | Deck marker-card mechanism. |
| Interim Operations Report | 期中營運報告 | Scoring pulse: current longest trail +3; +1 per 3 claimed routes. | Deck markers + mid-game budgeted longest-trail call. |
| Harvest Festival Express | 豐年祭加開列車 | 3 rounds: east-coast claims +1; market refresh on 3-of-a-colour. | Market-refresh rule ext. Near-v1 feasible. |
| All Seats Reserved | 全車對號入座 | 1 round: face-up locos untakeable; +1 extra loco on a claim = +2. | Face-up validation flag + surcharge branch. Near-v1 feasible. |
| Lucky Ticket Stub | 吉祥票根 | First to connect an authored auspicious city pair +5. | Authored pairs in map-data (CONTENT_HASH bump). Near-v1 feasible. |

## Milestones (each independently landable; engine lands dark until M5)

- **M0 — Off-mode golden fixture** (commit BEFORE any engine change): capture a
  `playGreedyGame(3, 'events-off-golden')` action log + final-state fixture on current main; new
  `packages/engine/test/off-mode-identity.spec.ts` replays it and asserts deep equality of
  everything except `engineVersion`/`ruleParams.eventsMode`. Guards off-mode behavior + v4
  recovery (R4).
- **M1 — Shared types + engine scaffolding**: `EventsMode`/`RuleParams` + 3 error codes
  (`@trm/shared`); `types/events-state.ts`, `events/schedule.ts`, `events/runtime.ts`
  (`tickRound`), `turn.ts` round hook, 4 event variants, `redactFor` events block +
  `settings.eventsMode`, invariants, index exports, ENGINE_VERSION 5. Tests:
  `events-schedule.spec.ts` (determinism; off ⇒ identical rng.counter; intensity counts/gaps;
  synthetic sparse-map fallbacks), `events-rounds.spec.ts` (round ticking incl. all-PASS/endgame;
  announce→start→end ordering; suppression), M0 stays green.
- **M2 — Restrictive/mixed rules** (typhoons, sky lantern, aftershock): `events/effects.ts`,
  reduce.ts gates, `hasAnyLegalMove` mirror, `payments.ts` `extraCards`, enumerator awareness.
  Tests per event + `variants-determinism` intense-mode replay-digest case + property greedy games
  at each intensity (asserting `PASS ∈ legalActions ⟺ !hasAnyLegalMove` every step — R2).
- **M3 — Positive rules** (hotspot, charter, gala, stamp rally) + zero-payment station candidate.
  Tests per event + `redact.spec.ts`: no unsanctioned schedule bytes pre-announce; forecast
  appears exactly in its window; spectator parity.
- **M4 — Wire**: proto additions + `PROTOCOL_VERSION` 3 + regenerate; codec cases + snapshot
  block + rejection map. Tests: codec round-trips; serialized-bytes leak assertion for unfired
  events.
- **M5 — Server**: `env.ts` flag, `LobbyConfig`, `RoomSettings.eventsMode` + zod schema,
  `GET rooms/config`, `updateSettings` 403 enforcement, `start` downgrade mapping, history
  compat allowlist `[4,5]`. Tests: lobby-settings e2e (flag off/on, flag-flip downgrade),
  new `wire-game-events.e2e.spec.ts` (room→start→event frames for players AND spectators, no
  schedule leakage), `bots-events.e2e.spec.ts` (all-bot intense game to GAME_OVER).
- **M6 — Web**: rest.ts, RoomScreen picker, EventsPanel, EventBanner + animation cue, logModel +
  LogPanel, board overlays, payments surcharge/free-station, i18n keys (zh-Hant + en; see key list
  in the Plan-agent section of the design doc). Tests: logModel/EventsPanel/RoomScreen/payments +
  replay smoke.
- **M7 — Design doc**: `docs/superpowers/specs/2026-07-04-random-events-design.md` per repo
  convention (Goal / Decisions / data shapes with file paths / i18n pairs / Testing / Out of
  scope), including the full future catalog above and the genesis RNG order amendment.

Per repo rules: commit each milestone once validated; stage only own files; run
`yarn workspace @trm/proto generate` after proto edits; `graphify update .` after code changes.

## Key risks

- **R2 (top)**: `hasAnyLegalMove` / enumerator divergence strands players or the bot PASS
  fallback (`no_legal_action` stall metric) — mitigated by M2 property assertions.
- **R1**: ENGINE_VERSION bump vs old replays — mitigated by the `[4,5]` allowlist.
- **R4**: v4 in-flight recovery — mitigated by M0 fixture + undefined-as-off gates.
- **R5**: `endTurn` now draws (gala/consolation) — event-order + rule-7.5-last covered in
  `events-rounds.spec.ts`.
- **R7**: sparse custom maps — schedule fallbacks must never throw (synthetic-board test).

## Verification

- `yarn typecheck && yarn lint && yarn test` (all workspaces) green at every milestone.
- Manual e2e: `TRM_RANDOM_EVENTS_ENABLED=1`, `docker compose up -d mongo`, server + web dev; create
  a room, set 強烈, play with bots: watch forecast panel → typhoon announce banner → closed-route
  hatching → reopen +2 → a charter payout; verify log itemization and zh-Hant/en copy. Flag-off
  run: picker invisible AND a forged `PATCH settings {eventsMode:'light'}` returns 403.
- Replay a finished events game in the history viewer; verify panels/overlays render identically.

## Out of scope (v1)

The 13 future-catalog events; bot bonus-chasing heuristics; admin dashboard event views;
event stats/achievements; sound design beyond optional start/bonus hooks.
