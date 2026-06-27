import type { PlayerId } from '@trm/shared';
import type { Board } from './board';
import type { GameState, FinalScoreboard, PlayerFinal } from './types/state';
import { longestTrail } from './graph/longestTrail';
import type { TrailEdge } from './graph/longestTrail';
import { evaluateTickets } from './graph/connectivity';
import type { Edge } from './graph/connectivity';

/** Routes a player owns, as graph edges (with length weight for the longest-trail bonus). */
function ownedEdges(board: Board, state: GameState, player: PlayerId): TrailEdge[] {
  const out: TrailEdge[] = [];
  for (const [routeId, cell] of Object.entries(state.ownership)) {
    if ('owner' in cell && cell.owner === player) {
      const r = board.routeById.get(routeId);
      if (r) out.push({ u: r.a as string, v: r.b as string, w: r.length });
    }
  }
  return out;
}

/** Opponent (non-locked) routes incident to a city → borrowable edges for station scoring. */
function borrowCandidatesForCity(
  board: Board,
  state: GameState,
  city: string,
  owner: PlayerId,
): Edge[] {
  const out: Edge[] = [];
  for (const routeId of board.incident.get(city) ?? []) {
    const cell = state.ownership[routeId as string];
    if (cell && 'owner' in cell && cell.owner !== owner) {
      const r = board.routeById.get(routeId as string);
      if (r) out.push({ a: r.a as string, b: r.b as string });
    }
  }
  return out;
}

export function computeFinalScores(board: Board, state: GameState): FinalScoreboard {
  const { stationsPerPlayer, stationBonus, longestPathBonus } = state.ruleParams;
  const cityIds = board.cityIds.map((c) => c as string);

  const trailLengths = new Map<string, number>();
  const partials: Omit<PlayerFinal, 'longestBonus' | 'total' | 'longestTrailLength'>[] = [];

  for (const playerId of state.turnOrder) {
    const player = state.players[playerId as string];
    if (!player) continue;
    const edges = ownedEdges(board, state, playerId);
    const trailLen = longestTrail(edges);
    trailLengths.set(playerId as string, trailLen);

    const stationCities = state.stations
      .filter((s) => s.playerId === playerId)
      .map((s) => s.cityId as string);
    const borrowCandidates = new Map<string, Edge[]>();
    for (const city of stationCities) {
      borrowCandidates.set(city, borrowCandidatesForCity(board, state, city, playerId));
    }
    const tickets = player.keptTickets
      .map((id) => board.ticketById.get(id as string))
      .filter((t): t is NonNullable<typeof t> => t !== undefined)
      .map((t) => ({ a: t.a as string, b: t.b as string, value: t.value }));

    const ticketEval = evaluateTickets({
      ownEdges: edges.map((e) => ({ a: e.u, b: e.v })),
      stationCities,
      borrowCandidates,
      tickets,
      vertices: cityIds,
    });

    const stationsUsed = stationsPerPlayer - player.stationsRemaining;
    const unusedStations = player.stationsRemaining;

    partials.push({
      playerId,
      routePoints: player.routePoints,
      ticketNet: ticketEval.net,
      ticketsCompleted: ticketEval.completed,
      stationsUsed,
      unusedStations,
      stationBonus: unusedStations * stationBonus,
    });
  }

  const maxTrail = Math.max(0, ...[...trailLengths.values()]);
  const finals: PlayerFinal[] = partials.map((p) => {
    const longestTrailLength = trailLengths.get(p.playerId as string) ?? 0;
    const longestBonus = longestTrailLength === maxTrail && maxTrail > 0 ? longestPathBonus : 0;
    return {
      ...p,
      longestTrailLength,
      longestBonus,
      total: p.routePoints + p.ticketNet + p.stationBonus + longestBonus,
    };
  });

  return { players: finals, ranking: rankPlayers(finals) };
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
