import type { GameEvent } from '@trm/proto';

/** The four haptic beats from the spec (§5), plus the your-turn nudge (issue #78). */
export type HapticCue =
  'route-claim' | 'tunnel-reveal' | 'ticket-complete' | 'game-end' | 'your-turn';

const CUE_BY_CASE: Partial<Record<string, HapticCue>> = {
  routeClaimed: 'route-claim',
  tunnelRevealed: 'tunnel-reveal',
  ticketCompleted: 'ticket-complete',
  gameEnded: 'game-end',
};

/**
 * Pure event→cue mapping so it stays testable without any native module.
 *
 * `me` is the viewer's playerId and gates the only viewer-relative cue: `turnStarted` buzzes just
 * for the viewer's own turn (the same test the yourTurn chime uses in `@trm/client-core`'s
 * soundModel). Pass `null` where nobody is actually playing — replay, encyclopedia demos — and the
 * turn cue is simply never emitted.
 */
export function cuesForEvents(events: readonly GameEvent[], me: string | null = null): HapticCue[] {
  const cues: HapticCue[] = [];
  for (const e of events) {
    if (e.event.case === 'turnStarted') {
      if (me && e.event.value.playerId === me) cues.push('your-turn');
      continue;
    }
    const cue = e.event.case ? CUE_BY_CASE[e.event.case] : undefined;
    if (cue) cues.push(cue);
  }
  return cues;
}
