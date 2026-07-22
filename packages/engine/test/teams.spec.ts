import { describe, it, expect } from 'vitest';
import {
  asPlayerId,
  TEAM_POOL_CAPACITY,
  type SeatIndex,
  type PlayerId,
  type CardColor,
} from '@trm/shared';
import { taiwanBoard, CONTENT_HASH } from '../src/taiwan';
import type { Board } from '../src/board';
import type { GameConfig } from '../src/config';
import type { GameState, PlayerState } from '../src/types/state';
import { initGame } from '../src/setup';
import { reduce } from '../src/reduce';
import { legalActions, redactFor } from '../src/selectors';
import { stateDigest, replay } from '../src/serialize';
import { computeFinalScores } from '../src/scoring';
import { emptyHand } from '../src/hand';
import { checkInvariants } from '../src/invariants';
import { hasAnyLegalMove } from '../src/legality';
import { teamOf, teammates, sameTeam } from '../src/teams';
import { playGreedyGame, makeConfig } from './helpers';

function cfg(
  numPlayers: number,
  teamCount: number | undefined,
  seed = 'teams',
): { board: Board; config: GameConfig } {
  const board = taiwanBoard();
  const players = Array.from({ length: numPlayers }, (_, i) => ({
    id: asPlayerId(`p${i}`),
    seat: i as SeatIndex,
  }));
  return {
    board,
    config: {
      seed,
      players,
      contentHash: CONTENT_HASH,
      ...(teamCount !== undefined ? { teamCount } : {}),
    },
  };
}

/** Put the game into AWAIT_ACTION with `actor` to move, past the setup ticket phase. */
function readyState(state: GameState, actor: PlayerId): GameState {
  const players: Record<string, PlayerState> = {};
  for (const [id, p] of Object.entries(state.players)) {
    players[id] = { ...p, pendingTicketOffer: null };
  }
  return {
    ...state,
    players,
    turn: {
      orderIndex: state.turnOrder.indexOf(actor),
      phase: 'AWAIT_ACTION',
      cardsDrawnThisTurn: 0,
    },
  };
}

/**
 * Move `n` cards of `color` from the deck into a player's hand. Goes through the deck rather than
 * conjuring cards so the state still satisfies the conservation invariant — hand-stuffing would
 * make `checkInvariants` fail for reasons that have nothing to do with the rule under test.
 */
function grantFromDeck(state: GameState, player: PlayerId, color: CardColor, n: number): GameState {
  const deck = [...state.deck];
  let moved = 0;
  for (let i = deck.length - 1; i >= 0 && moved < n; i--) {
    if (deck[i] === color) {
      deck.splice(i, 1);
      moved++;
    }
  }
  if (moved < n) throw new Error(`deck only had ${moved} ${color} cards, needed ${n}`);
  const p = state.players[player as string] as PlayerState;
  return {
    ...state,
    deck,
    players: {
      ...state.players,
      [player as string]: { ...p, hand: { ...p.hand, [color]: p.hand[color] + n } },
    },
  };
}

