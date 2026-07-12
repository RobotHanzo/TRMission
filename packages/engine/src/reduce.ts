import type { PlayerId, RouteId, CityId, TicketId, CardColor, TrainColor } from '@trm/shared';
import type { Result, RuleViolation } from '@trm/shared';
import { ok, err, violation, asTicketId } from '@trm/shared';
import type { RouteDef } from '@trm/map-data';
import type { Board } from './board';
import { getRoute, groupMembersOf } from './board';
import { openTrackCount } from './config';
import type { GameState } from './types/state';
import type { CharterContract } from './types/events-state';
import type { Action, Payment, EventPerk } from './types/actions';
import type { GameEvent } from './types/events';
import { refillMarket } from './deck';
import { emptyHand, totalCards } from './hand';
import type { CardCounts } from './hand';
import { validateRoutePayment, validateStationPayment } from './payments';
import { currentPlayerId, endTurn } from './turn';
import { offerTickets, allKeptTicketsCompleted } from './tickets';
import { getPlayer, withPlayer, spendCards, addCardToHand, setOwnership } from './reducers/common';
import {
  borrowConnectedTicketIds,
  ownConnectedTicketIds,
  citiesConnected,
} from './graph/connectivity';
import { stationBorrowEdges } from './scoring';
import {
  isRouteClosed,
  claimsSuspended,
  stationsSuspended,
  skyLanternSurcharge,
  skyLanternDoubles,
  tunnelRevealExtra,
  effectiveTunnelRevealCount,
  dayOffExtraDraw,
  takeReopenBonus,
  hotspotLevel,
  stampRallyActive,
  freeStationAvailable,
  consumeFreeStation,
  playerOwnEdges,
  playerNetworkCities,
  eventResources,
  updateEventResources,
  allSeatsReservedActive,
  hiveOfSparksActive,
  harvestFestivalActive,
  activeBentoCity,
  activeNightMarketCity,
  canUseNightMarketSwap,
  processionCurrentCity,
  activeHarvestRegion,
  routeTouchesCity,
  routeTouchesRegion,
} from './events/effects';
import { drawEventCard, applyEventRefill } from './events/draw';
import { hasAnyLegalMove } from './legality';

export interface ReduceOutput {
  readonly state: GameState;
  readonly events: GameEvent[];
}
export type ReduceResult = Result<ReduceOutput, RuleViolation>;

/** reduce = validate + apply. Pure: returns a fresh state + emitted events, or a rule violation. */
export function reduce(board: Board, state: GameState, action: Action): ReduceResult {
  const res = dispatch(board, state, action);
  if (!res.ok) return res;
  // Every applied action advances the audit cursor.
  return ok({
    state: { ...res.value.state, actionSeq: state.actionSeq + 1 },
    events: res.value.events,
  });
}

function dispatch(board: Board, state: GameState, action: Action): ReduceResult {
  const phase = state.turn.phase;
  if (phase === 'GAME_OVER') return err(violation('GAME_OVER', 'game is over'));

  if (phase === 'SETUP_TICKETS') {
    if (action.t !== 'KEEP_INITIAL_TICKETS')
      return err(violation('WRONG_PHASE', 'awaiting initial tickets'));
    return applyKeepInitial(board, state, action.player, action.keep);
  }

  // In-game phases: must be the active player.
  if (action.player !== currentPlayerId(state))
    return err(violation('NOT_YOUR_TURN', 'not your turn'));

  switch (phase) {
    case 'AWAIT_ACTION':
      switch (action.t) {
        case 'DRAW_BLIND':
          return applyDrawBlind(board, state, action.player);
        case 'DRAW_FACEUP':
          return applyDrawFaceup(board, state, action.player, action.slot);
        case 'DRAW_TICKETS':
          return applyDrawTickets(board, state, action.player);
        case 'CLAIM_ROUTE':
          return applyClaimRoute(board, state, action.player, action.routeId, action.payment);
        case 'BUILD_STATION':
          return applyBuildStation(board, state, action.player, action.cityId, action.payment);
        case 'REPAIR_ROUTE':
          return applyRepairRoute(board, state, action.player, action.routeId, action.payment);
        case 'NIGHT_MARKET_SWAP':
          return applyNightMarketSwap(board, state, action.player, action.giveColor, action.slot);
        case 'START_HIVE_DRAW':
          return applyStartHiveDraw(board, state, action.player);
        case 'PASS':
          return applyPass(board, state, action.player);
        default:
          return err(violation('WRONG_PHASE', 'illegal action for AWAIT_ACTION'));
      }
    case 'DRAWING_CARDS':
      if (action.t === 'DRAW_BLIND') return applyDrawBlind(board, state, action.player);
      if (action.t === 'DRAW_FACEUP')
        return applyDrawFaceup(board, state, action.player, action.slot);
      return err(violation('WRONG_PHASE', 'must finish drawing'));
    case 'TICKET_SELECTION':
      if (action.t === 'KEEP_TICKETS')
        return applyKeepTickets(board, state, action.player, action.keep);
      return err(violation('WRONG_PHASE', 'must select tickets'));
    case 'TUNNEL_PENDING':
      if (action.t === 'RESOLVE_TUNNEL')
        return applyResolveTunnel(board, state, action.player, action.commit, action.extra);
      return err(violation('WRONG_PHASE', 'must resolve tunnel'));
    case 'LANTERN_RELOCATION':
      if (action.t === 'RELOCATE_LANTERN_HOST')
        return applyRelocateLanternHost(board, state, action.player, action.cityId);
      return err(violation('WRONG_PHASE', 'must relocate the lantern host'));
    case 'EVENT_DRAFT':
      if (action.t === 'CHOOSE_EVENT_PERK')
        return applyChooseEventPerk(board, state, action.player, action.perk);
      return err(violation('WRONG_PHASE', 'must choose an event perk'));
    case 'HIVE_DRAW':
      if (action.t === 'CONTINUE_HIVE_DRAW')
        return applyContinueHiveDraw(board, state, action.player);
      if (action.t === 'STOP_HIVE_DRAW') return applyStopHiveDraw(board, state, action.player);
      return err(violation('WRONG_PHASE', 'must continue or stop the hive draw'));
    default:
      return err(violation('WRONG_PHASE', 'unknown phase'));
  }
}

// ─────────────────────────────────────────── ticket selection ───────────────────────────────

function validateKeep(
  board: Board,
  offer: readonly TicketId[] | null,
  keep: readonly TicketId[],
  minKeep: number,
  mustKeepLong = false,
): RuleViolation | null {
  if (!offer) return violation('WRONG_PHASE', 'no ticket offer pending');
  const offerSet = new Set(offer as readonly string[]);
  const seen = new Set<string>();
  for (const id of keep) {
    if (!offerSet.has(id as string))
      return violation('TICKET_INVALID_SELECTION', 'kept a ticket not offered');
    if (seen.has(id as string))
      return violation('TICKET_INVALID_SELECTION', 'duplicate kept ticket');
    if (!board.ticketById.has(id as string)) return violation('UNKNOWN_TICKET', 'unknown ticket');
    seen.add(id as string);
  }
  if (keep.length < minKeep)
    return violation('TICKET_KEEP_TOO_FEW', `keep at least ${minKeep}`, { min: minKeep });
  if (mustKeepLong) {
    for (const id of offer) {
      if (board.ticketById.get(id as string)?.deck === 'LONG' && !seen.has(id as string))
        return violation('TICKET_INVALID_SELECTION', 'long route tickets must all be kept');
    }
  }
  return null;
}

