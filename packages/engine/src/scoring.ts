import type { PlayerId, RouteId, TicketId } from '@trm/shared';
import type { Board } from './board';
import type { GameState, FinalScoreboard, PlayerFinal, TeamFinal } from './types/state';
import { longestTrail, longestTrailWithPath } from './graph/longestTrail';
import type { TrailEdge } from './graph/longestTrail';
import { evaluateTickets } from './graph/connectivity';
import type { Edge } from './graph/connectivity';
import { UnionFind } from './graph/unionFind';
import { teamOwnedEdges, ownedBySide } from './teams';

/**
 * The routes backing a player's network, as graph edges (length-weighted for the trail bonus).
 * In a team game this is the UNION of the side's routes — a partner's track extends your network
 * for ticket completion and for the combined trail. In a free-for-all `teamOwnedEdges` collapses
 * to exactly the player's own routes, so this is the historical behaviour unchanged.
 */
function ownedEdges(board: Board, state: GameState, player: PlayerId): TrailEdge[] {
  return teamOwnedEdges(board, state, player);
}

/**
 * Opposing (non-locked) routes incident to a city → borrowable edges for station scoring. A
 * teammate's route is deliberately NOT a candidate: it is already part of the team network, so
 * borrowing it would burn the station's single borrow slot on a no-op.
 */
function borrowCandidatesForCity(
  board: Board,
  state: GameState,
  city: string,
  owner: PlayerId,
): Edge[] {
  const out: Edge[] = [];
  for (const routeId of board.incident.get(city) ?? []) {
    const cell = state.ownership[routeId as string];
    if (cell && 'owner' in cell && !ownedBySide(state, routeId as string, owner)) {
      const r = board.routeById.get(routeId as string);
      if (r) out.push({ a: r.a as string, b: r.b as string });
    }
  }
  return out;
}

