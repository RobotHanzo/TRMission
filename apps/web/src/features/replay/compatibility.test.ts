import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION } from '@trm/engine';
import { isReplayVersionCompatible } from './compatibility';

describe('replay version compatibility', () => {
  it('accepts engine 9 through engine 11 with the current schema', () => {
    expect(isReplayVersionCompatible(9, SCHEMA_VERSION)).toBe(true);
    expect(isReplayVersionCompatible(10, SCHEMA_VERSION)).toBe(true);
    expect(isReplayVersionCompatible(11, SCHEMA_VERSION)).toBe(true);
  });

  it('still requires an exact schema version', () => {
    expect(isReplayVersionCompatible(9, SCHEMA_VERSION - 1)).toBe(false);
    expect(isReplayVersionCompatible(10, SCHEMA_VERSION + 1)).toBe(false);
  });

  it('rejects engine versions outside the supported replay window', () => {
    expect(isReplayVersionCompatible(8, SCHEMA_VERSION)).toBe(false);
    // v12 (team mode) joined the window: its rules are gated on `GameConfig.teamCount`, which no
    // pre-v12 log can carry, so older logs still replay byte-identically.
    expect(isReplayVersionCompatible(12, SCHEMA_VERSION)).toBe(true);
    expect(isReplayVersionCompatible(13, SCHEMA_VERSION)).toBe(false);
  });
});
