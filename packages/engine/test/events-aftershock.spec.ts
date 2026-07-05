import { describe, it, expect } from 'vitest';
import { asPlayerId } from '@trm/shared';
import type { CardColor } from '@trm/shared';
import type { RouteDef } from '@trm/map-data';
import type { Board } from '../src/board';
import { reduce } from '../src/reduce';
import {
  afterSetup,
  withEvents,
  emptyEvents,
  activeEvent,
  setPlayer,
  drainPools,
  handOf,
  handTotal,
  totalCards,
  payColorFor,
} from './events-helpers';

const p0 = asPlayerId('p0');

function findTunnel(board: Board): RouteDef {
  const r = board.content.routes.find((rt) => rt.isTunnel);
  if (!r) throw new Error('no tunnel route');
  return r;
}

function otherColor(c: CardColor): CardColor {
  return c === 'BLUE' ? 'RED' : 'BLUE';
}

describe('events — aftershock tunnel effects', () => {
  it('reveals 4 cards while active and commits normally', () => {
    const { board, state } = afterSetup(2, 'aftershock-reveal');
    const tunnel = findTunnel(board);
    const payColor = payColorFor(tunnel);
    const fill = otherColor(payColor);
    const s = withEvents(
      {
        ...setPlayer(state, p0, { hand: handOf({ [payColor]: tunnel.length + 4 }), trainCars: 45 }),
        deck: Array.from({ length: 20 }, () => fill),
      },
      { ...emptyEvents(), active: [activeEvent('AFTERSHOCK')] },
    );
    const begin = reduce(board, s, {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: tunnel.id,
      payment: { color: payColor, colorCount: tunnel.length, locomotives: 0 },
    });
    expect(begin.ok).toBe(true);
    if (!begin.ok) return;
    expect(begin.value.state.pendingTunnel!.revealed).toHaveLength(4);
    expect(begin.value.state.pendingTunnel!.extraRequired).toBe(0);
    // Commit path is unchanged by aftershock.
    const commit = reduce(board, begin.value.state, {
      t: 'RESOLVE_TUNNEL',
      player: p0,
      commit: true,
      extra: { color: null, colorCount: 0, locomotives: 0 },
    });
    expect(commit.ok).toBe(true);
    if (!commit.ok) return;
    expect(commit.value.events.some((e) => e.e === 'ROUTE_CLAIMED')).toBe(true);
    expect(commit.value.state.ownership[tunnel.id as string]).toEqual({ owner: p0 });
  });

  it('reveals only 3 cards once the aftershock has expired', () => {
    const { board, state } = afterSetup(2, 'aftershock-expired');
    const tunnel = findTunnel(board);
    const payColor = payColorFor(tunnel);
    const fill = otherColor(payColor);
    const s = withEvents(
      {
        ...setPlayer(state, p0, { hand: handOf({ [payColor]: tunnel.length + 4 }), trainCars: 45 }),
        deck: Array.from({ length: 20 }, () => fill),
      },
      emptyEvents(), // no active aftershock
    );
    const begin = reduce(board, s, {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: tunnel.id,
      payment: { color: payColor, colorCount: tunnel.length, locomotives: 0 },
    });
    expect(begin.ok).toBe(true);
    if (!begin.ok) return;
    expect(begin.value.state.pendingTunnel!.revealed).toHaveLength(3);
  });

  it('grants exactly one blind card on abort (hand +1, deck −1, cards conserved)', () => {
    const { board, state } = afterSetup(2, 'aftershock-abort');
    const tunnel = findTunnel(board);
    const payColor = payColorFor(tunnel);
    const fill = otherColor(payColor);
    const s = withEvents(
      {
        ...setPlayer(state, p0, { hand: handOf({ [payColor]: tunnel.length + 4 }), trainCars: 45 }),
        deck: Array.from({ length: 20 }, () => fill),
      },
      { ...emptyEvents(), active: [activeEvent('AFTERSHOCK')] },
    );
    const totalBefore = totalCards(s);
    const begin = reduce(board, s, {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: tunnel.id,
      payment: { color: payColor, colorCount: tunnel.length, locomotives: 0 },
    });
    expect(begin.ok).toBe(true);
    if (!begin.ok) return;
    const handAfterBegin = handTotal(begin.value.state, p0);
    const deckAfterBegin = begin.value.state.deck.length;
    const abort = reduce(board, begin.value.state, {
      t: 'RESOLVE_TUNNEL',
      player: p0,
      commit: false,
    });
    expect(abort.ok).toBe(true);
    if (!abort.ok) return;
    expect(handTotal(abort.value.state, p0)).toBe(handAfterBegin + 1);
    expect(abort.value.state.deck.length).toBe(deckAfterBegin - 1);
    expect(totalCards(abort.value.state)).toBe(totalBefore);
    const drawn = abort.value.events.filter((e) => e.e === 'CARD_DRAWN_BLIND');
    expect(drawn).toHaveLength(1);
    expect(drawn[0] && 'player' in drawn[0] ? drawn[0].player : null).toBe(p0);
  });

  it('grants nothing (and does not throw) when deck and discard are empty on abort', () => {
    const { board, state } = afterSetup(2, 'aftershock-empty');
    const tunnel = findTunnel(board);
    const payColor = payColorFor(tunnel);
    const s = withEvents(
      drainPools(
        setPlayer(state, p0, { hand: handOf({ [payColor]: tunnel.length }), trainCars: 45 }),
      ),
      { ...emptyEvents(), active: [activeEvent('AFTERSHOCK')] },
    );
    const begin = reduce(board, s, {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: tunnel.id,
      payment: { color: payColor, colorCount: tunnel.length, locomotives: 0 },
    });
    expect(begin.ok).toBe(true);
    if (!begin.ok) return;
    expect(begin.value.state.pendingTunnel!.revealed).toHaveLength(0); // nothing to reveal
    const handAfterBegin = handTotal(begin.value.state, p0);
    const abort = reduce(board, begin.value.state, {
      t: 'RESOLVE_TUNNEL',
      player: p0,
      commit: false,
    });
    expect(abort.ok).toBe(true);
    if (!abort.ok) return;
    expect(handTotal(abort.value.state, p0)).toBe(handAfterBegin); // no consolation card
    expect(abort.value.events.some((e) => e.e === 'CARD_DRAWN_BLIND')).toBe(false);
  });
});
