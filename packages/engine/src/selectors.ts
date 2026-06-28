import type { PlayerId, CardColor, TrainColor } from '@trm/shared';
import { CARD_COLORS, TRAIN_COLORS } from '@trm/shared';
import type { RouteDef } from '@trm/map-data';
import type { Board } from './board';
import type { GameState } from './types/state';
import type { Action, Payment } from './types/actions';
import type { RedactedView, RedactedPlayer, RedactedFinalScoreboard } from './types/view';
import { reduce, hasAnyLegalMove } from './reduce';
import { currentPlayerId } from './turn';
import { getPlayer } from './reducers/common';
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
  if (p.trainCars < route.length) return [];
  return enumeratePayments(p.hand, route.length, {
    ferryLocos: route.ferryLocos,
    specific: route.color === 'GRAY' ? null : route.color,
  });
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
    for (const city of board.cityIds) {
      if (state.stations.some((s) => s.cityId === city)) continue;
      for (const payment of stationPayments)
        candidates.push({ t: 'BUILD_STATION', player, cityId: city, payment });
    }
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
    return {
      id,
      seat: p?.seat ?? 0,
      trainCars: p?.trainCars ?? 0,
      stationsRemaining: p?.stationsRemaining ?? 0,
      routePoints: p?.routePoints ?? 0,
      handCount: p ? handCount(p.hand) : 0,
      ticketCount: p?.keptTickets.length ?? 0,
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
        }
      : null,
    players,
    finalScores,
    completedTickets,
  };
}
