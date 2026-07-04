import { describe, it, expect } from 'vitest';
import { asPlayerId } from '@trm/shared';
import type { RouteDef } from '@trm/map-data';
import type { Board } from '../src/board';
import type { GameState } from '../src/types/state';
import { reduce, hasAnyLegalMove } from '../src/reduce';
import { currentPlayerId } from '../src/turn';
import {
  afterSetup,
  withEvents,
  emptyEvents,
  activeEvent,
  setPlayer,
  drainPools,
  handOf,
  handTotal,
  colorPayment,
} from './events-helpers';

const p0 = asPlayerId('p0');

function findRoute(board: Board, pred: (r: RouteDef) => boolean): RouteDef {
  const r = board.content.routes.find(pred);
  if (!r) throw new Error('no route matches predicate');
  return r;
}

/** A day-off state at AWAIT_ACTION (p0 to move) with a RED-only deck so blind draws are non-loco. */
function dayOffState(seed: string, patch: Partial<GameState> = {}): { board: Board; state: GameState } {
  const { board, state } = afterSetup(2, seed);
  const s = withEvents(
    {
      ...setPlayer(state, p0, {
        hand: handOf({ RED: 8, BLUE: 8, GREEN: 8, LOCOMOTIVE: 4 }),
        trainCars: 45,
      }),
      deck: Array.from({ length: 30 }, () => 'RED' as const),
      ...patch,
    },
    { ...emptyEvents(), active: [activeEvent('TYPHOON_DAY_OFF')] },
  );
  return { board, state: s };
}

