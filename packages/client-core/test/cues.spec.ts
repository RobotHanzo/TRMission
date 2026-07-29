import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { CUES, ALL_CUES, OPPONENT_GAIN, type Cue } from '../src/sound/cues';

const SOUNDS_DIR = fileURLToPath(new URL('../assets/sounds', import.meta.url));

describe('cue catalog', () => {
  it('defines all 15 cues with sane gains', () => {
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
      'railRepaired',
      'eventStart',
      'chatMessage',
      'countdownWarning',
      'countdownLapsed',
    ];
    expect([...ALL_CUES].sort()).toEqual([...expected].sort());
    for (const cue of expected) {
      expect(CUES[cue].file).toMatch(/^[a-z-]+\.mp3$/);
      expect(CUES[cue].gain).toBeGreaterThan(0);
      expect(CUES[cue].gain).toBeLessThanOrEqual(1);
      expect(CUES[cue].throttleMs).toBeGreaterThanOrEqual(0);
    }
  });

  // Both apps bind their asset imports to these file names (a Vite-emitted URL on web, a Metro
  // asset id on mobile), and a bad name fails at BUNDLE time — on one platform, possibly not both.
  it('binds every cue to a file in the shared assets folder, with none left orphaned', () => {
    const onDisk = new Set(readdirSync(SOUNDS_DIR).filter((f) => f.endsWith('.mp3')));
    const used = new Set(ALL_CUES.map((cue) => CUES[cue].file));
    expect([...used].filter((f) => !onDisk.has(f))).toEqual([]);
    expect([...onDisk].filter((f) => !used.has(f))).toEqual([]);
  });

  it('attenuates opponent cues', () => {
    expect(OPPONENT_GAIN).toBeGreaterThan(0);
    expect(OPPONENT_GAIN).toBeLessThan(1);
  });
});
