import type { PlayerId, RouteId, CityId, TicketId, CardColor } from '@trm/shared';

/**
 * Events emitted by the reducer. The gateway turns these into protobuf and applies
 * per-recipient redaction. `visibility` tells the gateway who may see the full payload:
 * 'PUBLIC' → everyone; `{ private: PlayerId }` → only that player (hidden info).
 */
export type Visibility = 'PUBLIC' | { readonly private: PlayerId };

export type GameEvent =
  | { readonly e: 'GAME_STARTED'; readonly turnOrder: readonly PlayerId[]; readonly visibility: 'PUBLIC' }
  | { readonly e: 'INITIAL_TICKETS_OFFERED'; readonly player: PlayerId; readonly ticketIds: readonly TicketId[]; readonly visibility: Visibility }
  | { readonly e: 'INITIAL_TICKETS_KEPT'; readonly player: PlayerId; readonly keptCount: number; readonly visibility: 'PUBLIC' }
  | { readonly e: 'TURN_STARTED'; readonly player: PlayerId; readonly orderIndex: number; readonly visibility: 'PUBLIC' }
  | { readonly e: 'CARD_DRAWN_BLIND'; readonly player: PlayerId; readonly card: CardColor; readonly visibility: Visibility }
  | { readonly e: 'CARD_TAKEN_FACEUP'; readonly player: PlayerId; readonly slot: number; readonly card: CardColor; readonly visibility: 'PUBLIC' }
  | { readonly e: 'MARKET_REFILLED'; readonly market: readonly (CardColor | null)[]; readonly visibility: 'PUBLIC' }
  | { readonly e: 'MARKET_RECYCLED'; readonly reason: 'THREE_LOCOS'; readonly visibility: 'PUBLIC' }
  | { readonly e: 'DECK_RESHUFFLED'; readonly visibility: 'PUBLIC' }
  | { readonly e: 'ROUTE_CLAIMED'; readonly player: PlayerId; readonly routeId: RouteId; readonly pointsAwarded: number; readonly visibility: 'PUBLIC' }
  | { readonly e: 'DOUBLE_ROUTE_LOCKED'; readonly routeId: RouteId; readonly visibility: 'PUBLIC' }
  | { readonly e: 'TUNNEL_REVEALED'; readonly player: PlayerId; readonly routeId: RouteId; readonly revealed: readonly CardColor[]; readonly extraRequired: number; readonly visibility: 'PUBLIC' }
  | { readonly e: 'TUNNEL_RESOLVED'; readonly player: PlayerId; readonly routeId: RouteId; readonly committed: boolean; readonly visibility: 'PUBLIC' }
  | { readonly e: 'STATION_BUILT'; readonly player: PlayerId; readonly cityId: CityId; readonly visibility: 'PUBLIC' }
  | { readonly e: 'TICKETS_OFFERED'; readonly player: PlayerId; readonly ticketIds: readonly TicketId[]; readonly visibility: Visibility }
  | { readonly e: 'TICKETS_KEPT'; readonly player: PlayerId; readonly keptCount: number; readonly visibility: 'PUBLIC' }
  | { readonly e: 'PLAYER_PASSED'; readonly player: PlayerId; readonly visibility: 'PUBLIC' }
  | { readonly e: 'TURN_ENDED'; readonly player: PlayerId; readonly visibility: 'PUBLIC' }
  | { readonly e: 'ENDGAME_TRIGGERED'; readonly player: PlayerId; readonly finalTurnsRemaining: number; readonly visibility: 'PUBLIC' }
  | { readonly e: 'GAME_ENDED'; readonly visibility: 'PUBLIC' };

export type GameEventType = GameEvent['e'];
