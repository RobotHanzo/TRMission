import type { CardColor } from '@trm/shared';
import { Phase, type GameEvent, type GameSnapshot } from '@trm/proto';
import { pbToCard } from './cards';
import { myTeam } from './teams';

/**
 * One end of a card flight. Renderer-free: each client resolves an end to whatever it can measure —
 * a `data-anim` node on web, an `animTargets` key on mobile — and drops the flight when either end
 * is off screen (a panel in an inactive dock tab, say).
 */
export type FlightEnd =
  /** The face-down draw pile. */
  | { at: 'deck' }
  /** One face-up market slot. */
  | { at: 'market'; slot: number }
  /** The viewer's own team pool. Only that pool is ever on screen — see `intentsFromEvents`. */
  | { at: 'teamPool' }
  /** A player's cards: their own hand tray when they are the viewer, their tracker otherwise. */
  | { at: 'player'; playerId: string };

/**
 * The animation vocabulary. Pure data — `useAnimationDriver` turns these into store mutations.
 * `cardFly`/`glowRoute`/`glowStation`/`scoreFloat`/`turnCue`/`marketFlip` come from the event
 * stream (`intentsFromEvents`); `ticketComplete` is built by the driver from a snapshot diff.
 */
export type AnimIntent =
  | {
      kind: 'cardFly';
      from: FlightEnd;
      to: FlightEnd;
      faceUp: boolean;
      color: CardColor | null;
    }
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
        out.push({
          kind: 'glowRoute',
          routeId: ev.value.routeId,
          seat: seatOf(snapshot, ev.value.playerId),
        });
        if (ev.value.pointsAwarded > 0)
          out.push({
            kind: 'scoreFloat',
            playerId: ev.value.playerId,
            amount: ev.value.pointsAwarded,
          });
        break;
      }
      case 'stationBuilt':
        out.push({
          kind: 'glowStation',
          cityId: ev.value.cityId,
          seat: seatOf(snapshot, ev.value.playerId),
        });
        break;
      case 'cardDrawnBlind':
        out.push({
          kind: 'cardFly',
          from: { at: 'deck' },
          to: { at: 'player', playerId: ev.value.playerId },
          faceUp: false,
          color: ev.value.playerId === me ? pbToCard(ev.value.card) : null,
        });
        break;
      case 'cardTakenFaceup':
        out.push({
          kind: 'cardFly',
          from: { at: 'market', slot: ev.value.slot },
          to: { at: 'player', playerId: ev.value.playerId },
          faceUp: true,
          color: pbToCard(ev.value.card),
        });
        // While the drawer still owes a second card (snapshot is post-action), keep the refilled
        // slot face-down; it flips into view once the whole draw resolves. Otherwise reveal now.
        out.push(
          snapshot.phase === Phase.DRAWING_CARDS
            ? { kind: 'marketCover', slot: ev.value.slot }
            : { kind: 'marketFlip', slot: ev.value.slot },
        );
        break;
      // The team pool is a card channel like the deck and the market, so cards travelling through
      // it fly too — a take into the drawer's hand, a push out of the pusher's. Only the pool the
      // viewer shares is rendered (`myTeamPool`), so only its moves have anywhere to fly.
      case 'teamPoolTaken':
        if (myTeam(snapshot) === ev.value.team)
          out.push({
            kind: 'cardFly',
            from: { at: 'teamPool' },
            to: { at: 'player', playerId: ev.value.playerId },
            faceUp: true,
            color: pbToCard(ev.value.card),
          });
        break;
      case 'teamPoolPushed':
        if (myTeam(snapshot) === ev.value.team)
          out.push({
            kind: 'cardFly',
            from: { at: 'player', playerId: ev.value.playerId },
            to: { at: 'teamPool' },
            faceUp: true,
            color: pbToCard(ev.value.card),
          });
        break;
      case 'marketRecycled':
        for (let slot = 0; slot < snapshot.market.length; slot++)
          out.push({ kind: 'marketFlip', slot });
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
