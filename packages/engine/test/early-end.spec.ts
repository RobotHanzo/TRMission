import { describe, expect, it } from 'vitest';
import { asPlayerId } from '@trm/shared';
import { initGame } from '../src/setup';
import { reduce } from '../src/reduce';
import { replay, stateDigest } from '../src/serialize';
import { checkInvariants } from '../src/invariants';
import type { GameState } from '../src/types/state';
import { makeConfig } from './helpers';

describe('server-authorized early game end', () => {
  it('ends immediately during setup even when the requester is not the current player', () => {
    const { board, config } = makeConfig(3, 'early-end-setup');
    const state = initGame(board, config);
    const requester = config.players[2]!.id;

    const result = reduce(board, state, { t: 'END_GAME', player: requester });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state.turn.phase).toBe('GAME_OVER');
    expect(result.value.state.engineVersion).toBe(12);
    expect(result.value.state.actionSeq).toBe(state.actionSeq + 1);
    expect(result.value.state.finalScores?.players).toHaveLength(3);
    expect(result.value.events).toEqual([{ e: 'GAME_ENDED', visibility: 'PUBLIC' }]);
  });

  it('persists as a deterministic replayable action', () => {
    const { board, config } = makeConfig(2, 'early-end-replay');
    const action = { t: 'END_GAME', player: config.players[1]!.id } as const;
    const direct = reduce(board, initGame(board, config), action);
    expect(direct.ok).toBe(true);
    if (!direct.ok) return;

    const replayed = replay(board, config, [action]);
    expect(stateDigest(replayed.state)).toBe(stateDigest(direct.value.state));
    expect(replayed.events).toEqual(direct.value.events);
  });

  it('upgrades a recovered v9 state before persisting the new action grammar', () => {
    const { board, config } = makeConfig(2, 'early-end-v9-upgrade');
    const legacy = { ...initGame(board, config), engineVersion: 9 };

    const result = reduce(board, legacy, { t: 'END_GAME', player: config.players[0]!.id });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state.engineVersion).toBe(12);
  });

  it('rejects an end action attributed to someone outside the game', () => {
    const { board, config } = makeConfig(2, 'early-end-outsider');
    const result = reduce(board, initGame(board, config), {
      t: 'END_GAME',
      player: asPlayerId('outsider'),
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'NOT_YOUR_TURN' } });
  });

  it('preserves valid transient event state when ending from event-only phases', () => {
    const { board, config } = makeConfig(2, 'early-end-transient', { eventsMode: 'intense' });
    const base = initGame(board, config);
    if (!base.events) throw new Error('events state missing');
    const player = config.players[0]!.id;
    const city = board.cityIds[0]!;
    const hiveCard = base.deck[0]!;
    const transientStates: GameState[] = [
      {
        ...base,
        deck: base.deck.slice(1),
        turn: { ...base.turn, phase: 'HIVE_DRAW' },
        events: {
          ...base.events,
          pendingHiveDraw: { playerId: player, revealed: [hiveCard], maxDraws: 3 },
        },
      },
      {
        ...base,
        turn: { ...base.turn, phase: 'LANTERN_RELOCATION' },
        events: {
          ...base.events,
          lanternPendingRelocation: { playerId: player, candidateCityIds: [city] },
        },
      },
      {
        ...base,
        turn: { ...base.turn, phase: 'EVENT_DRAFT' },
        events: {
          ...base.events,
          eventDraft: {
            eventId: 'early-end-draft',
            order: base.turnOrder,
            pickIndex: 0,
            resumeOrderIndex: base.turn.orderIndex,
            picks: [],
          },
        },
      },
    ];

    for (const transient of transientStates) {
      expect(checkInvariants(board, transient)).toEqual([]);
      const result = reduce(board, transient, { t: 'END_GAME', player });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.value.state.turn.phase).toBe('GAME_OVER');
      expect(checkInvariants(board, result.value.state)).toEqual([]);
    }
  });
});
