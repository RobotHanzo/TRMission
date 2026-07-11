import type { PlayerId, CardColor, TrainColor, CityId, RouteId } from '@trm/shared';
import { CARD_COLORS, TRAIN_COLORS } from '@trm/shared';
import type { RouteDef } from '@trm/map-data';
import type { Board } from './board';
import type { GameState } from './types/state';
import type { Action, Payment } from './types/actions';
import type { RedactedView, RedactedPlayer, RedactedFinalScoreboard } from './types/view';
import { reduce, hasAnyLegalMove } from './reduce';
import { currentPlayerId } from './turn';
import { getPlayer } from './reducers/common';
import {
  skyLanternSurcharge,
  freeStationAvailable,
  eventResources,
  hiveOfSparksActive,
  canUseNightMarketSwap,
} from './events/effects';
import { ownConnectedTicketIds } from './graph/connectivity';
import { evaluatePlayerTickets, longestTrailRouteIdsFor } from './scoring';
import type { TicketId } from '@trm/shared';

type Hand = Record<CardColor, number>;

/** All valid payments for claiming a route, given the player's hand & trains. */
export function enumerateClaimPayments(
  board: Board,
  state: GameState,
  player: PlayerId,
  route: RouteDef,
): Payment[] {
  const p = getPlayer(state, player);
  if (!p) return [];
  // Trains are measured by the BASE length; a sky-lantern surcharge only inflates the card count so
  // legalActions still offers the (surcharged) claim (mirror of validateRoutePayment's extraCards).
  if (p.trainCars < route.length) return [];
  const extraCards = skyLanternSurcharge(state, route.id);
  const resources = eventResources(state, player);
  const variants: readonly {
    reduction: number;
    bentoSpend?: 'WILD' | 'POINTS';
    useClaimDiscount?: boolean;
  }[] = [
    { reduction: 0 },
    ...(resources.bentoTokens > 0
      ? [
          { reduction: 1, bentoSpend: 'WILD' as const },
          { reduction: 0, bentoSpend: 'POINTS' as const },
        ]
      : []),
    ...(resources.claimDiscounts > 0 ? [{ reduction: 1, useClaimDiscount: true }] : []),
    ...(resources.bentoTokens > 0 && resources.claimDiscounts > 0
      ? [
          { reduction: 2, bentoSpend: 'WILD' as const, useClaimDiscount: true },
          { reduction: 1, bentoSpend: 'POINTS' as const, useClaimDiscount: true },
        ]
      : []),
  ];
  const out: Payment[] = [];
  for (const variant of variants) {
    const needed = Math.max(0, route.length + extraCards - variant.reduction);
    if (needed < route.ferryLocos) continue;
    for (const payment of enumeratePayments(p.hand, needed, {
      ferryLocos: route.ferryLocos,
      specific: route.color === 'GRAY' ? null : route.color,
    })) {
      out.push({
        ...payment,
        ...(variant.bentoSpend ? { bentoSpend: variant.bentoSpend } : {}),
        ...(variant.useClaimDiscount ? { useClaimDiscount: true } : {}),
      });
    }
  }
  return out;
}

function enumeratePayments(
  hand: Readonly<Hand>,
  length: number,
  opts: { ferryLocos: number; specific: TrainColor | null },
): Payment[] {
  const out: Payment[] = [];
  for (let loco = opts.ferryLocos; loco <= length; loco++) {
    if (hand.LOCOMOTIVE < loco) continue;
    const colorCount = length - loco;
    if (colorCount === 0) {
      out.push({ color: null, colorCount: 0, locomotives: loco });
      continue;
    }
    if (opts.specific) {
      if (hand[opts.specific] >= colorCount)
        out.push({ color: opts.specific, colorCount, locomotives: loco });
    } else {
      for (const c of TRAIN_COLORS) {
        if (hand[c] >= colorCount) out.push({ color: c, colorCount, locomotives: loco });
      }
    }
  }
  return out;
}

function combinations<T>(items: readonly T[], minSize: number): T[][] {
  const out: T[][] = [];
  const n = items.length;
  for (let mask = 0; mask < 1 << n; mask++) {
    const subset: T[] = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) subset.push(items[i] as T);
    if (subset.length >= minSize) out.push(subset);
  }
  return out;
}

/**
 * Every legal action for `player` in the current state. Candidates are generated then filtered
 * through `reduce`, so this can NEVER diverge from what the authoritative reducer accepts.
 */