/** All non-locked opponent edges incident to any city where `playerId` built a station (deduped). */
export function stationBorrowEdges(board: Board, state: GameState, playerId: PlayerId): Edge[] {
  const out: Edge[] = [];
  const seen = new Set<string>();
  for (const s of state.stations) {
    // Own stations only, even in a team game: a partner's stations serve THEIR tickets. Pooling
    // them would also blow up the borrow-assignment enumeration (≤3 stations × ≤7 options is what
    // keeps `evaluateTickets` exhaustive; a trio would make it 7^9).
    if (s.playerId !== playerId) continue;
    for (const e of borrowCandidatesForCity(board, state, s.cityId as string, playerId)) {
      const key = e.a < e.b ? `${e.a}|${e.b}` : `${e.b}|${e.a}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(e);
      }
    }
  }
  return out;
}

/** End-of-game destination-ticket result for one player, including WHICH kept tickets count. */
export interface PlayerTicketDetail {
  /** Net ticket points (completed values minus failed values; may be negative). */
  readonly net: number;
  /** Number of kept tickets connected under the optimal station-borrow assignment. */
  readonly completed: number;
  /** The kept ticket ids that count as completed (matches `completed`), in kept order. */
  readonly completedTicketIds: TicketId[];
}

/**
 * Score a player's kept tickets at game end with the station-borrow optimisation, and recover
 * exactly which kept tickets are completed under the chosen assignment. The completed set is the
 * authoritative basis for the end-game gains/losses breakdown — unlike the in-game public
 * `completedTickets`, which is own-track only and can omit a borrow-completed ticket.
 */
export function evaluatePlayerTickets(
  board: Board,
  state: GameState,
  playerId: PlayerId,
): PlayerTicketDetail {
  const player = state.players[playerId as string];
  if (!player) return { net: 0, completed: 0, completedTicketIds: [] };

  const cityIds = board.cityIds.map((c) => c as string);
  const edges = ownedEdges(board, state, playerId);
  const stationCities = state.stations
    .filter((s) => s.playerId === playerId)
    .map((s) => s.cityId as string);
  const borrowCandidates = new Map<string, Edge[]>();
  for (const city of stationCities) {
    borrowCandidates.set(city, borrowCandidatesForCity(board, state, city, playerId));
  }
  const goals = player.keptTickets
    .map((id) => {
      const t = board.ticketById.get(id as string);
      return t ? { id, a: t.a as string, b: t.b as string, value: t.value } : null;
    })
    .filter((g): g is { id: TicketId; a: string; b: string; value: number } => g !== null);

  // Unlimited-borrow variant: every station borrows ALL its incident opponent edges, so completion
  // is a single monotonic union — no per-station optimisation. This matches the locked completion
  // set maintained mid-game (the monotonicity invariant), so banked == final.
  if (state.ruleParams.unlimitedStationBorrow) {
    const uf = new UnionFind(cityIds);
    for (const e of edges) uf.union(e.u, e.v);
    for (const e of stationBorrowEdges(board, state, playerId)) uf.union(e.a, e.b);
    let net = 0;
    let completed = 0;
    const completedTicketIds: TicketId[] = [];
    for (const g of goals) {
      if (uf.connected(g.a, g.b)) {
        net += g.value;
        completed += 1;
        completedTicketIds.push(g.id);
      } else if (!state.ruleParams.noUnfinishedTicketPenalty) {
        net -= g.value;
      }
    }
    return { net, completed, completedTicketIds };
  }

  const ticketEval = evaluateTickets({
    ownEdges: edges.map((e) => ({ a: e.u, b: e.v })),
    stationCities,
    borrowCandidates,
    tickets: goals.map((g) => ({ a: g.a, b: g.b, value: g.value })),
    vertices: cityIds,
    noUnfinishedTicketPenalty: state.ruleParams.noUnfinishedTicketPenalty,
  });

  // Re-derive which tickets are connected under the chosen borrow assignment so the listed
  // tickets always reconcile with `net`/`completed`.
  const uf = new UnionFind(cityIds);
  for (const e of edges) uf.union(e.u, e.v);
  for (const b of ticketEval.borrows) if (b) uf.union(b.a, b.b);
  const completedTicketIds = goals.filter((g) => uf.connected(g.a, g.b)).map((g) => g.id);

  return { net: ticketEval.net, completed: ticketEval.completed, completedTicketIds };
}

/**
 * The route ids of one optimal longest trail for a player (in traversal order) — the segments to
 * highlight on the map when reviewing the longest-path bonus at game end. `[]` if they own none.
 */
export function longestTrailRouteIdsFor(
  board: Board,
  state: GameState,
  playerId: PlayerId,
): RouteId[] {
  const routeOf: RouteId[] = [];
  const edges: TrailEdge[] = [];
  for (const [routeId, cell] of Object.entries(state.ownership)) {
    // Team game: highlight the side's combined trail — the one the bonus was actually awarded for.
    if ('owner' in cell && ownedBySide(state, routeId, playerId)) {
      const r = board.routeById.get(routeId);
      if (r) {
        routeOf.push(routeId as RouteId);
        edges.push({ u: r.a as string, v: r.b as string, w: r.length });
      }
    }
  }
  return longestTrailWithPath(edges).edges.map((i) => routeOf[i] as RouteId);
}

export function computeFinalScores(board: Board, state: GameState): FinalScoreboard {
  const { stationsPerPlayer, stationBonus, longestPathBonus } = state.ruleParams;

  const trailLengths = new Map<string, number>();
  const blessingCounts = state.turnOrder.map(
    (id) => state.events?.resources[id as string]?.blessings ?? 0,
  );
  const maxBlessings = Math.max(0, ...blessingCounts);
  const partials: Omit<PlayerFinal, 'longestBonus' | 'total' | 'longestTrailLength'>[] = [];

  for (const playerId of state.turnOrder) {
    const player = state.players[playerId as string];
    if (!player) continue;
    const edges = ownedEdges(board, state, playerId);
    const trailLen = longestTrail(edges);
    trailLengths.set(playerId as string, trailLen);

    const ticketDetail = evaluatePlayerTickets(board, state, playerId);

    const stationsUsed = stationsPerPlayer - player.stationsRemaining;
    const unusedStations = player.stationsRemaining;

    const blessings = state.events?.resources[playerId as string]?.blessings ?? 0;
    const eventBonus = maxBlessings > 0 && blessings === maxBlessings ? 4 : 0;
    partials.push({
      playerId,
      routePoints: player.routePoints,
      ticketNet: ticketDetail.net,
      ticketsCompleted: ticketDetail.completed,
      stationsUsed,
      unusedStations,
      stationBonus: unusedStations * stationBonus,
      ...(eventBonus > 0 ? { eventBonus } : {}),
    });
  }

  const maxTrail = Math.max(0, ...[...trailLengths.values()]);
  const teams = state.teams;

  const finals: PlayerFinal[] = partials.map((p) => {
    // In a team game `trailLengths` already holds the side's COMBINED trail (ownedEdges is
    // team-wide), so every member reports the same length — but the 10-point bonus is awarded
    // once, on the team row below, instead of once per member.
    const longestTrailLength = trailLengths.get(p.playerId as string) ?? 0;
    const longestBonus =
      teams === undefined && longestTrailLength === maxTrail && maxTrail > 0 ? longestPathBonus : 0;
    return {
      ...p,
      longestTrailLength,
      longestBonus,
      total: p.routePoints + p.ticketNet + p.stationBonus + longestBonus + (p.eventBonus ?? 0),
    };
  });

  if (teams === undefined) return { players: finals, ranking: rankPlayers(finals) };

  const teamFinals: TeamFinal[] = teams.map((members, team) => {
    const rows = members
      .map((id) => finals.find((f) => f.playerId === id))
      .filter((f): f is PlayerFinal => f !== undefined);
    const sum = (pick: (f: PlayerFinal) => number): number =>
      rows.reduce((acc, f) => acc + pick(f), 0);
    // Every member carries the same combined length; read the first rather than summing.
    const longestTrailLength = rows[0]?.longestTrailLength ?? 0;
    const longestBonus = longestTrailLength === maxTrail && maxTrail > 0 ? longestPathBonus : 0;
    const eventBonus = sum((f) => f.eventBonus ?? 0);
    const routePoints = sum((f) => f.routePoints);
    const ticketNet = sum((f) => f.ticketNet);
    const stationBonus = sum((f) => f.stationBonus);
    return {
      team,
      members: [...members],
      routePoints,
      ticketNet,
      ticketsCompleted: sum((f) => f.ticketsCompleted),
      stationBonus,
      longestTrailLength,
      longestBonus,
      ...(eventBonus > 0 ? { eventBonus } : {}),
      total: routePoints + ticketNet + stationBonus + longestBonus + eventBonus,
    };
  });

  return {
    players: finals,
    ranking: rankPlayers(finals),
    teams: teamFinals,
    teamRanking: rankTeams(teamFinals),
  };
}

/** Team tiebreaker, mirroring {@link rankPlayers}: total desc → tickets desc → holds longest. */
function rankTeams(finals: readonly TeamFinal[]): number[][] {
  const cmp = (a: TeamFinal, b: TeamFinal): number => {
    if (a.total !== b.total) return b.total - a.total;
    if (a.ticketsCompleted !== b.ticketsCompleted) return b.ticketsCompleted - a.ticketsCompleted;
    return (b.longestBonus > 0 ? 1 : 0) - (a.longestBonus > 0 ? 1 : 0);
  };
  const sorted = [...finals].sort(cmp);
  const groups: number[][] = [];
  for (const f of sorted) {
    const last = groups[groups.length - 1];
    const head = last ? finals.find((x) => x.team === last[0]) : undefined;
    if (last && head && cmp(head, f) === 0) last.push(f.team);
    else groups.push([f.team]);
  }
  return groups;
}

/** Strict tiebreaker: total desc → ticketsCompleted desc → stationsUsed asc → holds longest. */
function rankPlayers(finals: readonly PlayerFinal[]): PlayerId[][] {
  const cmp = (a: PlayerFinal, b: PlayerFinal): number => {
    if (a.total !== b.total) return b.total - a.total;
    if (a.ticketsCompleted !== b.ticketsCompleted) return b.ticketsCompleted - a.ticketsCompleted;
    if (a.stationsUsed !== b.stationsUsed) return a.stationsUsed - b.stationsUsed;
    const aLong = a.longestBonus > 0 ? 1 : 0;
    const bLong = b.longestBonus > 0 ? 1 : 0;
    return bLong - aLong;
  };
  const sorted = [...finals].sort(cmp);
  const groups: PlayerId[][] = [];
  for (const f of sorted) {
    const last = groups[groups.length - 1];
    if (last && cmp(byId(finals, last[0] as PlayerId), f) === 0) last.push(f.playerId);
    else groups.push([f.playerId]);
  }
  return groups;
}

function byId(finals: readonly PlayerFinal[], id: PlayerId): PlayerFinal {
  return finals.find((f) => f.playerId === id) as PlayerFinal;
}
