import { describe, it, expect } from 'vitest';
import type { CardColor } from '@trm/shared';
import { asPlayerId, asRouteId, asCityId, makeRng, DEFAULT_RULE_PARAMS } from '@trm/shared';
import { taiwanBoard } from '../src/taiwan';
import { buildBoard } from '../src/board';
import type { GameContent } from '@trm/map-data';
import type {
  GameState,
  OwnerCell,
  PendingTunnel,
  Phase,
  StationPlacement,
  PlayerState,
} from '../src/types/state';
import type { Action } from '../src/types/actions';
import { reduce } from '../src/reduce';
import { emptyHand } from '../src/hand';

const board = taiwanBoard();

interface Opts {
  numPlayers?: number;
  hands?: Record<string, Partial<Record<CardColor, number>>>;
  trains?: Record<string, number>;
  stationsRemaining?: Record<string, number>;
  deck?: CardColor[];
  ownership?: Record<string, OwnerCell>;
  stations?: StationPlacement[];
  phase?: Phase;
  orderIndex?: number;
  pendingTunnel?: PendingTunnel | null;
  ruleParams?: typeof DEFAULT_RULE_PARAMS;
}

function st(opts: Opts = {}): GameState {
  const n = opts.numPlayers ?? 2;
  const turnOrder = Array.from({ length: n }, (_, i) => asPlayerId(`p${i}`));
  const players: Record<string, PlayerState> = {};
  turnOrder.forEach((id, i) => {
    players[id as string] = {
      id,
      seat: i as 0 | 1 | 2 | 3 | 4,
      hand: { ...emptyHand(), ...(opts.hands?.[id as string] ?? {}) },
      trainCars: opts.trains?.[id as string] ?? 45,
      stationsRemaining: opts.stationsRemaining?.[id as string] ?? 3,
      keptTickets: [],
      pendingTicketOffer: null,
      routePoints: 0,
      completedTickets: [],
    };
  });
  return {
    schemaVersion: 1,
    engineVersion: 1,
    contentHash: 'test',
    rng: makeRng('rules'),
    ruleParams: opts.ruleParams ?? DEFAULT_RULE_PARAMS,
    turnOrder,
    players,
    turn: {
      orderIndex: opts.orderIndex ?? 0,
      phase: opts.phase ?? 'AWAIT_ACTION',
      cardsDrawnThisTurn: 0,
    },
    deck: opts.deck ?? [],
    discard: emptyHand(),
    market: [null, null, null, null, null],
    ticketDeckLong: [],
    ticketDeckShort: [],
    ownership: opts.ownership ?? {},
    stations: opts.stations ?? [],
    pendingTunnel: opts.pendingTunnel ?? null,
    endgame: { triggered: false, triggerPlayerIndex: -1, finalTurnsRemaining: 0 },
    consecutivePasses: 0,
    finalScores: null,
    actionSeq: 0,
  };
}

const apply = (state: GameState, action: Action) => reduce(board, state, action);
const p0 = asPlayerId('p0');
const p1 = asPlayerId('p1');

describe('double routes', () => {
  it('locks the sibling in a 2-player game', () => {
    // R6/R7 = 臺北–板橋 double pair (WHITE / RED, length 1).
    const state = st({ numPlayers: 2, hands: { p0: { WHITE: 1 } } });
    const res = apply(state, {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: asRouteId('R6'),
      payment: { color: 'WHITE', colorCount: 1, locomotives: 0 },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.state.ownership['R6']).toEqual({ owner: p0 });
    expect(res.value.state.ownership['R7']).toEqual({ locked: true });
  });

  it('does NOT lock the sibling in a 4-player game; the other edge stays claimable', () => {
    const state = st({ numPlayers: 4, hands: { p0: { WHITE: 1 }, p1: { RED: 1 } } });
    const r1 = apply(state, {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: asRouteId('R6'),
      payment: { color: 'WHITE', colorCount: 1, locomotives: 0 },
    });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.value.state.ownership['R7']).toBeUndefined();
    // Now p1 (next turn) claims the parallel R7.
    const r2 = apply(r1.value.state, {
      t: 'CLAIM_ROUTE',
      player: p1,
      routeId: asRouteId('R7'),
      payment: { color: 'RED', colorCount: 1, locomotives: 0 },
    });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.value.state.ownership['R7']).toEqual({ owner: p1 });
  });

  it('rejects claiming both edges of a pair', () => {
    const owned: Record<string, OwnerCell> = { R6: { owner: p0 } };
    const state = st({ numPlayers: 4, hands: { p0: { RED: 1 } }, ownership: owned });
    const res = apply(state, {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: asRouteId('R7'),
      payment: { color: 'RED', colorCount: 1, locomotives: 0 },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('DOUBLE_ROUTE_OWN_BOTH');
  });

  it('does NOT lock the sibling in a 2-player game when doubleRouteSingleFor23 is off', () => {
    // Same pair as the first test (R6/R7), but with the rule variant disabled.
    const state = st({
      numPlayers: 2,
      hands: { p0: { WHITE: 1 }, p1: { RED: 1 } },
      ruleParams: { ...DEFAULT_RULE_PARAMS, doubleRouteSingleFor23: false },
    });
    const r1 = apply(state, {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: asRouteId('R6'),
      payment: { color: 'WHITE', colorCount: 1, locomotives: 0 },
    });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    // Sibling should remain open (not locked).
    expect(r1.value.state.ownership['R7']).toBeUndefined();
    // p1 can now claim the parallel route.
    const r2 = apply(r1.value.state, {
      t: 'CLAIM_ROUTE',
      player: p1,
      routeId: asRouteId('R7'),
      payment: { color: 'RED', colorCount: 1, locomotives: 0 },
    });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.value.state.ownership['R7']).toEqual({ owner: p1 });
  });
});

