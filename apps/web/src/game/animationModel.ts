import type { CardColor } from '@trm/shared';
import { Phase, type GameEvent, type GameSnapshot } from '@trm/proto';
import { pbToCard } from './cards';

/**
 * The animation vocabulary. Pure data — `useAnimationDriver` turns these into store mutations.
 * `cardFly`/`glowRoute`/`glowStation`/`scoreFloat`/`turnCue`/`marketFlip` come from the event
 * stream (`intentsFromEvents`); `ticketComplete` is built by the driver from a snapshot diff.
 */
export type AnimIntent =
  | { kind: 'cardFly'; toPlayerId: string; faceUp: boolean; color: CardColor | null; slot: number | null }
  | { kind: 'glowRoute'; routeId: string; seat: number }
  | { kind: 'glowStation'; cityId: string; seat: number }
  | { kind: 'scoreFloat'; playerId: string; amount: number }
  | { kind: 'turnCue'; playerId: string; isYou: boolean }
  | { kind: 'marketFlip'; slot: number }
  | { kind: 'marketCover'; slot: number }
  | {
      kind: 'ticketComplete';
      playerId: string;
      ticketId: string;
      isYou: boolean;
      long: boolean;
      seat: number;
      path: string[];
    };

const seatOf = (snapshot: GameSnapshot, playerId: string): number =>
  snapshot.players.find((p) => p.id === playerId)?.seat ?? 0;

/** Translate a delivered event batch into animation intents (pure). */
export function intentsFromEvents(snapshot: GameSnapshot, events: GameEvent[]): AnimIntent[] {
  const me = snapshot.you?.playerId ?? null;
  const out: AnimIntent[] = [];

  for (const e of events) {
    const ev = e.event;
    switch (ev.case) {
      case 'routeClaimed': {
        out.push({ kind: 'glowRoute', routeId: ev.value.routeId, seat: seatOf(snapshot, ev.value.playerId) });
        if (ev.value.pointsAwarded > 0)
          out.push({ kind: 'scoreFloat', playerId: ev.value.playerId, amount: ev.value.pointsAwarded });
        break;
      }
      case 'stationBuilt':
        out.push({ kind: 'glowStation', cityId: ev.value.cityId, seat: seatOf(snapshot, ev.value.playerId) });
        break;
      case 'cardDrawnBlind':
        out.push({
          kind: 'cardFly',
          toPlayerId: ev.value.playerId,
          faceUp: false,
          color: ev.value.playerId === me ? pbToCard(ev.value.card) : null,
          slot: null,
        });
        break;
      case 'cardTakenFaceup':
        out.push({
          kind: 'cardFly',
          toPlayerId: ev.value.playerId,
          faceUp: true,
          color: pbToCard(ev.value.card),
          slot: ev.value.slot,
        });
        // While the drawer still owes a second card (snapshot is post-action), keep the refilled
        // slot face-down; it flips into view once the whole draw resolves. Otherwise reveal now.
        out.push(
          snapshot.phase === Phase.DRAWING_CARDS
            ? { kind: 'marketCover', slot: ev.value.slot }
            : { kind: 'marketFlip', slot: ev.value.slot },
        );
        break;
      case 'marketRecycled':
        for (let slot = 0; slot < snapshot.market.length; slot++) out.push({ kind: 'marketFlip', slot });
        break;
      case 'turnStarted':
        out.push({ kind: 'turnCue', playerId: ev.value.playerId, isYou: ev.value.playerId === me });
        break;
      default:
        break;
    }
  }
  return out;
}
