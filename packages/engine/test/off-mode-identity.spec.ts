/**
 * Off-mode identity golden test.
 *
 * The repo is about to gain an opt-in "random events" feature that touches `packages/engine`.
 * When the feature is OFF, engine behavior must stay byte-identical to what it is today. This
 * spec replays a frozen action log through the *current* reducer and asserts the result still
 * matches the frozen final state, so a later milestone can't silently change off-mode behavior.
 *
 * Fixture: packages/engine/test/golden/off-mode.json — a complete 3-player greedy-policy game
 * (seed 'events-off-golden', see helpers.ts `makeConfig`/`playGreedyGame`) played to GAME_OVER
 * and captured from the unmodified engine.
 *
 * Regeneration (only for a deliberate, intentional off-mode behavior change — e.g. a genuine
 * rules fix — NOT for the random-events feature itself, which must leave this fixture untouched
 * when its mode is off): add a temporary spec file under packages/engine/test/ containing
 *
 *   import { playGreedyGame } from './helpers';
 *   import { stateDigest } from '../src/serialize';
 *   import { writeFileSync } from 'node:fs';
 *   const { finalState, log, config } = playGreedyGame(3, 'events-off-golden');
 *   writeFileSync(
 *     new URL('./golden/off-mode.json', import.meta.url),
 *     JSON.stringify({ config, log, finalState, stateDigest: stateDigest(finalState) }, null, 2) + '\n',
 *   );
 *
 * run it once via `yarn workspace @trm/engine test --run <temp-file-name>`, then delete the temp
 * file — no generator script is committed to the tree.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { GameConfig } from '../src/config';
import type { GameState } from '../src/types/state';
import type { Action } from '../src/types/actions';
import { taiwanBoard } from '../src/taiwan';
import { replay, stateDigest } from '../src/serialize';

interface OffModeFixture {
  readonly config: GameConfig;
  readonly log: readonly Action[];
  readonly finalState: GameState;
  /** Informational only — future engine versions are expected to change this. */
  readonly stateDigest: string;
}

const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'golden',
  'off-mode.json',
);
const fixture: OffModeFixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

/**
 * Deep-equality comparison basis, stripped of the fields a future (events-aware) engine version
 * may legitimately change: the top-level `engineVersion`, and a not-yet-existent
 * `ruleParams.eventsMode` (stripped from both sides if present, so this spec keeps passing once
 * the feature lands and defaults to off).
 */
function normalize(state: GameState): unknown {
  const clone = structuredClone(state) as GameState & {
    ruleParams: Record<string, unknown>;
  };
  const { engineVersion: _engineVersion, ruleParams, ...rest } = clone;
  const { eventsMode: _eventsMode, ...restRuleParams } = ruleParams;
  return { ...rest, ruleParams: restRuleParams };
}

describe('off-mode identity (golden, pre-random-events freeze)', () => {
  it('replays the frozen action log byte-identically against the current engine', () => {
    const board = taiwanBoard();
    const replayed = replay(board, fixture.config, fixture.log);
    expect(replayed.state.turn.phase).toBe('GAME_OVER');
    expect(normalize(replayed.state)).toEqual(normalize(fixture.finalState));
  });

  it('fixture is internally consistent (captured digest matches captured state)', () => {
    expect(stateDigest(fixture.finalState)).toBe(fixture.stateDigest);
  });
});
