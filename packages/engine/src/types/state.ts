import type {
  PlayerId,
  RouteId,
  CityId,
  TicketId,
  CardColor,
  TrainColor,
  SeatIndex,
  RngState,
  RuleParams,
} from '@trm/shared';
import type { Payment } from './actions';

export type Phase =
  | 'SETUP_TICKETS'
  | 'AWAIT_ACTION'
  | 'DRAWING_CARDS'
  | 'TICKET_SELECTION'
  | 'TUNNEL_PENDING'
  | 'GAME_OVER';

/** A claimed route is owned; a locked route (closed double sibling in 2–3p) has no owner. */
export type OwnerCell = { readonly owner: PlayerId } | { readonly locked: true };

export interface PlayerState {
  readonly id: PlayerId;
  readonly seat: SeatIndex;
  readonly hand: Readonly<Record<CardColor, number>>;
  readonly trainCars: number;
  readonly stationsRemaining: number;
  /** Secret until scoring. */
  readonly keptTickets: readonly TicketId[];
  /** Non-null while this player has an unresolved ticket offer (setup or mid-game). */
  readonly pendingTicketOffer: readonly TicketId[] | null;
  /** Running board score from claimed routes (tickets/bonus added at game end). */
  readonly routePoints: number;
  /** Tickets locked as completed mid-game (only populated under the unlimitedStationBorrow
   *  variant). Monotonic; points are banked the moment a ticket enters this list. */
  readonly completedTickets: readonly TicketId[];
}

export interface TurnState {
  readonly orderIndex: number;
  readonly phase: Phase;
  /** Cards already taken in the current DRAWING_CARDS turn (0 or 1). */
  readonly cardsDrawnThisTurn: number;
}

export interface PendingTunnel {
  readonly playerId: PlayerId;
  readonly routeId: RouteId;
  readonly payment: Payment;
  /** The single non-loco colour played, or null for an all-locomotive claim. */
  readonly playedColor: TrainColor | null;
  readonly revealed: readonly CardColor[];
  readonly extraRequired: number;
}

export interface StationPlacement {
  readonly playerId: PlayerId;
  readonly cityId: CityId;
}

export interface Endgame {
  readonly triggered: boolean;
  /** Turn-order index of the player who first dropped to ≤ threshold (−1 if not triggered). */
  readonly triggerPlayerIndex: number;
  /** Remaining full turns once triggered (counts down to 0 → GAME_OVER). */
  readonly finalTurnsRemaining: number;
}

export interface PlayerFinal {
  readonly playerId: PlayerId;
  readonly routePoints: number;
  readonly ticketNet: number;
  readonly ticketsCompleted: number;
  readonly stationsUsed: number;
  readonly unusedStations: number;
  readonly stationBonus: number;
  readonly longestTrailLength: number;
  readonly longestBonus: number;
  readonly total: number;
}

export interface FinalScoreboard {
  readonly players: readonly PlayerFinal[];
  /** Ranking as equivalence groups (a group with >1 entry = tied co-winners/places). */
  readonly ranking: readonly (readonly PlayerId[])[];
}

export interface GameState {
  readonly schemaVersion: number;
  readonly engineVersion: number;
  readonly contentHash: string;
  readonly rng: RngState;
  readonly ruleParams: RuleParams;

  readonly turnOrder: readonly PlayerId[];
  readonly players: Readonly<Record<string, PlayerState>>;
  readonly turn: TurnState;

  /** Draw deck — index 0 = bottom, last element = top (we pop the top). */
  readonly deck: readonly CardColor[];
  readonly discard: Readonly<Record<CardColor, number>>;
  /** Face-up market; a slot is null only when the deck+discard are exhausted. */
  readonly market: readonly (CardColor | null)[];

  readonly ticketDeckLong: readonly TicketId[];
  readonly ticketDeckShort: readonly TicketId[];

  /** routeId → owner/locked. Absent key ⇒ open route. */
  readonly ownership: Readonly<Record<string, OwnerCell>>;
  readonly stations: readonly StationPlacement[];

  readonly pendingTunnel: PendingTunnel | null;
  readonly endgame: Endgame;
  /** Consecutive forced PASSes; a full round (=numPlayers) forces scoring (A15). */
  readonly consecutivePasses: number;

  readonly finalScores: FinalScoreboard | null;
  readonly actionSeq: number;
}

export const SCHEMA_VERSION = 1;
// v3: rule 7.5 — a player with every kept ticket already own-connected is forced to draw new
// tickets at the start of their turn (turn opens in TICKET_SELECTION instead of AWAIT_ACTION).
export const ENGINE_VERSION = 3;