describe('team mode — composition & seating', () => {
  it.each([
    [
      4,
      2,
      [
        ['p0', 'p2'],
        ['p1', 'p3'],
      ],
    ],
    [
      6,
      3,
      [
        ['p0', 'p3'],
        ['p1', 'p4'],
        ['p2', 'p5'],
      ],
    ],
    [
      6,
      2,
      [
        ['p0', 'p2', 'p4'],
        ['p1', 'p3', 'p5'],
      ],
    ],
  ])('seats %ip into %i teams by seat %% teamCount', (n, teamCount, expected) => {
    const { board, config } = cfg(n, teamCount);
    const state = initGame(board, config);
    expect(state.teams).toEqual(expected);
  });

  it('keeps turn order alternating between teams under the genesis shuffle', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const { board, config } = cfg(6, 3, seed);
      const state = initGame(board, { ...config, shuffleTurnOrder: true });
      const teamsInOrder = state.turnOrder.map((id) => teamOf(state, id));
      // Consecutive players are never on the same side (wrapping included).
      for (let i = 0; i < teamsInOrder.length; i++) {
        const next = teamsInOrder[(i + 1) % teamsInOrder.length];
        expect(teamsInOrder[i]).not.toBe(next);
      }
    }
  });

  it('a free-for-all game carries NO team keys at all (pre-v12 digest identity)', () => {
    const { board, config } = cfg(3, undefined);
    const state = initGame(board, config);
    expect('teams' in state).toBe(false);
    expect('teamPools' in state).toBe(false);
    expect(teamOf(state, asPlayerId('p0'))).toBeNull();
    expect(teammates(state, asPlayerId('p0'))).toEqual([asPlayerId('p0')]);
  });

  it('starts every team pool empty', () => {
    const { board, config } = cfg(4, 2);
    const state = initGame(board, config);
    expect(state.teamPools).toHaveLength(2);
    for (const pool of state.teamPools ?? []) {
      expect(Object.values(pool).every((n) => n === 0)).toBe(true);
    }
  });
});

describe('team mode — shared network', () => {
  /** Give `owner` a route and check whether `viewer`'s ticket on those endpoints locks. */
  function completionFor(teamCount: number | undefined) {
    const { board, config } = cfg(4, teamCount);
    let state = initGame(board, config);
    // Shortest simple route, so the locomotive payment fits inside the real deck supply.
    const route = board.content.routes
      .filter((r) => !r.isTunnel && r.ferryLocos === 0 && r.doubleGroup === undefined)
      .sort((a, b) => a.length - b.length)[0];
    if (!route) throw new Error('no simple route on the map');
    const ticket = board.content.tickets.find(
      (t) => (t.a === route.a && t.b === route.b) || (t.a === route.b && t.b === route.a),
    );
    // p0 holds the ticket; p2 (p0's partner when teamCount === 2) will claim the route.
    const p0 = asPlayerId('p0');
    const p2 = asPlayerId('p2');
    state = readyState(state, p2);
    state = grantFromDeck(state, p2, 'LOCOMOTIVE', route.length);
    state = {
      ...state,
      players: {
        ...state.players,
        [p0 as string]: {
          ...(state.players[p0 as string] as PlayerState),
          keptTickets: ticket ? [ticket.id] : [],
        },
      },
    };
    const res = reduce(board, state, {
      t: 'CLAIM_ROUTE',
      player: p2,
      routeId: route.id,
      payment: { color: null, colorCount: 0, locomotives: route.length },
    });
    if (!res.ok) throw new Error(`claim rejected: ${res.error.code}`);
    return {
      hasTicket: ticket !== undefined,
      locked: res.value.state.players[p0 as string]?.completedTickets ?? [],
      events: res.value.events,
    };
  }

  it("a partner's claim completes your ticket", () => {
    const out = completionFor(2);
    if (!out.hasTicket) return; // map has no ticket on a single simple route — nothing to assert
    expect(out.locked).toHaveLength(1);
    expect(out.events.some((e) => e.e === 'TICKET_COMPLETED')).toBe(true);
  });

  it("an opponent's identical claim does NOT complete it in a free-for-all", () => {
    const out = completionFor(undefined);
    if (!out.hasTicket) return;
    expect(out.locked).toHaveLength(0);
  });

  it('scores the longest trail over the combined team network, awarding the bonus once', () => {
    const { board, config } = cfg(4, 2);
    let state = initGame(board, config);
    // Give p0 and p2 (partners) one route each, on opposite sides of the map so their trails are
    // disjoint; a per-player trail would be short, the combined one is the sum.
    const simple = board.content.routes.filter(
      (r) => !r.isTunnel && r.ferryLocos === 0 && r.doubleGroup === undefined,
    );
    const r1 = simple[0];
    const r2 = simple.find((r) => r.a !== r1?.a && r.b !== r1?.b && r.a !== r1?.b && r.b !== r1?.a);
    if (!r1 || !r2) throw new Error('need two disjoint simple routes');
    state = {
      ...state,
      ownership: {
        [r1.id as string]: { owner: asPlayerId('p0') },
        [r2.id as string]: { owner: asPlayerId('p2') },
      },
    };
    const finals = computeFinalScores(board, state);
    expect(finals.teams).toHaveLength(2);
    const teamA = finals.teams?.find((t) => t.team === 0);
    // Both members report the SAME combined length...
    const p0 = finals.players.find((p) => p.playerId === asPlayerId('p0'));
    const p2 = finals.players.find((p) => p.playerId === asPlayerId('p2'));
    expect(p0?.longestTrailLength).toBe(p2?.longestTrailLength);
    expect(teamA?.longestTrailLength).toBe(p0?.longestTrailLength);
    // ...and the 10-point bonus is on the TEAM row, never doubled across the members.
    expect(p0?.longestBonus).toBe(0);
    expect(p2?.longestBonus).toBe(0);
    expect(teamA?.longestBonus).toBe(state.ruleParams.longestPathBonus);
    expect(finals.teamRanking?.flat().sort()).toEqual([0, 1]);
  });
});

