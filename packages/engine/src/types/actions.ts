import type { PlayerId, RouteId, CityId, TicketId, TrainColor, CardColor } from '@trm/shared';

/**
 * Payment for claiming a route / building a station: `colorCount` cards of a single
 * `color` (null only when the colored portion is zero, i.e. an all-locomotive payment),
 * plus `locomotives` wild cards.
 */
export interface Payment {
  readonly color: TrainColor | null;
  readonly colorCount: number;
  readonly locomotives: number;
  /** Spend one Bento Rush token either as a one-card wild or for +2 points. */
  readonly bentoSpend?: 'WILD' | 'POINTS';
  /** Consume one Rolling-Stock Allocation claim-discount perk. */
  readonly useClaimDiscount?: boolean;
}

export type EventPerk = 'CLAIM_DISCOUNT' | 'DRAW_TWO' | 'REPAIR_PERMIT';

export type Action =
  /** Server-authorized early completion after the room's end-game vote succeeds. This action is
   *  intentionally not exposed by the gameplay command codec; keeping it in the engine log makes
   *  the terminal state deterministic across persistence recovery and replay. */
  | { readonly t: 'END_GAME'; readonly player: PlayerId }
  /** SETUP_TICKETS: each player simultaneously keeps ≥ minKeepInitial of their initial offer. */
  | {
      readonly t: 'KEEP_INITIAL_TICKETS';
      readonly player: PlayerId;
      readonly keep: readonly TicketId[];
    }
  /** Draw one train card blind from the deck top (sub-action of the draw-cards turn). */
  | { readonly t: 'DRAW_BLIND'; readonly player: PlayerId }
  /** Take one face-up market card by slot (sub-action of the draw-cards turn). */
  | { readonly t: 'DRAW_FACEUP'; readonly player: PlayerId; readonly slot: number }
  /** Begin a draw-tickets turn → offers 3, transitions to TICKET_SELECTION. */
  | { readonly t: 'DRAW_TICKETS'; readonly player: PlayerId }
  /** Resolve a ticket offer (initial or mid-game), keeping ≥ the minimum. */
  | { readonly t: 'KEEP_TICKETS'; readonly player: PlayerId; readonly keep: readonly TicketId[] }
  /** Claim a route (or begin a tunnel claim → TUNNEL_PENDING). */
  | {
      readonly t: 'CLAIM_ROUTE';
      readonly player: PlayerId;
      readonly routeId: RouteId;
      readonly payment: Payment;
    }
  /** Build a station in a city. */
  | {
      readonly t: 'BUILD_STATION';
      readonly player: PlayerId;
      readonly cityId: CityId;
      readonly payment: Payment;
    }
  /** Resolve a pending tunnel: commit (paying `extra`) or abort. */
  | {
      readonly t: 'RESOLVE_TUNNEL';
      readonly player: PlayerId;
      readonly commit: boolean;
      readonly extra?: Payment;
    }
  /** Mandatory follow-up after claiming at the roaming Lantern Host city. */
  | { readonly t: 'RELOCATE_LANTERN_HOST'; readonly player: PlayerId; readonly cityId: CityId }
  /** Spend a turn repairing a route closed by Slope Repair Order. */
  | {
      readonly t: 'REPAIR_ROUTE';
      readonly player: PlayerId;
      readonly routeId: RouteId;
      readonly payment: Payment;
    }
  /** Free once-per-turn swap at an active station-front night market. */
  | {
      readonly t: 'NIGHT_MARKET_SWAP';
      readonly player: PlayerId;
      readonly giveColor: CardColor;
      readonly slot: number;
    }
  /** Mandatory Rolling-Stock Allocation draft choice. */
  | { readonly t: 'CHOOSE_EVENT_PERK'; readonly player: PlayerId; readonly perk: EventPerk }
  /** Begin / continue / stop a Hive of Sparks push-your-luck draw. */
  | { readonly t: 'START_HIVE_DRAW'; readonly player: PlayerId }
  | { readonly t: 'CONTINUE_HIVE_DRAW'; readonly player: PlayerId }
  | { readonly t: 'STOP_HIVE_DRAW'; readonly player: PlayerId }
  /** Pass — only legal when the player has no other legal move (A15 termination). */
  | { readonly t: 'PASS'; readonly player: PlayerId };

export type ActionType = Action['t'];
