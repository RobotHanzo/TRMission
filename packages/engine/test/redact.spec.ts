import { describe, it, expect } from 'vitest';
import { asPlayerId, asCityId, asRouteId } from '@trm/shared';
import type { PlayerId } from '@trm/shared';
import { makeConfig, playGreedyGame, taiwanBoard } from './helpers';
import { initGame } from '../src/setup';
import { reduce } from '../src/reduce';
import { redactFor } from '../src/selectors';
import type { GameState } from '../src/types/state';
import type { OwnerCell } from '../src/types/state';
import type { EventsState, EventScheduleEntry } from '../src/types/events-state';

/** Resolve every player's initial ticket offer (keep the minimum) → AWAIT_ACTION. */
function afterSetup(numPlayers: number, seed: string): GameState {
  const { board, config } = makeConfig(numPlayers, seed);
  let state = initGame(board, config);
  while (state.turn.phase === 'SETUP_TICKETS') {
    const pid = state.turnOrder.find((id) => state.players[id as string]?.pendingTicketOffer);
    const offer = state.players[pid as string]!.pendingTicketOffer!;
    const res = reduce(board, state, {
      t: 'KEEP_INITIAL_TICKETS',
      player: pid!,
      keep: offer.slice(0, state.ruleParams.minKeepInitial),
    });
    if (!res.ok) throw new Error('setup keep failed');
    state = res.value.state;
  }
  return state;
}

