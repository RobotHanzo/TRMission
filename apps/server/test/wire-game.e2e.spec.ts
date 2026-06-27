import { describe, it, expect, beforeAll } from 'vitest';
import {
  taiwanBoard,
  legalActions,
  replay,
  stateDigest,
  CONTENT_HASH,
  type Board,
  type GameState,
  type Action,
  type GameConfig,
  type PlayerSeed,
} from '@trm/engine';
import { asPlayerId, type PlayerId, type SeatIndex } from '@trm/shared';
import { CardColor, type ServerEnvelope } from '@trm/proto';
import { GameRegistry } from '../src/game/game-registry';
import { GameHub } from '../src/ws/hub';
import { makeDevTicket } from '../src/ws/ticket';
import { actionToCommand, encodeClient, decodeServer } from './helpers';

type ClaimAction = Extract<Action, { t: 'CLAIM_ROUTE' }>;

/**
 * A deterministic driver that prefers claiming the longest affordable NON-TUNNEL route
 * (to drain trains and reach the endgame without the tunnel reveal/commit branch), else
 * draws, else draws tickets, else builds, else passes. Coverage of tunnels and every
 * other mechanic is the engine's own job; here we only need a full game to complete over
 * the wire so we can prove transport + determinism + no information leak.
 */
function pickAction(board: Board, state: GameState, player: PlayerId): Action {
  const legal = legalActions(board, state, player);
  if (legal.length === 0) throw new Error(`no legal action for ${player}`);
  if (state.turn.phase === 'AWAIT_ACTION') {
    const claims = legal.filter(
      (a): a is ClaimAction =>
        a.t === 'CLAIM_ROUTE' && board.routeById.get(a.routeId as string)?.isTunnel !== true,
    );
    if (claims.length > 0) {
      claims.sort((a, b) => {
        const la = board.routeById.get(a.routeId as string)?.length ?? 0;
        const lb = board.routeById.get(b.routeId as string)?.length ?? 0;
        return lb - la || (a.routeId as string).localeCompare(b.routeId as string);
      });
      return claims[0] as Action;
    }
    for (const t of ['DRAW_BLIND', 'DRAW_TICKETS', 'BUILD_STATION', 'PASS'] as const) {
      const hit = legal.find((a) => a.t === t);
      if (hit) return hit;
    }
  }
  return legal[0] as Action;
}

const players: PlayerSeed[] = [
  { id: asPlayerId('p1'), seat: 0 },
  { id: asPlayerId('p2'), seat: 1 },
  { id: asPlayerId('p3'), seat: 2 },
];
const playerIds = players.map((p) => p.id);
const gameId = 'g1';
const config: GameConfig = { seed: 'wire-e2e-1', players, contentHash: CONTENT_HASH };

// Captured per-recipient frames + the live match — populated once by the full run.
const received = new Map<string, ServerEnvelope[]>();
let appliedActions: readonly Action[] = [];
let finalDigest = '';
let finalPhase = '';

beforeAll(async () => {
  const board = taiwanBoard();
  const registry = new GameRegistry();
  const hub = new GameHub(registry);
  const match = hub.createMatch(gameId, board, config);
  const { session } = match;

  const seq = new Map<string, number>();
  for (const p of playerIds) {
    const pid = p as string;
    received.set(pid, []);
    seq.set(pid, 0);
    hub.openConnection(pid, (bytes) => received.get(pid)!.push(decodeServer(bytes)));
  }

  const send = async (
    player: PlayerId,
    command: ReturnType<typeof actionToCommand>,
  ): Promise<void> => {
    const pid = player as string;
    const next = (seq.get(pid) ?? 0) + 1;
    seq.set(pid, next);
    await hub.receive(pid, encodeClient(next, command));
  };

  // Handshake.
  for (const seed of players) {
    await hub.receive(
      seed.id as string,
      encodeClient((seq.get(seed.id as string) ?? 0) + 1, {
        case: 'hello',
        value: {
          ticket: makeDevTicket({ gameId, playerId: seed.id as string, seat: seed.seat }),
          protocolVersion: 1,
        },
      }),
    );
    seq.set(seed.id as string, (seq.get(seed.id as string) ?? 0) + 1);
  }

  // Drive to completion.
  let guard = 0;
  while (session.phase !== 'GAME_OVER') {
    if (++guard > 50_000) throw new Error('game did not terminate');
    const state = session.raw();
    const actor =
      state.turn.phase === 'SETUP_TICKETS'
        ? playerIds.find((p) => session.hasPendingOffer(p))
        : session.currentPlayer;
    if (!actor) throw new Error(`no actor in phase ${state.turn.phase}`);

    const before = session.stateVersion;
    await send(actor, actionToCommand(pickAction(board, state, actor)));
    expect(session.stateVersion).toBe(before + 1); // every accepted action advances the cursor
  }

  appliedActions = session.appliedActions;
  finalDigest = session.digest();
  finalPhase = session.phase;
});

