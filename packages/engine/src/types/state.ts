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
import type { EventsState } from './events-state';

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
  /** Tickets locked as completed mid-game the instant own-track connectivity (or, under
   *  unlimitedStationBorrow, the fuller borrow-aware check) joins their endpoints. Monotonic;
   *  points are banked the moment a ticket enters this list. */
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

  /** Random-events runtime state. Absent (key omitted, not `undefined`) when the feature is off,
   *  so an off-mode game clones/digests byte-identically to a pre-v5 game. */
  readonly events?: EventsState;
}

export const SCHEMA_VERSION = 1;
// v4: two independent v3 bumps merged — main's `doubleRouteSingleFor23` ruleParam, plus rule 7.5
// forced ticket re-draw (a player with every kept ticket already own-connected is forced to draw
// new tickets at the start of their turn — the turn opens in TICKET_SELECTION, not AWAIT_ACTION).
// v5: random events — RuleParams.eventsMode + optional GameState.events; off-mode behavior
// identical to v4.
// v6: rule 7.5 also forces a re-draw when every kept ticket is locked in `completedTickets` (the
// unlimitedStationBorrow variant's station-borrow completion), not just own-connected — closing a
// gap where a borrow-only completion never triggered the forced re-draw. Off-variant behavior
// (completedTickets always empty) is identical to v5.
// v7: TICKET_COMPLETED (and the completedTickets lock) now fires for own-track completion in
// EVERY game, not just unlimitedStationBorrow — closing the gap where a standard game's ticket
// completions were never locked/announced mid-game, only computed on demand for display. This
// only changes *when* completedTickets is populated; a game's final scoring is unaffected
// (evaluatePlayerTickets always re-derives completion independently, never reading this field
// off-variant).
export const ENGINE_VERSION = 7;
