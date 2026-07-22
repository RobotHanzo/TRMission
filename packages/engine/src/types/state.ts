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
  | 'LANTERN_RELOCATION'
  | 'EVENT_DRAFT'
  | 'HIVE_DRAW'
  | 'GAME_OVER';

/** A claimed route is owned; a locked route (closed double sibling in 2–3p) has no owner. */
export type OwnerCell = { readonly owner: PlayerId } | { readonly locked: true };

/**
 * Repair record for a broken-rail route (`RouteDef.brokenCarriages > 0`). A broken route with no
 * record is still broken (unclaimable); once a record exists the route is repaired. While
 * `exclusiveTurnEnds > 0` only the repairer may claim it — the counter starts at
 * `turnOrder.length + 1` and is decremented once per completed turn (including the repair turn
 * itself), so it reaches 0 exactly when the repairer's next turn has ended.
 */
export interface BrokenRailRepair {
  readonly by: PlayerId;
  readonly exclusiveTurnEnds: number;
}

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
  /** Present only after the active player used the Night Market free pre-action. */
  readonly nightMarketSwapUsed?: true;
  /** Present only after the active player used their one free team-pool push this turn. */
  readonly teamPushUsed?: true;
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
  /** Deferred random-event scoring; omitted when zero to preserve off-mode identity. */
  readonly eventBonus?: number;
  readonly total: number;
}

/** A team's aggregated end-game score. Present only in a team game. */
export interface TeamFinal {
  readonly team: number;
  readonly members: readonly PlayerId[];
  /** Sum of the members' route points / ticket nets / station bonuses. */
  readonly routePoints: number;
  readonly ticketNet: number;
  readonly ticketsCompleted: number;
  readonly stationBonus: number;
  /** Longest trail over the UNION of the team's routes (the combined-network ruling). */
  readonly longestTrailLength: number;
  readonly longestBonus: number;
  readonly eventBonus?: number;
  readonly total: number;
}

export interface FinalScoreboard {
  readonly players: readonly PlayerFinal[];
  /** Ranking as equivalence groups (a group with >1 entry = tied co-winners/places). */
  readonly ranking: readonly (readonly PlayerId[])[];
  /** Team totals, ascending by team id. Absent (key omitted) in a free-for-all game. */
  readonly teams?: readonly TeamFinal[];
  /** Team ranking as equivalence groups of team ids. Absent in a free-for-all game. */
  readonly teamRanking?: readonly (readonly number[])[];
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
  /** routeId → broken-rail repair record. Absent (key omitted, not `undefined`) until the first
   *  repair happens, so games on maps without broken rails digest byte-identically to pre-v11. */
  readonly brokenRails?: Readonly<Record<string, BrokenRailRepair>>;
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

  /**
   * Team rosters, index = team id, each listed in ascending seat order. Absent (key omitted, not
   * `undefined`) in a free-for-all game, so an FFA game digests byte-identically to a pre-v12
   * game. Membership is fixed at genesis from `seat % teamCount` and never changes.
   */
  readonly teams?: readonly (readonly PlayerId[])[];

  /**
   * Each team's face-up card pool, index-aligned with `teams`. This is the ONLY channel through
   * which teammates may pass cards — hands stay secret — and it is public to every viewer, so it
   * doubles as the signalling device that replaces table talk. Absent in a free-for-all game.
   */
  readonly teamPools?: readonly Readonly<Record<CardColor, number>>[];
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
// v8: the 13-event expansion — new event actions/phases, inventories, deck marker, and deferred
// Goddess Procession scoring. Off-mode state remains byte-identical apart from engineVersion.
// v9: deadlock end-sequence — a player with no productive move in a dead card pool must PASS
// (futile ticket draws are no longer forced), and the endgame is triggered when the pool is dead
// and no one can claim a route (ENDGAME_TRIGGERED gains `reason`). Off-path play is unchanged.
// v10: server-authorized END_GAME is a new persisted action grammar. Existing v9 action behavior
// is unchanged and remains replay-compatible, but a recovered v9 game that applies END_GAME
// upgrades its terminal state/game document to v10 so older interpreters never receive it.
// v11: broken rails (斷軌) — routes authored with `brokenCarriages > 0` are unclaimable until a
// player spends a turn on a REPAIR_ROUTE (paying brokenCarriages cards of the route colour,
// scoring routePoints[brokenCarriages]), recorded in the new optional `brokenRails` state field;
// the repairer holds exclusive claim rights until their next turn ends. Every new behavior is
// gated on the authored `brokenCarriages` field, which no pre-v11 content hash contains, so
// existing logs replay byte-identically.
// v12: team mode (組隊模式) — 4p/6p tables split into 2–3 teams. Teams share a network for ticket
// completion and for a single combined longest-trail bonus, teammates see each other's kept
// tickets, and cards move between partners only through a public per-team card pool (the new
// PUSH_TO_TEAM_POOL free action + TAKE_FROM_TEAM_POOL draw). Every new behavior is gated on the
// optional `teams` state key, which only `GameConfig.teamCount` can produce, so a free-for-all
// game carries no team keys and replays byte-identically to v9–v11.
export const ENGINE_VERSION = 12;

/**
 * Which persisted engine majors THIS engine can replay/recover byte-identically — the single gate
 * shared by server-side crash recovery, post-game replay eligibility, and every client that needs
 * to know whether a stored action log is safe to feed through its own reducer (server, web, mobile
 * all import this rather than hand-copying the list, so it cannot drift between them).
 *
 * v5 replayed a v4 log identically (only inert genesis fields added), but v6 is NOT provably inert
 * for v4/v5 (see git history), and v7 is not provably inert for v6 either: v7 locks own-track
 * ticket completions into `completedTickets` (and emits TICKET_COMPLETED) mid-game for every
 * ruleset, changing `stateDigest` at exactly the points a ticket completes. v8 adds stateful
 * future-event actions/phases and cannot replay a v7 log byte-identically. v9 changes the deadlock
 * rule (a dead-pool DRAW_TICKETS is now rejected; endgame can trigger on deadlock), so a v8 log
 * containing such an action would diverge or become illegal under v9. v10 only adds the terminal
 * END_GAME action; every existing v9 action retains identical behavior. v11's broken-rail rules
 * activate only for routes with the new authored `brokenCarriages` field — impossible under any
 * pre-v11 content hash — so v9/v10 logs replay byte-identically (the optional `brokenRails` state
 * field is never populated for them). v12's team rules activate only when `GameConfig.teamCount`
 * is set — impossible in any persisted pre-v12 config — so v9/v10/v11 logs replay byte-identically
 * (the optional `teams`/`teamPools` state keys and the `turn.teamPushUsed` flag are never
 * populated for them, and no RuleParams field was added, which would have changed every digest).
 * Only extend this list for a new version when the change is provably inert for every version
 * already listed.
 */
export const REPLAY_COMPATIBLE_ENGINE_VERSIONS: readonly number[] = [9, 10, 11, 12];