/** Returned (un-kept) tickets go to the BOTTOM of their respective decks. */
function returnTickets(
  board: Board,
  state: GameState,
  offer: readonly TicketId[],
  keep: readonly TicketId[],
): { ticketDeckLong: TicketId[]; ticketDeckShort: TicketId[] } {
  const keepSet = new Set(keep as readonly string[]);
  const long = [...state.ticketDeckLong];
  const short = [...state.ticketDeckShort];
  for (const id of offer) {
    if (keepSet.has(id as string)) continue;
    const def = board.ticketById.get(id as string);
    if (def?.deck === 'LONG') long.unshift(id);
    else short.unshift(id);
  }
  return { ticketDeckLong: long, ticketDeckShort: short };
}

function applyKeepInitial(
  board: Board,
  state: GameState,
  player: PlayerId,
  keep: readonly TicketId[],
): ReduceResult {
  const p = getPlayer(state, player);
  if (!p) return err(violation('NOT_YOUR_TURN', 'unknown player'));
  if (!p.pendingTicketOffer) return err(violation('WRONG_PHASE', 'already kept initial tickets'));
  const v = validateKeep(board, p.pendingTicketOffer, keep, state.ruleParams.minKeepInitial, true);
  if (v) return err(v);

  const { ticketDeckLong, ticketDeckShort } = returnTickets(
    board,
    state,
    p.pendingTicketOffer,
    keep,
  );
  let next: GameState = {
    ...withPlayer(state, player, (pl) => ({
      ...pl,
      keptTickets: [...pl.keptTickets, ...keep],
      pendingTicketOffer: null,
    })),
    ticketDeckLong,
    ticketDeckShort,
  };

  const events: GameEvent[] = [
    { e: 'INITIAL_TICKETS_KEPT', player, keptCount: keep.length, visibility: 'PUBLIC' },
  ];

  // When every player has resolved their initial offer, the game begins.
  const allResolved = state.turnOrder.every(
    (id) => next.players[id as string]?.pendingTicketOffer === null,
  );
  if (allResolved) {
    next = { ...next, turn: { orderIndex: 0, phase: 'AWAIT_ACTION', cardsDrawnThisTurn: 0 } };
    events.push({
      e: 'TURN_STARTED',
      player: next.turnOrder[0] as PlayerId,
      orderIndex: 0,
      visibility: 'PUBLIC',
    });
  }
  return ok({ state: next, events });
}

function applyKeepTickets(
  board: Board,
  state: GameState,
  player: PlayerId,
  keep: readonly TicketId[],
): ReduceResult {
  const p = getPlayer(state, player);
  if (!p) return err(violation('NOT_YOUR_TURN', 'unknown player'));
  const v = validateKeep(board, p.pendingTicketOffer, keep, state.ruleParams.minKeepNormal);
  if (v) return err(v);
  const offer = p.pendingTicketOffer as readonly TicketId[];
  const { ticketDeckLong, ticketDeckShort } = returnTickets(board, state, offer, keep);
  let next: GameState = {
    ...withPlayer(state, player, (pl) => ({
      ...pl,
      keptTickets: [...pl.keptTickets, ...keep],
      pendingTicketOffer: null,
    })),
    ticketDeckLong,
    ticketDeckShort,
  };
  // A freshly-kept ticket may already be satisfied by the player's existing network — lock it now.
  const lock = lockCompletedTickets(board, next);
  next = lock.state;
  const out = endTurn(board, next, { wasPass: false });
  return ok({
    state: out.state,
    events: [
      { e: 'TICKETS_KEPT', player, keptCount: keep.length, visibility: 'PUBLIC' },
      ...lock.events,
      ...out.events,
    ],
  });
}

function applyDrawTickets(board: Board, state: GameState, player: PlayerId): ReduceResult {
  // A stuck player (dead pool, no productive move) may not draw futile tickets — PASS is their sole
  // legal move (A15, the deadlock fix). Otherwise draw as before; an empty short deck stays an error.
  if (!hasAnyLegalMove(board, state, player))
    return err(violation('NOTHING_TO_DRAW', 'no productive move — must pass'));
  // Shared with the forced re-draw (rule 7.5); here an empty short deck is an explicit error.
  const offer = offerTickets(state, player);
  if (!offer) return err(violation('NOTHING_TO_DRAW', 'ticket deck empty'));
  return ok(offer);
}

// ─────────────────────────────────────────────── drawing cards ──────────────────────────────

/** Is there any card left anywhere a second draw could take (blind pool or a non-loco face-up)? */
function hasSecondDrawAvailable(state: GameState): boolean {
  if (state.deck.length > 0 || totalCards(state.discard) > 0) return true;
  return state.market.some((c) => c !== null && c !== 'LOCOMOTIVE');
}

function applyDrawBlind(board: Board, state: GameState, player: PlayerId): ReduceResult {
  const d = drawEventCard(state);
  const isFirst = state.turn.phase === 'AWAIT_ACTION';

  if (d.card === null) {
    if (isFirst) return err(violation('NOTHING_TO_DRAW', 'no cards to draw'));
    // Stuck mid-draw with nothing left: end the turn with the one card already taken.
    const out = endTurn(board, state, { wasPass: false });
    return ok({ state: out.state, events: out.events });
  }
  const events: GameEvent[] = [...d.events];
  let next: GameState = d.state;
  next = addCardToHand(next, player, d.card);
  events.push({ e: 'CARD_DRAWN_BLIND', player, card: d.card, visibility: { private: player } });

  // Draw-limit: 2 picks per turn, +1 while a typhoon day off is active. A blind rainbow still
  // consumes the normal BASE draw on the FIRST pick (variant default) — but the day-off's own
  // bonus card is a separate allowance and still owed afterward.
  const drawn = (isFirst ? 0 : state.turn.cardsDrawnThisTurn) + 1;
  const extraDraw = dayOffExtraDraw(state);
  const limit = 2 + extraDraw;

  if (isFirst && d.card === 'LOCOMOTIVE' && !state.ruleParams.secondDrawAfterBlindRainbow) {
    if (extraDraw > 0 && hasSecondDrawAvailable(next)) {
      // Base allotment (2 picks) is spent by the locomotive; only the day-off bonus remains.
      next = { ...next, turn: { ...next.turn, phase: 'DRAWING_CARDS', cardsDrawnThisTurn: 2 } };
      return ok({ state: next, events });
    }
    const out = endTurn(board, next, { wasPass: false });
    return ok({ state: out.state, events: [...events, ...out.events] });
  }
  if (drawn >= limit || !hasSecondDrawAvailable(next)) {
    // Limit reached, or deck+discard+market are exhausted/unusable so a further pick is provably
    // impossible (DRAWING_CARDS has no PASS escape) — end the turn now.
    const out = endTurn(board, next, { wasPass: false });
    return ok({ state: out.state, events: [...events, ...out.events] });
  }
  next = { ...next, turn: { ...next.turn, phase: 'DRAWING_CARDS', cardsDrawnThisTurn: drawn } };
  return ok({ state: next, events });
}

