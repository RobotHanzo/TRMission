import { describe, it, expect } from 'vitest';
import { asPlayerId, type CityId, type PlayerId } from '@trm/shared';
import type { RouteDef, TicketDef } from '@trm/map-data';
import type { Board } from '../src/board';
import type { GameState, PlayerState } from '../src/types/state';
import { initGame } from '../src/setup';
import { cloneState } from '../src/serialize';
import { evaluateSideTickets, computeFinalScores, stationBorrowEdges } from '../src/scoring';
import { TEAM_SHARED_STATIONS_ENGINE_VERSION } from '../src/teams';
import { makeConfig } from './helpers';

const p0 = asPlayerId('p0');
const p1 = asPlayerId('p1');
const p2 = asPlayerId('p2');

const simpleRoutes = (board: Board): RouteDef[] =>
  board.content.routes.filter(
    (r) => !r.isTunnel && r.ferryLocos === 0 && r.doubleGroup === undefined,
  );

/** A ticket T with a 2-edge path T.a–m–T.b over two simple routes. */
function findBorrow(board: Board) {
  const simple = simpleRoutes(board);
  for (const t of board.content.tickets) {
    for (const own of simple) {
      const m = own.a === t.a ? own.b : own.b === t.a ? own.a : null;
      if (!m || m === t.b) continue;
      const leg = simple.find(
        (r) => r.id !== own.id && ((r.a === m && r.b === t.b) || (r.a === t.b && r.b === m)),
      );
      if (leg) return { t, own, leg, m };
    }
  }
  return null;
}

/**
 * Two tickets that both hinge on ONE junction city `m`, each needing a DIFFERENT borrowed leg out of
 * it: the side owns `m–ownA` and `m–ownB`, an opponent owns `m–legA` and `m–legB`, and the tickets
 * are (ownA, legA-end) and (ownB, legB-end). One station at `m` can serve only one of them, which is
 * what makes the side's single shared borrow budget observable.
 */
function findRivalBorrows(board: Board) {
  const simple = simpleRoutes(board);
  const legsInto = (m: CityId): RouteDef[] =>
    simple.filter((r) => r.a === m || r.b === m).map((r) => r);
  const other = (r: RouteDef, m: CityId): CityId => (r.a === m ? r.b : r.a);
  const cities = board.cityIds;

  for (const m of cities) {
    const legs = legsInto(m);
    if (legs.length < 4) continue;
    // Candidate (ownRoute, ticket, borrowRoute) triples through this junction.
    const options: { own: RouteDef; leg: RouteDef; ticket: TicketDef }[] = [];
    for (const own of legs) {
      const near = other(own, m);
      for (const leg of legs) {
        if (leg.id === own.id) continue;
        const far = other(leg, m);
        const ticket = board.content.tickets.find(
          (t) => (t.a === near && t.b === far) || (t.a === far && t.b === near),
        );
        if (ticket) options.push({ own, leg, ticket });
      }
    }
    // Two of them must be fully disjoint in routes and tickets, and differ in value so the joint
    // optimum is forced to pick a side.
    for (const x of options) {
      for (const y of options) {
        if (x.ticket.id === y.ticket.id) continue;
        if (x.ticket.value === y.ticket.value) continue;
        const ids = new Set([x.own.id, x.leg.id, y.own.id, y.leg.id]);
        if (ids.size !== 4) continue;
        return {
          m,
          lo: x.ticket.value < y.ticket.value ? x : y,
          hi: x.ticket.value < y.ticket.value ? y : x,
        };
      }
    }
  }
  return null;
}

/** AWAIT_ACTION state with the given per-player overrides, ownership, and stations. */
function stateWith(
  board: Board,
  teamCount: number | undefined,
  overrides: Partial<Record<string, Partial<PlayerState>>>,
  ownership: GameState['ownership'],
  stations: GameState['stations'],
  engineVersion?: number,
): GameState {
  const { config } = makeConfig(4, 'team-stations', undefined, teamCount);
  const s0 = cloneState(initGame(board, config));
  const players: Record<string, PlayerState> = {};
  for (const [id, p] of Object.entries(s0.players)) {
    players[id] = { ...p, keptTickets: [], pendingTicketOffer: null, ...(overrides[id] ?? {}) };
  }
  return {
    ...s0,
    players,
    ownership,
    stations,
    ...(engineVersion !== undefined ? { engineVersion } : {}),
    turn: { orderIndex: 0, phase: 'AWAIT_ACTION', cardsDrawnThisTurn: 0 },
  };
}