describe('redactFor — hidden information', () => {
  it('never exposes opponents’ hands or kept tickets mid-game', () => {
    const board = taiwanBoard();
    const state = afterSetup(3, 'redact');
    const viewer = asPlayerId('p0');
    const view = redactFor(board, state, viewer);

    const self = view.players.find((p) => p.id === viewer)!;
    expect(self.hand).not.toBeNull();
    expect(self.keptTickets).not.toBeNull();

    for (const opp of view.players.filter((p) => p.id !== viewer)) {
      expect(opp_hand(opp)).toBeNull();
      expect(opp.keptTickets).toBeNull();
      expect(opp.pendingTicketOffer).toBeNull();
      // Counts ARE public.
      expect(opp.handCount).toBeGreaterThan(0);
      expect(opp.ticketCount).toBeGreaterThanOrEqual(2);
    }

    // The ONLY ticket ids structurally present in the per-player view are the viewer's own.
    const ownTickets = new Set(
      state.players[viewer as string]!.keptTickets.map((t) => t as string),
    );
    const visibleTicketIds = new Set<string>();
    for (const p of view.players) {
      for (const t of p.keptTickets ?? []) visibleTicketIds.add(t as string);
      for (const t of p.pendingTicketOffer ?? []) visibleTicketIds.add(t as string);
    }
    for (const id of visibleTicketIds) expect(ownTickets.has(id)).toBe(true);
  });

  it('reveals no completed tickets before any routes are claimed', () => {
    const board = taiwanBoard();
    const state = afterSetup(2, 'complete-none');
    // Nobody has claimed a route yet → nothing is own-track connected.
    expect(redactFor(board, state, asPlayerId('p1')).completedTickets).toEqual([]);
  });

  it('reveals a player’s own-track completed tickets to EVERY viewer (in-progress stay secret)', () => {
    const board = taiwanBoard();
    const state = afterSetup(2, 'complete-all');
    const p0 = asPlayerId('p0');
    // Give p0 every route on the map → all of p0's kept tickets become own-track connected.
    const ownership: Record<string, OwnerCell> = {};
    for (const routeId of board.routeById.keys()) ownership[routeId] = { owner: p0 };
    const owned: GameState = { ...state, ownership };

    const p0Tickets = new Set(state.players[p0 as string]!.keptTickets.map((t) => t as string));
    expect(p0Tickets.size).toBeGreaterThan(0);

    // From an OPPONENT's view, p0's finished tickets are still revealed (public by design).
    const oppView = redactFor(board, owned, asPlayerId('p1'));
    const completedForP0 = new Set(
      oppView.completedTickets
        .filter((c) => (c.player as string) === 'p0')
        .map((c) => c.ticket as string),
    );
    expect(completedForP0).toEqual(p0Tickets);
    // p1 owns nothing → none of p1's tickets are completed.
    expect(oppView.completedTickets.filter((c) => (c.player as string) === 'p1')).toEqual([]);

    // The reveal is viewer-independent: p0's own view lists the same completions.
    const selfView = redactFor(board, owned, p0);
    expect(new Set(selfView.completedTickets.map((c) => c.ticket as string))).toEqual(p0Tickets);
  });

  it('reveals all kept tickets at GAME_OVER', () => {
    const board = taiwanBoard();
    const { finalState } = playGreedyGame(3, 'redact-end');
    expect(finalState.turn.phase).toBe('GAME_OVER');
    const view = redactFor(board, finalState, asPlayerId('p1'));
    for (const p of view.players) {
      expect(p.keptTickets).not.toBeNull();
    }
    expect(view.finalScores).not.toBeNull();
  });

  it('enriches the GAME_OVER scoreboard so the breakdown reconciles with each total', () => {
    const board = taiwanBoard();
    const { finalState } = playGreedyGame(3, 'redact-breakdown');
    const view = redactFor(board, finalState, asPlayerId('p0'));
    const final = view.finalScores!;
    expect(final).not.toBeNull();

    for (const pf of final.players) {
      const kept = new Set(
        (view.players.find((p) => p.id === pf.playerId)!.keptTickets ?? []).map((t) => t as string),
      );
      const completed = pf.completedTicketIds.map((t) => t as string);

      // Completed ⊆ kept, count matches, and gains − losses == the net used in the total.
      for (const id of completed) expect(kept.has(id)).toBe(true);
      expect(completed.length).toBe(pf.ticketsCompleted);
      const completedSet = new Set(completed);
      let gain = 0;
      let loss = 0;
      for (const id of kept) {
        const value = board.ticketById.get(id)!.value;
        if (completedSet.has(id)) gain += value;
        else loss += value;
      }
      expect(gain - loss).toBe(pf.ticketNet);

      // The longest-trail route ids are owned by this player and weigh exactly the bonus length.
      let trailLen = 0;
      for (const rid of pf.longestTrailRouteIds) {
        const cell = finalState.ownership[rid as string];
        expect(cell && 'owner' in cell && cell.owner === pf.playerId).toBe(true);
        trailLen += board.routeById.get(rid as string)!.length;
      }
      expect(trailLen).toBe(pf.longestTrailLength);
    }
  });

  it('a spectator (null viewer) sees no hands and no tickets pre-endgame', () => {
    const board = taiwanBoard();
    const state = afterSetup(2, 'spectator');
    const view = redactFor(board, state, null);
    for (const p of view.players) {
      expect(opp_hand(p)).toBeNull();
      expect(p.keptTickets).toBeNull();
    }
  });
});

// Helper to read the (possibly null) hand without tripping the no-non-null-assertion lint.
function opp_hand(p: { hand: unknown }): unknown {
  return p.hand;
}

