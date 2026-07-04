import { describe, it, expect } from 'vitest';
import { asPlayerId } from '@trm/shared';
import type { RouteDef } from '@trm/map-data';
import type { Board } from '../src/board';
import type { GameState } from '../src/types/state';
import type { GameEvent } from '../src/types/events';
import { reduce, hasAnyLegalMove } from '../src/reduce';
import { legalActions } from '../src/selectors';
import { endTurn } from '../src/turn';
import { siblingOf, getRoute } from '../src/board';
import {
  afterSetup,
  withEvents,
  emptyEvents,
  activeEvent,
  setPlayer,
  drainPools,
  handOf,
  colorPayment,
} from './events-helpers';

const p0 = asPlayerId('p0');

/** First route matching a predicate (throws if the board has none — a test wiring bug). */
function findRoute(board: Board, pred: (r: RouteDef) => boolean): RouteDef {
  const r = board.content.routes.find(pred);
  if (!r) throw new Error('no route matches predicate');
  return r;
}

/** A generous hand + full trains so payment is never the limiting factor. */
function wellStocked(state: GameState): GameState {
  return setPlayer(state, p0, {
    hand: handOf({ RED: 8, ORANGE: 8, YELLOW: 8, GREEN: 8, BLUE: 8, PURPLE: 8, WHITE: 8, BLACK: 8, LOCOMOTIVE: 8 }),
    trainCars: 45,
  });
}

const kinds = (events: readonly GameEvent[]): string[] => events.map((e) => e.e);