describe('full game over the wire (in-memory)', () => {
  it('reaches GAME_OVER and matches a pure replay digit-for-digit (determinism)', () => {
    expect(finalPhase).toBe('GAME_OVER');
    const rep = replay(taiwanBoard(), config, appliedActions);
    expect(stateDigest(rep.state)).toBe(finalDigest);
  });

  it('delivers each player a final snapshot carrying the scoreboard', () => {
    for (const p of playerIds) {
      const frames = received.get(p as string) ?? [];
      const lastSnap = [...frames].reverse().find((e) => e.event.case === 'snapshot');
      expect(lastSnap, `${p} got a snapshot`).toBeDefined();
      if (lastSnap?.event.case !== 'snapshot') throw new Error('unreachable');
      const snap = lastSnap.event.value.snapshot;
      expect(snap?.phase).toBeDefined();
      expect(snap?.finalScores?.players.length).toBe(players.length);
      expect(snap?.finalScores?.ranking.length).toBeGreaterThan(0);
    }
  });
});

describe('hidden-information leak test (risk #1) — over every captured frame', () => {
  it('never exposes another player’s secrets to a recipient', () => {
    for (const p of playerIds) {
      const pid = p as string;
      for (const env of received.get(pid) ?? []) {
        if (env.event.case === 'snapshot') {
          const snap = env.event.value.snapshot;
          // The private `you` block, if present, is always the recipient's own.
          if (snap?.you) expect(snap.you.playerId).toBe(pid);
          // Opponents' kept tickets are only ever revealed via finalScores at GAME_OVER.
          if (snap && snap.phase !== 6 /* PHASE_GAME_OVER */) {
            expect(snap.finalScores).toBeUndefined();
          }
        } else if (env.event.case === 'events') {
          for (const ev of env.event.value.events) {
            if (
              ev.event.case === 'cardDrawnBlind' &&
              ev.event.value.card !== CardColor.UNSPECIFIED
            ) {
              // A revealed blind-draw card is only ever sent to the player who drew it.
              expect(ev.event.value.playerId).toBe(pid);
            }
            if (ev.event.case === 'initialTicketsOffered' || ev.event.case === 'ticketsOffered') {
              // Private ticket offers are only delivered to their owner.
              expect(ev.event.value.playerId).toBe(pid);
            }
          }
        }
      }
    }
  });
});

describe('idempotency (A7) — a resent command never applies twice', () => {
  it('drops a duplicate client_seq instead of double-applying', async () => {
    const board = taiwanBoard();
    const hub = new GameHub(new GameRegistry());
    const two: PlayerSeed[] = [
      { id: asPlayerId('a'), seat: 0 as SeatIndex },
      { id: asPlayerId('b'), seat: 1 as SeatIndex },
    ];
    const match = hub.createMatch('idem', board, {
      seed: 'idem-1',
      players: two,
      contentHash: CONTENT_HASH,
    });
    const { session } = match;
    for (const seed of two) hub.openConnection(seed.id as string, () => {});

    // Both players hello (seq 1) then keep their initial tickets to start the game.
    for (const seed of two) {
      await hub.receive(
        seed.id as string,
        encodeClient(1, {
          case: 'hello',
          value: {
            ticket: makeDevTicket({ gameId: 'idem', playerId: seed.id as string, seat: seed.seat }),
            protocolVersion: 1,
          },
        }),
      );
    }
    for (const seed of two) {
      const keep = legalActions(board, session.raw(), seed.id)[0] as Action;
      await hub.receive(seed.id as string, encodeClient(2, actionToCommand(keep)));
    }

    expect(session.phase).toBe('AWAIT_ACTION');
    const actor = session.currentPlayer as PlayerId;
    const drawBytes = encodeClient(3, { case: 'drawBlind', value: {} });

    const before = session.stateVersion;
    await hub.receive(actor as string, drawBytes); // applies
    const afterFirst = session.stateVersion;
    await hub.receive(actor as string, drawBytes); // duplicate seq 3 → dropped
    const afterDup = session.stateVersion;

    expect(afterFirst).toBe(before + 1);
    expect(afterDup).toBe(afterFirst);
  });
});
