import { describe, it, expect } from 'vitest';
import { asPlayerId } from '@trm/shared';
import type { CityId } from '@trm/shared';
import type { RouteDef } from '@trm/map-data';
import type { Board } from '../src/board';
import type { GameState, OwnerCell } from '../src/types/state';
import type { GameEvent } from '../src/types/events';
import type { CharterContract, EventScheduleEntry } from '../src/types/events-state';
import { reduce } from '../src/reduce';
import { endTurn } from '../src/turn';
import { siblingOf } from '../src/board';
import { afterSetup, withEvents, emptyEvents, setPlayer, handOf } from './events-helpers';

const p0 = asPlayerId('p0');
const p1 = asPlayerId('p1');

const simpleRoutes = (board: Board): RouteDef[] =>
  board.content.routes.filter((r) => !r.isTunnel && r.ferryLocos === 0 && r.doubleGroup === undefined);

/** Two simple routes r1=(A,M), r2=(M,C) sharing city M with distinct outer endpoints A,C. */
function findChain(board: Board): { r1: RouteDef; r2: RouteDef; A: string; M: string; C: string } {
  const s = simpleRoutes(board);
  for (const r1 of s)
    for (const r2 of s) {
      if (r1.id === r2.id) continue;
      const shared = [r1.a, r1.b].find((c) => c === r2.a || c === r2.b);
      if (!shared) continue;
      const A = (r1.a === shared ? r1.b : r1.a) as string;
      const C = (r2.a === shared ? r2.b : r2.a) as string;
      if (A !== C) return { r1, r2, A, M: shared as string, C };
    }
  throw new Error('no chain');
}

/** A triangle of simple routes: rab=(A,B), rbc=(B,C), rac=(A,C). */
function findTriangle(
  board: Board,
): { A: string; B: string; C: string; rab: RouteDef; rbc: RouteDef; rac: RouteDef } {
  const s = simpleRoutes(board);
  const connects = (r: RouteDef, x: string, y: string) =>
    (r.a === x && r.b === y) || (r.a === y && r.b === x);
  for (const rab of s) {
    const A = rab.a as string;
    const B = rab.b as string;
    for (const rbc of s) {
      if (rbc.id === rab.id) continue;
      let C: string | null = null;
      if (rbc.a === B) C = rbc.b as string;
      else if (rbc.b === B) C = rbc.a as string;
      else continue;
      if (C === A) continue;
      const rac = s.find((r) => r.id !== rab.id && r.id !== rbc.id && connects(r, A, C));
      if (rac) return { A, B, C, rab, rbc, rac };
    }
  }
  throw new Error('no triangle');
}

function wellStocked(state: GameState, player = p0): GameState {
  return setPlayer(state, player, {
    hand: handOf({
      RED: 12,
      ORANGE: 12,
      YELLOW: 12,
      GREEN: 12,
      BLUE: 12,
      PURPLE: 12,
      WHITE: 12,
      BLACK: 12,
      LOCOMOTIVE: 12,
    }),
    trainCars: 45,
  });
}

function payFor(route: RouteDef) {
  const color = route.color === 'GRAY' ? 'RED' : route.color;
  return { color, colorCount: route.length - route.ferryLocos, locomotives: route.ferryLocos };
}

const charterBonuses = (events: readonly GameEvent[]) =>
  events.filter(
    (e): e is Extract<GameEvent, { e: 'EVENT_BONUS' }> =>
      e.e === 'EVENT_BONUS' && e.kind === 'CHARTER_SPECIAL',
  );

