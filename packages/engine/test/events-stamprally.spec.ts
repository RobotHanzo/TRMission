import { describe, it, expect } from 'vitest';
import { asPlayerId } from '@trm/shared';
import type { RouteDef } from '@trm/map-data';
import type { Board } from '../src/board';
import type { GameState, OwnerCell } from '../src/types/state';
import type { GameEvent } from '../src/types/events';
import { reduce } from '../src/reduce';
import { afterSetup, withEvents, emptyEvents, activeEvent, setPlayer, drainPools, handOf } from './events-helpers';

const p0 = asPlayerId('p0');

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
function findTriangle(board: Board): { rab: RouteDef; rbc: RouteDef; rac: RouteDef } {
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
      if (rac) return { rab, rbc, rac };
    }
  }
  throw new Error('no triangle');
}

function wellStocked(state: GameState): GameState {
  return setPlayer(state, p0, {
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

const stampBonuses = (events: readonly GameEvent[]) =>
  events.filter(
    (e): e is Extract<GameEvent, { e: 'EVENT_BONUS' }> =>
      e.e === 'EVENT_BONUS' && e.kind === 'STAMP_RALLY',
  );

const stampActive = () => ({ ...emptyEvents(), active: [activeEvent('STAMP_RALLY')] });

describe('events — stamp rally new-city bonus', () => {
  it('awards +1 per NEW endpoint city: a first route gives +2 (two sorted events)', () => {
    const base = afterSetup(2, 'stamp-first');
    const route = simpleRoutes(base.board)[0]!;
    const state = wellStocked(withEvents(base.state, stampActive()));
    const before = state.players['p0']!.routePoints;
    const res = reduce(base.board, state, {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: route.id,
      payment: payFor(route),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const bs = stampBonuses(res.value.events);
    expect(bs).toHaveLength(2);
    const sorted = [route.a as string, route.b as string].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
    expect(bs.map((e) => e.cityId as string)).toEqual(sorted);
    for (const e of bs) expect(e.points).toBe(1);
    const basePoints = state.ruleParams.routePoints[route.length] ?? 0;
    expect(res.value.state.players['p0']!.routePoints).toBe(before + basePoints + 2);
  });

  it('awards +1 when extending the network from an existing endpoint', () => {
    const base = afterSetup(2, 'stamp-extend');
    const { r1, r2, C } = findChain(base.board);
    // p0 already owns r1 (A–M); claiming r2 (M–C) adds only the new city C.
    const state = wellStocked(
      withEvents({ ...base.state, ownership: { [r1.id as string]: { owner: p0 } } }, stampActive()),
    );
    const res = reduce(base.board, state, {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: r2.id,
      payment: payFor(r2),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const bs = stampBonuses(res.value.events);
    expect(bs).toHaveLength(1);
    expect(bs[0]).toMatchObject({ points: 1, cityId: C });
  });

  it('awards nothing when the claimed route adds no new city (parallel-sibling case)', () => {
    const base = afterSetup(2, 'stamp-nonew');
    const { rab, rbc, rac } = findTriangle(base.board);
    // p0 owns A–B and B–C (network {A,B,C}); claiming A–C adds no new city — the same reason a
    // parallel double-route sibling (identical endpoints) earns nothing.
    const ownership: Record<string, OwnerCell> = {
      [rab.id as string]: { owner: p0 },
      [rbc.id as string]: { owner: p0 },
    };
    const state = wellStocked(withEvents({ ...base.state, ownership }, stampActive()));
    const res = reduce(base.board, state, {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: rac.id,
      payment: payFor(rac),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(stampBonuses(res.value.events)).toHaveLength(0);
  });

  it('counts new cities on a tunnel commit', () => {
    const base = afterSetup(2, 'stamp-tunnel');
    const tunnel = base.board.content.routes.find((r) => r.isTunnel);
    if (!tunnel) throw new Error('no tunnel');
    // Drain the draw pool so the tunnel reveals nothing (extraRequired 0 → trivial commit).
    const state = wellStocked(drainPools(withEvents(base.state, stampActive())));
    const begin = reduce(base.board, state, {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: tunnel.id,
      payment: payFor(tunnel),
    });
    expect(begin.ok).toBe(true);
    if (!begin.ok) return;
    const commit = reduce(base.board, begin.value.state, { t: 'RESOLVE_TUNNEL', player: p0, commit: true });
    expect(commit.ok).toBe(true);
    if (!commit.ok) return;
    const bs = stampBonuses(commit.value.events);
    expect(bs).toHaveLength(2); // both tunnel endpoints are new
  });

  it('awards nothing outside a stamp-rally window', () => {
    const base = afterSetup(2, 'stamp-off');
    const route = simpleRoutes(base.board)[0]!;
    const state = wellStocked(withEvents(base.state, emptyEvents())); // no STAMP_RALLY active
    const res = reduce(base.board, state, {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: route.id,
      payment: payFor(route),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(stampBonuses(res.value.events)).toHaveLength(0);
  });
});