function applyDrawFaceup(
  board: Board,
  state: GameState,
  player: PlayerId,
  slot: number,
): ReduceResult {
  if (slot < 0 || slot >= state.market.length)
    return err(violation('MARKET_SLOT_EMPTY', 'bad market slot'));
  const card = state.market[slot];
  if (card === null || card === undefined)
    return err(violation('MARKET_SLOT_EMPTY', 'empty market slot'));
  const isFirst = state.turn.phase === 'AWAIT_ACTION';

  if (card === 'LOCOMOTIVE' && allSeatsReservedActive(state)) {
    return err(
      violation('EVENT_FACEUP_LOCO_BLOCKED', 'face-up locomotives are reserved during this event'),
    );
  }

  // A face-up Locomotive may not be taken as the SECOND draw.
  if (card === 'LOCOMOTIVE' && !isFirst) {
    return err(
      violation('FACEUP_LOCO_SECOND_DRAW', 'cannot take a face-up locomotive as the second draw'),
    );
  }

  const newMarket = state.market.slice();
  newMarket[slot] = null;
  const refill = refillMarket(
    newMarket,
    state.deck,
    state.discard,
    state.rng,
    state.ruleParams,
    harvestFestivalActive(state),
  );
  const applied = applyEventRefill(state, refill);
  let next: GameState = applied.state;
  next = addCardToHand(next, player, card);

  const events: GameEvent[] = [
    { e: 'CARD_TAKEN_FACEUP', player, slot, card, visibility: 'PUBLIC' },
    ...applied.events,
  ];
  events.push({ e: 'MARKET_REFILLED', market: refill.market, visibility: 'PUBLIC' });

  // Draw-limit: 2 picks per turn, +1 while a typhoon day off is active.
  const drawn = (isFirst ? 0 : state.turn.cardsDrawnThisTurn) + 1;
  const extraDraw = dayOffExtraDraw(state);
  const limit = 2 + extraDraw;

  // Taking a face-up Locomotive (only possible on the first pick — the guard above rejects it later)
  // consumes the base allotment (both normal picks) — but the day-off's own bonus card is a
  // separate allowance and still owed afterward.
  if (card === 'LOCOMOTIVE') {
    if (extraDraw > 0 && hasSecondDrawAvailable(next)) {
      next = { ...next, turn: { ...next.turn, phase: 'DRAWING_CARDS', cardsDrawnThisTurn: 2 } };
      return ok({ state: next, events });
    }
    const out = endTurn(board, next, { wasPass: false });
    return ok({ state: out.state, events: [...events, ...out.events] });
  }
  if (drawn >= limit || !hasSecondDrawAvailable(next)) {
    // Limit reached, or deck+discard+market are exhausted/unusable so a further pick is provably
    // impossible (DRAWING_CARDS has no PASS escape) — end the turn now.
    const out = endTurn(board, next, { wasPass: false });
    return ok({ state: out.state, events: [...events, ...out.events] });
  }
  next = { ...next, turn: { ...next.turn, phase: 'DRAWING_CARDS', cardsDrawnThisTurn: drawn } };
  return ok({ state: next, events });
}

// ──────────────────────────────────────────────── claim / tunnel ────────────────────────────

function claimPreconditions(
  board: Board,
  state: GameState,
  player: PlayerId,
  routeId: RouteId,
): Result<RouteDef, RuleViolation> {
  const route = getRoute(board, routeId);
  if (!route) return err(violation('UNKNOWN_ROUTE', 'unknown route'));
  const cell = state.ownership[routeId as string];
  if (cell) {
    if ('locked' in cell) return err(violation('ROUTE_LOCKED', 'route is locked'));
    return err(violation('ROUTE_TAKEN', 'route already claimed'));
  }
  if (isRouteClosed(state, routeId))
    return err(violation('ROUTE_CLOSED_BY_EVENT', 'route closed by a typhoon landfall'));
  for (const other of groupMembersOf(board, routeId)) {
    const oc = state.ownership[other as string];
    if (oc && 'owner' in oc && oc.owner === player) {
      return err(violation('DOUBLE_ROUTE_OWN_BOTH', 'cannot own two tracks of a parallel route'));
    }
  }
  return ok(route);
}

function validateClaimEventResources(
  state: GameState,
  player: PlayerId,
  payment: Payment,
): RuleViolation | null {
  const resources = eventResources(state, player);
  if (payment.bentoSpend && resources.bentoTokens <= 0) {
    return violation('EVENT_RESOURCE_UNAVAILABLE', 'no Bento Rush token available');
  }
  if (payment.useClaimDiscount && resources.claimDiscounts <= 0) {
    return violation('EVENT_RESOURCE_UNAVAILABLE', 'no claim-discount perk available');
  }
  return null;
}

function consumeClaimEventResources(
  state: GameState,
  player: PlayerId,
  payment: Payment,
): GameState {
  if (!payment.bentoSpend && !payment.useClaimDiscount) return state;
  return updateEventResources(state, player, (resources) => ({
    ...resources,
    bentoTokens: resources.bentoTokens - (payment.bentoSpend ? 1 : 0),
    claimDiscounts: resources.claimDiscounts - (payment.useClaimDiscount ? 1 : 0),
  }));
}

