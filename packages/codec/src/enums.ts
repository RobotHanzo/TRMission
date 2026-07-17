// Enum mapping between the engine's string unions and the protobuf-es numeric
// enums. This is half of the engine⇄wire seam; the message-shape mapping lives in
// snapshot/event/command codecs. Keeping it in one place makes drift impossible
// to miss (ADR A18/A19).
import {
  CardColor as PbCardColor,
  Phase as PbPhase,
  RejectionCode as PbRejectionCode,
  BentoSpend as PbBentoSpend,
  EventPerk as PbEventPerk,
} from '@trm/proto';
import type { CardColor, TrainColor, RuleViolationCode } from '@trm/shared';
import type { Phase, EventPerk } from '@trm/engine';

const CARD_TO_PB: Record<CardColor, PbCardColor> = {
  RED: PbCardColor.RED,
  ORANGE: PbCardColor.ORANGE,
  YELLOW: PbCardColor.YELLOW,
  GREEN: PbCardColor.GREEN,
  BLUE: PbCardColor.BLUE,
  PURPLE: PbCardColor.PURPLE,
  BLACK: PbCardColor.BLACK,
  WHITE: PbCardColor.WHITE,
  LOCOMOTIVE: PbCardColor.LOCOMOTIVE,
};

const PB_TO_CARD: Partial<Record<PbCardColor, CardColor>> = {
  [PbCardColor.RED]: 'RED',
  [PbCardColor.ORANGE]: 'ORANGE',
  [PbCardColor.YELLOW]: 'YELLOW',
  [PbCardColor.GREEN]: 'GREEN',
  [PbCardColor.BLUE]: 'BLUE',
  [PbCardColor.PURPLE]: 'PURPLE',
  [PbCardColor.BLACK]: 'BLACK',
  [PbCardColor.WHITE]: 'WHITE',
  [PbCardColor.LOCOMOTIVE]: 'LOCOMOTIVE',
};

/** Engine card colour → proto. */
export const cardToPb = (c: CardColor): PbCardColor => CARD_TO_PB[c];

/** A market slot: a card, or null when the deck+discard are exhausted → UNSPECIFIED. */
export const cardOrNullToPb = (c: CardColor | null): PbCardColor =>
  c === null ? PbCardColor.UNSPECIFIED : CARD_TO_PB[c];

/**
 * Proto colour → the engine's `Payment.color` (a TrainColor or null). UNSPECIFIED
 * and LOCOMOTIVE both map to null (an all-locomotive / no-coloured-portion payment);
 * the engine's payment validator rejects any inconsistent colour/count combination.
 */
export const pbToTrainColorOrNull = (c: PbCardColor): TrainColor | null => {
  const card = PB_TO_CARD[c];
  return card === undefined || card === 'LOCOMOTIVE' ? null : card;
};

const PHASE_TO_PB: Record<Phase, PbPhase> = {
  SETUP_TICKETS: PbPhase.SETUP_TICKETS,
  AWAIT_ACTION: PbPhase.AWAIT_ACTION,
  DRAWING_CARDS: PbPhase.DRAWING_CARDS,
  TICKET_SELECTION: PbPhase.TICKET_SELECTION,
  TUNNEL_PENDING: PbPhase.TUNNEL_PENDING,
  LANTERN_RELOCATION: PbPhase.LANTERN_RELOCATION,
  EVENT_DRAFT: PbPhase.EVENT_DRAFT,
  HIVE_DRAW: PbPhase.HIVE_DRAW,
  GAME_OVER: PbPhase.GAME_OVER,
};

export const phaseToPb = (p: Phase): PbPhase => PHASE_TO_PB[p];

