import type { PlayerId, RouteId, CityId, TicketId, CardColor, TrainColor } from '@trm/shared';
import type { Result, RuleViolation } from '@trm/shared';
import { ok, err, violation, asTicketId, TRAIN_COLORS } from '@trm/shared';
import type { RouteDef } from '@trm/map-data';
import type { Board } from './board';
import { getRoute, siblingOf } from './board';
import { variantForPlayerCount } from './config';
import type { GameState } from './types/state';
import type { Action, Payment } from './types/actions';
import type { GameEvent } from './types/events';
import { drawOne, refillMarket } from './deck';
import { emptyHand } from './hand';
import type { CardCounts } from './hand';
import { validateRoutePayment, validateStationPayment } from './payments';
import { currentPlayerId, endTurn } from './turn';
import { getPlayer, withPlayer, spendCards, addCardToHand, setOwnership } from './reducers/common';
import { borrowConnectedTicketIds } from './graph/connectivity';
import { stationBorrowEdges } from './scoring';

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
  return ok({ state: { ...res.value.state, actionSeq: state.actionSeq + 1 }, events: res.value.events });
}

function dispatch(board: Board, state: GameState, action: Action): ReduceResult {
  const phase = state.turn.phase;
  if (phase === 'GAME_OVER') return err(violation('GAME_OVER', 'game is over'));

  if (phase === 'SETUP_TICKETS') {
    if (action.t !== 'KEEP_INITIAL_TICKETS') return err(violation('WRONG_PHASE', 'awaiting initial tickets'));
    return applyKeepInitial(board, state, action.player, action.keep);
  }

  // In-game phases: must be the active player.
  if (action.player !== currentPlayerId(state)) return err(violation('NOT_YOUR_TURN', 'not your turn'));

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
        case 'PASS':
          return applyPass(board, state, action.player);
        default:
          return err(violation('WRONG_PHASE', 'illegal action for AWAIT_ACTION'));
      }
    case 'DRAWING_CARDS':
      if (action.t === 'DRAW_BLIND') return applyDrawBlind(board, state, action.player);
      if (action.t === 'DRAW_FACEUP') return applyDrawFaceup(board, state, action.player, action.slot);
      return err(violation('WRONG_PHASE', 'must finish drawing'));
    case 'TICKET_SELECTION':
      if (action.t === 'KEEP_TICKETS') return applyKeepTickets(board, state, action.player, action.keep);
      return err(violation('WRONG_PHASE', 'must select tickets'));
    case 'TUNNEL_PENDING':
      if (action.t === 'RESOLVE_TUNNEL')
        return applyResolveTunnel(board, state, action.player, action.commit, action.extra);
      return err(violation('WRONG_PHASE', 'must resolve tunnel'));
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
    if (!offerSet.has(id as string)) return violation('TICKET_INVALID_SELECTION', 'kept a ticket not offered');
    if (seen.has(id as string)) return violation('TICKET_INVALID_SELECTION', 'duplicate kept ticket');
    if (!board.ticketById.has(id as string)) return violation('UNKNOWN_TICKET', 'unknown ticket');
    seen.add(id as string);
  }
  if (keep.length < minKeep) return violation('TICKET_KEEP_TOO_FEW', `keep at least ${minKeep}`, { min: minKeep });
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

  const { ticketDeckLong, ticketDeckShort } = returnTickets(board, state, p.pendingTicketOffer, keep);
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
  const allResolved = state.turnOrder.every((id) => next.players[id as string]?.pendingTicketOffer === null);
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
  const next: GameState = {
    ...withPlayer(state, player, (pl) => ({
      ...pl,
      keptTickets: [...pl.keptTickets, ...keep],
      pendingTicketOffer: null,
    })),
    ticketDeckLong,
    ticketDeckShort,
  };
  const out = endTurn(board, next, { wasPass: false });
  return ok({
    state: out.state,
    events: [{ e: 'TICKETS_KEPT', player, keptCount: keep.length, visibility: 'PUBLIC' }, ...out.events],
  });
}

