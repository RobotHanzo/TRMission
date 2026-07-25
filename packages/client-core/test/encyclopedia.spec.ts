import { describe, it, expect } from 'vitest';
import { asPlayerId } from '@trm/shared';
import { demoGate } from '../src/tutorial/encyclopedia';
import { encyclopediaEntries } from '../src/tutorial/curriculum';
import { gateAllowsTarget, gateFlags, type Beat } from '../src/tutorial/types';

describe('demoGate', () => {
  it('locks narration, scripted, and finished beats', () => {
    const info: Beat = { id: 'i', text: 't', mode: 'info' };
    const auto: Beat = {
      id: 'a',
      text: 't',
      mode: 'auto',
      action: { t: 'PASS', player: asPlayerId('you') },
    };
    expect(demoGate(info)).toBe('locked');
    expect(demoGate(auto)).toBe('locked');
    expect(demoGate(null)).toBe('locked'); // the clip has run out of beats
    expect(gateFlags(demoGate(info))).toMatchObject({ claim: false, station: false, draw: false });
  });

  it('exposes exactly the affordance an await beat narrates — and only its own target', () => {
    const claim: Beat = {
      id: 'c',
      text: 't',
      mode: 'await',
      expect: { t: 'CLAIM_ROUTE', routeId: 'R42' },
    };
    const gate = demoGate(claim);
    expect(gateFlags(gate)).toMatchObject({ claim: true, station: false, draw: false });
    expect(gateAllowsTarget(gate, 'route', 'R42')).toBe(true);
    expect(gateAllowsTarget(gate, 'route', 'R1')).toBe(false);
    expect(gateAllowsTarget(gate, 'city', 'taipei')).toBe(false);
  });

  it('leaves every encyclopedia await beat performable by a paused viewer', () => {
    // The regression this guards: a caption reading "click the highlighted route to claim it" while
    // the stage refuses the click, so a paused clip can never be stepped through by hand.
    const awaits = encyclopediaEntries().flatMap((entry) =>
      entry.beats.filter((b) => b.mode === 'await'),
    );
    expect(awaits.length).toBeGreaterThan(0);
    for (const beat of awaits) {
      const flags = gateFlags(demoGate(beat));
      expect(Object.values(flags).some(Boolean)).toBe(true);
    }
  });
});
