import { describe, it, expect } from 'vitest';
import type { SeatIndex, PlayerId, TrainColor } from '@trm/shared';
import { asPlayerId } from '@trm/shared';
import type { RouteDef } from '@trm/map-data';
import { taiwanBoard } from '../src/taiwan';
import { buildBoard } from '../src/board';
import type { Board } from '../src/board';
import type { GameConfig } from '../src/config';
import type { GameState } from '../src/types/state';
import type { Action } from '../src/types/actions';
import { initGame } from '../src/setup';
import { reduce } from '../src/reduce';
import { legalActions } from '../src/selectors';
import { stateDigest, replay } from '../src/serialize';
import { checkInvariants } from '../src/invariants';
import { handOf, setPlayer } from './events-helpers';

/** Build a Taiwan board with one chosen route turned into a broken rail. */
function setupBroken(
  numPlayers: number,
  opts: { carriages: number; gray?: boolean },
): { board: Board; state: GameState; route: RouteDef; config: GameConfig; log: Action[] } {
  const base = taiwanBoard().content;
  const target = base.routes.find(
    (r) =>
      (opts.gray ? r.color === 'GRAY' : r.color !== 'GRAY') &&
      !r.isTunnel &&
      r.ferryLocos === 0 &&
      !r.doubleGroup &&
      r.length >= 3,
  );
  if (!target) throw new Error('no suitable route found');
  const content = {
    ...base,
    routes: base.routes.map((r) =>
      r.id === target.id ? { ...r, brokenCarriages: opts.carriages } : r,
    ),
  };
  const board = buildBoard(content);
  const players = Array.from({ length: numPlayers }, (_, i) => ({
    id: asPlayerId(`p${i}`),
    seat: i as SeatIndex,
  }));
  const config: GameConfig = { seed: 'broken-rail', players, contentHash: 'hash-broken-test' };
  let state = initGame(board, config);
  const log: Action[] = [];
  while (state.turn.phase === 'SETUP_TICKETS') {
    const pid = state.turnOrder.find((id) => state.players[id as string]?.pendingTicketOffer)!;
    const offer = state.players[pid as string]!.pendingTicketOffer!;
    const action: Action = {
      t: 'KEEP_INITIAL_TICKETS',
      player: pid,
      keep: offer.slice(0, state.ruleParams.minKeepInitial),
    };
    const res = reduce(board, state, action);
    if (!res.ok) throw new Error('setup keep failed');
    state = res.value.state;
    log.push(action);
  }
  const routeAfter = board.routeById.get(target.id as string)!;
  return { board, state, route: routeAfter, config, log };
}

/** Apply an action that must succeed. (Most tests doctor hands via setPlayer, which breaks the
 *  card-conservation invariant by construction — the organic replay test asserts invariants.) */
function apply(
  board: Board,
  state: GameState,
  action: Action,
  log?: Action[],
): { state: GameState; events: readonly { e: string }[] } {
  const res = reduce(board, state, action);
  if (!res.ok) throw new Error(`expected ok, got ${res.error.code}: ${res.error.message}`);
  log?.push(action);
  return res.value;
}

/** A full draw-cards turn (two blind draws). */
function drawTurn(board: Board, state: GameState, player: PlayerId, log?: Action[]): GameState {
  let s = apply(board, state, { t: 'DRAW_BLIND', player }, log).state;
  if (s.turn.phase === 'DRAWING_CARDS') {
    s = apply(board, s, { t: 'DRAW_BLIND', player }, log).state;
  }
  return s;
}

