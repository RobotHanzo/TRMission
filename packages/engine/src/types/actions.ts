import type { PlayerId, RouteId, CityId, TicketId, TrainColor } from '@trm/shared';

/**
 * Payment for claiming a route / building a station: `colorCount` cards of a single
 * `color` (null only when the colored portion is zero, i.e. an all-locomotive payment),
 * plus `locomotives` wild cards.
 */
export interface Payment {
  readonly color: TrainColor | null;
  readonly colorCount: number;
  readonly locomotives: number;
}

export type Action =
  /** SETUP_TICKETS: each player simultaneously keeps ≥ minKeepInitial of their initial offer. */
  | { readonly t: 'KEEP_INITIAL_TICKETS'; readonly player: PlayerId; readonly keep: readonly TicketId[] }
  /** Draw one train card blind from the deck top (sub-action of the draw-cards turn). */
  | { readonly t: 'DRAW_BLIND'; readonly player: PlayerId }
  /** Take one face-up market card by slot (sub-action of the draw-cards turn). */
  | { readonly t: 'DRAW_FACEUP'; readonly player: PlayerId; readonly slot: number }
  /** Begin a draw-tickets turn → offers 3, transitions to TICKET_SELECTION. */
  | { readonly t: 'DRAW_TICKETS'; readonly player: PlayerId }
  /** Resolve a ticket offer (initial or mid-game), keeping ≥ the minimum. */
  | { readonly t: 'KEEP_TICKETS'; readonly player: PlayerId; readonly keep: readonly TicketId[] }
  /** Claim a route (or begin a tunnel claim → TUNNEL_PENDING). */
  | { readonly t: 'CLAIM_ROUTE'; readonly player: PlayerId; readonly routeId: RouteId; readonly payment: Payment }
  /** Build a station in a city. */
  | { readonly t: 'BUILD_STATION'; readonly player: PlayerId; readonly cityId: CityId; readonly payment: Payment }
  /** Resolve a pending tunnel: commit (paying `extra`) or abort. */
  | { readonly t: 'RESOLVE_TUNNEL'; readonly player: PlayerId; readonly commit: boolean; readonly extra?: Payment }
  /** Pass — only legal when the player has no other legal move (A15 termination). */
  | { readonly t: 'PASS'; readonly player: PlayerId };

export type ActionType = Action['t'];