export function legalActions(board: Board, state: GameState, player: PlayerId): Action[] {
  const phase = state.turn.phase;
  const candidates: Action[] = [];
  const p = getPlayer(state, player);
  if (!p) return [];

  if (phase === 'SETUP_TICKETS') {
    if (p.pendingTicketOffer) {
      for (const keep of combinations(p.pendingTicketOffer, state.ruleParams.minKeepInitial)) {
        candidates.push({ t: 'KEEP_INITIAL_TICKETS', player, keep });
      }
    }
    return candidates.filter((a) => reduce(board, state, a).ok);
  }

  if (player !== currentPlayerId(state)) return [];

  if (phase === 'AWAIT_ACTION') {
    candidates.push({ t: 'DRAW_BLIND', player });
    state.market.forEach((c, slot) => {
      if (c !== null) candidates.push({ t: 'DRAW_FACEUP', player, slot });
    });
    candidates.push({ t: 'DRAW_TICKETS', player });
    for (const route of board.content.routes) {
      for (const payment of enumerateClaimPayments(board, state, player, route)) {
        candidates.push({ t: 'CLAIM_ROUTE', player, routeId: route.id, payment });
      }
    }
    const built = state.ruleParams.stationsPerPlayer - p.stationsRemaining;
    const stationPayments = enumeratePayments(p.hand, built + 1, { ferryLocos: 0, specific: null });
    // Railway-gala free-station: offer the empty (zero-card) payment alongside the paid options
    // exactly while the flag is up. reduce filters it, so an off-mode game is byte-identical.
    const emptyPayment: Payment = { color: null, colorCount: 0, locomotives: 0 };
    const allStationPayments = freeStationAvailable(state)
      ? [emptyPayment, ...stationPayments]
      : stationPayments;
    for (const city of board.cityIds) {
      if (state.stations.some((s) => s.cityId === city)) continue;
      for (const payment of allStationPayments)
        candidates.push({ t: 'BUILD_STATION', player, cityId: city, payment });
    }
    const resources = eventResources(state, player);
    for (const active of state.events?.active ?? []) {
      if (active.kind !== 'SLOPE_REPAIR_ORDER' || !active.routeIds) continue;
      const payments = enumeratePayments(p.hand, 2, { ferryLocos: 0, specific: null });
      const repairPayments =
        resources.repairPermits > 0
          ? [{ color: null, colorCount: 0, locomotives: 0 } as Payment, ...payments]
          : payments;
      for (const routeId of active.routeIds) {
        for (const payment of repairPayments) {
          candidates.push({ t: 'REPAIR_ROUTE', player, routeId, payment });
        }
      }
    }
    if (canUseNightMarketSwap(board, state, player)) {
      for (const giveColor of CARD_COLORS) {
        if (p.hand[giveColor] <= 0) continue;
        state.market.forEach((card, slot) => {
          if (card !== null) candidates.push({ t: 'NIGHT_MARKET_SWAP', player, giveColor, slot });
        });
      }
    }
    if (hiveOfSparksActive(state)) candidates.push({ t: 'START_HIVE_DRAW', player });
    candidates.push({ t: 'PASS', player });
  } else if (phase === 'DRAWING_CARDS') {
    candidates.push({ t: 'DRAW_BLIND', player });
    state.market.forEach((c, slot) => {
      if (c !== null && c !== 'LOCOMOTIVE') candidates.push({ t: 'DRAW_FACEUP', player, slot });
    });
  } else if (phase === 'TICKET_SELECTION') {
    if (p.pendingTicketOffer) {
      for (const keep of combinations(p.pendingTicketOffer, state.ruleParams.minKeepNormal)) {
        candidates.push({ t: 'KEEP_TICKETS', player, keep });
      }
    }
  } else if (phase === 'TUNNEL_PENDING') {
    const pt = state.pendingTunnel;
    if (pt && pt.playerId === player) {
      candidates.push({ t: 'RESOLVE_TUNNEL', player, commit: false });
      for (const extra of enumerateTunnelExtra(pt.playedColor, pt.extraRequired)) {
        candidates.push({ t: 'RESOLVE_TUNNEL', player, commit: true, extra });
      }
    }
  } else if (phase === 'LANTERN_RELOCATION') {
    const pending = state.events?.lanternPendingRelocation;
    if (pending?.playerId === player) {
      for (const cityId of pending.candidateCityIds) {
        candidates.push({ t: 'RELOCATE_LANTERN_HOST', player, cityId });
      }
    }
  } else if (phase === 'EVENT_DRAFT') {
    for (const perk of ['CLAIM_DISCOUNT', 'DRAW_TWO', 'REPAIR_PERMIT'] as const) {
      candidates.push({ t: 'CHOOSE_EVENT_PERK', player, perk });
    }
  } else if (phase === 'HIVE_DRAW') {
    candidates.push({ t: 'CONTINUE_HIVE_DRAW', player }, { t: 'STOP_HIVE_DRAW', player });
  }

  return candidates.filter((a) => reduce(board, state, a).ok);
}

