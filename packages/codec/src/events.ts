// Engine GameEvent → proto GameEvent, redacted for a specific recipient. Events
// are cosmetic (the authoritative Snapshot is ground truth), but they still must
// not leak hidden info: a private event for someone else is dropped (null), and a
// blind-draw's card is blanked to UNSPECIFIED for non-owners.
import { create, type MessageInitShape } from '@bufbuild/protobuf';
import { CardColor as PbCardColor } from '@trm/proto';
import { GameEventSchema, type GameEvent as PbGameEvent } from '@trm/proto';
import type { PlayerId } from '@trm/shared';
import type { GameEvent } from '@trm/engine';
import { cardToPb, cardOrNullToPb } from './enums';
import { announcedToInfo, startedToInfo } from './random-events';

/** Returns null when this recipient must not receive the event at all. */
export function eventToProto(ev: GameEvent, recipient: PlayerId | null): PbGameEvent | null {
  const owner = typeof ev.visibility === 'object' ? ev.visibility.private : null;
  const ownerSees = owner !== null && recipient !== null && recipient === owner;

  switch (ev.e) {
    case 'GAME_STARTED':
      return wrap({ case: 'gameStarted', value: { turnOrder: ev.turnOrder.map(String) } });
    case 'INITIAL_TICKETS_OFFERED':
      return ownerSees
        ? wrap({
            case: 'initialTicketsOffered',
            value: { playerId: ev.player as string, ticketIds: ev.ticketIds.map(String) },
          })
        : null;
    case 'INITIAL_TICKETS_KEPT':
      return wrap({
        case: 'initialTicketsKept',
        value: { playerId: ev.player as string, keptCount: ev.keptCount },
      });
    case 'TURN_STARTED':
      return wrap({
        case: 'turnStarted',
        value: { playerId: ev.player as string, orderIndex: ev.orderIndex },
      });
    case 'CARD_DRAWN_BLIND':
      return wrap({
        case: 'cardDrawnBlind',
        value: {
          playerId: ev.player as string,
          card: ownerSees ? cardToPb(ev.card) : PbCardColor.UNSPECIFIED,
        },
      });
    case 'CARD_TAKEN_FACEUP':
      return wrap({
        case: 'cardTakenFaceup',
        value: { playerId: ev.player as string, slot: ev.slot, card: cardToPb(ev.card) },
      });
    case 'MARKET_REFILLED':
      return wrap({
        case: 'marketRefilled',
        value: { market: ev.market.map((c) => cardOrNullToPb(c)) },
      });
    case 'MARKET_RECYCLED':
      return wrap({ case: 'marketRecycled', value: {} });
    case 'DECK_RESHUFFLED':
      return wrap({ case: 'deckReshuffled', value: {} });
    case 'ROUTE_CLAIMED':
      return wrap({
        case: 'routeClaimed',
        value: {
          playerId: ev.player as string,
          routeId: ev.routeId as string,
          pointsAwarded: ev.pointsAwarded,
        },
      });
    case 'DOUBLE_ROUTE_LOCKED':
      return wrap({ case: 'doubleRouteLocked', value: { routeId: ev.routeId as string } });
    case 'TUNNEL_REVEALED':
      return wrap({
        case: 'tunnelRevealed',
        value: {
          playerId: ev.player as string,
          routeId: ev.routeId as string,
          revealed: ev.revealed.map((c) => cardToPb(c)),
          extraRequired: ev.extraRequired,
        },
      });
    case 'TUNNEL_RESOLVED':
      return wrap({
        case: 'tunnelResolved',
        value: {
          playerId: ev.player as string,
          routeId: ev.routeId as string,
          committed: ev.committed,
        },
      });
    case 'STATION_BUILT':
      return wrap({
        case: 'stationBuilt',
        value: { playerId: ev.player as string, cityId: ev.cityId as string },
      });
    case 'TICKETS_OFFERED':
      return ownerSees
        ? wrap({
            case: 'ticketsOffered',
            value: { playerId: ev.player as string, ticketIds: ev.ticketIds.map(String) },
          })
        : null;
    case 'TICKETS_KEPT':
      return wrap({
        case: 'ticketsKept',
        value: { playerId: ev.player as string, keptCount: ev.keptCount },
      });
    case 'PLAYER_PASSED':
      return wrap({ case: 'playerPassed', value: { playerId: ev.player as string } });
    case 'TURN_ENDED':
      return wrap({ case: 'turnEnded', value: { playerId: ev.player as string } });
    case 'ENDGAME_TRIGGERED':
      return wrap({
        case: 'endgameTriggered',
        value: { playerId: ev.player as string, finalTurnsRemaining: ev.finalTurnsRemaining },
      });
    case 'GAME_ENDED':
      return wrap({ case: 'gameEnded', value: {} });
    case 'TICKET_COMPLETED':
      return wrap({
        case: 'ticketCompleted',
        value: { playerId: ev.player as string, ticketId: ev.ticket as string },
      });
    case 'EVENT_ANNOUNCED':
      // All four random-events engine events are PUBLIC — the feature carries no per-recipient
      // hidden info (unlike ticket offers / blind draws above).
      return wrap({ case: 'randomEventAnnounced', value: { info: announcedToInfo(ev) } });
    case 'EVENT_STARTED':
      return wrap({ case: 'randomEventStarted', value: { info: startedToInfo(ev) } });
    case 'EVENT_ENDED':
      return wrap({ case: 'randomEventEnded', value: { id: ev.id, kind: ev.kind } });
    case 'EVENT_BONUS':
      return wrap({
        case: 'randomEventBonus',
        value: {
          kind: ev.kind,
          reason: ev.reason,
          playerId: ev.player as string,
          points: ev.points,
          routeId: (ev.routeId as string | undefined) ?? '',
          cityId: (ev.cityId as string | undefined) ?? '',
        },
      });
  }
}

type EventOneof = NonNullable<MessageInitShape<typeof GameEventSchema>['event']>;
const wrap = (event: EventOneof): PbGameEvent => create(GameEventSchema, { event });