describe('broken rail (斷軌)', () => {
  it('cannot be claimed before it is repaired', () => {
    const { board, state, route } = setupBroken(3, { carriages: 2 });
    const p0 = state.turnOrder[0]!;
    const armed = setPlayer(state, p0, {
      hand: handOf({ [route.color as TrainColor]: route.length }),
    });
    const res = reduce(board, armed, {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: route.id,
      payment: { color: route.color as TrainColor, colorCount: route.length, locomotives: 0 },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('ROUTE_BROKEN');
  });

  it('repair validates the payment (count, colour, hand)', () => {
    const { board, state, route } = setupBroken(3, { carriages: 2 });
    const p0 = state.turnOrder[0]!;
    const color = route.color as TrainColor;
    const armed = setPlayer(state, p0, { hand: handOf({ [color]: 4, GREEN: 4 }) });

    const wrongCount = reduce(board, armed, {
      t: 'REPAIR_ROUTE',
      player: p0,
      routeId: route.id,
      payment: { color, colorCount: 3, locomotives: 0 },
    });
    expect(!wrongCount.ok && wrongCount.error.code).toBe('BAD_PAYMENT_LENGTH');

    const wrongColor = reduce(board, armed, {
      t: 'REPAIR_ROUTE',
      player: p0,
      routeId: route.id,
      payment: { color: color === 'GREEN' ? 'RED' : 'GREEN', colorCount: 2, locomotives: 0 },
    });
    expect(!wrongColor.ok && wrongColor.error.code).toBe('BAD_PAYMENT_COLOR');

    const broke = setPlayer(state, p0, { hand: handOf({ [color]: 1 }) });
    const insufficient = reduce(board, broke, {
      t: 'REPAIR_ROUTE',
      player: p0,
      routeId: route.id,
      payment: { color, colorCount: 2, locomotives: 0 },
    });
    expect(!insufficient.ok && insufficient.error.code).toBe('INSUFFICIENT_CARDS');
  });

  it('repair spends the cards, banks routePoints[carriages], places no trains, ends the turn', () => {
    const { board, state, route } = setupBroken(3, { carriages: 2 });
    const p0 = state.turnOrder[0]!;
    const color = route.color as TrainColor;
    const armed = setPlayer(state, p0, { hand: handOf({ [color]: 3 }) });
    const before = armed.players[p0 as string]!;

    const out = apply(board, armed, {
      t: 'REPAIR_ROUTE',
      player: p0,
      routeId: route.id,
      payment: { color, colorCount: 2, locomotives: 0 },
    });
    const after = out.state.players[p0 as string]!;
    const expectedPoints = armed.ruleParams.routePoints[2] ?? 0;
    expect(expectedPoints).toBeGreaterThan(0);
    expect(after.routePoints).toBe(before.routePoints + expectedPoints);
    expect(after.hand[color]).toBe(1);
    expect(after.trainCars).toBe(before.trainCars);
    // The route stays unowned; the repair record starts its exclusivity window (already ticked
    // once by the repair turn's own end: players + 1 - 1 = players).
    expect(out.state.ownership[route.id as string]).toBeUndefined();
    expect(out.state.brokenRails?.[route.id as string]).toEqual({
      by: p0,
      exclusiveTurnEnds: 3,
    });
    expect(out.state.turn.orderIndex).toBe(1);
    const repaired = out.events.find((e) => e.e === 'BROKEN_RAIL_REPAIRED');
    expect(repaired).toMatchObject({
      player: p0,
      routeId: route.id,
      carriages: 2,
      pointsAwarded: 2,
    });
  });

  it('locomotives are wild and a gray broken rail accepts any single colour', () => {
    const { board, state, route } = setupBroken(3, { carriages: 3, gray: true });
    const p0 = state.turnOrder[0]!;
    const armed = setPlayer(state, p0, { hand: handOf({ BLUE: 2, LOCOMOTIVE: 1 }) });
    const out = apply(board, armed, {
      t: 'REPAIR_ROUTE',
      player: p0,
      routeId: route.id,
      payment: { color: 'BLUE', colorCount: 2, locomotives: 1 },
    });
    expect(out.state.brokenRails?.[route.id as string]?.by).toBe(p0);
    const expectedPoints = armed.ruleParams.routePoints[3] ?? 0;
    expect(out.state.players[p0 as string]!.routePoints).toBe(
      armed.players[p0 as string]!.routePoints + expectedPoints,
    );
  });

  it('a repaired route cannot be repaired again', () => {
    const { board, state, route } = setupBroken(3, { carriages: 2 });
    const [p0, p1] = [state.turnOrder[0]!, state.turnOrder[1]!];
    const color = route.color as TrainColor;
    let s = setPlayer(state, p0, { hand: handOf({ [color]: 2 }) });
    s = setPlayer(s, p1, { hand: handOf({ [color]: 2 }) });
    s = apply(board, s, {
      t: 'REPAIR_ROUTE',
      player: p0,
      routeId: route.id,
      payment: { color, colorCount: 2, locomotives: 0 },
    }).state;
    const again = reduce(board, s, {
      t: 'REPAIR_ROUTE',
      player: p1,
      routeId: route.id,
      payment: { color, colorCount: 2, locomotives: 0 },
    });
    expect(!again.ok && again.error.code).toBe('EVENT_REPAIR_UNAVAILABLE');
  });

  it('the repairer holds exclusive claim rights until their next turn ends, then everyone may claim', () => {
    const { board, state, route, config, log } = setupBroken(3, { carriages: 2 });
    const [p0, p1, p2] = [state.turnOrder[0]!, state.turnOrder[1]!, state.turnOrder[2]!];
    const color = route.color as TrainColor;
    const claimPayment = { color, colorCount: route.length, locomotives: 0 } as const;

    let s = setPlayer(state, p0, { hand: handOf({ [color]: 2 }) });
    s = setPlayer(s, p1, { hand: handOf({ [color]: route.length }) });
    // setPlayer patches are not replayable actions — replay determinism is asserted separately.
    s = apply(board, s, {
      t: 'REPAIR_ROUTE',
      player: p0,
      routeId: route.id,
      payment: { color, colorCount: 2, locomotives: 0 },
    }).state;

    // p1 (next to act) cannot claim during the window…
    const blocked = reduce(board, s, {
      t: 'CLAIM_ROUTE',
      player: p1,
      routeId: route.id,
      payment: claimPayment,
    });
    expect(!blocked.ok && blocked.error.code).toBe('ROUTE_REPAIR_EXCLUSIVE');
    // …and their legal actions offer no claim on that route.
    expect(
      legalActions(board, s, p1).some((a) => a.t === 'CLAIM_ROUTE' && a.routeId === route.id),
    ).toBe(false);

    s = drawTurn(board, s, p1);
    s = drawTurn(board, s, p2);
    expect(s.brokenRails?.[route.id as string]?.exclusiveTurnEnds).toBe(1);

    // Back at the repairer: they may claim the repaired route (normal cost).
    const armedP0 = setPlayer(s, p0, { hand: handOf({ [color]: route.length }) });
    const p0Claims = legalActions(board, armedP0, p0).some(
      (a) => a.t === 'CLAIM_ROUTE' && a.routeId === route.id,
    );
    expect(p0Claims).toBe(true);

    // Instead the repairer draws — the window expires at the end of their turn.
    s = drawTurn(board, s, p0);
    expect(s.brokenRails?.[route.id as string]?.exclusiveTurnEnds).toBe(0);

    const claimed = apply(board, s, {
      t: 'CLAIM_ROUTE',
      player: p1,
      routeId: route.id,
      payment: claimPayment,
    });
    const cell = claimed.state.ownership[route.id as string];
    expect(cell && 'owner' in cell && cell.owner).toBe(p1);
    // Standard claim scoring applies on top of the earlier repair points.
    expect(claimed.events.some((e) => e.e === 'ROUTE_CLAIMED')).toBe(true);
    void config;
    void log;
  });

  it('repair actions replay byte-identically', () => {
    const { board, state, route, config, log } = setupBroken(2, { carriages: 2 });
    const p0 = state.turnOrder[0]!;
    let s = state;
    // Draw until p0 actually holds enough of the route colour, using only replayable actions.
    const color = route.color as TrainColor;
    let guard = 0;
    while (
      (s.players[p0 as string]!.hand[color] ?? 0) + s.players[p0 as string]!.hand.LOCOMOTIVE <
      2
    ) {
      for (const pid of [s.turnOrder[s.turn.orderIndex]!]) {
        s = drawTurn(board, s, pid, log);
      }
      if (++guard > 200) throw new Error('never drew enough cards');
    }
    while (s.turnOrder[s.turn.orderIndex] !== p0) {
      s = drawTurn(board, s, s.turnOrder[s.turn.orderIndex]!, log);
    }
    const hand = s.players[p0 as string]!.hand;
    const colorCount = Math.min(2, hand[color]);
    const action: Action = {
      t: 'REPAIR_ROUTE',
      player: p0,
      routeId: route.id,
      payment: { color: colorCount > 0 ? color : null, colorCount, locomotives: 2 - colorCount },
    };
    s = apply(board, s, action, log).state;
    expect(checkInvariants(board, s)).toEqual([]);

    const replayed = replay(board, config, log);
    expect(stateDigest(replayed.state)).toBe(stateDigest(s));
  });
});
