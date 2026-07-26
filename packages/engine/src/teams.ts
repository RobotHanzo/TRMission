import type { PlayerId, CardColor, RouteId } from '@trm/shared';
import { CARD_COLORS, TEAM_POOL_CAPACITY } from '@trm/shared';
import type { Board } from './board';
import { groupMembersOf } from './board';
import type { GameState } from './types/state';
import type { Edge } from './graph/connectivity';
import type { TrailEdge } from './graph/longestTrail';

/**
 * Team helpers — the single place that answers "who is on whose side". Every team rule in the
 * engine (shared network, combined trail, ticket visibility, the card pool) reads membership
 * through here, so a free-for-all game short-circuits on one `state.teams === undefined` check
 * and can never pick up team behaviour by accident.
 */

/** True when this game is a team game. */
export const isTeamGame = (state: GameState): boolean => state.teams !== undefined;

/** The team id `player` belongs to, or null in a free-for-all. */
export function teamOf(state: GameState, player: PlayerId): number | null {
  const teams = state.teams;
  if (!teams) return null;
  for (let i = 0; i < teams.length; i++) {
    if ((teams[i] as readonly PlayerId[]).includes(player)) return i;
  }
  return null;
}

/**
 * Everyone on `player`'s side, INCLUDING `player`. In a free-for-all this is just `[player]` —
 * which is what makes the shared-network code below collapse to the historical per-player
 * behaviour without a branch at every call site.
 */
export function teammates(state: GameState, player: PlayerId): readonly PlayerId[] {
  const team = teamOf(state, player);
  if (team === null) return [player];
  return (state.teams as readonly (readonly PlayerId[])[])[team] as readonly PlayerId[];
}

/** Everyone on `player`'s side EXCLUDING `player` (empty in a free-for-all). */
export function partnersOf(state: GameState, player: PlayerId): readonly PlayerId[] {
  return teammates(state, player).filter((id) => id !== player);
}

/** True when `a` and `b` are on the same side. False in a free-for-all unless `a === b`. */
export function sameTeam(state: GameState, a: PlayerId, b: PlayerId): boolean {
  if (a === b) return true;
  const ta = teamOf(state, a);
  return ta !== null && ta === teamOf(state, b);
}

/**
 * The routes a player's SIDE owns, as graph edges. This is the shared-network primitive: ticket
 * completion and the longest-trail bonus both run over it, so in a team game a partner's track
 * extends your network exactly as if you had claimed it yourself. Iterates `state.ownership` in
 * insertion order (never a Set/Map of ids) to stay digest-deterministic.
 */
export function teamOwnedEdges(board: Board, state: GameState, player: PlayerId): TrailEdge[] {
  const side = teammates(state, player);
  const out: TrailEdge[] = [];
  for (const [routeId, cell] of Object.entries(state.ownership)) {
    if ('owner' in cell && side.includes(cell.owner)) {
      const r = board.routeById.get(routeId);
      if (r) out.push({ u: r.a as string, v: r.b as string, w: r.length });
    }
  }
  return out;
}

/** {@link teamOwnedEdges} as plain connectivity edges (no length weight). */
export const teamOwnedConnectivityEdges = (
  board: Board,
  state: GameState,
  player: PlayerId,
): Edge[] => teamOwnedEdges(board, state, player).map((e) => ({ a: e.u, b: e.v }));

/**
 * Is `routeId` owned by someone on `player`'s side? Used wherever the old code asked "is this an
 * OPPONENT's route" — station borrowing must not let you borrow your partner's track, because in
 * a team game it is already part of your own network and borrowing it would be a no-op that
 * wastes the station's one borrow slot.
 */
export function ownedBySide(state: GameState, routeId: string, player: PlayerId): boolean {
  const cell = state.ownership[routeId];
  if (!cell || !('owner' in cell)) return false;
  return sameTeam(state, cell.owner, player);
}

