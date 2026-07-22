# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`@trm/engine` is the **heart of the system**: a pure, deterministic reducer that owns all game rules.
It has zero I/O and no framework dependencies. The server feeds it actions and ships its events; the
web client imports it for selectors only (legal-move hints, score preview) but never trusts its own
result. Commands: `yarn workspace @trm/engine test` (or `yarn test:engine` from root);
`… test --run <file-substring>` for one suite; `… test:watch`.

## Purity is enforced, not just intended (ADR A4)

ESLint **bans** `Date`, `new Date()`, `Math.random`, `crypto.randomUUID`, and `Date.now` inside
`packages/engine/src/**`. All randomness comes from the seeded counter PRNG carried in
`GameState.rng` (from `@trm/shared`). The contract: `initGame(config) + Action[]` **replays
byte-identically**, verified by `stateDigest` (key-sorted SHA-256). Anything that breaks this breaks
recovery, reconnection, audit, and bots — so never introduce wall-clock, unseeded randomness, or
Set/Map-iteration-order dependence.

## Shape of the code

- `reduce.ts` — the entry reducer: `reduce(board, state, action) → ReduceResult` (ok | RuleViolation).
  Candidates are validated here; this is the sole authority on legality. `Board` (static precomputed
  lookups, built once from content via `buildBoard`) is passed alongside `state` to every function so
  `GameState` stays small and serializable.
- `types/state.ts`, `types/actions.ts`, `types/events.ts` — state model, the `Action` union, and the
  emitted `GameEvent`s. Hands/discard are colour-count **multisets** (fungible); deck & market are
  ordered arrays (blind draws / tunnel reveals expose specific cards).
- `selectors.ts` — `legalActions` (generates candidates then filters through `reduce`, so it can never
  diverge from what the reducer accepts), `enumerateClaimPayments`, and **`redactFor`** — the single
  per-viewer projection choke point (own hand/tickets visible, opponents counts-only). All wire egress
  goes through this; raw `GameState` must never reach a client.
- `graph/longestTrail.ts` — the longest-continuous-path bonus (max-weight trail, NP-hard): contract
  degree-2 chains → branch-and-bound with reachable-weight pruning → bitmask-DP fallback, under a
  **deterministic instruction-count budget** (never wall-clock). B&B and DP are cross-checked in tests.
- `graph/connectivity.ts` — ticket completion via union-find over owned edges, augmented by an
  exhaustive deterministic search over each station's borrowed opponent edge.
- `teams.ts` — the single answer to "who is on whose side" (v12). Every team rule reads membership
  through it, and in a free-for-all `teammates()` returns just `[player]`, so the shared-network
  code collapses to the historical per-player behaviour with no branch at the call sites.
- `scoring.ts`, `setup.ts`, `turn.ts`, `serialize.ts` (`stateDigest`/`replay`/`cloneState`),
  `invariants.ts` (conservation checks fast-check'd in tests).

## Team mode (v12)

A team game is any game whose config carried `teamCount`. Membership is `seat % teamCount`, so
partners are interleaved around the table by construction and the genesis turn-order shuffle is a
ROTATION (one `nextInt`) rather than a permutation — alternation cannot be broken. Teams share a
network for ticket completion (including the mid-game lock) and score ONE combined longest-trail
bonus on a team scoreboard row; the per-player rows carry `longestBonus: 0` so it is never doubled.
Teammates see each other's kept tickets, but never each other's hands: cards move between partners
only through the public per-team pool (`PUSH_TO_TEAM_POOL` is free once per turn and is deliberately
excluded from `hasAnyLegalMove` so A15 termination survives; `TAKE_FROM_TEAM_POOL` is a draw).

**Adding no `RuleParams` field was deliberate** — `stateDigest` covers `ruleParams`, so a new key
there would change every existing game's digest and break the replay allowlist. All team state is
optional keys (`teams`, `teamPools`, `turn.teamPushUsed`) that only `GameConfig.teamCount` can
produce, which is what lets v12 sit in `REPLAY_COMPATIBLE_ENGINE_VERSIONS` beside 9/10/11. Keep it
that way.

## When changing rules

The hard flows each have named unit + golden tests: tunnels (two-phase reveal/commit/abort), ferries,
double-routes, ticket+station scoring, endgame/termination, longest-path. A rule change should update
the relevant reducer **and** its golden fixture; the property suite asserts card/train conservation,
ownership exclusivity, station limits, and `stateDigest(replay) === stateDigest(live)` after every
legal action. `PASS` is legal **only** when the player has no other legal move (termination guarantee).