describe('ferries', () => {
  it('claims a ferry with the required locomotives', () => {
    // R88 = 臺東–綠島, GRAY length 2, Ferry(1).
    const state = st({ hands: { p0: { RED: 1, LOCOMOTIVE: 1 } } });
    const res = apply(state, {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: asRouteId('R88'),
      payment: { color: 'RED', colorCount: 1, locomotives: 1 },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.state.ownership['R88']).toEqual({ owner: p0 });
  });

  it('rejects a ferry payment without enough locomotives', () => {
    const state = st({ hands: { p0: { RED: 2 } } });
    const res = apply(state, {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: asRouteId('R88'),
      payment: { color: 'RED', colorCount: 2, locomotives: 0 },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('FERRY_LOCOS_SHORT');
  });
});

describe('double-ferry routes', () => {
  // A small custom board with a double-route pair where BOTH members are ferries, with
  // different locomotive counts — proves doubleGroup (sibling lock) and ferryLocos (payment)
  // stay fully independent even on the same pair. taiwanBoard() has no such route by the
  // bundled map's own convention, so this content is purpose-built.
  const doubleFerryContent: GameContent = {
    meta: { mapId: 'test-double-ferry', version: 1, nameZh: '雙渡輪測試', nameEn: 'Double Ferry Test' },
    cities: [
      { id: asCityId('x1'), nameZh: '甲', nameEn: 'X1', x: 0, y: 0, region: 'test', isIsland: false },
      { id: asCityId('x2'), nameZh: '乙', nameEn: 'X2', x: 10, y: 0, region: 'test', isIsland: false },
    ],
    routes: [
      {
        id: asRouteId('DF1'),
        a: asCityId('x1'),
        b: asCityId('x2'),
        color: 'GRAY',
        length: 2,
        ferryLocos: 1,
        isTunnel: false,
        doubleGroup: 'A',
      },
      {
        id: asRouteId('DF2'),
        a: asCityId('x1'),
        b: asCityId('x2'),
        color: 'GRAY',
        length: 2,
        ferryLocos: 2,
        isTunnel: false,
        doubleGroup: 'A',
      },
    ],
    tickets: [],
  };
  const doubleFerryBoard = buildBoard(doubleFerryContent);
  const apply2 = (state: GameState, action: Action) => reduce(doubleFerryBoard, state, action);

  it('locks the ferry sibling in a 2-player game, exactly like a non-ferry double route', () => {
    const state = st({ numPlayers: 2, hands: { p0: { RED: 1, LOCOMOTIVE: 1 } } });
    const res = apply2(state, {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: asRouteId('DF1'),
      payment: { color: 'RED', colorCount: 1, locomotives: 1 },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.state.ownership['DF1']).toEqual({ owner: p0 });
    expect(res.value.state.ownership['DF2']).toEqual({ locked: true });
  });

  it("keeps each side's locomotive requirement independent", () => {
    const state = st({
      numPlayers: 4,
      hands: { p0: { RED: 1, LOCOMOTIVE: 1 }, p1: { BLUE: 1, LOCOMOTIVE: 2 } },
    });
    const r1 = apply2(state, {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: asRouteId('DF1'),
      payment: { color: 'RED', colorCount: 1, locomotives: 1 },
    });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.value.state.ownership['DF2']).toBeUndefined(); // 4p: no sibling lock

    const underpaid = apply2(r1.value.state, {
      t: 'CLAIM_ROUTE',
      player: p1,
      routeId: asRouteId('DF2'),
      payment: { color: 'BLUE', colorCount: 1, locomotives: 1 },
    });
    expect(underpaid.ok).toBe(false);
    if (underpaid.ok) return;
    expect(underpaid.error.code).toBe('FERRY_LOCOS_SHORT'); // DF2 needs 2 locos, not 1

    const r2 = apply2(r1.value.state, {
      t: 'CLAIM_ROUTE',
      player: p1,
      routeId: asRouteId('DF2'),
      payment: { color: null, colorCount: 0, locomotives: 2 },
    });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.value.state.ownership['DF2']).toEqual({ owner: p1 });
  });
});

describe('tunnels', () => {
  // R20 = 苗栗–豐原, BLUE length 2, tunnel. deck top three = BLUE,RED,GREEN → 1 BLUE match.
  const tunnelStart = () =>
    st({ hands: { p0: { BLUE: 4, LOCOMOTIVE: 2 } }, deck: ['GREEN', 'RED', 'BLUE'] });

  it('reveals top-3 and computes the surcharge', () => {
    const res = apply(tunnelStart(), {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: asRouteId('R20'),
      payment: { color: 'BLUE', colorCount: 2, locomotives: 0 },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.state.turn.phase).toBe('TUNNEL_PENDING');
    expect(res.value.state.pendingTunnel?.extraRequired).toBe(1);
  });

  it('commits by paying the surcharge', () => {
    const r1 = apply(tunnelStart(), {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: asRouteId('R20'),
      payment: { color: 'BLUE', colorCount: 2, locomotives: 0 },
    });
    if (!r1.ok) throw new Error('lay failed');
    const r2 = apply(r1.value.state, {
      t: 'RESOLVE_TUNNEL',
      player: p0,
      commit: true,
      extra: { color: 'BLUE', colorCount: 1, locomotives: 0 },
    });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.value.state.ownership['R20']).toEqual({ owner: p0 });
    expect(r2.value.state.players['p0']!.hand.BLUE).toBe(1); // 4 - 2 base - 1 surcharge
    expect(r2.value.state.turn.phase).toBe('AWAIT_ACTION');
  });

  it('aborts, spending nothing and ending the turn', () => {
    const r1 = apply(tunnelStart(), {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: asRouteId('R20'),
      payment: { color: 'BLUE', colorCount: 2, locomotives: 0 },
    });
    if (!r1.ok) throw new Error('lay failed');
    const r2 = apply(r1.value.state, { t: 'RESOLVE_TUNNEL', player: p0, commit: false });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.value.state.ownership['R20']).toBeUndefined();
    expect(r2.value.state.players['p0']!.hand.BLUE).toBe(4); // nothing spent
    expect(r2.value.state.discard.BLUE).toBe(1); // revealed cards discarded
  });
});

describe('stations', () => {
  it('first station costs one card', () => {
    const state = st({ hands: { p0: { RED: 1 } } });
    const res = apply(state, {
      t: 'BUILD_STATION',
      player: p0,
      cityId: asCityId('taipei'),
      payment: { color: 'RED', colorCount: 1, locomotives: 0 },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.state.players['p0']!.stationsRemaining).toBe(2);
    expect(res.value.state.stations).toContainEqual({ playerId: p0, cityId: asCityId('taipei') });
  });

  it('second station costs two of one colour', () => {
    const state = st({ hands: { p0: { RED: 2 } }, stationsRemaining: { p0: 2 } });
    const tooFew = apply(state, {
      t: 'BUILD_STATION',
      player: p0,
      cityId: asCityId('taipei'),
      payment: { color: 'RED', colorCount: 1, locomotives: 0 },
    });
    expect(tooFew.ok).toBe(false);
    const ok = apply(state, {
      t: 'BUILD_STATION',
      player: p0,
      cityId: asCityId('taipei'),
      payment: { color: 'RED', colorCount: 2, locomotives: 0 },
    });
    expect(ok.ok).toBe(true);
  });

  it('rejects a city that already has a station', () => {
    const state = st({
      hands: { p0: { RED: 1 } },
      stations: [{ playerId: p1, cityId: asCityId('taipei') }],
    });
    const res = apply(state, {
      t: 'BUILD_STATION',
      player: p0,
      cityId: asCityId('taipei'),
      payment: { color: 'RED', colorCount: 1, locomotives: 0 },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('STATION_CITY_TAKEN');
  });
});

describe('turn enforcement', () => {
  it('rejects acting out of turn', () => {
    const state = st({ numPlayers: 2, hands: { p1: { WHITE: 1 } } });
    const res = apply(state, {
      t: 'CLAIM_ROUTE',
      player: p1,
      routeId: asRouteId('R6'),
      payment: { color: 'WHITE', colorCount: 1, locomotives: 0 },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('NOT_YOUR_TURN');
  });
});
