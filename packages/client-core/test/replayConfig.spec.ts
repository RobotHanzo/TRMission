import { describe, it, expect } from 'vitest';
import { initGame, taiwanBoard, stateDigest, CONTENT_HASH } from '@trm/engine';
import type { ReplayPayload } from '../src/net/restTypes';
import { replayGameConfig } from '../src/replay/config';

const board = taiwanBoard();
const payloadConfig = (extra: Partial<ReplayPayload['config']> = {}): ReplayPayload['config'] => ({
  seed: 'cfg-1',
  players: [0, 1, 2, 3].map((seat) => ({ id: `p${seat}`, seat })),
  contentHash: CONTENT_HASH,
  shuffleTurnOrder: true,
  ...extra,
});

describe('replayGameConfig', () => {
  it('carries teamCount, so a team log replays against a team genesis (issue #75)', () => {
    const config = replayGameConfig(payloadConfig({ teamCount: 2 }));
    expect(config.teamCount).toBe(2);

    const state = initGame(board, config);
    expect(state.teams).toHaveLength(2);
    // The genesis a free-for-all rebuild would have produced: a different deck entirely, which
    // is why every recorded action of a team game was rejected.
    expect(stateDigest(state)).not.toBe(
      stateDigest(initGame(board, replayGameConfig(payloadConfig()))),
    );
  });

  it('treats an absent or zero teamCount as a free-for-all', () => {
    expect(replayGameConfig(payloadConfig()).teamCount).toBeUndefined();
    // 0 is the server's lobby spelling of "no teams"; passing it through would make the engine
    // derive membership as `seat % 0`.
    expect(replayGameConfig(payloadConfig({ teamCount: 0 })).teamCount).toBeUndefined();
    expect(
      initGame(board, replayGameConfig(payloadConfig({ teamCount: 0 }))).teams,
    ).toBeUndefined();
  });

  it('carries every other genesis-affecting key', () => {
    const config = replayGameConfig(
      payloadConfig({ wideSeed: true, ruleParams: { handStart: 5 }, shuffleTurnOrder: false }),
    );
    expect(config.wideSeed).toBe(true);
    expect(config.shuffleTurnOrder).toBe(false);
    expect(config.ruleParams).toEqual({ handStart: 5 });
    expect(config.players.map((p) => p.seat)).toEqual([0, 1, 2, 3]);
    expect(config.contentHash).toBe(CONTENT_HASH);
  });
});