describe('redactFor — random events projection', () => {
  // Distinctive ids that must NEVER appear in any projection while the entry is still in the future.
  const SECRET = {
    id: 'evSecretFuture',
    route: asRouteId('SECRET_ROUTE_X'),
    city: asCityId('SECRET_CITY_C'),
    charterA: asCityId('SECRET_CITY_A'),
    charterB: asCityId('SECRET_CITY_B'),
    pathCity: asCityId('SECRET_PATH_CITY'),
    pairA: asCityId('SECRET_PAIR_A'),
    pairB: asCityId('SECRET_PAIR_B'),
    markerSelector: 54321,
  };

  function baseState(seed: string): {
    state: GameState;
    live: { closed: string; hot: string; a: string; b: string };
  } {
    const board = taiwanBoard();
    const state = afterSetup(2, seed);
    const closed = board.content.routes[0]!.id as string; // unclaimed after setup
    const hot = board.cityIds[0] as string;
    const a = board.cityIds[1] as string;
    const b = board.cityIds[2] as string;
    return { state, live: { closed, hot, a, b } };
  }

  it('never leaks a future unannounced entry (id, routeIds, cityId, charter cities) to any seat', () => {
    const board = taiwanBoard();
    const { state, live } = baseState('redact-events-future');
    // Future surprise entry: far off, not telegraphed → nothing about it may be projected. It carries
    // every hidden field (routeIds, cityId, charter, cityPath, pair, markerSelector) so the leak
    // test is exhaustive across the expansion's new target shapes too.
    const future: EventScheduleEntry = {
      id: SECRET.id,
      kind: 'CHARTER_SPECIAL',
      startRound: 5,
      durationRounds: 3,
      telegraphed: false,
      routeIds: [SECRET.route],
      cityId: SECRET.city,
      charter: { a: SECRET.charterA, b: SECRET.charterB, points: 20 },
      cityPath: [SECRET.pathCity, SECRET.charterA, SECRET.charterB],
      pair: { a: SECRET.pairA, b: SECRET.pairB },
      markerSelector: SECRET.markerSelector,
    };
    const events: EventsState = {
      mode: 'light',
      roundIndex: 1,
      nextIdx: 0,
      schedule: [future],
      suppressed: [],
      active: [
        {
          id: 'evTy',
          kind: 'TYPHOON_LANDFALL',
          endsAfterRound: 99,
          routeIds: [asRouteId(live.closed)],
        },
      ],
      hotspots: { [live.hot]: 2 },
      charters: [
        {
          id: 'evCh',
          a: asCityId(live.a),
          b: asCityId(live.b),
          points: 8,
          expiresAfterRound: 99,
          wonBy: null,
        },
      ],
      luckyContracts: [],
      reopenBonus: [],
      repairedRouteIds: [],
      resources: {},
    };
    const withEv: GameState = { ...state, events };

    for (const viewer of [asPlayerId('p0'), asPlayerId('p1'), null] as (PlayerId | null)[]) {
      const view = redactFor(board, withEv, viewer);
      const json = JSON.stringify(view);
      for (const secret of [
        SECRET.id,
        SECRET.route as string,
        SECRET.city as string,
        SECRET.charterA as string,
        SECRET.charterB as string,
        SECRET.pathCity as string,
        SECRET.pairA as string,
        SECRET.pairB as string,
        String(SECRET.markerSelector),
      ]) {
        expect(json.includes(secret)).toBe(false);
      }
      expect(view.events).toBeDefined();
      expect(view.events!.forecast).toBeNull(); // unannounced future ⇒ no forecast
      // Live effects DO surface once active.
      expect(view.events!.hotspots.some((h) => (h.cityId as string) === live.hot)).toBe(true);
      expect(view.events!.charters.some((c) => c.id === 'evCh')).toBe(true);
      expect(view.events!.closedRouteIds.map((r) => r as string)).toContain(live.closed);
    }
  });

  it('projects the forecast exactly when the next entry is telegraphed and starts next round', () => {
    const board = taiwanBoard();
    const { state } = baseState('redact-events-forecast');
    const telegraphed: EventScheduleEntry = {
      id: 'evNext',
      kind: 'TYPHOON_DAY_OFF',
      startRound: 2,
      durationRounds: 1,
      telegraphed: true,
    };
    const events: EventsState = {
      mode: 'light',
      roundIndex: 1, // startRound 2 === roundIndex + 1 → announced window
      nextIdx: 0,
      schedule: [telegraphed],
      suppressed: [],
      active: [],
      hotspots: {},
      charters: [],
      luckyContracts: [],
      reopenBonus: [],
      repairedRouteIds: [],
      resources: {},
    };
    const view = redactFor(board, { ...state, events }, asPlayerId('p0'));
    expect(view.events!.forecast).not.toBeNull();
    expect(view.events!.forecast!.id).toBe('evNext');
    // A spectator sees the identical block.
    expect(redactFor(board, { ...state, events }, null).events).toEqual(view.events);
  });
});