/** Apply ownership/sibling-lock/trains/points for a claim (does NOT spend cards or end the turn). */
function applyClaimEffects(
  board: Board,
  state: GameState,
  player: PlayerId,
  route: RouteDef,
  payment: Payment,
): { state: GameState; events: GameEvent[] } {
  // Stamp-rally counts cities NEW to the claimer's network, so snapshot it BEFORE the claim (from
  // pre-claim ownership). Null when no stamp-rally window is active (off mode / feature absent).
  const preClaimCities = stampRallyActive(state) ? playerNetworkCities(board, state, player) : null;

  let next = setOwnership(state, route.id as string, { owner: player });

  // Parallel-group lock is emitted AFTER the claim/bonus events; buffer it here. Once the group's
  // owned tracks reach the open-track count, every remaining track locks. For a 2-member group at
  // 2–3p this reduces to the historical "lock the one sibling."
  const lockedEvents: GameEvent[] = [];
  const groupMembers = groupMembersOf(board, route.id);
  if (groupMembers.length > 0) {
    const open = openTrackCount(
      groupMembers.length + 1,
      state.turnOrder.length,
      state.ruleParams.doubleRouteSingleFor23,
    );
    let owned = 1; // the route just claimed
    for (const other of groupMembers) {
      const oc = next.ownership[other as string];
      if (oc && 'owner' in oc) owned++;
    }
    if (owned >= open) {
      for (const other of groupMembers) {
        if (!next.ownership[other as string]) {
          next = setOwnership(next, other as string, { locked: true });
          lockedEvents.push({ e: 'DOUBLE_ROUTE_LOCKED', routeId: other, visibility: 'PUBLIC' });
        }
      }
    }
  }

  // Sky-lantern doubles the route's board points at claim time (reflected in pointsAwarded); off
  // mode / non-surcharged routes keep today's value byte-identically.
  const basePoints = state.ruleParams.routePoints[route.length] ?? 0;
  const points = skyLanternDoubles(next, route.id) ? basePoints * 2 : basePoints;
  next = withPlayer(next, player, (p) => ({
    ...p,
    trainCars: p.trainCars - route.length,
    routePoints: p.routePoints + points,
  }));

  const events: GameEvent[] = [
    {
      e: 'ROUTE_CLAIMED',
      player,
      routeId: route.id,
      pointsAwarded: points,
      visibility: 'PUBLIC',
    },
  ];

  // Event bonuses ride separate itemized EVENT_BONUS events AFTER ROUTE_CLAIMED, in a fixed,
  // deterministic order: REOPEN → HOTSPOT → STAMP → CHARTER. Every one banks into routePoints.

  // (1) REOPEN — typhoon +2 to the FIRST claimer of a reopened route (one-off, consumed here). A
  // second claimer of the reopened double-route sibling finds it already gone and earns nothing.
  const rb = takeReopenBonus(next, route.id);
  next = rb.state;
  if (rb.bonus > 0) {
    next = withPlayer(next, player, (p) => ({ ...p, routePoints: p.routePoints + rb.bonus }));
    events.push({
      e: 'EVENT_BONUS',
      kind: 'TYPHOON_LANDFALL',
      reason: 'REOPEN',
      player,
      points: rb.bonus,
      routeId: route.id,
      visibility: 'PUBLIC',
    });
  }

  // Both endpoint-driven bonuses iterate the route's endpoints sorted by cityId (deterministic).
  const endpoints = [route.a as string, route.b as string].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );

  // (2) HOTSPOT — +level for each endpoint city carrying a viral-hotspot marker.
  for (const cityId of endpoints) {
    const level = hotspotLevel(next, cityId as CityId);
    if (level > 0) {
      next = withPlayer(next, player, (p) => ({ ...p, routePoints: p.routePoints + level }));
      events.push({
        e: 'EVENT_BONUS',
        kind: 'VIRAL_HOTSPOT',
        reason: 'HOTSPOT',
        player,
        points: level,
        cityId: cityId as CityId,
        visibility: 'PUBLIC',
      });
    }
  }

  // (3) STAMP — +1 for each endpoint city NEW to the claimer's network while a stamp rally runs.
  // A parallel double-route sibling adds no new city (both endpoints already owned) ⇒ no bonus.
  if (preClaimCities) {
    for (const cityId of endpoints) {
      if (!preClaimCities.has(cityId)) {
        next = withPlayer(next, player, (p) => ({ ...p, routePoints: p.routePoints + 1 }));
        events.push({
          e: 'EVENT_BONUS',
          kind: 'STAMP_RALLY',
          reason: 'STAMP',
          player,
          points: 1,
          cityId: cityId as CityId,
          visibility: 'PUBLIC',
        });
      }
    }
  }

  if (payment.bentoSpend === 'POINTS') {
    next = withPlayer(next, player, (p) => ({ ...p, routePoints: p.routePoints + 2 }));
    events.push({
      e: 'EVENT_BONUS',
      kind: 'BENTO_RUSH',
      reason: 'BENTO_POINTS',
      player,
      points: 2,
      routeId: route.id,
      visibility: 'PUBLIC',
    });
  }

  const bentoCity = activeBentoCity(next);
  if (bentoCity !== null && routeTouchesCity(board, route.id, bentoCity)) {
    next = updateEventResources(next, player, (r) => ({
      ...r,
      bentoTokens: r.bentoTokens + 1,
    }));
    events.push({
      e: 'EVENT_BONUS',
      kind: 'BENTO_RUSH',
      reason: 'BENTO_COLLECT',
      player,
      points: 0,
      cityId: bentoCity,
      routeId: route.id,
      visibility: 'PUBLIC',
    });
  }

  const harvestRegion = activeHarvestRegion(next);
  if (harvestRegion !== null && routeTouchesRegion(board, route.id, harvestRegion)) {
    next = withPlayer(next, player, (p) => ({ ...p, routePoints: p.routePoints + 1 }));
    events.push({
      e: 'EVENT_BONUS',
      kind: 'HARVEST_FESTIVAL_EXPRESS',
      reason: 'HARVEST',
      player,
      points: 1,
      routeId: route.id,
      visibility: 'PUBLIC',
    });
  }

  if (allSeatsReservedActive(next) && payment.locomotives > route.ferryLocos) {
    next = withPlayer(next, player, (p) => ({ ...p, routePoints: p.routePoints + 2 }));
    events.push({
      e: 'EVENT_BONUS',
      kind: 'ALL_SEATS_RESERVED',
      reason: 'RESERVED_LOCO',
      player,
      points: 2,
      routeId: route.id,
      visibility: 'PUBLIC',
    });
  }

  const processionCity = processionCurrentCity(next);
  if (processionCity !== null && routeTouchesCity(board, route.id, processionCity)) {
    const draw = drawEventCard(next);
    next = draw.state;
    events.push(...draw.events);
    if (draw.card !== null) {
      next = addCardToHand(next, player, draw.card);
      events.push({
        e: 'CARD_DRAWN_BLIND',
        player,
        card: draw.card,
        visibility: { private: player },
      });
    }
    next = updateEventResources(next, player, (r) => ({ ...r, blessings: r.blessings + 1 }));
    events.push({
      e: 'EVENT_BONUS',
      kind: 'GODDESS_PROCESSION',
      reason: 'BLESSING',
      player,
      points: 0,
      cityId: processionCity,
      routeId: route.id,
      visibility: 'PUBLIC',
    });
  }

  // (4) CHARTER — every open, un-won charter whose endpoints the claimer's OWN network now joins
  // (no station borrowing). One claim can win several; award each in charters-array order.
  const evc = next.events;
  if (evc && evc.charters.length > 0) {
    const ownEdges = playerOwnEdges(board, next, player);
    const updated: CharterContract[] = [];
    let anyWon = false;
    for (const c of evc.charters) {
      if (c.wonBy === null && citiesConnected(ownEdges, c.a as string, c.b as string)) {
        anyWon = true;
        next = withPlayer(next, player, (p) => ({ ...p, routePoints: p.routePoints + c.points }));
        events.push({
          e: 'EVENT_BONUS',
          kind: 'CHARTER_SPECIAL',
          reason: 'CHARTER',
          player,
          points: c.points,
          visibility: 'PUBLIC',
        });
        updated.push({ ...c, wonBy: player });
      } else {
        updated.push(c);
      }
    }
    if (anyWon) next = { ...next, events: { ...evc, charters: updated } };
  }

  const evLucky = next.events;
  if (evLucky && evLucky.luckyContracts.length > 0) {
    const ownEdges = playerOwnEdges(board, next, player);
    let anyWon = false;
    const updated = evLucky.luckyContracts.map((contract) => {
      if (
        contract.wonBy === null &&
        citiesConnected(ownEdges, contract.a as string, contract.b as string)
      ) {
        anyWon = true;
        next = withPlayer(next, player, (p) => ({
          ...p,
          routePoints: p.routePoints + contract.points,
        }));
        events.push({
          e: 'EVENT_BONUS',
          kind: 'LUCKY_TICKET_STUB',
          reason: 'LUCKY',
          player,
          points: contract.points,
          visibility: 'PUBLIC',
        });
        return { ...contract, wonBy: player };
      }
      return contract;
    });
    if (anyWon) next = { ...next, events: { ...evLucky, luckyContracts: updated } };
  }

  const host = next.events?.lanternHost;
  if (host && routeTouchesCity(board, route.id, host.cityId)) {
    const candidateCityIds = [...playerNetworkCities(board, next, player)]
      .filter((city) => city !== (host.cityId as string))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      .map((city) => city as CityId);
    if (candidateCityIds.length > 0 && next.events) {
      const currentEvents = next.events;
      next = withPlayer(next, player, (p) => ({ ...p, routePoints: p.routePoints + host.points }));
      next = {
        ...next,
        events: {
          ...currentEvents,
          lanternPendingRelocation: { playerId: player, candidateCityIds },
        },
        turn: { ...next.turn, phase: 'LANTERN_RELOCATION' },
      };
      events.push({
        e: 'EVENT_BONUS',
        kind: 'LANTERN_HOST_CITY',
        reason: 'LANTERN',
        player,
        points: host.points,
        cityId: host.cityId,
        routeId: route.id,
        visibility: 'PUBLIC',
      });
    }
  }

  events.push(...lockedEvents);
  return { state: next, events };
}

