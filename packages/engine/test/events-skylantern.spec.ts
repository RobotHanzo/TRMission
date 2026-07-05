import { describe, it, expect } from 'vitest';
import { asPlayerId } from '@trm/shared';
import type { CardColor } from '@trm/shared';
import type { RouteDef } from '@trm/map-data';
import type { Board } from '../src/board';
import type { GameState } from '../src/types/state';
import { reduce } from '../src/reduce';
import { legalActions } from '../src/selectors';
import { endTurn } from '../src/turn';
import {
  afterSetup,
  withEvents,
  emptyEvents,
  activeEvent,
  setPlayer,
  handOf,
  payColorFor,
} from './events-helpers';

const p0 = asPlayerId('p0');

function findRoute(board: Board, pred: (r: RouteDef) => boolean): RouteDef {
  const r = board.content.routes.find(pred);
  if (!r) throw new Error('no route matches predicate');
  return r;
}

/** A colour distinct from `c` and never a locomotive — used to fill a deck with harmless reveals. */
function otherColor(c: CardColor): CardColor {
  return c === 'BLUE' ? 'RED' : 'BLUE';
}

/** A plain (non-tunnel, non-ferry, single, coloured) route. */
function plainColored(board: Board): RouteDef {
  return findRoute(
    board,
    (r) => !r.isTunnel && r.ferryLocos === 0 && r.doubleGroup === undefined && r.color !== 'GRAY',
  );
}

describe('events — sky lantern surcharge & doubling', () => {
  it('requires length+1 cards (unsurcharged is rejected) and doubles the points', () => {
    const { board, state } = afterSetup(2, 'sky-surcharge');
    const route = plainColored(board);
    const color = payColorFor(route);
    const s = withEvents(
      setPlayer(state, p0, { hand: handOf({ [color]: route.length + 3 }), trainCars: 45 }),
      { ...emptyEvents(), active: [activeEvent('SKY_LANTERN', { routeIds: [route.id] })] },
    );
    // Unsurcharged (exact length) is rejected.
    const short = reduce(board, s, {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: route.id,
      payment: { color, colorCount: route.length, locomotives: 0 },
    });
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.error.code).toBe('BAD_PAYMENT_LENGTH');

    // Surcharged (length + 1) is accepted, points doubled.
    const before = s.players['p0']!.routePoints;
    const ok = reduce(board, s, {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: route.id,
      payment: { color, colorCount: route.length + 1, locomotives: 0 },
    });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    const basePoints = state.ruleParams.routePoints[route.length] ?? 0;
    const claimed = ok.value.events.find((e) => e.e === 'ROUTE_CLAIMED');
    expect(claimed && 'pointsAwarded' in claimed ? claimed.pointsAwarded : -1).toBe(basePoints * 2);
    expect(ok.value.state.players['p0']!.routePoints).toBe(before + basePoints * 2);
  });

  it('lets a locomotive cover the surcharge card', () => {
    const { board, state } = afterSetup(2, 'sky-loco');
    const route = plainColored(board);
    const color = payColorFor(route);
    const s = withEvents(
      setPlayer(state, p0, {
        hand: handOf({ [color]: route.length, LOCOMOTIVE: 1 }),
        trainCars: 45,
      }),
      { ...emptyEvents(), active: [activeEvent('SKY_LANTERN', { routeIds: [route.id] })] },
    );
    const res = reduce(board, s, {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: route.id,
      payment: { color, colorCount: route.length, locomotives: 1 },
    });
    expect(res.ok).toBe(true);
  });

  it('offers the claim in legalActions iff the hand covers length+1', () => {
    const { board, state } = afterSetup(2, 'sky-legal');
    const route = plainColored(board);
    const color = payColorFor(route);
    const offers = (n: number): boolean => {
      const s = withEvents(setPlayer(state, p0, { hand: handOf({ [color]: n }), trainCars: 45 }), {
        ...emptyEvents(),
        active: [activeEvent('SKY_LANTERN', { routeIds: [route.id] })],
      });
      return legalActions(board, s, p0).some(
        (a) => a.t === 'CLAIM_ROUTE' && (a as { routeId: string }).routeId === (route.id as string),
      );
    };
    expect(offers(route.length + 1)).toBe(true);
    expect(offers(route.length)).toBe(false);
  });

  it('applies the base surcharge and doubling to a tunnel end-to-end (begin → reveal → commit)', () => {
    const { board, state } = afterSetup(2, 'sky-tunnel');
    const tunnel = findRoute(board, (r) => r.isTunnel);
    const payColor = payColorFor(tunnel);
    const fill = otherColor(payColor);
    const s = withEvents(
      {
        ...setPlayer(state, p0, { hand: handOf({ [payColor]: tunnel.length + 4 }), trainCars: 45 }),
        deck: Array.from({ length: 20 }, () => fill),
      },
      { ...emptyEvents(), active: [activeEvent('SKY_LANTERN', { routeIds: [tunnel.id] })] },
    );
    const begin = reduce(board, s, {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: tunnel.id,
      payment: { color: payColor, colorCount: tunnel.length + 1, locomotives: 0 },
    });
    expect(begin.ok).toBe(true);
    if (!begin.ok) return;
    expect(begin.value.state.turn.phase).toBe('TUNNEL_PENDING');
    expect(begin.value.state.pendingTunnel!.extraRequired).toBe(0); // fill colour never matches
    const before = s.players['p0']!.routePoints;
    const commit = reduce(board, begin.value.state, {
      t: 'RESOLVE_TUNNEL',
      player: p0,
      commit: true,
      extra: { color: null, colorCount: 0, locomotives: 0 },
    });
    expect(commit.ok).toBe(true);
    if (!commit.ok) return;
    const basePoints = state.ruleParams.routePoints[tunnel.length] ?? 0;
    const claimed = commit.value.events.find((e) => e.e === 'ROUTE_CLAIMED');
    expect(claimed && 'pointsAwarded' in claimed ? claimed.pointsAwarded : -1).toBe(basePoints * 2);
    expect(commit.value.state.players['p0']!.routePoints).toBe(before + basePoints * 2);
  });

  it('restores normal cost and points once the window expires', () => {
    const { board, state } = afterSetup(2, 'sky-expiry');
    const route = plainColored(board);
    const color = payColorFor(route);
    let s: GameState = withEvents(
      setPlayer(state, p0, { hand: handOf({ [color]: route.length + 2 }), trainCars: 45 }),
      {
        ...emptyEvents(),
        roundIndex: 1,
        active: [
          activeEvent('SKY_LANTERN', { id: 'ev1', endsAfterRound: 1, routeIds: [route.id] }),
        ],
      },
    );
    // Wrap into round 2 → the window expires.
    for (let i = 0; i < 2; i++) s = endTurn(board, s, { wasPass: false }).state;
    expect(s.events!.active).toHaveLength(0);
    // Normal (exact length) payment is now valid, and points are NOT doubled.
    const before = s.players['p0']!.routePoints;
    const res = reduce(board, s, {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: route.id,
      payment: { color, colorCount: route.length, locomotives: 0 },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const basePoints = state.ruleParams.routePoints[route.length] ?? 0;
    const claimed = res.value.events.find((e) => e.e === 'ROUTE_CLAIMED');
    expect(claimed && 'pointsAwarded' in claimed ? claimed.pointsAwarded : -1).toBe(basePoints);
    expect(res.value.state.players['p0']!.routePoints).toBe(before + basePoints);
  });
});