function applyDrawTickets(board: Board, state: GameState, player: PlayerId): ReduceResult {
  if (state.ticketDeckShort.length === 0) return err(violation('NOTHING_TO_DRAW', 'ticket deck empty'));
  const count = Math.min(state.ruleParams.ticketDrawCount, state.ticketDeckShort.length);
  const short = [...state.ticketDeckShort];
  const offered: TicketId[] = [];
  for (let i = 0; i < count; i++) {
    const t = short.pop();
    if (t) offered.push(t);
  }
  const next: GameState = {
    ...withPlayer(state, player, (pl) => ({ ...pl, pendingTicketOffer: offered })),
    ticketDeckShort: short,
    turn: { ...state.turn, phase: 'TICKET_SELECTION' },
  };
  return ok({
    state: next,
    events: [{ e: 'TICKETS_OFFERED', player, ticketIds: offered, visibility: { private: player } }],
  });
}

// ─────────────────────────────────────────────── drawing cards ──────────────────────────────

function applyDrawBlind(board: Board, state: GameState, player: PlayerId): ReduceResult {
  const d = drawOne(state.deck, state.discard, state.rng);
  const isFirst = state.turn.phase === 'AWAIT_ACTION';
  if (d.card === null) {
    if (isFirst) return err(violation('NOTHING_TO_DRAW', 'no cards to draw'));
    // Stuck mid-draw with nothing left: end the turn with the one card already taken.
    const out = endTurn(board, state, { wasPass: false });
    return ok({ state: out.state, events: out.events });
  }
  const events: GameEvent[] = [];
  if (d.reshuffled) events.push({ e: 'DECK_RESHUFFLED', visibility: 'PUBLIC' });
  let next: GameState = { ...state, deck: d.deck, discard: d.discard, rng: d.rng };
  next = addCardToHand(next, player, d.card);
  events.push({ e: 'CARD_DRAWN_BLIND', player, card: d.card, visibility: { private: player } });

  if (isFirst) {
    if (d.card === 'LOCOMOTIVE' && !state.ruleParams.secondDrawAfterBlindRainbow) {
      // Variant default: a blind rainbow consumes the whole draw — end the turn now.
      const out = endTurn(board, next, { wasPass: false });
      return ok({ state: out.state, events: [...events, ...out.events] });
    }
    next = { ...next, turn: { ...next.turn, phase: 'DRAWING_CARDS', cardsDrawnThisTurn: 1 } };
    return ok({ state: next, events });
  }
  const out = endTurn(board, next, { wasPass: false });
  return ok({ state: out.state, events: [...events, ...out.events] });
}

function applyDrawFaceup(board: Board, state: GameState, player: PlayerId, slot: number): ReduceResult {
  if (slot < 0 || slot >= state.market.length) return err(violation('MARKET_SLOT_EMPTY', 'bad market slot'));
  const card = state.market[slot];
  if (card === null || card === undefined) return err(violation('MARKET_SLOT_EMPTY', 'empty market slot'));
  const isFirst = state.turn.phase === 'AWAIT_ACTION';

  // A face-up Locomotive may not be taken as the SECOND draw.
  if (card === 'LOCOMOTIVE' && !isFirst) {
    return err(violation('FACEUP_LOCO_SECOND_DRAW', 'cannot take a face-up locomotive as the second draw'));
  }

  const newMarket = state.market.slice();
  newMarket[slot] = null;
  const refill = refillMarket(newMarket, state.deck, state.discard, state.rng, state.ruleParams);

  let next: GameState = {
    ...state,
    market: refill.market,
    deck: refill.deck,
    discard: refill.discard,
    rng: refill.rng,
  };
  next = addCardToHand(next, player, card);

  const events: GameEvent[] = [
    { e: 'CARD_TAKEN_FACEUP', player, slot, card, visibility: 'PUBLIC' },
  ];
  if (refill.reshuffled) events.push({ e: 'DECK_RESHUFFLED', visibility: 'PUBLIC' });
  if (refill.recycled) events.push({ e: 'MARKET_RECYCLED', reason: 'THREE_LOCOS', visibility: 'PUBLIC' });
  events.push({ e: 'MARKET_REFILLED', market: refill.market, visibility: 'PUBLIC' });

  // Taking a face-up Locomotive (only possible on the first draw) consumes the whole draw.
  if (card === 'LOCOMOTIVE' || !isFirst) {
    const out = endTurn(board, next, { wasPass: false });
    return ok({ state: out.state, events: [...events, ...out.events] });
  }
  next = { ...next, turn: { ...next.turn, phase: 'DRAWING_CARDS', cardsDrawnThisTurn: 1 } };
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
  const sib = siblingOf(board, routeId);
  if (sib) {
    const sibCell = state.ownership[sib as string];
    if (sibCell && 'owner' in sibCell && sibCell.owner === player) {
      return err(violation('DOUBLE_ROUTE_OWN_BOTH', 'cannot own both of a double route'));
    }
  }
  return ok(route);
}