describe('team mode — card pool', () => {
  function poolGame() {
    const { board, config } = cfg(4, 2);
    let state = readyState(initGame(board, config), asPlayerId('p0'));
    state = grantFromDeck(state, asPlayerId('p0'), 'LOCOMOTIVE', 2);
    return { board, state };
  }

  it('pushes one card from hand into the team pool as a free action', () => {
    const { board, state } = poolGame();
    const before = state.players['p0']?.hand.LOCOMOTIVE ?? 0;
    const res = reduce(board, state, {
      t: 'PUSH_TO_TEAM_POOL',
      player: asPlayerId('p0'),
      color: 'LOCOMOTIVE',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.state.teamPools?.[0]?.LOCOMOTIVE).toBe(1);
    expect(res.value.state.players['p0']?.hand.LOCOMOTIVE).toBe(before - 1);
    // Free: still the same player's turn, still AWAIT_ACTION.
    expect(res.value.state.turn.phase).toBe('AWAIT_ACTION');
    expect(res.value.state.turn.orderIndex).toBe(state.turn.orderIndex);
    expect(res.value.state.turn.teamPushUsed).toBe(true);
    expect(checkInvariants(board, res.value.state)).toEqual([]);
  });

  it('allows only one push per turn', () => {
    const { board, state } = poolGame();
    const first = reduce(board, state, {
      t: 'PUSH_TO_TEAM_POOL',
      player: asPlayerId('p0'),
      color: 'LOCOMOTIVE',
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = reduce(board, first.value.state, {
      t: 'PUSH_TO_TEAM_POOL',
      player: asPlayerId('p0'),
      color: 'LOCOMOTIVE',
    });
    expect(second.ok).toBe(false);
    expect(
      legalActions(board, first.value.state, asPlayerId('p0')).some(
        (a) => a.t === 'PUSH_TO_TEAM_POOL',
      ),
    ).toBe(false);
  });

  it('refuses to push into a full pool', () => {
    const { board, state } = poolGame();
    const full = {
      ...state,
      teamPools: [{ ...emptyHand(), RED: TEAM_POOL_CAPACITY }, emptyHand()],
    };
    const res = reduce(board, full, {
      t: 'PUSH_TO_TEAM_POOL',
      player: asPlayerId('p0'),
      color: 'LOCOMOTIVE',
    });
    expect(res.ok).toBe(false);
  });

  it('taking from the pool consumes a draw and moves the card to hand', () => {
    const { board, state } = poolGame();
    // Source the pool cards from the deck so conservation still holds.
    const moved = grantFromDeck(state, asPlayerId('p0'), 'RED', 2);
    const p0Hand = moved.players['p0']?.hand as PlayerState['hand'];
    const stocked: GameState = {
      ...moved,
      players: {
        ...moved.players,
        p0: { ...(moved.players['p0'] as PlayerState), hand: { ...p0Hand, RED: p0Hand.RED - 2 } },
      },
      teamPools: [{ ...emptyHand(), RED: 2 }, emptyHand()],
    };
    const before = stocked.players['p0']?.hand.RED ?? 0;
    const res = reduce(board, stocked, {
      t: 'TAKE_FROM_TEAM_POOL',
      player: asPlayerId('p0'),
      color: 'RED',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.state.teamPools?.[0]?.RED).toBe(1);
    expect(res.value.state.players['p0']?.hand.RED).toBe(before + 1);
    // It was a DRAW: the turn moved into the draw phase rather than staying open.
    expect(res.value.state.turn.phase).toBe('DRAWING_CARDS');
    expect(res.value.state.turn.cardsDrawnThisTurn).toBe(1);
    expect(checkInvariants(board, res.value.state)).toEqual([]);
  });

  it('refuses a locomotive from the pool as the second draw (mirrors the face-up rule)', () => {
    const { board, state } = poolGame();
    const stocked: GameState = {
      ...state,
      teamPools: [{ ...emptyHand(), LOCOMOTIVE: 1 }, emptyHand()],
      turn: { ...state.turn, phase: 'DRAWING_CARDS', cardsDrawnThisTurn: 1 },
    };
    const res = reduce(board, stocked, {
      t: 'TAKE_FROM_TEAM_POOL',
      player: asPlayerId('p0'),
      color: 'LOCOMOTIVE',
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('FACEUP_LOCO_SECOND_DRAW');
  });

  it("cannot touch another team's pool", () => {
    const { board, state } = poolGame();
    const stocked = { ...state, teamPools: [emptyHand(), { ...emptyHand(), RED: 3 }] };
    // p0 is on team 0; team 1's pool holds the RED cards, so this must fail.
    const res = reduce(board, stocked, {
      t: 'TAKE_FROM_TEAM_POOL',
      player: asPlayerId('p0'),
      color: 'RED',
    });
    expect(res.ok).toBe(false);
  });

  it('pushing never rescues a stuck player from having to PASS (A15)', () => {
    const { board, config } = cfg(4, 2);
    let state = readyState(initGame(board, config), asPlayerId('p0'));
    // Dead pool, no stations, and NO TRAINS — so no route is claimable whatever the hand holds —
    // but cards still in hand, which is exactly the state where a pushable card must not count.
    state = {
      ...state,
      deck: [],
      discard: emptyHand(),
      market: [null, null, null, null, null],
      teamPools: [emptyHand(), emptyHand()],
      players: Object.fromEntries(
        Object.entries(state.players).map(([id, p]) => [
          id,
          { ...p, stationsRemaining: 0, trainCars: 0 },
        ]),
      ),
    };
    const handSize = Object.values(state.players['p0']?.hand ?? {}).reduce((a, b) => a + b, 0);
    expect(handSize).toBeGreaterThan(0);
    expect(hasAnyLegalMove(board, state, asPlayerId('p0'))).toBe(false);
    // The push is still offered as a free action...
    const acts = legalActions(board, state, asPlayerId('p0'));
    expect(acts.some((a) => a.t === 'PUSH_TO_TEAM_POOL')).toBe(true);
    // ...and PASS remains legal, which is what the termination guarantee needs.
    expect(acts.some((a) => a.t === 'PASS')).toBe(true);
  });

  it('a stocked pool DOES count as a legal move (taking is productive)', () => {
    const { board, config } = cfg(4, 2);
    let state = readyState(initGame(board, config), asPlayerId('p0'));
    state = {
      ...state,
      deck: [],
      discard: emptyHand(),
      market: [null, null, null, null, null],
      teamPools: [{ ...emptyHand(), RED: 1 }, emptyHand()],
      players: Object.fromEntries(
        Object.entries(state.players).map(([id, p]) => [
          id,
          { ...p, hand: emptyHand(), stationsRemaining: 0 },
        ]),
      ),
    };
    expect(hasAnyLegalMove(board, state, asPlayerId('p0'))).toBe(true);
  });
});

describe('team mode — redaction', () => {
  it("reveals a teammate's tickets but never their hand", () => {
    const { board, config } = cfg(4, 2);
    const state = initGame(board, config);
    const view = redactFor(board, state, asPlayerId('p0'));
    const partner = view.players.find((p) => p.id === asPlayerId('p2'));
    const opponent = view.players.find((p) => p.id === asPlayerId('p1'));

    expect(sameTeam(state, asPlayerId('p0'), asPlayerId('p2'))).toBe(true);
    // Tickets: shared with the partner, hidden from the opponent.
    expect(partner?.keptTickets).not.toBeNull();
    expect(opponent?.keptTickets).toBeNull();
    // Hand: hidden from BOTH — the pool is the only card channel.
    expect(partner?.hand).toBeNull();
    expect(opponent?.hand).toBeNull();
    // Team ids are published so clients can colour the table.
    expect(partner?.team).toBe(0);
    expect(opponent?.team).toBe(1);
  });

  it('publishes the pools and capacity to every viewer, including spectators', () => {
    const { board, config } = cfg(4, 2);
    const state: GameState = {
      ...initGame(board, config),
      teamPools: [{ ...emptyHand(), RED: 2 }, emptyHand()],
    };
    for (const viewer of [asPlayerId('p0'), asPlayerId('p1'), null]) {
      const view = redactFor(board, state, viewer);
      expect(view.teams?.pools[0]?.RED).toBe(2);
      expect(view.teams?.capacity).toBe(TEAM_POOL_CAPACITY);
      expect(view.teams?.rosters).toEqual([
        [asPlayerId('p0'), asPlayerId('p2')],
        [asPlayerId('p1'), asPlayerId('p3')],
      ]);
      expect(view.settings.teamCount).toBe(2);
    }
  });

  it('omits the whole team block in a free-for-all', () => {
    const { board, config } = cfg(3, undefined);
    const view = redactFor(board, initGame(board, config), asPlayerId('p0'));
    expect(view.teams).toBeUndefined();
    expect(view.settings.teamCount).toBe(0);
    expect(view.players.every((p) => p.team === null)).toBe(true);
  });
});

describe('team mode — determinism', () => {
  it.each([
    [4, 2],
    [6, 3],
    [6, 2],
  ])('replays a %ip/%i-team game byte-identically', (n, teamCount) => {
    const played = playGreedyGame(n, `team-replay-${n}-${teamCount}`, { teamCount });
    const { board, config } = makeConfig(n, `team-replay-${n}-${teamCount}`, undefined, teamCount);
    const again = replay(board, config, played.log);
    expect(stateDigest(again.state)).toBe(stateDigest(played.finalState));
  });

  it('plays a full 4p team game to GAME_OVER with a team scoreboard', () => {
    const played = playGreedyGame(4, 'team-full', { teamCount: 2 });
    expect(played.finalState.turn.phase).toBe('GAME_OVER');
    const finals = played.finalState.finalScores;
    expect(finals?.teams).toHaveLength(2);
    expect(finals?.teamRanking?.flat().sort()).toEqual([0, 1]);
    // Every team total accounts for its members' route points.
    for (const team of finals?.teams ?? []) {
      const memberRoutePoints = team.members.reduce(
        (acc, id) => acc + (finals?.players.find((p) => p.playerId === id)?.routePoints ?? 0),
        0,
      );
      expect(team.routePoints).toBe(memberRoutePoints);
    }
    expect(checkInvariants(played.board, played.finalState)).toEqual([]);
  });
});