/**
 * Engine major from which parallel-track exclusivity became a rule about SIDES rather than about
 * players: one team may hold at most ONE track of a double/triple, not one per member. v12/v13 team
 * games were played (and persisted) under the per-player rule, so the switch is pinned per game on
 * `state.engineVersion` — stamped at genesis and never touched mid-game — which is what keeps their
 * logs replaying byte-identically under v14 and lets 12/13 stay in the replay allowlist.
 */
export const TEAM_PARALLEL_EXCLUSIVITY_ENGINE_VERSION = 14;

/** Does this game apply parallel-track exclusivity per SIDE (v14+) rather than per player? */
export const oneParallelTrackPerSide = (state: GameState): boolean =>
  state.engineVersion >= TEAM_PARALLEL_EXCLUSIVITY_ENGINE_VERSION;

/**
 * Does `player`'s SIDE already hold a track of `routeId`'s parallel group? The single answer behind
 * the claim gate (`reduce`), its PASS-legality mirror (`legality`), the state invariant, and the
 * bot's path-finding, so none of them can drift. A free-for-all — and any pre-v14 team game — reads
 * as the historical "does this PLAYER already hold one", because `sameTeam` is identity there.
 */
export function sideHoldsParallelTrack(
  board: Board,
  state: GameState,
  player: PlayerId,
  routeId: RouteId,
): boolean {
  const perSide = oneParallelTrackPerSide(state);
  for (const other of groupMembersOf(board, routeId)) {
    const cell = state.ownership[other as string];
    if (!cell || !('owner' in cell)) continue;
    if (perSide ? sameTeam(state, cell.owner, player) : cell.owner === player) return true;
  }
  return false;
}

/**
 * Engine major from which a side's STATIONS are shared: from v15 a partner's station borrows on
 * your behalf too, and the side's stations spend their one-borrow-each budget on a SINGLE
 * assignment serving every member's tickets. v12–v14 team games were played (and persisted) with
 * stations private to their builder, so — exactly like
 * {@link TEAM_PARALLEL_EXCLUSIVITY_ENGINE_VERSION} — the switch is pinned per game on
 * `state.engineVersion`, which is what keeps their logs replaying byte-identically under v15.
 */
export const TEAM_SHARED_STATIONS_ENGINE_VERSION = 15;

/** Does this game share a side's stations (v15+) rather than keeping them private to the builder? */
export const sharedTeamStations = (state: GameState): boolean =>
  state.engineVersion >= TEAM_SHARED_STATIONS_ENGINE_VERSION;

/**
 * Whose stations `player` may borrow through — and therefore whose tickets share the resulting
 * borrow assignment. `[player]` in a free-for-all AND in a pre-v15 team game (stations private to
 * their builder); the whole side from v15. Order follows {@link teammates}, so it is
 * digest-deterministic.
 */
export function stationSideOf(state: GameState, player: PlayerId): readonly PlayerId[] {
  return sharedTeamStations(state) ? teammates(state, player) : [player];
}

/** A team's face-up pool, or an all-zero hand when this is not a team game. */
export function teamPool(state: GameState, team: number): Readonly<Record<CardColor, number>> {
  const pool = state.teamPools?.[team];
  if (pool) return pool;
  const empty = {} as Record<CardColor, number>;
  for (const c of CARD_COLORS) empty[c] = 0;
  return empty;
}

/** How many cards sit in a team's pool. */
export function teamPoolCount(state: GameState, team: number): number {
  const pool = teamPool(state, team);
  let n = 0;
  for (const c of CARD_COLORS) n += pool[c];
  return n;
}

/** True when `team`'s pool has room for another card. */
export const teamPoolHasRoom = (state: GameState, team: number): boolean =>
  teamPoolCount(state, team) < TEAM_POOL_CAPACITY;

/** Replace one team's pool, preserving the array's identity discipline for the digest. */
export function withTeamPool(
  state: GameState,
  team: number,
  pool: Readonly<Record<CardColor, number>>,
): readonly Readonly<Record<CardColor, number>>[] {
  const pools = state.teamPools ?? [];
  return pools.map((p, i) => (i === team ? pool : p));
}
