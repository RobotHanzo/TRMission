// Ported verbatim from apps/web/src/sound/soundModel.ts (pure event→cue mapping).
import { Phase, type GameEvent, type GameSnapshot } from '@trm/proto';
import type { Cue } from './cues';

export interface CueHit {
  cue: Cue;
  /** True when the local player triggered the event (full gain); false → opponent (attenuated). */
  isSelf: boolean;
}

/** Translate a delivered event batch into sound cues (pure). */
export function cuesFromEvents(snapshot: GameSnapshot, events: GameEvent[]): CueHit[] {
  const me = snapshot.you?.playerId ?? null;
  const out: CueHit[] = [];
  for (const e of events) {
    const ev = e.event;
    switch (ev.case) {
      case 'cardDrawnBlind':
      case 'cardTakenFaceup':
        out.push({ cue: 'cardDraw', isSelf: ev.value.playerId === me });
        break;
      case 'turnStarted':
        if (ev.value.playerId === me) out.push({ cue: 'yourTurn', isSelf: true });
        break;
      case 'stationBuilt':
        out.push({ cue: 'stationBuilt', isSelf: ev.value.playerId === me });
        break;
      case 'routeClaimed':
        out.push({ cue: 'railwayBuilt', isSelf: ev.value.playerId === me });
        break;
      case 'randomEventStarted':
        // Global announcement, not attributable to a player — always full gain.
        out.push({ cue: 'eventStart', isSelf: true });
        break;
      default:
        break;
    }
  }
  return out;
}

/** The game-over cue when the snapshot is at GAME_OVER, else null. Winners = ranking[0]. */
export function gameOverCue(snapshot: GameSnapshot): Cue | null {
  if (snapshot.phase !== Phase.GAME_OVER) return null;
  const me = snapshot.you?.playerId ?? null;
  const winners = snapshot.finalScores?.ranking[0]?.playerIds ?? [];
  return me !== null && winners.includes(me) ? 'gameOverWin' : 'gameOverNormal';
}
