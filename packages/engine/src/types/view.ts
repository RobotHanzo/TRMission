import type { PlayerId, RouteId, TicketId, CardColor, SeatIndex, Hand } from '@trm/shared';
import type { Phase, OwnerCell, StationPlacement, Endgame, FinalScoreboard } from './state';

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
  readonly finalScores: FinalScoreboard | null;

  /**
   * Tickets revealed because their owner has COMPLETED them with their own routes (own-track
   * connectivity, no station borrowing). Public to every viewer — in-progress tickets stay secret.
   */
  readonly completedTickets: readonly { readonly player: PlayerId; readonly ticket: TicketId }[];
}
