import type {
  PlayerId,
  RouteId,
  CityId,
  TicketId,
  CardColor,
  SeatIndex,
  Hand,
  EventsMode,
} from '@trm/shared';
import type {
  Phase,
  OwnerCell,
  BrokenRailRepair,
  StationPlacement,
  Endgame,
  PlayerFinal,
  TeamFinal,
} from './state';
import type {
  ActiveEvent,
  CharterContract,
  RandomEventKind,
  LuckyContract,
  LanternHostState,
  LanternRelocationState,
  EventDraftState,
  PendingHiveDraw,
} from './events-state';

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
  /** Team totals + team ranking. Absent in a free-for-all game. */
  readonly teams?: readonly TeamFinal[];
  readonly teamRanking?: readonly (readonly number[])[];
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
  readonly bentoTokens: number;
  readonly blessings: number;
  readonly claimDiscounts: number;
  readonly repairPermits: number;
  /** Own hand only (null for opponents — a TEAMMATE'S HAND IS NOT VISIBLE either; the team pool
   *  is the only card channel between partners). */
  readonly hand: Hand | null;
  /** Own kept tickets, a teammate's in a team game, or everyone's at GAME_OVER (null otherwise). */
  readonly keptTickets: readonly TicketId[] | null;
  /** Own pending offer only. */
  readonly pendingTicketOffer: readonly TicketId[] | null;
  /** This player's team id, or null in a free-for-all. */
  readonly team: number | null;
}

export interface RedactedView {
  readonly schemaVersion: number;
  readonly contentHash: string;
  readonly phase: Phase;
  readonly orderIndex: number;
  readonly currentPlayer: PlayerId | null;
  /** True iff `viewer` is the current player in AWAIT_ACTION with no legal move — surface a Pass
   *  control. Always false for opponents/spectators (the client cannot derive it from a redacted
   *  snapshot, so the server computes it here). */
  readonly youMustPass: boolean;
  readonly turnOrder: readonly PlayerId[];

  readonly market: readonly (CardColor | null)[];
  readonly deckCount: number;
  readonly discard: Readonly<Record<CardColor, number>>;
  readonly ticketDeckLongCount: number;
  readonly ticketDeckShortCount: number;

  readonly ownership: Readonly<Record<string, OwnerCell>>;
  /** Broken-rail repair records (public). Absent until the first repair happens. */
  readonly brokenRails?: Readonly<Record<string, BrokenRailRepair>>;
  readonly stations: readonly StationPlacement[];
  readonly endgame: Endgame;

  /**
   * Tunnel reveal is public information. `playedColor` is the single non-loco colour the
   * claimant played (null for an all-locomotive base claim) — the colour the surcharge must
   * be matched in; published so every viewer can render the surcharge combination.
   */
  readonly pendingTunnel: {
    readonly player: PlayerId;
    readonly routeId: RouteId;
    readonly revealed: readonly CardColor[];
    readonly extraRequired: number;
    readonly playedColor: CardColor | null;
  } | null;

  readonly players: readonly RedactedPlayer[];
  readonly finalScores: RedactedFinalScoreboard | null;

  /**
   * Team rosters (index = team id) and each team's PUBLIC card pool. Absent in a free-for-all.
   * The pools are open information on purpose: with hands secret and no table talk, the pool is
   * the channel partners signal through, so every player must be able to read it.
   */
  readonly teams?: {
    readonly rosters: readonly (readonly PlayerId[])[];
    readonly pools: readonly Hand[];
    /** How many cards a pool may hold, so clients can render remaining capacity. */
    readonly capacity: number;
    /** True iff the viewer has already spent their one free push this turn. */
    readonly youPushedThisTurn: boolean;
  };

  /** Active rule variants for this game (display only — consequences are already baked in). */
  readonly settings: {
    readonly unlimitedStationBorrow: boolean;
    readonly secondDrawAfterBlindRainbow: boolean;
    readonly noUnfinishedTicketPenalty: boolean;
    readonly doubleRouteSingleFor23: boolean;
    readonly eventsMode: EventsMode;
    /** Number of teams, or 0 in a free-for-all. */
    readonly teamCount: number;
  };

  /**
   * Tickets revealed because their owner has COMPLETED them with their own routes (own-track
   * connectivity, no station borrowing). Public to every viewer — in-progress tickets stay secret.
   */
  readonly completedTickets: readonly { readonly player: PlayerId; readonly ticket: TicketId }[];

  /**
   * Random-events projection (absent when the feature is off). The hidden schedule, `nextIdx`, and
   * `suppressed` never appear here — only currently-live effects plus a one-round `forecast` of the
   * next telegraphed entry (exactly its announced window). Viewer-independent (spectators see the
   * same block).
   */
  readonly events?: {
    readonly mode: Exclude<EventsMode, 'off'>;
    readonly roundIndex: number;
    readonly active: readonly ActiveEvent[];
    /** The next telegraphed entry, only during its one-round announced window; else null. */
    readonly forecast: {
      readonly id: string;
      readonly kind: RandomEventKind;
      readonly startRound: number;
      readonly durationRounds: number;
      readonly routeIds?: readonly RouteId[];
      readonly region?: string;
      readonly cityId?: CityId;
      readonly cityPath?: readonly CityId[];
      readonly pair?: { readonly a: CityId; readonly b: CityId };
    } | null;
    /** Permanent viral-hotspot levels, sorted by cityId. */
    readonly hotspots: readonly { readonly cityId: CityId; readonly level: number }[];
    readonly charters: readonly CharterContract[];
    readonly reopenBonusRouteIds: readonly RouteId[];
    /** Resolved: routeIds of active TYPHOON_LANDFALL events that are still unclaimed. */
    readonly closedRouteIds: readonly RouteId[];
    readonly freeStationAvailable: boolean;
    readonly lanternHost: LanternHostState | null;
    readonly lanternPendingRelocation: LanternRelocationState | null;
    readonly luckyContracts: readonly LuckyContract[];
    readonly repairedRouteIds: readonly RouteId[];
    readonly eventDraft: EventDraftState | null;
    readonly pendingHiveDraw: PendingHiveDraw | null;
    readonly boringActive: boolean;
    readonly nightMarketSwapAvailable: boolean;
  };
}
