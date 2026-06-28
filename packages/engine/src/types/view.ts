import type { PlayerId, RouteId, TicketId, CardColor, SeatIndex, Hand } from '@trm/shared';
import type { Phase, OwnerCell, StationPlacement, Endgame, PlayerFinal } from './state';

/**
 * A player's end-game score, enriched for display: which kept tickets are completed (gains) vs
 * failed (losses), and the route ids of one optimal longest trail (to highlight on the map).
 * These are deterministic functions of game state, derived at the projection boundary so the
 * authoritative {@link PlayerFinal} stored in `GameState` stays minimal.
 */
export interface RedactedPlayerFinal extends PlayerFinal {
  readonly completedTicketIds: readonly TicketId[];
  readonly longestTrailRouteIds: readonly RouteId[];
}

export interface RedactedFinalScoreboard {
  readonly players: readonly RedactedPlayerFinal[];
  readonly ranking: readonly (readonly PlayerId[])[];
}

/** A player as seen by a particular viewer: own secrets included, opponents' are counts only. */
export interface RedactedPlayer {
  readonly id: PlayerId;
  readonly seat: SeatIndex;
  readonly trainCars: number;
  readonly stationsRemaining: number;
  readonly routePoints: number;
  readonly handCount: number;
  readonly ticketCount: number;
  /** Own hand only (null for opponents). */
  readonly hand: Hand | null;
  /** Own kept tickets, or everyone's at GAME_OVER (null for hidden opponents). */
  readonly keptTickets: readonly TicketId[] | null;
  /** Own pending offer only. */
  readonly pendingTicketOffer: readonly TicketId[] | null;
}

export interface RedactedView {
  readonly schemaVersion: number;
  readonly contentHash: string;
  readonly phase: Phase;
  readonly orderIndex: number;
  readonly currentPlayer: PlayerId | null;
  readonly turnOrder: readonly PlayerId[];

  readonly market: readonly (CardColor | null)[];
  readonly deckCount: number;
  readonly discard: Readonly<Record<CardColor, number>>;
  readonly ticketDeckLongCount: number;
  readonly ticketDeckShortCount: number;

  readonly ownership: Readonly<Record<string, OwnerCell>>;
  readonly stations: readonly StationPlacement[];
  readonly endgame: Endgame;

  /** Tunnel reveal is public information. */
  readonly pendingTunnel: {
    readonly player: PlayerId;
    readonly routeId: RouteId;
    readonly revealed: readonly CardColor[];
    readonly extraRequired: number;
  } | null;

  readonly players: readonly RedactedPlayer[];
  readonly finalScores: RedactedFinalScoreboard | null;

  /** Active rule variants for this game (display only — consequences are already baked in). */
  readonly settings: {
    readonly unlimitedStationBorrow: boolean;
    readonly secondDrawAfterBlindRainbow: boolean;
    readonly noUnfinishedTicketPenalty: boolean;
  };

  /**
   * Tickets revealed because their owner has COMPLETED them with their own routes (own-track
   * connectivity, no station borrowing). Public to every viewer — in-progress tickets stay secret.
   */
  readonly completedTickets: readonly { readonly player: PlayerId; readonly ticket: TicketId }[];
}
