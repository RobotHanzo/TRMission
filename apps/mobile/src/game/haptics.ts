import type { GameEvent } from '@trm/proto';

/** The four haptic beats from the spec (§5) — nothing else ever vibrates. */
export type HapticCue = 'route-claim' | 'tunnel-reveal' | 'ticket-complete' | 'game-end';

const CUE_BY_CASE: Partial<Record<string, HapticCue>> = {
  routeClaimed: 'route-claim',
  tunnelRevealed: 'tunnel-reveal',
  ticketCompleted: 'ticket-complete',
  gameEnded: 'game-end',
};

/** Pure event→cue mapping so it's testable without any native module. */
export function cuesForEvents(events: readonly GameEvent[]): HapticCue[] {
  const cues: HapticCue[] = [];
  for (const e of events) {
    const cue = e.event.case ? CUE_BY_CASE[e.event.case] : undefined;
    if (cue) cues.push(cue);
  }
  return cues;
}
