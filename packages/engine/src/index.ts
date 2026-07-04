// Public API of the pure deterministic game engine.

export type { Board } from './board';
export { buildBoard, getRoute, getTicket, siblingOf, incidentRoutes } from './board';

export type { GameConfig, PlayerSeed, DoubleRouteVariant } from './config';
export { variantForPlayerCount } from './config';

export type {
  GameState,
  PlayerState,
  TurnState,
  Phase,
  OwnerCell,
  PendingTunnel,
  StationPlacement,
  Endgame,
  PlayerFinal,
  FinalScoreboard,
} from './types/state';
export { SCHEMA_VERSION, ENGINE_VERSION } from './types/state';

export type {
  EventsState,
  EventScheduleEntry,
  ActiveEvent,
  CharterContract,
  RandomEventKind,
} from './types/events-state';
export { generateSchedule } from './events/schedule';
export { tickRound, isQuietEndgame } from './events/runtime';

export type { Action, ActionType, Payment } from './types/actions';
export type { GameEvent, GameEventType, Visibility } from './types/events';
export type {
  RedactedView,
  RedactedPlayer,
  RedactedPlayerFinal,
  RedactedFinalScoreboard,
} from './types/view';

export { initGame } from './setup';
export { reduce, hasAnyLegalMove } from './reduce';
export type { ReduceResult, ReduceOutput } from './reduce';
export { currentPlayerId, endTurn } from './turn';

export {
  computeFinalScores,
  evaluatePlayerTickets,
  longestTrailRouteIdsFor,
  stationBorrowEdges,
} from './scoring';
export type { PlayerTicketDetail } from './scoring';
export { legalActions, enumerateClaimPayments, redactFor } from './selectors';
export { stateDigest, cloneState, replay } from './serialize';
export type { ReplayResult } from './serialize';
export { checkInvariants } from './invariants';

export { longestTrail, longestTrailWithPath } from './graph/longestTrail';
export type { TrailEdge, TrailResult } from './graph/longestTrail';
export {
  evaluateTickets,
  ownConnectedTicketIds,
  borrowConnectedTicketIds,
} from './graph/connectivity';
export type { Edge, TicketGoal, TicketEvaluation, IdTicketGoal } from './graph/connectivity';
export { UnionFind } from './graph/unionFind';

// Re-export the canonical content + helpers for convenience.
export { TAIWAN_CONTENT, CONTENT_HASH, taiwanBoard, boardForContentHash } from './taiwan';