describe('events — typhoon landfall closure', () => {
  it('rejects a normal claim of a closed route with ROUTE_CLOSED_BY_EVENT', () => {
    const base = afterSetup(2, 'typhoon-normal');
    const route = findRoute(base.board, (r) => !r.isTunnel && r.ferryLocos === 0 && r.doubleGroup === undefined);
    const state = wellStocked(
      withEvents(base.state, {
        ...emptyEvents(),
        active: [activeEvent('TYPHOON_LANDFALL', { routeIds: [route.id] })],
      }),
    );
    const res = reduce(base.board, state, {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: route.id,
      payment: colorPayment(route),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('ROUTE_CLOSED_BY_EVENT');
  });

  it('rejects a tunnel-begin of a closed route with ROUTE_CLOSED_BY_EVENT', () => {
    const base = afterSetup(2, 'typhoon-tunnel');
    const tunnel = findRoute(base.board, (r) => r.isTunnel);
    const state = wellStocked(
      withEvents(base.state, {
        ...emptyEvents(),
        active: [activeEvent('TYPHOON_LANDFALL', { routeIds: [tunnel.id] })],
      }),
    );
    const res = reduce(base.board, state, {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: tunnel.id,
      payment: colorPayment(tunnel),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('ROUTE_CLOSED_BY_EVENT');
  });

  it('leaves unaffected routes claimable while another route is closed', () => {
    const base = afterSetup(2, 'typhoon-unaffected');
    const claimable = base.board.content.routes.filter(
      (r) => !r.isTunnel && r.ferryLocos === 0 && r.doubleGroup === undefined,
    );
    const closed = claimable[0]!;
    const open = claimable[1]!;
    const state = wellStocked(
      withEvents(base.state, {
        ...emptyEvents(),
        active: [activeEvent('TYPHOON_LANDFALL', { routeIds: [closed.id] })],
      }),
    );
    const res = reduce(base.board, state, {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: open.id,
      payment: colorPayment(open),
    });
    expect(res.ok).toBe(true);
  });

  it('hasAnyLegalMove is false (and PASS becomes the sole move) when every affordable claim is closed', () => {
    const base = afterSetup(2, 'typhoon-stranded');
    // Tiny footprint: trains cap claims to length ≤ 2, no stations, no draw/ticket sources.
    const stripped = drainPools(
      setPlayer(base.state, p0, {
        hand: handOf({ RED: 4, BLUE: 4, GREEN: 4, YELLOW: 4, LOCOMOTIVE: 2 }),
        trainCars: 2,
        stationsRemaining: 0,
      }),
    );
    const openState = withEvents(stripped, emptyEvents());
    const claimIds = Array.from(
      new Set(
        legalActions(base.board, openState, p0)
          .filter((a) => a.t === 'CLAIM_ROUTE')
          .map((a) => (a as { routeId: string }).routeId),
      ),
    );
    expect(claimIds.length).toBeGreaterThan(0); // there ARE affordable claims to close

    const closedState = withEvents(stripped, {
      ...emptyEvents(),
      active: [activeEvent('TYPHOON_LANDFALL', { routeIds: claimIds as never })],
    });
    expect(hasAnyLegalMove(base.board, closedState, p0)).toBe(false);
    const la = legalActions(base.board, closedState, p0);
    expect(la.length).toBe(1);
    expect(la[0]!.t).toBe('PASS');
    expect(reduce(base.board, closedState, { t: 'PASS', player: p0 }).ok).toBe(true);
  });
});

describe('events — typhoon reopen +2', () => {
  it('awards +2 (itemized EVENT_BONUS after ROUTE_CLAIMED) to the first claimer and clears the entry', () => {
    const base = afterSetup(2, 'reopen-first');
    const route = findRoute(base.board, (r) => !r.isTunnel && r.ferryLocos === 0 && r.doubleGroup === undefined);
    const state = wellStocked(
      withEvents(base.state, { ...emptyEvents(), reopenBonus: [route.id] }),
    );
    const before = state.players['p0']!.routePoints;
    const res = reduce(base.board, state, {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: route.id,
      payment: colorPayment(route),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const basePoints = state.ruleParams.routePoints[route.length] ?? 0;
    const claimed = res.value.events.find((e) => e.e === 'ROUTE_CLAIMED');
    expect(claimed && 'pointsAwarded' in claimed ? claimed.pointsAwarded : -1).toBe(basePoints);
    const bonus = res.value.events.find((e) => e.e === 'EVENT_BONUS');
    expect(bonus).toBeDefined();
    if (bonus && bonus.e === 'EVENT_BONUS') {
      expect(bonus.kind).toBe('TYPHOON_LANDFALL');
      expect(bonus.reason).toBe('REOPEN');
      expect(bonus.player).toBe(p0);
      expect(bonus.points).toBe(2);
      expect(bonus.routeId).toBe(route.id);
    }
    // Ordering: ROUTE_CLAIMED precedes its EVENT_BONUS.
    const ks = kinds(res.value.events);
    expect(ks.indexOf('ROUTE_CLAIMED')).toBeLessThan(ks.indexOf('EVENT_BONUS'));
    // Points banked = base + 2; the reopen entry is consumed.
    expect(res.value.state.players['p0']!.routePoints).toBe(before + basePoints + 2);
    expect(res.value.state.events!.reopenBonus).not.toContain(route.id);
  });

  it('pays a reopened sibling only for the route actually in the reopen list', () => {
    const base = afterSetup(2, 'reopen-sibling');
    // A double-route edge whose sibling exists on the board.
    const doubled = findRoute(
      base.board,
      (r) => r.doubleGroup !== undefined && !r.isTunnel && r.ferryLocos === 0,
    );
    const sibId = siblingOf(base.board, doubled.id);
    expect(sibId).toBeDefined();
    const sibling = getRoute(base.board, sibId!)!;
    // Only `doubled` carries the reopen bonus; the sibling does not.
    const state = wellStocked(
      withEvents(base.state, { ...emptyEvents(), reopenBonus: [doubled.id] }),
    );
    const before = state.players['p0']!.routePoints;
    const res = reduce(base.board, state, {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: sibling.id,
      payment: colorPayment(sibling),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const basePoints = state.ruleParams.routePoints[sibling.length] ?? 0;
    // No reopen bonus for a route not in the list.
    expect(res.value.events.some((e) => e.e === 'EVENT_BONUS')).toBe(false);
    expect(res.value.state.players['p0']!.routePoints).toBe(before + basePoints);
    // The unclaimed sibling's entry is untouched.
    expect(res.value.state.events!.reopenBonus).toContain(doubled.id);
  });

  it('does NOT consume the reopen bonus on a tunnel abort', () => {
    const base = afterSetup(2, 'reopen-abort');
    const tunnel = findRoute(base.board, (r) => r.isTunnel);
    const state = wellStocked(
      withEvents(base.state, { ...emptyEvents(), reopenBonus: [tunnel.id] }),
    );
    const begin = reduce(base.board, state, {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: tunnel.id,
      payment: colorPayment(tunnel),
    });
    expect(begin.ok).toBe(true);
    if (!begin.ok) return;
    expect(begin.value.state.turn.phase).toBe('TUNNEL_PENDING');
    const abort = reduce(base.board, begin.value.state, {
      t: 'RESOLVE_TUNNEL',
      player: p0,
      commit: false,
    });
    expect(abort.ok).toBe(true);
    if (!abort.ok) return;
    expect(abort.value.events.some((e) => e.e === 'EVENT_BONUS')).toBe(false);
    expect(abort.value.state.events!.reopenBonus).toContain(tunnel.id);
  });
});

describe('events — reopen list population on typhoon expiry', () => {
  it('rolls only STILL-UNCLAIMED typhoon routes into reopenBonus when the window ends', () => {
    // The M1 expiry semantics the M2 rules build on: a claimed typhoon route is never reopened.
    // Two endTurns (2p) wrap into round 2 so tickRound's END phase fires (endsAfterRound 1 < 2).
    const base = afterSetup(2, 'reopen-populate');
    const routes = base.board.content.routes.filter(
      (r) => !r.isTunnel && r.ferryLocos === 0 && r.doubleGroup === undefined,
    );
    const owned = routes[0]!;
    const unclaimed = routes[1]!;
    let state: GameState = withEvents(
      { ...base.state, ownership: { [owned.id as string]: { owner: p0 } } },
      {
        ...emptyEvents(),
        roundIndex: 1,
        active: [
          activeEvent('TYPHOON_LANDFALL', {
            id: 'ev1',
            endsAfterRound: 1,
            routeIds: [owned.id, unclaimed.id],
          }),
        ],
      },
    );
    const batches: string[][] = [];
    for (let i = 0; i < 2; i++) {
      const out = endTurn(base.board, state, { wasPass: false });
      batches.push(out.events.map((e) => e.e));
      state = out.state;
    }
    expect(state.events!.roundIndex).toBe(2);
    // The window ended on the wrap.
    expect(batches[1]).toContain('EVENT_ENDED');
    // Only the still-unclaimed route reopened.
    expect(state.events!.reopenBonus).toContain(unclaimed.id);
    expect(state.events!.reopenBonus).not.toContain(owned.id);
    // The closed set is empty now the window is gone.
    expect(state.events!.active).toHaveLength(0);
  });
});