function applyClaimRoute(
  board: Board,
  state: GameState,
  player: PlayerId,
  routeId: RouteId,
  payment: Payment,
): ReduceResult {
  if (claimsSuspended(state))
    return err(violation('EVENT_CLAIMS_SUSPENDED', 'route claims suspended by a typhoon day off'));
  const pre = claimPreconditions(board, state, player, routeId);
  if (!pre.ok) return pre;
  const route = pre.value;
  const p = getPlayer(state, player);
  if (!p) return err(violation('NOT_YOUR_TURN', 'unknown player'));

  const resourceError = validateClaimEventResources(state, player, payment);
  if (resourceError) return err(resourceError);
  const reduction = (payment.bentoSpend === 'WILD' ? 1 : 0) + (payment.useClaimDiscount ? 1 : 0);
  const extraCards = skyLanternSurcharge(state, routeId) - reduction;
  const pay = validateRoutePayment(route, payment, p, extraCards);
  if (!pay.ok) return pay;

  if (route.isTunnel) return beginTunnel(state, player, route, payment, pay.value.playedColor);

  // Normal claim: spend, apply, lock newly-completed tickets, end turn.
  let next = spendCards(state, player, pay.value.spent);
  next = consumeClaimEventResources(next, player, payment);
  const eff = applyClaimEffects(board, next, player, route, payment);
  next = eff.state;
  const lock = lockCompletedTickets(board, next);
  next = lock.state;
  if (next.turn.phase === 'LANTERN_RELOCATION') {
    return ok({ state: next, events: [...eff.events, ...lock.events] });
  }
  const out = endTurn(board, next, { wasPass: false });
  return ok({ state: out.state, events: [...eff.events, ...lock.events, ...out.events] });
}

function beginTunnel(
  state: GameState,
  player: PlayerId,
  route: RouteDef,
  payment: Payment,
  playedColor: TrainColor | null,
): ReduceResult {
  // Reveal top up-to-N cards (reshuffling if needed). Base cards stay in hand (abort is free).
  // An active aftershock adds one extra reveal. Sky-lantern's base surcharge is already baked into
  // `payment` (validated as length+1), so the pendingTunnel needs no extra bookkeeping for it.
  const revealCount = effectiveTunnelRevealCount(state);
  const revealed: CardColor[] = [];
  let nextState = state;
  const drawEvents: GameEvent[] = [];
  for (let i = 0; i < revealCount; i++) {
    const d = drawEventCard(nextState);
    nextState = d.state;
    drawEvents.push(...d.events);
    if (d.card === null) break;
    revealed.push(d.card);
  }
  const extraRequired = revealed.filter(
    (c) => c === 'LOCOMOTIVE' || (playedColor !== null && c === playedColor),
  ).length;

  const next: GameState = {
    ...nextState,
    pendingTunnel: {
      playerId: player,
      routeId: route.id,
      payment,
      playedColor,
      revealed,
      extraRequired,
    },
    turn: { ...state.turn, phase: 'TUNNEL_PENDING' },
  };
  const events: GameEvent[] = [...drawEvents];
  events.push({
    e: 'TUNNEL_REVEALED',
    player,
    routeId: route.id,
    revealed,
    extraRequired,
    visibility: 'PUBLIC',
  });
  return ok({ state: next, events });
}

function spentFromPayment(playedColor: TrainColor | null, payment: Payment): CardCounts {
  const spent = emptyHand();
  if (playedColor && payment.colorCount > 0) spent[playedColor] += payment.colorCount;
  spent.LOCOMOTIVE += payment.locomotives;
  return spent;
}

