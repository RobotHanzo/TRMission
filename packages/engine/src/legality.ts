import type { PlayerId, CardColor } from '@trm/shared';
import { TRAIN_COLORS } from '@trm/shared';
import type { RouteDef } from '@trm/map-data';
import type { Board } from './board';
import { groupMembersOf } from './board';
import type { GameState } from './types/state';
import type { CardCounts } from './hand';
import { getPlayer } from './reducers/common';
import {
  allSeatsReservedActive,
  claimsSuspended,
  closedRouteIds,
  skyLanternSurcharge,
  stationsSuspended,
  freeStationAvailable,
  canUseNightMarketSwap,
  hiveOfSparksActive,
  eventResources,
} from './events/effects';

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

function canAffordRoute(
  hand: Readonly<Record<CardColor, number>>,
  route: RouteDef,
  extraCards = 0,
): boolean {
  // Sky-lantern surcharge adds cards, not trains: the caller already checked `trainCars` against
  // the BASE length, so here we only inflate the CARD requirement.
  const L = Math.max(0, route.length + extraCards);
  const F = route.ferryLocos;
  if (L < F) return false;
  if (hand.LOCOMOTIVE < F) return false;
  if (hand.LOCOMOTIVE >= L) return true; // all-locomotive payment
  if (route.color === 'GRAY') {
    for (const c of TRAIN_COLORS) if (hand[c] + hand.LOCOMOTIVE >= L) return true;
    return false;
  }
  return hand[route.color] + hand.LOCOMOTIVE >= L;
}

/** No card can be drawn anywhere: deck+discard empty AND no takeable market slot. */
export function poolDead(state: GameState): boolean {
  if (state.deck.length + totalDiscard(state.discard) > 0) return false;
  return !state.market.some(
    (c) => c !== null && !(c === 'LOCOMOTIVE' && allSeatsReservedActive(state)),
  );
}

/** Can `player` claim at least one open route right now? (exact mirror of the applyClaimRoute gates) */
export function canClaimAnyRoute(board: Board, state: GameState, player: PlayerId): boolean {
  const p = getPlayer(state, player);
  if (!p || claimsSuspended(state)) return false;
  const resources = eventResources(state, player);
  const closed = closedRouteIds(state);
  for (const route of board.content.routes) {
    if (state.ownership[route.id as string]) continue;
    if (closed.has(route.id as string)) continue;
    if ((route.brokenCarriages ?? 0) > 0) {
      const repair = state.brokenRails?.[route.id as string];
      if (!repair) continue;
      if (repair.exclusiveTurnEnds > 0 && repair.by !== player) continue;
    }
    const ownsGroupMember = groupMembersOf(board, route.id).some((other) => {
      const sc = state.ownership[other as string];
      return sc && 'owner' in sc && sc.owner === player;
    });
    if (ownsGroupMember) continue;
    if (p.trainCars < route.length) continue;
    // Try every reduction level, not just the deepest one: a ferry's locomotive floor can make the
    // fully-reduced requirement unpayable while a shallower reduction (or none) still affords a
    // payment — the exact mirror of enumerateClaimPayments' per-variant floor skip.
    const maxReduction =
      (resources.bentoTokens > 0 ? 1 : 0) + (resources.claimDiscounts > 0 ? 1 : 0);
    const surcharge = skyLanternSurcharge(state, route.id);
    for (let reduction = 0; reduction <= maxReduction; reduction++) {
      if (canAffordRoute(p.hand, route, surcharge - reduction)) return true;
    }
  }
  return false;
}

/** True when NO player at the table can claim any open route (the deadlock end-sequence gate). */
export function noPlayerCanClaimRoute(board: Board, state: GameState): boolean {
  return state.turnOrder.every((pid) => !canClaimAnyRoute(board, state, pid));
}

/**
 * Whether the player has ANY legal non-pass move (used by PASS validation and legalActions).
 * NOTE: drawing destination tickets is deliberately NOT counted as a move here — a player whose
 * only remaining option would be a futile ticket draw in a dead card pool must PASS instead (the
 * deadlock fix). PASS is legal exactly when this returns false, preserving A15.
 */
export function hasAnyLegalMove(board: Board, state: GameState, player: PlayerId): boolean {
  const p = getPlayer(state, player);
  if (!p) return false;
  // Draw cards: any card available anywhere?
  const discardTotal = totalDiscard(state.discard);
  if (state.deck.length + discardTotal > 0) return true;
  if (
    state.market.some((c) => c !== null && !(c === 'LOCOMOTIVE' && allSeatsReservedActive(state)))
  )
    return true;
  // Build a station — suspended entirely during a typhoon day off (mirror of applyBuildStation).
  if (
    !stationsSuspended(state) &&
    p.stationsRemaining > 0 &&
    state.stations.length < board.cityIds.length
  ) {
    // Gala free-station: buildable with zero cards while the flag is up (mirror of the empty-payment
    // branch in applyBuildStation). Day-off suspension above already wins over the flag.
    if (freeStationAvailable(state)) return true;
    const built = state.ruleParams.stationsPerPlayer - p.stationsRemaining;
    const cost = built + 1;
    if (canAffordCount(p.hand, cost)) return true;
  }
  // Hive of Sparks is a main-action draw option while its one-round window is active.
  if (hiveOfSparksActive(state) && state.deck.length + discardTotal > 0) return true;
  // Slope repair is a main action when the player can pay two matching cards or owns a permit.
  const resources = eventResources(state, player);
  if (
    state.events?.active.some(
      (active) =>
        active.kind === 'SLOPE_REPAIR_ORDER' &&
        active.routeIds?.some(
          (rid) => !state.ownership[rid as string] && !state.events?.repairedRouteIds.includes(rid),
        ),
    ) &&
    (resources.repairPermits > 0 || canAffordCount(p.hand, 2))
  )
    return true;
  // Broken-rail repair is a main action whenever an unrepaired broken route's cards can be paid
  // (mirror of applyBrokenRailRepair: unowned, not event-closed, not an open slope-repair target —
  // that case keeps the event meaning of REPAIR_ROUTE and is covered by the slope branch above).
  {
    const closed = closedRouteIds(state);
    for (const route of board.content.routes) {
      const carriages = route.brokenCarriages ?? 0;
      if (carriages <= 0) continue;
      const rid = route.id as string;
      if (state.brokenRails?.[rid] || state.ownership[rid] || closed.has(rid)) continue;
      const canAfford =
        route.color === 'GRAY'
          ? TRAIN_COLORS.some((c) => p.hand[c] + p.hand.LOCOMOTIVE >= carriages)
          : p.hand[route.color] + p.hand.LOCOMOTIVE >= carriages;
      if (canAfford) return true;
    }
  }
  // A free night-market swap can change the hand before the main action, so it is itself a legal
  // non-pass continuation. Once used, the normal main-action checks below decide whether PASS is
  // required.
  if (canUseNightMarketSwap(board, state, player)) return true;
  // Claim a route — the full gate mirror lives in canClaimAnyRoute.
  if (canClaimAnyRoute(board, state, player)) return true;
  return false;
}
