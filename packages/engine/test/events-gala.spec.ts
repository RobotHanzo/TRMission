import { describe, it, expect } from 'vitest';
import { asPlayerId } from '@trm/shared';
import type { GameState } from '../src/types/state';
import type { GameEvent } from '../src/types/events';
import type { Action, Payment } from '../src/types/actions';
import type { EventScheduleEntry } from '../src/types/events-state';
import { reduce, hasAnyLegalMove } from '../src/reduce';
import { legalActions } from '../src/selectors';
import { endTurn } from '../src/turn';
import { afterSetup, withEvents, emptyEvents, setPlayer, drainPools, handOf, handTotal } from './events-helpers';

const p0 = asPlayerId('p0');
const EMPTY_PAYMENT: Payment = { color: null, colorCount: 0, locomotives: 0 };

/** A feature-on state with the gala free-station flag already up. */
function flagUp(state: GameState, untilRound = 99): GameState {
  return withEvents(state, { ...emptyEvents(), freeStation: { untilRound } });
}

const galaBonus = (events: readonly GameEvent[]) =>
  events.find(
    (e): e is Extract<GameEvent, { e: 'EVENT_BONUS' }> =>
      e.e === 'EVENT_BONUS' && e.kind === 'RAILWAY_GALA',
  );

// NOTE: a typhoon day off (which suspends station builds) and a railway gala never overlap — the
// schedule generator lays restrictive and positive windows in non-overlapping slots — so a
// "day-off wins over the free flag" case is unreachable in a real game and needs no test.

describe('events — railway gala free station', () => {
  it('opens the free window for EXACTLY the gala round, then clears it at the next boundary', () => {
    const base = afterSetup(2, 'gala-window');
    const sched: EventScheduleEntry[] = [
      { id: 'ev1', kind: 'RAILWAY_GALA', startRound: 2, durationRounds: 1, telegraphed: false },
    ];
    let s: GameState = withEvents(base.state, { ...emptyEvents(), schedule: sched });
    // Wrap into round 2: the gala starts and the flag is up for its own round only.
    for (let i = 0; i < 2; i++) s = endTurn(base.board, s, { wasPass: false }).state;
    expect(s.events!.roundIndex).toBe(2);
    expect(s.events!.freeStation).toEqual({ untilRound: 2 });
    // Wrap into round 3: the flag (and the gala active window) are gone.
    for (let i = 0; i < 2; i++) s = endTurn(base.board, s, { wasPass: false }).state;
    expect(s.events!.roundIndex).toBe(3);
    expect(s.events!.freeStation).toBeUndefined();
    expect(s.events!.active.some((a) => a.kind === 'RAILWAY_GALA')).toBe(false);
  });

  it('accepts the empty payment, consumes the flag, and emits EVENT_BONUS after STATION_BUILT', () => {
    const base = afterSetup(2, 'gala-build');
    const state = flagUp(base.state);
    const city = base.board.cityIds[0]!;
    const handBefore = handTotal(state, p0);
    const stationsBefore = state.players['p0']!.stationsRemaining;
    const res = reduce(base.board, state, {
      t: 'BUILD_STATION',
      player: p0,
      cityId: city,
      payment: EMPTY_PAYMENT,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const ks = res.value.events.map((e) => e.e);
    expect(ks.indexOf('STATION_BUILT')).toBeLessThan(ks.indexOf('EVENT_BONUS'));
    expect(galaBonus(res.value.events)).toMatchObject({
      reason: 'FREE_STATION',
      player: p0,
      cityId: city,
      points: 0,
    });
    expect(res.value.state.events!.freeStation).toBeUndefined(); // consumed
    expect(res.value.state.players['p0']!.stationsRemaining).toBe(stationsBefore - 1);
    expect(handTotal(res.value.state, p0)).toBe(handBefore); // no cards spent
  });

  it('leaves the flag up when the player builds a PAID station instead', () => {
    const base = afterSetup(2, 'gala-paid');
    const state = flagUp(setPlayer(base.state, p0, { hand: handOf({ RED: 5 }) }));
    const city = base.board.cityIds[0]!;
    const res = reduce(base.board, state, {
      t: 'BUILD_STATION',
      player: p0,
      cityId: city,
      payment: { color: 'RED', colorCount: 1, locomotives: 0 }, // first station costs 1
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(galaBonus(res.value.events)).toBeUndefined();
    expect(res.value.state.events!.freeStation).toEqual({ untilRound: 99 }); // NOT consumed
    expect(res.value.state.players['p0']!.hand.RED).toBe(4); // paid one card
  });

  it('rejects a second empty-payment station once the flag is consumed', () => {
    const base = afterSetup(2, 'gala-second');
    const state = flagUp(base.state);
    const first = reduce(base.board, state, {
      t: 'BUILD_STATION',
      player: p0,
      cityId: base.board.cityIds[0]!,
      payment: EMPTY_PAYMENT,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    // Put p0 back on the clock; the flag is gone, so an empty payment now fails normal validation.
    const back: GameState = {
      ...first.value.state,
      turn: { orderIndex: 0, phase: 'AWAIT_ACTION', cardsDrawnThisTurn: 0 },
    };
    const second = reduce(base.board, back, {
      t: 'BUILD_STATION',
      player: p0,
      cityId: base.board.cityIds[1]!,
      payment: EMPTY_PAYMENT,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe('BAD_PAYMENT_LENGTH');
  });

  it('offers the empty-payment station candidate exactly while the flag is up', () => {
    const base = afterSetup(2, 'gala-legal');
    const isEmpty = (a: Action) =>
      a.t === 'BUILD_STATION' && a.payment.colorCount === 0 && a.payment.locomotives === 0;
    const up = legalActions(base.board, flagUp(base.state), p0);
    expect(up.some(isEmpty)).toBe(true);
    const down = legalActions(base.board, withEvents(base.state, emptyEvents()), p0);
    expect(down.some(isEmpty)).toBe(false);
  });

  it('gives a 0-card player with stations a legal move iff the flag is up (hasAnyLegalMove mirror)', () => {
    const base = afterSetup(2, 'gala-stranded');
    const stranded = drainPools(setPlayer(base.state, p0, { hand: handOf({}) }));
    const up = flagUp(stranded);
    const down = withEvents(stranded, emptyEvents());
    expect(hasAnyLegalMove(base.board, up, p0)).toBe(true);
    expect(hasAnyLegalMove(base.board, down, p0)).toBe(false);
    // Mirror: PASS is the SOLE move only when the flag is down.
    const laDown = legalActions(base.board, down, p0);
    expect(laDown.map((a) => a.t)).toEqual(['PASS']);
    expect(legalActions(base.board, up, p0).some((a) => a.t === 'BUILD_STATION')).toBe(true);
  });
});
