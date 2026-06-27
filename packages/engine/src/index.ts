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

export type { Action, ActionType, Payment } from './types/actions';
export type { GameEvent, GameEventType, Visibility } from './types/events';
export type { RedactedView, RedactedPlayer } from './types/view';

export { initGame } from './setup';
export { reduce, hasAnyLegalMove } from './reduce';
export type { ReduceResult, ReduceOutput } from './reduce';
export { currentPlayerId, endTurn } from './turn';

export { computeFinalScores } from './scoring';
export { legalActions, enumerateClaimPayments, redactFor } from './selectors';
export { stateDigest, cloneState, replay } from './serialize';
export type { ReplayResult } from './serialize';
export { checkInvariants } from './invariants';

export { longestTrail } from './graph/longestTrail';
export type { TrailEdge } from './graph/longestTrail';
export { evaluateTickets } from './graph/connectivity';
export type { Edge, TicketGoal, TicketEvaluation } from './graph/connectivity';
export { UnionFind } from './graph/unionFind';

// Re-export the canonical content + helpers for convenience.
export { TAIWAN_CONTENT, CONTENT_HASH, taiwanBoard } from './taiwan';