/** Apply ownership/sibling-lock/trains/points for a claim (does NOT spend cards or end the turn). */
function applyClaimEffects(
  board: Board,
  state: GameState,
  player: PlayerId,
  route: RouteDef,
): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  let next = setOwnership(state, route.id as string, { owner: player });

  const variant = variantForPlayerCount(state.turnOrder.length);
  if (variant === 'SINGLE_ONLY') {
    const sib = siblingOf(board, route.id);
    if (sib && !next.ownership[sib as string]) {
      next = setOwnership(next, sib as string, { locked: true });
      events.push({ e: 'DOUBLE_ROUTE_LOCKED', routeId: sib, visibility: 'PUBLIC' });
    }
  }

  const points = state.ruleParams.routePoints[route.length] ?? 0;
  next = withPlayer(next, player, (p) => ({
    ...p,
    trainCars: p.trainCars - route.length,
    routePoints: p.routePoints + points,
  }));
  events.unshift({ e: 'ROUTE_CLAIMED', player, routeId: route.id, pointsAwarded: points, visibility: 'PUBLIC' });
  return { state: next, events };
}

function applyClaimRoute(
  board: Board,
  state: GameState,
  player: PlayerId,
  routeId: RouteId,
  payment: Payment,
): ReduceResult {
  const pre = claimPreconditions(board, state, player, routeId);
  if (!pre.ok) return pre;
  const route = pre.value;
  const p = getPlayer(state, player);
  if (!p) return err(violation('NOT_YOUR_TURN', 'unknown player'));

  const pay = validateRoutePayment(route, payment, p);
  if (!pay.ok) return pay;

  if (route.isTunnel) return beginTunnel(state, player, route, payment, pay.value.playedColor);

  // Normal claim: spend, apply, lock newly-completed tickets, end turn.
  let next = spendCards(state, player, pay.value.spent);
  const eff = applyClaimEffects(board, next, player, route);
  next = eff.state;
  const lock = lockCompletedTickets(board, next);
  next = lock.state;
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
  const revealed: CardColor[] = [];
  let deck = state.deck;
  let discard = state.discard;
  let rng = state.rng;
  let reshuffled = false;
  for (let i = 0; i < state.ruleParams.tunnelRevealCount; i++) {
    const d = drawOne(deck, discard, rng);
    if (d.card === null) break;
    deck = d.deck;
    discard = d.discard;
    rng = d.rng;
    if (d.reshuffled) reshuffled = true;
    revealed.push(d.card);
  }
  const extraRequired = revealed.filter(
    (c) => c === 'LOCOMOTIVE' || (playedColor !== null && c === playedColor),
  ).length;

  const next: GameState = {
    ...state,
    deck,
    discard,
    rng,
    pendingTunnel: { playerId: player, routeId: route.id, payment, playedColor, revealed, extraRequired },
    turn: { ...state.turn, phase: 'TUNNEL_PENDING' },
  };
  const events: GameEvent[] = [];
  if (reshuffled) events.push({ e: 'DECK_RESHUFFLED', visibility: 'PUBLIC' });
  events.push({ e: 'TUNNEL_REVEALED', player, routeId: route.id, revealed, extraRequired, visibility: 'PUBLIC' });
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
    const cleared: GameState = { ...state, discard: discardAfterReveal, pendingTunnel: null };
    const out = endTurn(board, cleared, { wasPass: false });
    return ok({
      state: out.state,
      events: [
        { e: 'TUNNEL_RESOLVED', player, routeId: pt.routeId, committed: false, visibility: 'PUBLIC' },
        ...out.events,
      ],
    });
  }

  // Commit: validate the extra payment.
  const ex = extra ?? { color: null, colorCount: 0, locomotives: 0 };
  if (ex.colorCount < 0 || ex.locomotives < 0) return err(violation('TUNNEL_BAD_EXTRA', 'negative extra'));
  if (ex.colorCount + ex.locomotives !== pt.extraRequired) {
    return err(violation('TUNNEL_BAD_EXTRA', `extra must total ${pt.extraRequired}`, { need: pt.extraRequired }));
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
    if (p.hand[k] < totalSpent[k]) return err(violation('TUNNEL_EXTRA_UNPAYABLE', 'cannot pay tunnel surcharge'));
  }

  let next: GameState = { ...state, discard: discardAfterReveal, pendingTunnel: null };
  next = spendCards(next, player, totalSpent);
  const eff = applyClaimEffects(board, next, player, route);
  next = eff.state;
  const lock = lockCompletedTickets(board, next);
  next = lock.state;
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
  if (!board.cityById.has(cityId as string)) return err(violation('UNKNOWN_CITY', 'unknown city'));
  if (state.stations.some((s) => s.cityId === cityId)) return err(violation('STATION_CITY_TAKEN', 'city has a station'));
  const p = getPlayer(state, player);
  if (!p) return err(violation('NOT_YOUR_TURN', 'unknown player'));
  if (p.stationsRemaining <= 0) return err(violation('STATION_LIMIT', 'no stations left'));

  const built = state.ruleParams.stationsPerPlayer - p.stationsRemaining;
  const cost = built + 1;
  const pay = validateStationPayment(cost, payment, p);
  if (!pay.ok) return pay;

  let next = spendCards(state, player, pay.value.spent);
  next = withPlayer(next, player, (pl) => ({ ...pl, stationsRemaining: pl.stationsRemaining - 1 }));
  next = { ...next, stations: [...next.stations, { playerId: player, cityId }] };
  const lock = lockCompletedTickets(board, next);
  next = lock.state;
  const out = endTurn(board, next, { wasPass: false });
  return ok({
    state: out.state,
    events: [{ e: 'STATION_BUILT', player, cityId, visibility: 'PUBLIC' }, ...lock.events, ...out.events],
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
 * Under `unlimitedStationBorrow`, re-evaluate every player's kept tickets after a connectivity
 * change and lock any newly-completed ones into `completedTickets`, emitting TICKET_COMPLETED.
 * No-op when the variant is off. ALL players are checked because an opponent's claim into a
 * player's station city can complete that player's ticket. The borrow graph only grows, so this
 * is monotonic — a locked ticket never retracts, and the locked set equals the end-game total.
 */
function lockCompletedTickets(board: Board, state: GameState): { state: GameState; events: GameEvent[] } {
  if (!state.ruleParams.unlimitedStationBorrow) return { state, events: [] };
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

    const connected = borrowConnectedTicketIds({
      ownEdges,
      borrowEdges: stationBorrowEdges(board, next, pid),
      tickets,
    });
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

// Whether the player has ANY legal non-pass move (used by PASS validation and legalActions).
export function hasAnyLegalMove(board: Board, state: GameState, player: PlayerId): boolean {
  const p = getPlayer(state, player);
  if (!p) return false;
  // Draw cards: any card available anywhere?
  const discardTotal = totalDiscard(state.discard);
  if (state.deck.length + discardTotal > 0) return true;
  if (state.market.some((c) => c !== null)) return true;
  // Draw tickets.
  if (state.ticketDeckShort.length > 0) return true;
  // Build a station.
  if (p.stationsRemaining > 0 && state.stations.length < board.cityIds.length) {
    const built = state.ruleParams.stationsPerPlayer - p.stationsRemaining;
    const cost = built + 1;
    if (canAffordCount(p.hand, cost)) return true;
  }
  // Claim a route.
  for (const route of board.content.routes) {
    if (state.ownership[route.id as string]) continue;
    const sib = siblingOf(board, route.id);
    if (sib) {
      const sc = state.ownership[sib as string];
      if (sc && 'owner' in sc && sc.owner === player) continue;
    }
    if (p.trainCars < route.length) continue;
    if (canAffordRoute(p.hand, route)) return true;
  }
  return false;
}

function totalDiscard(discard: Readonly<CardCounts>): number {
  let n = 0;
  for (const k of Object.keys(discard) as (keyof CardCounts)[]) n += discard[k];
  return n;
}

function canAffordCount(hand: Readonly<Record<CardColor, number>>, count: number): boolean {
  if (hand.LOCOMOTIVE >= count) return true;
  for (const c of TRAIN_COLORS) {
    if (hand[c] + hand.LOCOMOTIVE >= count) return true;
  }
  return false;
}

function canAffordRoute(hand: Readonly<Record<CardColor, number>>, route: RouteDef): boolean {
  const L = route.length;
  const F = route.ferryLocos;
  if (hand.LOCOMOTIVE < F) return false;
  if (hand.LOCOMOTIVE >= L) return true; // all-locomotive payment
  if (route.color === 'GRAY') {
    for (const c of TRAIN_COLORS) if (hand[c] + hand.LOCOMOTIVE >= L) return true;
    return false;
  }
  return hand[route.color] + hand.LOCOMOTIVE >= L;
}