describe("team mode — a side's stations are shared", () => {
  /**
   * p0 owns T.a–m and keeps T; the opponent p1 owns m–T.b. The only station is p0's PARTNER's,
   * at m. Shared stations ⇒ p0's ticket scores; private ones ⇒ it does not.
   */
  function partnerStationScenario(teamCount: number | undefined, engineVersion?: number) {
    const board = makeConfig(4, 'team-stations', undefined, teamCount).board;
    const found = findBorrow(board);
    expect(found).not.toBeNull();
    const { t, own, leg, m } = found!;
    const state = stateWith(
      board,
      teamCount,
      { p0: { keptTickets: [t.id] } },
      { [own.id as string]: { owner: p0 }, [leg.id as string]: { owner: p1 } },
      [{ playerId: p2, cityId: m }],
      engineVersion,
    );
    const rows = evaluateSideTickets(board, state, p0);
    return { board, state, ticket: t, row: rows.get(p0 as string)! };
  }

  it("completes a ticket through a PARTNER's station", () => {
    const { ticket, row } = partnerStationScenario(2);
    expect(row.completedTicketIds).toContain(ticket.id);
    expect(row.net).toBe(ticket.value);
  });

  it('does not borrow through a non-partner station in a free-for-all', () => {
    const { ticket, row } = partnerStationScenario(undefined);
    expect(row.completedTicketIds).toEqual([]);
    expect(row.net).toBe(-ticket.value);
  });

  it('keeps stations private to their builder for a persisted v14 team log', () => {
    const { ticket, row } = partnerStationScenario(2, TEAM_SHARED_STATIONS_ENGINE_VERSION - 1);
    expect(row.completedTicketIds).toEqual([]);
    expect(row.net).toBe(-ticket.value);
  });

  it("adds a partner's station city to the borrow edges", () => {
    const board = makeConfig(4, 'team-stations', undefined, 2).board;
    const found = findBorrow(board);
    expect(found).not.toBeNull();
    const { leg, m } = found!;
    const state = stateWith(board, 2, {}, { [leg.id as string]: { owner: p1 } }, [
      { playerId: p2, cityId: m },
    ]);
    expect(stationBorrowEdges(board, state, p0)).toContainEqual({
      a: leg.a as string,
      b: leg.b as string,
    });
    // The same station is invisible to the other team.
    expect(stationBorrowEdges(board, state, p1)).toEqual([]);
  });

  /**
   * The shared station is a shared BUDGET, not a borrow each: one station still borrows exactly one
   * route, and the side spends it on whichever member's ticket is worth more.
   */
  it("spends one shared station on the side's most valuable ticket, not one borrow per member", () => {
    const board = makeConfig(4, 'team-stations', undefined, 2).board;
    const found = findRivalBorrows(board);
    expect(found).not.toBeNull();
    const { m, lo, hi } = found!;
    // p0 keeps the CHEAP ticket and owns the only station; p2 (partner) keeps the dear one.
    const state = stateWith(
      board,
      2,
      { p0: { keptTickets: [lo.ticket.id] }, p2: { keptTickets: [hi.ticket.id] } },
      {
        [lo.own.id as string]: { owner: p0 },
        [hi.own.id as string]: { owner: p2 },
        [lo.leg.id as string]: { owner: p1 },
        [hi.leg.id as string]: { owner: p1 },
      },
      [{ playerId: p0, cityId: m }],
    );

    const rows = evaluateSideTickets(board, state, p0);
    const completed = [...rows.values()].flatMap((r) => r.completedTicketIds as string[]);
    expect(completed).toEqual([hi.ticket.id as string]);
    // The station-owner's own ticket is the one sacrificed — the side's total is what is maximised.
    expect(rows.get(p0 as string)?.net).toBe(-lo.ticket.value);
    expect(rows.get(p2 as string)?.net).toBe(hi.ticket.value);

    // Private stations (pre-v15) would instead spend p0's station on p0's own cheap ticket.
    const legacy = evaluateSideTickets(
      board,
      { ...state, engineVersion: TEAM_SHARED_STATIONS_ENGINE_VERSION - 1 },
      p0,
    );
    expect(legacy.get(p0 as string)?.completedTicketIds).toEqual([lo.ticket.id]);
  });

  it('rolls the shared-station ticket rows into the team scoreboard exactly once', () => {
    const board = makeConfig(4, 'team-stations', undefined, 2).board;
    const found = findRivalBorrows(board);
    expect(found).not.toBeNull();
    const { m, lo, hi } = found!;
    const state = stateWith(
      board,
      2,
      { p0: { keptTickets: [lo.ticket.id] }, p2: { keptTickets: [hi.ticket.id] } },
      {
        [lo.own.id as string]: { owner: p0 },
        [hi.own.id as string]: { owner: p2 },
        [lo.leg.id as string]: { owner: p1 },
        [hi.leg.id as string]: { owner: p1 },
      },
      [{ playerId: p0, cityId: m }],
    );
    const finals = computeFinalScores(board, state);
    const rowOf = (id: PlayerId) => finals.players.find((f) => f.playerId === id);
    const team0 = finals.teams?.find((t) => t.team === 0);
    expect(team0?.ticketNet).toBe(hi.ticket.value - lo.ticket.value);
    expect(team0?.ticketNet).toBe((rowOf(p0)?.ticketNet ?? 0) + (rowOf(p2)?.ticketNet ?? 0));
    expect(team0?.ticketsCompleted).toBe(1);
  });
});
