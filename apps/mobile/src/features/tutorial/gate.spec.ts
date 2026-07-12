import { describe, it, expect } from 'vitest';
import { gateFlags, type ActionGate } from './types';
import { LESSONS } from './curriculum';
import type { Beat } from './types';

// Mirror TutorialScreen's gate derivation: an `await` beat exposes the action it waits for; any
// other beat (and the post-lesson `done` state) locks the HUD entirely.
const gateForBeat = (beat: Beat): ActionGate => (beat.mode === 'await' ? beat.expect : 'locked');

describe('tutorial action gate', () => {
  it('a live game (no gate) leaves every affordance interactive', () => {
    expect(gateFlags(undefined)).toEqual({
      draw: true,
      tickets: true,
      claim: true,
      station: true,
      keep: true,
      tunnel: true,
    });
  });

  it('a locked gate disables every affordance', () => {
    expect(gateFlags('locked')).toEqual({
      draw: false,
      tickets: false,
      claim: false,
      station: false,
      keep: false,
      tunnel: false,
    });
  });

  it('an await gate enables exactly the affordance it expects', () => {
    expect(gateFlags({ t: 'DRAW_ANY' })).toMatchObject({ draw: true, tickets: false, keep: false });
    expect(gateFlags({ t: 'DRAW_BLIND' })).toMatchObject({ draw: true });
    expect(gateFlags({ t: 'DRAW_FACEUP' })).toMatchObject({ draw: true });
    expect(gateFlags({ t: 'DRAW_TICKETS' })).toMatchObject({ tickets: true, draw: false });
    expect(gateFlags({ t: 'CLAIM_ROUTE' })).toMatchObject({ claim: true, draw: false });
    expect(gateFlags({ t: 'BUILD_STATION' })).toMatchObject({ station: true, claim: false });
    expect(gateFlags({ t: 'KEEP_INITIAL_TICKETS' })).toMatchObject({ keep: true, draw: false });
    expect(gateFlags({ t: 'KEEP_TICKETS' })).toMatchObject({ keep: true, draw: false });
    expect(gateFlags({ t: 'RESOLVE_TUNNEL' })).toMatchObject({ tunnel: true, draw: false });
  });

  // The user-facing guarantee, enforced across EVERY chapter: a learner can never act during a
  // narration (`info`) or scripted (`auto`) beat — only when a beat explicitly awaits that action.
  // This guards against the "drew a card / kept tickets early → stranded at a later step" dead end.
  for (const lesson of LESSONS) {
    it(`"${lesson.id}": only await beats expose an affordance`, () => {
      for (const beat of lesson.beats) {
        const flags = gateFlags(gateForBeat(beat));
        const anyAllowed = Object.values(flags).some(Boolean);
        if (beat.mode === 'await') {
          expect(anyAllowed, `${lesson.id}/${beat.id} (await) should expose its action`).toBe(true);
        } else {
          expect(anyAllowed, `${lesson.id}/${beat.id} (${beat.mode}) should expose nothing`).toBe(
            false,
          );
        }
      }
    });
  }
});
