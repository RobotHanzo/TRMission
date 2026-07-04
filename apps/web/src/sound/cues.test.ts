import { describe, it, expect } from 'vitest';
import { CUES, ALL_CUES, OPPONENT_GAIN, type Cue } from './cues';

describe('cue catalog', () => {
  it('defines all 12 cues with /sounds/*.mp3 sources and sane gains', () => {
    const expected: Cue[] = [
      'cardDraw',
      'yourTurn',
      'tunnelDraw',
      'tunnelSuccess',
      'tunnelPayment',
      'missionComplete',
      'gameOverWin',
      'gameOverNormal',
      'stationBuilt',
      'railwayBuilt',
      'eventStart',
      'chatMessage',
    ];
    expect([...ALL_CUES].sort()).toEqual([...expected].sort());
    for (const cue of expected) {
      expect(CUES[cue].src).toMatch(/^\/sounds\/.+\.mp3$/);
      expect(CUES[cue].gain).toBeGreaterThan(0);
      expect(CUES[cue].gain).toBeLessThanOrEqual(1);
      expect(CUES[cue].throttleMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('attenuates opponent cues', () => {
    expect(OPPONENT_GAIN).toBeGreaterThan(0);
    expect(OPPONENT_GAIN).toBeLessThan(1);
  });
});
