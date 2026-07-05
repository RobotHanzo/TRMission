import { describe, it, expect } from 'vitest';
import { asPlayerId } from '@trm/shared';
import type { RouteDef } from '@trm/map-data';
import type { Board } from '../src/board';
import type { GameState } from '../src/types/state';
import type { GameEvent } from '../src/types/events';
import type { EventScheduleEntry } from '../src/types/events-state';
import { reduce } from '../src/reduce';
import { endTurn } from '../src/turn';
import {
  afterSetup,
  withEvents,
  emptyEvents,
  setPlayer,
  drainPools,
  handOf,
} from './events-helpers';

const p0 = asPlayerId('p0');

function findSimpleRoute(board: Board): RouteDef {
  const r = board.content.routes.find(
    (rt) => !rt.isTunnel && rt.ferryLocos === 0 && rt.doubleGroup === undefined,
  );
  if (!r) throw new Error('no simple route');
  return r;
}

/** A generous hand + full trains so payment/trains are never the limiting factor. */
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

/** A base payment covering `route`'s length (locos cover any ferry symbols). */
function payFor(route: RouteDef) {
  const color = route.color === 'GRAY' ? 'RED' : route.color;
  return { color, colorCount: route.length - route.ferryLocos, locomotives: route.ferryLocos };
}

const bonuses = (events: readonly GameEvent[]) =>
  events.filter(
    (e): e is Extract<GameEvent, { e: 'EVENT_BONUS' }> =>
      e.e === 'EVENT_BONUS' && e.kind === 'VIRAL_HOTSPOT',
  );