describe('events — typhoon day off suspensions', () => {
  it('rejects CLAIM_ROUTE with EVENT_CLAIMS_SUSPENDED', () => {
    const { board, state } = dayOffState('dayoff-claim');
    const route = findRoute(board, (r) => !r.isTunnel && r.ferryLocos === 0 && r.doubleGroup === undefined);
    const res = reduce(board, state, {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: route.id,
      payment: colorPayment(route),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('EVENT_CLAIMS_SUSPENDED');
  });

  it('rejects a tunnel-begin with EVENT_CLAIMS_SUSPENDED too', () => {
    const { board, state } = dayOffState('dayoff-tunnel');
    const tunnel = findRoute(board, (r) => r.isTunnel);
    const res = reduce(board, state, {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: tunnel.id,
      payment: colorPayment(tunnel),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('EVENT_CLAIMS_SUSPENDED');
  });

  it('rejects BUILD_STATION with EVENT_STATIONS_SUSPENDED', () => {
    const { board, state } = dayOffState('dayoff-station');
    const city = board.cityIds[0]!;
    const res = reduce(board, state, {
      t: 'BUILD_STATION',
      player: p0,
      cityId: city,
      payment: { color: 'RED', colorCount: 1, locomotives: 0 },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('EVENT_STATIONS_SUSPENDED');
  });
});

describe('events — typhoon day off draw limit (3 picks)', () => {
  it('allows THREE blind picks, then auto-ends the turn', () => {
    const { board, state } = dayOffState('dayoff-3draws');
    const start = handTotal(state, p0);
    const r1 = reduce(board, state, { t: 'DRAW_BLIND', player: p0 });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.value.state.turn.phase).toBe('DRAWING_CARDS');
    expect(r1.value.state.turn.cardsDrawnThisTurn).toBe(1);
    const r2 = reduce(board, r1.value.state, { t: 'DRAW_BLIND', player: p0 });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.value.state.turn.phase).toBe('DRAWING_CARDS');
    expect(r2.value.state.turn.cardsDrawnThisTurn).toBe(2);
    const r3 = reduce(board, r2.value.state, { t: 'DRAW_BLIND', player: p0 });
    expect(r3.ok).toBe(true);
    if (!r3.ok) return;
    // Turn ended: it is now the other player's AWAIT_ACTION.
    expect(r3.value.state.turn.phase).toBe('AWAIT_ACTION');
    expect(currentPlayerId(r3.value.state)).not.toBe(p0);
    // p0 gained exactly 3 cards.
    expect(handTotal(r3.value.state, p0)).toBe(start + 3);
  });

  it('a FIRST-pick face-up locomotive still owes the day-off bonus card (but not a second locomotive)', () => {
    const { board, state } = dayOffState('dayoff-faceloco', {
      market: ['LOCOMOTIVE', 'LOCOMOTIVE', null, null, null],
    });
    const start = handTotal(state, p0);
    const res = reduce(board, state, { t: 'DRAW_FACEUP', player: p0, slot: 0 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // The locomotive forfeits the normal second draw, but the day-off's own bonus card is
    // unaffected — the turn stays open for exactly one more pick.
    expect(res.value.state.turn.phase).toBe('DRAWING_CARDS');
    expect(currentPlayerId(res.value.state)).toBe(p0);
    expect(handTotal(res.value.state, p0)).toBe(start + 1);

    // That bonus pick still cannot itself be a face-up locomotive (the leftover one in slot 1).
    const stillLoco = reduce(board, res.value.state, { t: 'DRAW_FACEUP', player: p0, slot: 1 });
    expect(stillLoco.ok).toBe(false);
    if (!stillLoco.ok) expect(stillLoco.error.code).toBe('FACEUP_LOCO_SECOND_DRAW');

    // A normal card consumes the bonus pick and ends the turn — exactly 2 cards total, not 3.
    const final = reduce(board, res.value.state, { t: 'DRAW_BLIND', player: p0 });
    expect(final.ok).toBe(true);
    if (!final.ok) return;
    expect(final.value.state.turn.phase).toBe('AWAIT_ACTION');
    expect(currentPlayerId(final.value.state)).not.toBe(p0);
    expect(handTotal(final.value.state, p0)).toBe(start + 2);
  });

  it('still rejects a face-up locomotive taken as the 2nd or 3rd pick', () => {
    const { board, state } = dayOffState('dayoff-loco-2nd', {
      market: ['LOCOMOTIVE', null, null, null, null],
    });
    const r1 = reduce(board, state, { t: 'DRAW_BLIND', player: p0 });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const bad2 = reduce(board, r1.value.state, { t: 'DRAW_FACEUP', player: p0, slot: 0 });
    expect(bad2.ok).toBe(false);
    if (!bad2.ok) expect(bad2.error.code).toBe('FACEUP_LOCO_SECOND_DRAW');
    // Advance to the 3rd pick and try again.
    const r2 = reduce(board, r1.value.state, { t: 'DRAW_BLIND', player: p0 });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.value.state.turn.cardsDrawnThisTurn).toBe(2);
    const bad3 = reduce(board, r2.value.state, { t: 'DRAW_FACEUP', player: p0, slot: 0 });
    expect(bad3.ok).toBe(false);
    if (!bad3.ok) expect(bad3.error.code).toBe('FACEUP_LOCO_SECOND_DRAW');
  });
});

describe('events — typhoon day off PASS legality', () => {
  it('keeps PASS illegal while cards are still drawable (drawing is a move)', () => {
    const { board, state } = dayOffState('dayoff-pass-illegal');
    expect(hasAnyLegalMove(board, state, p0)).toBe(true);
    const res = reduce(board, state, { t: 'PASS', player: p0 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('NO_LEGAL_MOVE_REQUIRED');
  });

  it('makes PASS legal once nothing is drawable and only (suspended) claims remain', () => {
    const { board, state } = afterSetup(2, 'dayoff-pass-legal');
    // Affordable claims would exist, but there is nothing to draw and no stations left.
    const stranded = drainPools(
      setPlayer(state, p0, {
        hand: handOf({ RED: 8, BLUE: 8, LOCOMOTIVE: 4 }),
        trainCars: 45,
        stationsRemaining: 0,
      }),
    );
    const s = withEvents(stranded, { ...emptyEvents(), active: [activeEvent('TYPHOON_DAY_OFF')] });
    expect(hasAnyLegalMove(board, s, p0)).toBe(false);
    expect(reduce(board, s, { t: 'PASS', player: p0 }).ok).toBe(true);
  });
});