const REJECTION_TO_PB: Record<RuleViolationCode, PbRejectionCode> = {
  NOT_YOUR_TURN: PbRejectionCode.NOT_YOUR_TURN,
  WRONG_PHASE: PbRejectionCode.WRONG_PHASE,
  GAME_OVER: PbRejectionCode.GAME_OVER,
  INSUFFICIENT_CARDS: PbRejectionCode.INSUFFICIENT_CARDS,
  UNKNOWN_ROUTE: PbRejectionCode.UNKNOWN_ROUTE,
  UNKNOWN_CITY: PbRejectionCode.UNKNOWN_CITY,
  UNKNOWN_TICKET: PbRejectionCode.UNKNOWN_TICKET,
  ROUTE_TAKEN: PbRejectionCode.ROUTE_TAKEN,
  ROUTE_LOCKED: PbRejectionCode.ROUTE_LOCKED,
  DOUBLE_ROUTE_OWN_BOTH: PbRejectionCode.DOUBLE_ROUTE_OWN_BOTH,
  BAD_PAYMENT_LENGTH: PbRejectionCode.BAD_PAYMENT_LENGTH,
  BAD_PAYMENT_COLOR: PbRejectionCode.BAD_PAYMENT_COLOR,
  FERRY_LOCOS_SHORT: PbRejectionCode.FERRY_LOCOS_SHORT,
  NOT_ENOUGH_TRAINS: PbRejectionCode.NOT_ENOUGH_TRAINS,
  NOT_A_TUNNEL: PbRejectionCode.NOT_A_TUNNEL,
  TUNNEL_BAD_EXTRA: PbRejectionCode.TUNNEL_BAD_EXTRA,
  TUNNEL_EXTRA_UNPAYABLE: PbRejectionCode.TUNNEL_EXTRA_UNPAYABLE,
  STATION_LIMIT: PbRejectionCode.STATION_LIMIT,
  STATION_CITY_TAKEN: PbRejectionCode.STATION_CITY_TAKEN,
  STATION_ALREADY_THIS_TURN: PbRejectionCode.STATION_ALREADY_THIS_TURN,
  TICKET_KEEP_TOO_FEW: PbRejectionCode.TICKET_KEEP_TOO_FEW,
  TICKET_INVALID_SELECTION: PbRejectionCode.TICKET_INVALID_SELECTION,
  MARKET_SLOT_EMPTY: PbRejectionCode.MARKET_SLOT_EMPTY,
  FACEUP_LOCO_SECOND_DRAW: PbRejectionCode.FACEUP_LOCO_SECOND_DRAW,
  NO_LEGAL_MOVE_REQUIRED: PbRejectionCode.NO_LEGAL_MOVE_REQUIRED,
  NOTHING_TO_DRAW: PbRejectionCode.NOTHING_TO_DRAW,
  ROUTE_CLOSED_BY_EVENT: PbRejectionCode.ROUTE_CLOSED_BY_EVENT,
  EVENT_CLAIMS_SUSPENDED: PbRejectionCode.EVENT_CLAIMS_SUSPENDED,
  EVENT_STATIONS_SUSPENDED: PbRejectionCode.EVENT_STATIONS_SUSPENDED,
  EVENT_FACEUP_LOCO_BLOCKED: PbRejectionCode.EVENT_FACEUP_LOCO_BLOCKED,
  EVENT_REPAIR_UNAVAILABLE: PbRejectionCode.EVENT_REPAIR_UNAVAILABLE,
  EVENT_REPAIR_PAYMENT_INVALID: PbRejectionCode.EVENT_REPAIR_PAYMENT_INVALID,
  EVENT_NIGHT_MARKET_UNAVAILABLE: PbRejectionCode.EVENT_NIGHT_MARKET_UNAVAILABLE,
  EVENT_LANTERN_RELOCATION_INVALID: PbRejectionCode.EVENT_LANTERN_RELOCATION_INVALID,
  EVENT_DRAFT_CHOICE_INVALID: PbRejectionCode.EVENT_DRAFT_CHOICE_INVALID,
  EVENT_HIVE_UNAVAILABLE: PbRejectionCode.EVENT_HIVE_UNAVAILABLE,
  EVENT_RESOURCE_UNAVAILABLE: PbRejectionCode.EVENT_RESOURCE_UNAVAILABLE,
  ROUTE_BROKEN: PbRejectionCode.ROUTE_BROKEN,
  ROUTE_REPAIR_EXCLUSIVE: PbRejectionCode.ROUTE_REPAIR_EXCLUSIVE,
};

export const pbToCardColorOrNull = (c: PbCardColor): CardColor | null => PB_TO_CARD[c] ?? null;

export const rejectionToPb = (code: RuleViolationCode): PbRejectionCode => REJECTION_TO_PB[code];

export const pbToBentoSpend = (value: PbBentoSpend): 'WILD' | 'POINTS' | undefined =>
  value === PbBentoSpend.WILD ? 'WILD' : value === PbBentoSpend.POINTS ? 'POINTS' : undefined;

const PERK_TO_PB: Record<EventPerk, PbEventPerk> = {
  CLAIM_DISCOUNT: PbEventPerk.CLAIM_DISCOUNT,
  DRAW_TWO: PbEventPerk.DRAW_TWO,
  REPAIR_PERMIT: PbEventPerk.REPAIR_PERMIT,
};

export const eventPerkToPb = (perk: EventPerk): PbEventPerk => PERK_TO_PB[perk];

export const pbToEventPerk = (perk: PbEventPerk): EventPerk | null => {
  switch (perk) {
    case PbEventPerk.CLAIM_DISCOUNT:
      return 'CLAIM_DISCOUNT';
    case PbEventPerk.DRAW_TWO:
      return 'DRAW_TWO';
    case PbEventPerk.REPAIR_PERMIT:
      return 'REPAIR_PERMIT';
    default:
      return null;
  }
};