describe('events — viral hotspot claim bonus', () => {
  it('awards +1 (itemized EVENT_BONUS after ROUTE_CLAIMED) when a claim touches a level-1 city', () => {
    const base = afterSetup(2, 'hotspot-l1');
    const route = findSimpleRoute(base.board);
    const city = route.a as string;
    const state = wellStocked(
      withEvents(base.state, { ...emptyEvents(), hotspots: { [city]: 1 } }),
    );
    const before = state.players['p0']!.routePoints;
    const res = reduce(base.board, state, {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: route.id,
      payment: payFor(route),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const bs = bonuses(res.value.events);
    expect(bs).toHaveLength(1);
    expect(bs[0]).toMatchObject({ reason: 'HOTSPOT', player: p0, points: 1, cityId: route.a });
    // Ordering: the bonus follows ROUTE_CLAIMED.
    const ks = res.value.events.map((e) => e.e);
    expect(ks.indexOf('ROUTE_CLAIMED')).toBeLessThan(ks.indexOf('EVENT_BONUS'));
    const basePoints = state.ruleParams.routePoints[route.length] ?? 0;
    expect(res.value.state.players['p0']!.routePoints).toBe(before + basePoints + 1);
  });

  it('pays 2 for a level-2 city', () => {
    const base = afterSetup(2, 'hotspot-l2');
    const route = findSimpleRoute(base.board);
    const state = wellStocked(
      withEvents(base.state, { ...emptyEvents(), hotspots: { [route.a as string]: 2 } }),
    );
    const before = state.players['p0']!.routePoints;
    const res = reduce(base.board, state, {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: route.id,
      payment: payFor(route),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const bs = bonuses(res.value.events);
    expect(bs).toHaveLength(1);
    expect(bs[0]!.points).toBe(2);
    const basePoints = state.ruleParams.routePoints[route.length] ?? 0;
    expect(res.value.state.players['p0']!.routePoints).toBe(before + basePoints + 2);
  });

  it('emits one sorted event per marked endpoint when BOTH endpoints are hotspots', () => {
    const base = afterSetup(2, 'hotspot-both');
    const route = findSimpleRoute(base.board);
    const a = route.a as string;
    const b = route.b as string;
    // Distinct levels so we can check each event carries its own city's level.
    const state = wellStocked(
      withEvents(base.state, { ...emptyEvents(), hotspots: { [a]: 1, [b]: 2 } }),
    );
    const res = reduce(base.board, state, {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: route.id,
      payment: payFor(route),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const bs = bonuses(res.value.events);
    expect(bs).toHaveLength(2);
    // Sorted by cityId ascending.
    const sorted = [a, b].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
    expect(bs.map((e) => e.cityId as string)).toEqual(sorted);
    // Each event's points equal its own city's level.
    const levelOf: Record<string, number> = { [a]: 1, [b]: 2 };
    for (const e of bs) expect(e.points).toBe(levelOf[e.cityId as string]);
  });

  it('applies on a tunnel commit', () => {
    const base = afterSetup(2, 'hotspot-tunnel');
    const tunnel = base.board.content.routes.find((r) => r.isTunnel);
    if (!tunnel) throw new Error('no tunnel');
    // Drain the draw pool so the tunnel reveals nothing (extraRequired 0 → trivial commit).
    const state = wellStocked(
      drainPools(
        withEvents(base.state, { ...emptyEvents(), hotspots: { [tunnel.a as string]: 1 } }),
      ),
    );
    const begin = reduce(base.board, state, {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: tunnel.id,
      payment: payFor(tunnel),
    });
    expect(begin.ok).toBe(true);
    if (!begin.ok) return;
    expect(begin.value.state.turn.phase).toBe('TUNNEL_PENDING');
    const commit = reduce(base.board, begin.value.state, {
      t: 'RESOLVE_TUNNEL',
      player: p0,
      commit: true,
    });
    expect(commit.ok).toBe(true);
    if (!commit.ok) return;
    const bs = bonuses(commit.value.events);
    expect(bs).toHaveLength(1);
    expect(bs[0]).toMatchObject({ reason: 'HOTSPOT', points: 1, cityId: tunnel.a });
  });

  it('awards nothing when the feature is off or no hotspot marks the endpoints', () => {
    const base = afterSetup(2, 'hotspot-off');
    const route = findSimpleRoute(base.board);
    // Feature ON but no marker on this route's endpoints.
    const noMark = wellStocked(withEvents(base.state, emptyEvents()));
    const r1 = reduce(base.board, noMark, {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: route.id,
      payment: payFor(route),
    });
    expect(r1.ok && bonuses(r1.value.events)).toHaveLength(0);
    // Feature OFF entirely (events key absent).
    const { events: _drop, ...offState } = wellStocked(base.state);
    const r2 = reduce(base.board, offState as GameState, {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: route.id,
      payment: payFor(route),
    });
    expect(r2.ok && bonuses(r2.value.events)).toHaveLength(0);
  });

  it('respects the stacking cap end-to-end: two firings on one city ⇒ level 2, not 3', () => {
    const base = afterSetup(2, 'hotspot-cap');
    const route = findSimpleRoute(base.board);
    const city = route.a as string;
    // Two VIRAL_HOTSPOT schedule entries for the SAME city, in consecutive rounds.
    const sched: EventScheduleEntry[] = [
      {
        id: 'ev1',
        kind: 'VIRAL_HOTSPOT',
        startRound: 2,
        durationRounds: 0,
        telegraphed: false,
        cityId: route.a,
      },
      {
        id: 'ev2',
        kind: 'VIRAL_HOTSPOT',
        startRound: 3,
        durationRounds: 0,
        telegraphed: false,
        cityId: route.a,
      },
    ];
    let s: GameState = withEvents(base.state, { ...emptyEvents(), schedule: sched });
    // 4 endTurns (2p): wrap to round 2 (first bump) then round 3 (second bump, capped at 2).
    for (let i = 0; i < 4; i++) s = endTurn(base.board, s, { wasPass: false }).state;
    expect(s.events!.hotspots[city]).toBe(2);
    // The 4th endTurn wrapped to orderIndex 0 → p0 is to move; claim the route touching the city.
    expect(s.turn.orderIndex).toBe(0);
    const claim = reduce(base.board, wellStocked(s), {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: route.id,
      payment: payFor(route),
    });
    expect(claim.ok).toBe(true);
    if (!claim.ok) return;
    const bs = bonuses(claim.value.events);
    expect(bs).toHaveLength(1);
    expect(bs[0]!.points).toBe(2); // capped level, not 3
  });
});