function applyResolveTunnel(
  board: Board,
  state: GameState,
  player: PlayerId,
  commit: boolean,
  extra?: Payment,
): ReduceResult {
  const pt = state.pendingTunnel;
  if (!pt || pt.playerId !== player) return err(violation('WRONG_PHASE', 'no pending tunnel'));
  const route = getRoute(board, pt.routeId);
  if (!route) return err(violation('UNKNOWN_ROUTE', 'unknown route'));

  // Revealed cards always go to discard.
  const discardAfterReveal = { ...state.discard };
  for (const c of pt.revealed) discardAfterReveal[c] += 1;

  if (!commit) {
    let cleared: GameState = { ...state, discard: discardAfterReveal, pendingTunnel: null };
    const abortEvents: GameEvent[] = [
      { e: 'TUNNEL_RESOLVED', player, routeId: pt.routeId, committed: false, visibility: 'PUBLIC' },
    ];
    // Aftershock consolation: an aborting player draws one blind card (a real draw from the shared
    // deck helper). Silently skipped when deck + discard are both empty.
    if (tunnelRevealExtra(state) > 0) {
      const d = drawEventCard(cleared);
      abortEvents.push(...d.events);
      if (d.card !== null) {
        cleared = d.state;
        cleared = addCardToHand(cleared, player, d.card);
        abortEvents.push({
          e: 'CARD_DRAWN_BLIND',
          player,
          card: d.card,
          visibility: { private: player },
        });
      }
    }
    const out = endTurn(board, cleared, { wasPass: false });
    return ok({ state: out.state, events: [...abortEvents, ...out.events] });
  }

  // Commit: validate the extra payment.
  const ex = extra ?? { color: null, colorCount: 0, locomotives: 0 };
  if (ex.bentoSpend || ex.useClaimDiscount)
    return err(violation('TUNNEL_BAD_EXTRA', 'event resources may only modify the base payment'));
  if (ex.colorCount < 0 || ex.locomotives < 0)
    return err(violation('TUNNEL_BAD_EXTRA', 'negative extra'));
  if (ex.colorCount + ex.locomotives !== pt.extraRequired) {
    return err(
      violation('TUNNEL_BAD_EXTRA', `extra must total ${pt.extraRequired}`, {
        need: pt.extraRequired,
      }),
    );
  }
  if (ex.colorCount > 0) {
    if (pt.playedColor === null || ex.color !== pt.playedColor) {
      return err(violation('TUNNEL_BAD_EXTRA', 'extra colour must match the played colour'));
    }
  }

  const p = getPlayer(state, player);
  if (!p) return err(violation('NOT_YOUR_TURN', 'unknown player'));

  const base = spentFromPayment(pt.playedColor, pt.payment);
  const extraSpent = spentFromPayment(pt.playedColor, ex);
  const totalSpent = { ...base };
  for (const k of Object.keys(extraSpent) as (keyof CardCounts)[]) totalSpent[k] += extraSpent[k];
  for (const k of Object.keys(totalSpent) as (keyof CardCounts)[]) {
    if (p.hand[k] < totalSpent[k])
      return err(violation('TUNNEL_EXTRA_UNPAYABLE', 'cannot pay tunnel surcharge'));
  }

  let next: GameState = { ...state, discard: discardAfterReveal, pendingTunnel: null };
  next = spendCards(next, player, totalSpent);
  next = consumeClaimEventResources(next, player, pt.payment);
  const eff = applyClaimEffects(board, next, player, route, pt.payment);
  next = eff.state;
  const lock = lockCompletedTickets(board, next);
  next = lock.state;
  if (next.turn.phase === 'LANTERN_RELOCATION') {
    return ok({
      state: next,
      events: [
        {
          e: 'TUNNEL_RESOLVED',
          player,
          routeId: pt.routeId,
          committed: true,
          visibility: 'PUBLIC',
        },
        ...eff.events,
        ...lock.events,
      ],
    });
  }
  const out = endTurn(board, next, { wasPass: false });
  return ok({
    state: out.state,
    events: [
      { e: 'TUNNEL_RESOLVED', player, routeId: pt.routeId, committed: true, visibility: 'PUBLIC' },
      ...eff.events,
      ...lock.events,
      ...out.events,
    ],
  });
}

// ──────────────────────────────────────────────── station ───────────────────────────────────

function applyBuildStation(
  board: Board,
  state: GameState,
  player: PlayerId,
  cityId: CityId,
  payment: Payment,
): ReduceResult {
  if (stationsSuspended(state))
    return err(
      violation('EVENT_STATIONS_SUSPENDED', 'station builds suspended by a typhoon day off'),
    );
  if (!board.cityById.has(cityId as string)) return err(violation('UNKNOWN_CITY', 'unknown city'));
  if (state.stations.some((s) => s.cityId === cityId))
    return err(violation('STATION_CITY_TAKEN', 'city has a station'));
  const p = getPlayer(state, player);
  if (!p) return err(violation('NOT_YOUR_TURN', 'unknown player'));
  if (p.stationsRemaining <= 0) return err(violation('STATION_LIMIT', 'no stations left'));

  // Railway-gala zero-cost station: while the flag is up, the EMPTY payment (zero cards) builds a
  // station for free and consumes the flag game-wide (first-come). The normal PAID station stays
  // legal and does NOT consume the flag — the player's choice of payment decides. A non-empty
  // payment (or an empty one with the flag down) falls through to normal cost validation, which
  // rejects the empty payment because a station always costs ≥ 1 card.
  const isEmptyPayment = payment.colorCount === 0 && payment.locomotives === 0;
  const useFreeStation = freeStationAvailable(state) && isEmptyPayment;

  const buildEvents: GameEvent[] = [{ e: 'STATION_BUILT', player, cityId, visibility: 'PUBLIC' }];
  let next: GameState;
  if (useFreeStation) {
    next = consumeFreeStation(state);
    buildEvents.push({
      e: 'EVENT_BONUS',
      kind: 'RAILWAY_GALA',
      reason: 'FREE_STATION',
      player,
      cityId,
      points: 0,
      visibility: 'PUBLIC',
    });
  } else {
    const built = state.ruleParams.stationsPerPlayer - p.stationsRemaining;
    const cost = built + 1;
    const pay = validateStationPayment(cost, payment, p);
    if (!pay.ok) return pay;
    next = spendCards(state, player, pay.value.spent);
  }

  next = withPlayer(next, player, (pl) => ({ ...pl, stationsRemaining: pl.stationsRemaining - 1 }));
  next = { ...next, stations: [...next.stations, { playerId: player, cityId }] };
  const lock = lockCompletedTickets(board, next);
  next = lock.state;
  const out = endTurn(board, next, { wasPass: false });
  return ok({
    state: out.state,
    events: [...buildEvents, ...lock.events, ...out.events],
  });
}

// ───────────────────────────────── expansion event actions ────────────────────────────────

function applyRelocateLanternHost(
  board: Board,
  state: GameState,
  player: PlayerId,
  cityId: CityId,
): ReduceResult {
  const ev = state.events;
  const pending = ev?.lanternPendingRelocation;
  const host = ev?.lanternHost;
  if (
    !ev ||
    !pending ||
    !host ||
    pending.playerId !== player ||
    !pending.candidateCityIds.includes(cityId) ||
    cityId === host.cityId
  ) {
    return err(
      violation('EVENT_LANTERN_RELOCATION_INVALID', 'invalid lantern-host relocation city'),
    );
  }
  const { lanternPendingRelocation: _omit, ...rest } = ev;
  const moved: GameState = {
    ...state,
    events: { ...rest, lanternHost: { ...host, cityId } },
    turn: { ...state.turn, phase: 'AWAIT_ACTION' },
  };
  const out = endTurn(board, moved, { wasPass: false });
  return ok({
    state: out.state,
    events: [
      {
        e: 'EVENT_MARKER_MOVED',
        kind: 'LANTERN_HOST_CITY',
        id: host.eventId,
        cityId,
        player,
        visibility: 'PUBLIC',
      },
      ...out.events,
    ],
  });
}

