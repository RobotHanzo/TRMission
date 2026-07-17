import type { PlayerId, RouteId, CityId, TicketId, CardColor } from '@trm/shared';
import type { RandomEventKind } from './events-state';
import type { EventPerk } from './actions';

/**
 * Events emitted by the reducer. The gateway turns these into protobuf and applies
 * per-recipient redaction. `visibility` tells the gateway who may see the full payload:
 * 'PUBLIC' → everyone; `{ private: PlayerId }` → only that player (hidden info).
 */
export type Visibility = 'PUBLIC' | { readonly private: PlayerId };

export type GameEvent =
  | {
      readonly e: 'GAME_STARTED';
      readonly turnOrder: readonly PlayerId[];
      readonly visibility: 'PUBLIC';
    }
  | {
      readonly e: 'INITIAL_TICKETS_OFFERED';
      readonly player: PlayerId;
      readonly ticketIds: readonly TicketId[];
      readonly visibility: Visibility;
    }
  | {
      readonly e: 'INITIAL_TICKETS_KEPT';
      readonly player: PlayerId;
      readonly keptCount: number;
      readonly visibility: 'PUBLIC';
    }
  | {
      readonly e: 'TURN_STARTED';
      readonly player: PlayerId;
      readonly orderIndex: number;
      readonly visibility: 'PUBLIC';
    }
  | {
      readonly e: 'CARD_DRAWN_BLIND';
      readonly player: PlayerId;
      readonly card: CardColor;
      readonly visibility: Visibility;
    }
  | {
      readonly e: 'CARD_TAKEN_FACEUP';
      readonly player: PlayerId;
      readonly slot: number;
      readonly card: CardColor;
      readonly visibility: 'PUBLIC';
    }
  | {
      readonly e: 'MARKET_REFILLED';
      readonly market: readonly (CardColor | null)[];
      readonly visibility: 'PUBLIC';
    }
  | {
      readonly e: 'MARKET_RECYCLED';
      readonly reason: 'THREE_LOCOS' | 'THREE_OF_COLOR';
      readonly visibility: 'PUBLIC';
    }
  | { readonly e: 'DECK_RESHUFFLED'; readonly visibility: 'PUBLIC' }
  | {
      readonly e: 'ROUTE_CLAIMED';
      readonly player: PlayerId;
      readonly routeId: RouteId;
      readonly pointsAwarded: number;
      readonly visibility: 'PUBLIC';
    }
  | { readonly e: 'DOUBLE_ROUTE_LOCKED'; readonly routeId: RouteId; readonly visibility: 'PUBLIC' }
  | {
      readonly e: 'BROKEN_RAIL_REPAIRED';
      readonly player: PlayerId;
      readonly routeId: RouteId;
      /** The authored brokenCarriages count that was paid for. */
      readonly carriages: number;
      readonly pointsAwarded: number;
      readonly visibility: 'PUBLIC';
    }
  | {
      readonly e: 'TUNNEL_REVEALED';
      readonly player: PlayerId;
      readonly routeId: RouteId;
      readonly revealed: readonly CardColor[];
      readonly extraRequired: number;
      readonly visibility: 'PUBLIC';
    }
  | {
      readonly e: 'TUNNEL_RESOLVED';
      readonly player: PlayerId;
      readonly routeId: RouteId;
      readonly committed: boolean;
      readonly visibility: 'PUBLIC';
    }
  | {
      readonly e: 'STATION_BUILT';
      readonly player: PlayerId;
      readonly cityId: CityId;
      readonly visibility: 'PUBLIC';
    }
  | {
      readonly e: 'TICKETS_OFFERED';
      readonly player: PlayerId;
      readonly ticketIds: readonly TicketId[];
      readonly visibility: Visibility;
    }
  | {
      readonly e: 'TICKETS_KEPT';
      readonly player: PlayerId;
      readonly keptCount: number;
      readonly visibility: 'PUBLIC';
    }
  | {
      readonly e: 'TICKET_COMPLETED';
      readonly player: PlayerId;
      readonly ticket: TicketId;
      readonly visibility: 'PUBLIC';
    }
  | { readonly e: 'PLAYER_PASSED'; readonly player: PlayerId; readonly visibility: 'PUBLIC' }
  | { readonly e: 'TURN_ENDED'; readonly player: PlayerId; readonly visibility: 'PUBLIC' }
  | {
      readonly e: 'ENDGAME_TRIGGERED';
      readonly player: PlayerId;
      readonly finalTurnsRemaining: number;
      /** Why the final round began: a player ran their trains down, or the table deadlocked (the
       *  card pool is dead and no one can claim a route). */
      readonly reason: 'FINAL_TRAINS' | 'DEADLOCK';
      readonly visibility: 'PUBLIC';
    }
  | { readonly e: 'GAME_ENDED'; readonly visibility: 'PUBLIC' }
  // ─── random events (feature-gated; only emitted when GameState.events is present) ───
  | {
      readonly e: 'EVENT_ANNOUNCED';
      readonly id: string;
      readonly kind: RandomEventKind;
      readonly startRound: number;
      readonly durationRounds: number;
      readonly routeIds?: readonly RouteId[];
      readonly region?: string;
      readonly cityId?: CityId;
      readonly cityPath?: readonly CityId[];
      readonly pair?: { readonly a: CityId; readonly b: CityId };
      readonly visibility: Visibility;
    }
  | {
      readonly e: 'EVENT_STARTED';
      readonly id: string;
      readonly kind: RandomEventKind;
      readonly startRound: number;
      readonly durationRounds: number;
      readonly routeIds?: readonly RouteId[];
      readonly region?: string;
      readonly cityId?: CityId;
      readonly charter?: { readonly a: CityId; readonly b: CityId; readonly points: number };
      readonly cityPath?: readonly CityId[];
      readonly pair?: { readonly a: CityId; readonly b: CityId };
      readonly visibility: Visibility;
    }
  | {
      readonly e: 'EVENT_ENDED';
      readonly id: string;
      readonly kind: RandomEventKind;
      readonly visibility: Visibility;
    }
  | {
      readonly e: 'EVENT_BONUS';
      readonly kind: RandomEventKind;
      readonly reason:
        | 'HOTSPOT'
        | 'REOPEN'
        | 'STAMP'
        | 'CHARTER'
        | 'FREE_STATION'
        | 'LANTERN'
        | 'BENTO_COLLECT'
        | 'BENTO_POINTS'
        | 'REPAIR'
        | 'BLESSING'
        | 'PROCESSION'
        | 'INTERIM_TRAIL'
        | 'INTERIM_ROUTES'
        | 'HARVEST'
        | 'RESERVED_LOCO'
        | 'LUCKY';
      readonly player: PlayerId;
      readonly points: number;
      readonly routeId?: RouteId;
      readonly cityId?: CityId;
      readonly visibility: Visibility;
    }
  | {
      readonly e: 'EVENT_MARKER_MOVED';
      readonly kind: 'LANTERN_HOST_CITY' | 'GODDESS_PROCESSION';
      readonly id: string;
      readonly cityId: CityId;
      readonly player?: PlayerId;
      readonly position?: number;
      readonly visibility: 'PUBLIC';
    }
  | {
      readonly e: 'EVENT_NIGHT_MARKET_SWAPPED';
      readonly player: PlayerId;
      readonly slot: number;
      readonly gave: CardColor;
      readonly took: CardColor;
      readonly visibility: 'PUBLIC';
    }
  | {
      readonly e: 'EVENT_PERK_CHOSEN';
      readonly player: PlayerId;
      readonly perk: EventPerk;
      readonly visibility: 'PUBLIC';
    }
  | {
      readonly e: 'EVENT_HIVE_CARD_REVEALED';
      readonly player: PlayerId;
      readonly card: CardColor;
      readonly count: number;
      readonly visibility: 'PUBLIC';
    }
  | {
      readonly e: 'EVENT_HIVE_RESOLVED';
      readonly player: PlayerId;
      readonly busted: boolean;
      readonly keptCount: number;
      readonly visibility: 'PUBLIC';
    };

export type GameEventType = GameEvent['e'];