function enumerateTunnelExtra(playedColor: TrainColor | null, need: number): Payment[] {
  const out: Payment[] = [];
  for (let loco = 0; loco <= need; loco++) {
    const colorCount = need - loco;
    if (colorCount === 0) out.push({ color: null, colorCount: 0, locomotives: loco });
    else if (playedColor !== null) out.push({ color: playedColor, colorCount, locomotives: loco });
  }
  return out;
}

/** Quick check used by UI/bots: does the player have any legal move (true) or must PASS (false)? */
export { hasAnyLegalMove };

// ─────────────────────────────────────────────── redaction ──────────────────────────────────

function handCount(hand: Readonly<Hand>): number {
  let n = 0;
  for (const c of CARD_COLORS) n += hand[c];
  return n;
}

/**
 * Project state for a single viewer: the viewer sees their own hand & tickets; opponents are
 * counts only. At GAME_OVER all kept tickets are revealed. The gateway sends ONLY this (never
 * raw GameState), so hidden information is structurally impossible to leak (ADR / risk #1).
 */
export function redactFor(board: Board, state: GameState, viewer: PlayerId | null): RedactedView {
  const gameOver = state.turn.phase === 'GAME_OVER';
  const eventsBlock = projectEvents(board, state);

  // Finished tickets are public (own-track completion). Computed once for every player; the
  // result is viewer-independent, so the same list reaches everyone.
  const completedTickets: { player: PlayerId; ticket: TicketId }[] = [];
  for (const id of state.turnOrder) {
    const p = state.players[id as string];
    if (!p || p.keptTickets.length === 0) continue;
    // Under unlimitedStationBorrow, completion is recorded (locked) in state the moment it happens
    // — including station-borrow completions — so read it directly. Otherwise derive own-track
    // completion (the only kind that is monotonic without the variant).
    if (state.ruleParams.unlimitedStationBorrow) {
      for (const tid of p.completedTickets) completedTickets.push({ player: id, ticket: tid });
      continue;
    }
    const ownEdges: { a: string; b: string }[] = [];
    for (const [routeId, cell] of Object.entries(state.ownership)) {
      if ('owner' in cell && cell.owner === id) {
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
    const done = new Set(ownConnectedTicketIds({ ownEdges, tickets }));
    for (const tid of p.keptTickets) {
      if (done.has(tid as string)) completedTickets.push({ player: id, ticket: tid });
    }
  }

  const players: RedactedPlayer[] = state.turnOrder.map((id) => {
    const p = state.players[id as string];
    const isSelf = id === viewer;
    const keptVisible = isSelf || gameOver;
    const resources = eventResources(state, id);
    return {
      id,
      seat: p?.seat ?? 0,
      trainCars: p?.trainCars ?? 0,
      stationsRemaining: p?.stationsRemaining ?? 0,
      routePoints: p?.routePoints ?? 0,
      handCount: p ? handCount(p.hand) : 0,
      ticketCount: p?.keptTickets.length ?? 0,
      bentoTokens: resources.bentoTokens,
      blessings: resources.blessings,
      claimDiscounts: resources.claimDiscounts,
      repairPermits: resources.repairPermits,
      hand: isSelf && p ? { ...p.hand } : null,
      keptTickets: keptVisible && p ? [...p.keptTickets] : null,
      pendingTicketOffer: isSelf && p?.pendingTicketOffer ? [...p.pendingTicketOffer] : null,
    };
  });

  const discardTotal = (): Record<CardColor, number> => ({ ...state.discard });

  // Enrich the stored final scoreboard with display-only derivations (gains/losses split and the
  // longest-trail route ids). Computed here, at the projection boundary, so `GameState` stays minimal.
  const finalScores: RedactedFinalScoreboard | null =
    state.finalScores === null
      ? null
      : {
          players: state.finalScores.players.map((pf) => ({
            ...pf,
            completedTicketIds: evaluatePlayerTickets(board, state, pf.playerId).completedTicketIds,
            longestTrailRouteIds: longestTrailRouteIdsFor(board, state, pf.playerId),
          })),
          ranking: state.finalScores.ranking,
        };

  return {
    schemaVersion: state.schemaVersion,
    contentHash: state.contentHash,
    phase: state.turn.phase,
    orderIndex: state.turn.orderIndex,
    currentPlayer: gameOver ? null : (state.turnOrder[state.turn.orderIndex] as PlayerId),
    turnOrder: state.turnOrder,
    market: [...state.market],
    deckCount: state.deck.length,
    discard: discardTotal(),
    ticketDeckLongCount: state.ticketDeckLong.length,
    ticketDeckShortCount: state.ticketDeckShort.length,
    ownership: { ...state.ownership },
    stations: [...state.stations],
    endgame: state.endgame,
    pendingTunnel: state.pendingTunnel
      ? {
          player: state.pendingTunnel.playerId,
          routeId: state.pendingTunnel.routeId,
          revealed: [...state.pendingTunnel.revealed],
          extraRequired: state.pendingTunnel.extraRequired,
          playedColor: state.pendingTunnel.playedColor,
        }
      : null,
    players,
    finalScores,
    completedTickets,
    settings: {
      unlimitedStationBorrow: state.ruleParams.unlimitedStationBorrow,
      secondDrawAfterBlindRainbow: state.ruleParams.secondDrawAfterBlindRainbow,
      noUnfinishedTicketPenalty: state.ruleParams.noUnfinishedTicketPenalty,
      doubleRouteSingleFor23: state.ruleParams.doubleRouteSingleFor23,
      eventsMode: state.ruleParams.eventsMode ?? 'off',
    },
    ...(eventsBlock ? { events: eventsBlock } : {}),
  };
}

/**
 * Project the random-events state for the wire (viewer-independent; spectators see the same block).
 * Returns undefined when the feature is off. The hidden schedule / `nextIdx` / `suppressed` never
 * leak: only currently-live effects plus a one-round `forecast` of the next telegraphed entry
 * (exactly its announced window) reach a viewer.
 */
function projectEvents(board: Board, state: GameState): RedactedView['events'] {
  const ev = state.events;
  if (!ev) return undefined;
  const roundIndex = ev.roundIndex;

  const entry = ev.schedule[ev.nextIdx];
  const forecast =
    entry &&
    entry.telegraphed &&
    entry.startRound === roundIndex + 1 &&
    !ev.suppressed.includes(entry.id)
      ? {
          id: entry.id,
          kind: entry.kind,
          startRound: entry.startRound,
          durationRounds: entry.durationRounds,
          ...(entry.routeIds ? { routeIds: entry.routeIds } : {}),
          ...(entry.region !== undefined ? { region: entry.region } : {}),
          ...(entry.cityId !== undefined ? { cityId: entry.cityId } : {}),
          ...(entry.cityPath ? { cityPath: entry.cityPath } : {}),
          ...(entry.pair ? { pair: entry.pair } : {}),
        }
      : null;

  const hotspots = Object.keys(ev.hotspots)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((cityId) => ({ cityId: cityId as CityId, level: ev.hotspots[cityId] as number }));

  const closedRouteIds: RouteId[] = [];
  for (const act of ev.active) {
    if ((act.kind === 'TYPHOON_LANDFALL' || act.kind === 'SLOPE_REPAIR_ORDER') && act.routeIds) {
      for (const rid of act.routeIds) {
        if (!state.ownership[rid as string] && !ev.repairedRouteIds.includes(rid))
          closedRouteIds.push(rid);
      }
    }
  }

  const actor = state.turnOrder[state.turn.orderIndex] as PlayerId | undefined;
  const nightMarketSwapAvailable =
    actor !== undefined &&
    state.turn.phase === 'AWAIT_ACTION' &&
    canUseNightMarketSwap(board, state, actor);

  return {
    mode: ev.mode,
    roundIndex,
    active: [...ev.active],
    forecast,
    hotspots,
    charters: [...ev.charters],
    reopenBonusRouteIds: [...ev.reopenBonus],
    closedRouteIds,
    freeStationAvailable: ev.freeStation !== undefined,
    lanternHost: ev.lanternHost ?? null,
    lanternPendingRelocation: ev.lanternPendingRelocation ?? null,
    luckyContracts: [...ev.luckyContracts],
    repairedRouteIds: [...ev.repairedRouteIds],
    eventDraft: ev.eventDraft ?? null,
    pendingHiveDraw: ev.pendingHiveDraw ?? null,
    boringActive: ev.boringMachine !== undefined,
    nightMarketSwapAvailable,
  };
}