describe('events — charter special award', () => {
  it('awards on the connecting claim (points + wonBy + EVENT_BONUS)', () => {
    const base = afterSetup(2, 'charter-claim');
    const route = simpleRoutes(base.board)[0]!;
    const charter: CharterContract = {
      id: 'c1',
      a: route.a,
      b: route.b,
      points: 15,
      expiresAfterRound: 99,
      wonBy: null,
    };
    const state = wellStocked(withEvents(base.state, { ...emptyEvents(), charters: [charter] }));
    const before = state.players['p0']!.routePoints;
    const res = reduce(base.board, state, {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: route.id,
      payment: payFor(route),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const bs = charterBonuses(res.value.events);
    expect(bs).toHaveLength(1);
    expect(bs[0]).toMatchObject({ reason: 'CHARTER', player: p0, points: 15 });
    expect(res.value.state.events!.charters[0]!.wonBy).toBe(p0);
    const basePoints = state.ruleParams.routePoints[route.length] ?? 0;
    expect(res.value.state.players['p0']!.routePoints).toBe(before + basePoints + 15);
  });

  it('awards at open to the earlier-seat player when multiple are already connected', () => {
    const base = afterSetup(2, 'charter-open-tiebreak');
    const dbl = base.board.content.routes.find((r) => r.doubleGroup !== undefined);
    if (!dbl) throw new Error('no double route');
    const sib = siblingOf(base.board, dbl.id);
    if (!sib) throw new Error('no sibling');
    // p0 owns one sibling, p1 the other — BOTH own-connect the same city pair (A,B).
    const ownership: Record<string, OwnerCell> = {
      [dbl.id as string]: { owner: p0 },
      [sib as string]: { owner: p1 },
    };
    const sched: EventScheduleEntry[] = [
      {
        id: 'c1',
        kind: 'CHARTER_SPECIAL',
        startRound: 2,
        durationRounds: 3,
        telegraphed: false,
        charter: { a: dbl.a, b: dbl.b, points: 12 },
      },
    ];
    let s: GameState = withEvents(
      { ...base.state, ownership },
      { ...emptyEvents(), schedule: sched },
    );
    const p0Before = s.players['p0']!.routePoints;
    let batch: GameEvent[] = [];
    for (let i = 0; i < 2; i++) {
      const out = endTurn(base.board, s, { wasPass: false });
      batch = out.events;
      s = out.state;
    }
    const bs = charterBonuses(batch);
    expect(bs).toHaveLength(1);
    expect(bs[0]!.player).toBe(p0); // earlier seat wins the tie
    const won = s.events!.charters.find((c) => c.id === 'c1');
    expect(won?.wonBy).toBe(p0);
    expect(s.players['p0']!.routePoints).toBe(p0Before + 12);
    // Ordering: the charter's EVENT_BONUS follows its EVENT_STARTED.
    const ks = batch.map((e) => e.e);
    expect(ks.indexOf('EVENT_STARTED')).toBeLessThan(ks.indexOf('EVENT_BONUS'));
  });

  it('does NOT count station-borrowed connectivity (own edges only)', () => {
    const base = afterSetup(2, 'charter-no-borrow');
    const { r1, r2, A, M, C } = findChain(base.board);
    // p0 owns A–M only; p1 owns M–C; p0 has a station at M (would borrow M–C). Charter (A,C) must
    // NOT be awarded, because own-network connectivity ignores station borrowing.
    const ownership: Record<string, OwnerCell> = {
      [r1.id as string]: { owner: p0 },
      [r2.id as string]: { owner: p1 },
    };
    const sched: EventScheduleEntry[] = [
      {
        id: 'c1',
        kind: 'CHARTER_SPECIAL',
        startRound: 2,
        durationRounds: 3,
        telegraphed: false,
        charter: { a: A as CityId, b: C as CityId, points: 10 },
      },
    ];
    let s: GameState = withEvents(
      { ...base.state, ownership, stations: [{ playerId: p0, cityId: M as CityId }] },
      { ...emptyEvents(), schedule: sched },
    );
    let batch: GameEvent[] = [];
    for (let i = 0; i < 2; i++) {
      const out = endTurn(base.board, s, { wasPass: false });
      batch = out.events;
      s = out.state;
    }
    expect(charterBonuses(batch)).toHaveLength(0);
    expect(s.events!.charters.find((c) => c.id === 'c1')?.wonBy).toBe(null);
  });

  it('drops an un-won contract at expiry but keeps a won one', () => {
    const base = afterSetup(2, 'charter-expiry');
    const cities = base.board.cityIds;
    const won: CharterContract = {
      id: 'won',
      a: cities[0]!,
      b: cities[1]!,
      points: 5,
      expiresAfterRound: 1,
      wonBy: p0,
    };
    const lost: CharterContract = {
      id: 'lost',
      a: cities[2]!,
      b: cities[3]!,
      points: 5,
      expiresAfterRound: 1,
      wonBy: null,
    };
    let s: GameState = withEvents(base.state, {
      ...emptyEvents(),
      roundIndex: 1,
      charters: [won, lost],
    });
    for (let i = 0; i < 2; i++) s = endTurn(base.board, s, { wasPass: false }).state; // → round 2
    expect(s.events!.roundIndex).toBe(2);
    expect(s.events!.charters.map((c) => c.id)).toEqual(['won']);
  });

  it('wins two open charters with a single claim, in charters-array order', () => {
    const base = afterSetup(2, 'charter-double-win');
    const { A, B, C, rab, rbc } = findTriangle(base.board);
    // p0 owns A–B; claiming B–C connects both A↔C (via B) and B↔C directly.
    const c1: CharterContract = { id: 'c1', a: A as CityId, b: C as CityId, points: 8, expiresAfterRound: 99, wonBy: null };
    const c2: CharterContract = { id: 'c2', a: B as CityId, b: C as CityId, points: 4, expiresAfterRound: 99, wonBy: null };
    const state = wellStocked(
      withEvents(
        { ...base.state, ownership: { [rab.id as string]: { owner: p0 } } },
        { ...emptyEvents(), charters: [c1, c2] },
      ),
    );
    const before = state.players['p0']!.routePoints;
    const res = reduce(base.board, state, {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: rbc.id,
      payment: payFor(rbc),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const bs = charterBonuses(res.value.events);
    expect(bs.map((e) => e.points)).toEqual([8, 4]); // array order c1, c2
    expect(res.value.state.events!.charters.map((c) => c.wonBy)).toEqual([p0, p0]);
    const basePoints = state.ruleParams.routePoints[rbc.length] ?? 0;
    expect(res.value.state.players['p0']!.routePoints).toBe(before + basePoints + 8 + 4);
  });

  it('never re-awards a charter that is already won', () => {
    const base = afterSetup(2, 'charter-no-reaward');
    const route = simpleRoutes(base.board)[0]!;
    const charter: CharterContract = {
      id: 'c1',
      a: route.a,
      b: route.b,
      points: 9,
      expiresAfterRound: 99,
      wonBy: p0, // already won
    };
    const state = wellStocked(withEvents(base.state, { ...emptyEvents(), charters: [charter] }));
    const before = state.players['p0']!.routePoints;
    const res = reduce(base.board, state, {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: route.id,
      payment: payFor(route),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(charterBonuses(res.value.events)).toHaveLength(0);
    expect(res.value.state.events!.charters[0]!.wonBy).toBe(p0);
    const basePoints = state.ruleParams.routePoints[route.length] ?? 0;
    expect(res.value.state.players['p0']!.routePoints).toBe(before + basePoints); // no re-award
  });
});