function applyRepairRoute(
  board: Board,
  state: GameState,
  player: PlayerId,
  routeId: RouteId,
  payment: Payment,
): ReduceResult {
  const ev = state.events;
  const repairable = ev?.active.some(
    (active) =>
      active.kind === 'SLOPE_REPAIR_ORDER' &&
      active.routeIds?.includes(routeId) &&
      !ev.repairedRouteIds.includes(routeId),
  );
  if (!ev || !repairable || state.ownership[routeId as string]) {
    return err(violation('EVENT_REPAIR_UNAVAILABLE', 'route is not open for event repair'));
  }
  if (!board.routeById.has(routeId as string))
    return err(violation('UNKNOWN_ROUTE', 'unknown route'));
  if (payment.bentoSpend || payment.useClaimDiscount) {
    return err(
      violation('EVENT_REPAIR_PAYMENT_INVALID', 'claim resources cannot modify a repair payment'),
    );
  }

  const resources = eventResources(state, player);
  const empty = payment.colorCount === 0 && payment.locomotives === 0;
  let next = state;
  if (empty) {
    if (resources.repairPermits <= 0) {
      return err(violation('EVENT_RESOURCE_UNAVAILABLE', 'no event-repair permit available'));
    }
    next = updateEventResources(next, player, (r) => ({
      ...r,
      repairPermits: r.repairPermits - 1,
    }));
  } else {
    const p = getPlayer(state, player);
    if (!p) return err(violation('NOT_YOUR_TURN', 'unknown player'));
    const validated = validateStationPayment(2, payment, p);
    if (!validated.ok) {
      return err(violation('EVENT_REPAIR_PAYMENT_INVALID', 'repair requires two matching cards'));
    }
    next = spendCards(next, player, validated.value.spent);
  }

  next = withPlayer(next, player, (p) => ({ ...p, routePoints: p.routePoints + 3 }));
  next = {
    ...next,
    events: { ...next.events!, repairedRouteIds: [...next.events!.repairedRouteIds, routeId] },
  };
  const out = endTurn(board, next, { wasPass: false });
  return ok({
    state: out.state,
    events: [
      {
        e: 'EVENT_BONUS',
        kind: 'SLOPE_REPAIR_ORDER',
        reason: 'REPAIR',
        player,
        points: 3,
        routeId,
        visibility: 'PUBLIC',
      },
      ...out.events,
    ],
  });
}

function applyNightMarketSwap(
  board: Board,
  state: GameState,
  player: PlayerId,
  giveColor: CardColor,
  slot: number,
): ReduceResult {
  const city = activeNightMarketCity(state);
  const p = getPlayer(state, player);
  const took = state.market[slot];
  if (took === 'LOCOMOTIVE' && allSeatsReservedActive(state)) {
    return err(
      violation('EVENT_FACEUP_LOCO_BLOCKED', 'face-up locomotives are reserved during this event'),
    );
  }
  if (
    city === null ||
    !p ||
    !canUseNightMarketSwap(board, state, player) ||
    slot < 0 ||
    slot >= state.market.length ||
    took === null ||
    took === undefined ||
    p.hand[giveColor] <= 0
  ) {
    return err(violation('EVENT_NIGHT_MARKET_UNAVAILABLE', 'night-market swap is not available'));
  }

  let next = withPlayer(state, player, (pl) => {
    const hand = { ...pl.hand };
    hand[giveColor] -= 1;
    hand[took] += 1;
    return { ...pl, hand };
  });
  const market = [...next.market];
  market[slot] = giveColor;
  next = { ...next, market, turn: { ...next.turn, nightMarketSwapUsed: true } };
  const refill = refillMarket(
    next.market,
    next.deck,
    next.discard,
    next.rng,
    next.ruleParams,
    harvestFestivalActive(next),
  );
  const applied = applyEventRefill(next, refill);
  next = applied.state;
  const events: GameEvent[] = [
    {
      e: 'EVENT_NIGHT_MARKET_SWAPPED',
      player,
      slot,
      gave: giveColor,
      took,
      visibility: 'PUBLIC',
    },
    ...applied.events,
  ];
  if (refill.recycled) {
    events.push({ e: 'MARKET_REFILLED', market: refill.market, visibility: 'PUBLIC' });
  }
  return ok({ state: next, events });
}

function applyChooseEventPerk(
  board: Board,
  state: GameState,
  player: PlayerId,
  perk: EventPerk,
): ReduceResult {
  const ev = state.events;
  const draft = ev?.eventDraft;
  if (!ev || !draft || draft.order[draft.pickIndex] !== player) {
    return err(violation('EVENT_DRAFT_CHOICE_INVALID', "not this player's event draft pick"));
  }
  if (!(['CLAIM_DISCOUNT', 'DRAW_TWO', 'REPAIR_PERMIT'] as const).includes(perk)) {
    return err(violation('EVENT_DRAFT_CHOICE_INVALID', 'unknown event perk'));
  }

  let next = state;
  const events: GameEvent[] = [{ e: 'EVENT_PERK_CHOSEN', player, perk, visibility: 'PUBLIC' }];
  if (perk === 'CLAIM_DISCOUNT') {
    next = updateEventResources(next, player, (r) => ({
      ...r,
      claimDiscounts: r.claimDiscounts + 1,
    }));
  } else if (perk === 'REPAIR_PERMIT') {
    next = updateEventResources(next, player, (r) => ({
      ...r,
      repairPermits: r.repairPermits + 1,
    }));
  } else {
    for (let i = 0; i < 2; i++) {
      const draw = drawEventCard(next);
      next = draw.state;
      events.push(...draw.events);
      if (draw.card === null) break;
      next = addCardToHand(next, player, draw.card);
      events.push({
        e: 'CARD_DRAWN_BLIND',
        player,
        card: draw.card,
        visibility: { private: player },
      });
    }
  }

  const currentEvents = next.events;
  const currentDraft = currentEvents?.eventDraft;
  if (!currentEvents || !currentDraft) {
    return err(violation('EVENT_DRAFT_CHOICE_INVALID', 'event draft disappeared'));
  }
  const picks = [...currentDraft.picks, { playerId: player, perk }];
  const pickIndex = currentDraft.pickIndex + 1;
  if (pickIndex < currentDraft.order.length) {
    const nextPlayer = currentDraft.order[pickIndex] as PlayerId;
    next = {
      ...next,
      events: { ...currentEvents, eventDraft: { ...currentDraft, pickIndex, picks } },
      turn: {
        orderIndex: next.turnOrder.indexOf(nextPlayer),
        phase: 'EVENT_DRAFT',
        cardsDrawnThisTurn: 0,
      },
    };
    events.push({
      e: 'TURN_STARTED',
      player: nextPlayer,
      orderIndex: next.turn.orderIndex,
      visibility: 'PUBLIC',
    });
  } else {
    const { eventDraft: _omit, ...rest } = currentEvents;
    next = {
      ...next,
      events: rest,
      turn: {
        orderIndex: currentDraft.resumeOrderIndex,
        phase: 'AWAIT_ACTION',
        cardsDrawnThisTurn: 0,
      },
    };
    const resumePlayer = next.turnOrder[currentDraft.resumeOrderIndex] as PlayerId;
    events.push({
      e: 'TURN_STARTED',
      player: resumePlayer,
      orderIndex: currentDraft.resumeOrderIndex,
      visibility: 'PUBLIC',
    });
    // The round-boundary turn start was paused by the draft, so endTurn deliberately skipped its
    // forced-ticket check. Re-run that start-of-turn rule now that the draft has released the
    // resumed player; otherwise a player whose objectives are all complete can incorrectly take a
    // normal action here.
    if (allKeptTicketsCompleted(board, next, resumePlayer)) {
      const forced = offerTickets(next, resumePlayer);
      if (forced) {
        next = forced.state;
        events.push(...forced.events);
      }
    }
  }
  return ok({ state: next, events });
}

function blindPoolAvailable(state: GameState): boolean {
  return state.deck.length > 0 || totalCards(state.discard) > 0;
}

