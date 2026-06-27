/**
 * Engine rule-violation taxonomy and the single source-of-truth mapping table (ADR A18):
 * RuleViolationCode → i18n messageKey (+ a stable wire string). The proto RejectionCode
 * and the REST error.code are derived from this same catalog so localized rejection
 * messages can never drift across the four layers.
 */

export type RuleViolationCode =
  | 'NOT_YOUR_TURN'
  | 'WRONG_PHASE'
  | 'GAME_OVER'
  | 'INSUFFICIENT_CARDS'
  | 'UNKNOWN_ROUTE'
  | 'UNKNOWN_CITY'
  | 'UNKNOWN_TICKET'
  | 'ROUTE_TAKEN'
  | 'ROUTE_LOCKED'
  | 'DOUBLE_ROUTE_OWN_BOTH'
  | 'BAD_PAYMENT_LENGTH'
  | 'BAD_PAYMENT_COLOR'
  | 'FERRY_LOCOS_SHORT'
  | 'NOT_ENOUGH_TRAINS'
  | 'NOT_A_TUNNEL'
  | 'TUNNEL_BAD_EXTRA'
  | 'TUNNEL_EXTRA_UNPAYABLE'
  | 'STATION_LIMIT'
  | 'STATION_CITY_TAKEN'
  | 'STATION_ALREADY_THIS_TURN'
  | 'TICKET_KEEP_TOO_FEW'
  | 'TICKET_INVALID_SELECTION'
  | 'MARKET_SLOT_EMPTY'
  | 'FACEUP_LOCO_SECOND_DRAW'
  | 'NO_LEGAL_MOVE_REQUIRED'
  | 'NOTHING_TO_DRAW';

export interface RuleViolation {
  readonly code: RuleViolationCode;
  /** Developer-facing English message; the player-facing text comes from `messageKey`. */
  readonly message: string;
  /** Optional structured params for i18n interpolation. */
  readonly params?: Readonly<Record<string, string | number>>;
}

export interface ErrorMeta {
  /** i18n key, resolved zh-Hant primary / en fallback on the client. */
  readonly messageKey: string;
}

/** RuleViolationCode → metadata. messageKey namespace `errors:` lives in the i18n bundles. */
export const ERROR_CATALOG: Readonly<Record<RuleViolationCode, ErrorMeta>> = Object.freeze({
  NOT_YOUR_TURN: { messageKey: 'errors:notYourTurn' },
  WRONG_PHASE: { messageKey: 'errors:wrongPhase' },
  GAME_OVER: { messageKey: 'errors:gameOver' },
  INSUFFICIENT_CARDS: { messageKey: 'errors:insufficientCards' },
  UNKNOWN_ROUTE: { messageKey: 'errors:unknownRoute' },
  UNKNOWN_CITY: { messageKey: 'errors:unknownCity' },
  UNKNOWN_TICKET: { messageKey: 'errors:unknownTicket' },
  ROUTE_TAKEN: { messageKey: 'errors:routeTaken' },
  ROUTE_LOCKED: { messageKey: 'errors:routeLocked' },
  DOUBLE_ROUTE_OWN_BOTH: { messageKey: 'errors:doubleRouteOwnBoth' },
  BAD_PAYMENT_LENGTH: { messageKey: 'errors:badPaymentLength' },
  BAD_PAYMENT_COLOR: { messageKey: 'errors:badPaymentColor' },
  FERRY_LOCOS_SHORT: { messageKey: 'errors:ferryLocosShort' },
  NOT_ENOUGH_TRAINS: { messageKey: 'errors:notEnoughTrains' },
  NOT_A_TUNNEL: { messageKey: 'errors:notATunnel' },
  TUNNEL_BAD_EXTRA: { messageKey: 'errors:tunnelBadExtra' },
  TUNNEL_EXTRA_UNPAYABLE: { messageKey: 'errors:tunnelExtraUnpayable' },
  STATION_LIMIT: { messageKey: 'errors:stationLimit' },
  STATION_CITY_TAKEN: { messageKey: 'errors:stationCityTaken' },
  STATION_ALREADY_THIS_TURN: { messageKey: 'errors:stationAlreadyThisTurn' },
  TICKET_KEEP_TOO_FEW: { messageKey: 'errors:ticketKeepTooFew' },
  TICKET_INVALID_SELECTION: { messageKey: 'errors:ticketInvalidSelection' },
  MARKET_SLOT_EMPTY: { messageKey: 'errors:marketSlotEmpty' },
  FACEUP_LOCO_SECOND_DRAW: { messageKey: 'errors:faceupLocoSecondDraw' },
  NO_LEGAL_MOVE_REQUIRED: { messageKey: 'errors:noLegalMoveRequired' },
  NOTHING_TO_DRAW: { messageKey: 'errors:nothingToDraw' },
});

export function violation(
  code: RuleViolationCode,
  message: string,
  params?: Record<string, string | number>,
): RuleViolation {
  return params === undefined ? { code, message } : { code, message, params };
}

export function messageKeyFor(code: RuleViolationCode): string {
  return ERROR_CATALOG[code].messageKey;
}