function applyStartHiveDraw(board: Board, state: GameState, player: PlayerId): ReduceResult {
  if (!hiveOfSparksActive(state) || !state.events || !blindPoolAvailable(state)) {
    return err(violation('EVENT_HIVE_UNAVAILABLE', 'Hive of Sparks draw is not available'));
  }
  const draw = drawEventCard(state);
  if (draw.card === null) return err(violation('EVENT_HIVE_UNAVAILABLE', 'nothing to reveal'));
  const pending = { playerId: player, revealed: [draw.card], maxDraws: 4 } as const;
  const next: GameState = {
    ...draw.state,
    events: { ...draw.state.events!, pendingHiveDraw: pending },
    turn: { ...state.turn, phase: 'HIVE_DRAW' },
  };
  const prefix: GameEvent[] = [
    ...draw.events,
    {
      e: 'EVENT_HIVE_CARD_REVEALED',
      player,
      card: draw.card,
      count: 1,
      visibility: 'PUBLIC',
    },
  ];
  return blindPoolAvailable(next)
    ? ok({ state: next, events: prefix })
    : resolveHive(board, next, false, prefix);
}

function applyContinueHiveDraw(board: Board, state: GameState, player: PlayerId): ReduceResult {
  const pending = state.events?.pendingHiveDraw;
  if (!pending || pending.playerId !== player) {
    return err(violation('EVENT_HIVE_UNAVAILABLE', 'no Hive of Sparks draw is pending'));
  }
  const draw = drawEventCard(state);
  if (draw.card === null) return resolveHive(board, state, false, []);
  const revealed = [...pending.revealed, draw.card];
  const previous = pending.revealed[pending.revealed.length - 1];
  const busted = previous === draw.card;
  const next: GameState = {
    ...draw.state,
    events: {
      ...draw.state.events!,
      pendingHiveDraw: { ...pending, revealed },
    },
  };
  const prefix: GameEvent[] = [
    ...draw.events,
    {
      e: 'EVENT_HIVE_CARD_REVEALED',
      player,
      card: draw.card,
      count: revealed.length,
      visibility: 'PUBLIC',
    },
  ];
  if (busted) return resolveHive(board, next, true, prefix);
  if (revealed.length >= pending.maxDraws || !blindPoolAvailable(next)) {
    return resolveHive(board, next, false, prefix);
  }
  return ok({ state: next, events: prefix });
}

function applyStopHiveDraw(board: Board, state: GameState, player: PlayerId): ReduceResult {
  const pending = state.events?.pendingHiveDraw;
  if (!pending || pending.playerId !== player) {
    return err(violation('EVENT_HIVE_UNAVAILABLE', 'no Hive of Sparks draw is pending'));
  }
  return resolveHive(board, state, false, []);
}

function resolveHive(
  board: Board,
  state: GameState,
  busted: boolean,
  prefix: GameEvent[],
): ReduceResult {
  const ev = state.events;
  const pending = ev?.pendingHiveDraw;
  if (!ev || !pending) return err(violation('EVENT_HIVE_UNAVAILABLE', 'no hive draw pending'));
  const kept = busted ? pending.revealed.slice(0, 1) : pending.revealed;
  const discarded = busted ? pending.revealed.slice(1) : [];
  const { pendingHiveDraw: _omit, ...rest } = ev;
  const discard = { ...state.discard };
  for (const card of discarded) discard[card] += 1;
  let next: GameState = {
    ...state,
    events: rest,
    discard,
    turn: { ...state.turn, phase: 'AWAIT_ACTION' },
  };
  for (const card of kept) next = addCardToHand(next, pending.playerId, card);
  const out = endTurn(board, next, { wasPass: false });
  return ok({
    state: out.state,
    events: [
      ...prefix,
      {
        e: 'EVENT_HIVE_RESOLVED',
        player: pending.playerId,
        busted,
        keptCount: kept.length,
        visibility: 'PUBLIC',
      },
      ...out.events,
    ],
  });
}

// ──────────────────────────────────────────────────── pass ──────────────────────────────────

function applyPass(board: Board, state: GameState, player: PlayerId): ReduceResult {
  if (hasAnyLegalMove(board, state, player)) {
    return err(violation('NO_LEGAL_MOVE_REQUIRED', 'pass is only allowed with no legal move'));
  }
  const out = endTurn(board, state, { wasPass: true });
  return ok({
    state: out.state,
    events: [{ e: 'PLAYER_PASSED', player, visibility: 'PUBLIC' }, ...out.events],
  });
}

// ─────────────────────────────────────── instant ticket completion ──────────────────────────

/**
 * Re-evaluate every player's kept tickets after a connectivity change and lock any
 * newly-completed ones into `completedTickets`, emitting TICKET_COMPLETED. Own-track completion
 * (`ownConnectedTicketIds`) is checked in EVERY game; under `unlimitedStationBorrow` the fuller
 * borrow-aware check (`borrowConnectedTicketIds`, a superset) is used instead. ALL players are
 * checked because an opponent's claim into a player's station city can complete that player's
 * ticket under the borrow variant. Both checks are monotonic — a locked ticket never retracts,
 * and the locked set equals the end-game total.
 */
function lockCompletedTickets(
  board: Board,
  state: GameState,
): { state: GameState; events: GameEvent[] } {
  let next = state;
  const events: GameEvent[] = [];
  for (const pid of state.turnOrder) {
    const p = next.players[pid as string];
    if (!p || p.keptTickets.length === 0) continue;
    const already = new Set(p.completedTickets as readonly string[]);

    const ownEdges: { a: string; b: string }[] = [];
    for (const [routeId, cell] of Object.entries(next.ownership)) {
      if ('owner' in cell && cell.owner === pid) {
        const r = board.routeById.get(routeId);
        if (r) ownEdges.push({ a: r.a as string, b: r.b as string });
      }
    }
    const tickets = p.keptTickets
      .map((tid) => {
        const t = board.ticketById.get(tid as string);
        return t ? { id: tid as string, a: t.a as string, b: t.b as string } : null;
      })
      .filter((x): x is { id: string; a: string; b: string } => x !== null);

    const connected = state.ruleParams.unlimitedStationBorrow
      ? borrowConnectedTicketIds({
          ownEdges,
          borrowEdges: stationBorrowEdges(board, next, pid),
          tickets,
        })
      : ownConnectedTicketIds({ ownEdges, tickets });
    const newly = connected.filter((id) => !already.has(id));
    if (newly.length > 0) {
      const newIds = newly.map((id) => asTicketId(id));
      next = withPlayer(next, pid, (pl) => ({
        ...pl,
        completedTickets: [...pl.completedTickets, ...newIds],
      }));
      for (const id of newIds)
        events.push({ e: 'TICKET_COMPLETED', player: pid, ticket: id, visibility: 'PUBLIC' });
    }
  }
  return { state: next, events };
}

// hasAnyLegalMove and the affordability predicates now live in ./legality — shared with the turn
// sequencer's deadlock trigger without a reduce↔turn import cycle. Re-exported for existing callers
// (index.ts, selectors.ts, tests). NOTE: the old standalone "draw tickets" clause is intentionally
// gone: a stuck player in a dead pool must PASS rather than draw a futile ticket.
export { hasAnyLegalMove };
