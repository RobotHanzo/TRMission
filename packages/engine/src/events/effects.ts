import type { RouteId, CityId, PlayerId } from '@trm/shared';
import type { GameState } from '../types/state';
import type { EventResources, RandomEventKind } from '../types/events-state';
import type { Board } from '../board';
import type { Edge } from '../graph/connectivity';

/**
 * Pure rule-effect queries for the random-events feature (M2 restrictive + M3 positive events).
 *
 * Every helper is TOTAL for `state.events === undefined` (feature off) and returns the no-event
 * answer, so off-mode behaviour is byte-identical. None of these mutate state except
 * {@link takeReopenBonus}, which returns a fresh state with the consumed route removed.
 *
 * These predicates are the single source of truth shared by BOTH the reducer's accept/reject gates
 * and the `hasAnyLegalMove` / payment-enumeration mirrors, so PASS legality can never diverge from
 * what the reducer actually accepts.
 */

const EMPTY_SET: ReadonlySet<string> = new Set<string>();

function hasActiveKind(state: GameState, kind: RandomEventKind): boolean {
  const ev = state.events;
  if (!ev) return false;
  return ev.active.some((a) => a.kind === kind);
}

/** Currently-closed (active TYPHOON_LANDFALL, still-unclaimed) route ids. */
export function closedRouteIds(state: GameState): ReadonlySet<string> {
  const ev = state.events;
  if (!ev) return EMPTY_SET;
  const out = new Set<string>();
  for (const act of ev.active) {
    if ((act.kind === 'TYPHOON_LANDFALL' || act.kind === 'SLOPE_REPAIR_ORDER') && act.routeIds) {
      for (const rid of act.routeIds) {
        if (!state.ownership[rid as string] && !ev.repairedRouteIds.includes(rid))
          out.add(rid as string);
      }
    }
  }
  return out;
}

/** Is this specific route currently closed by an active typhoon landfall (and still unclaimed)? */
export function isRouteClosed(state: GameState, routeId: RouteId): boolean {
  const ev = state.events;
  if (!ev) return false;
  if (state.ownership[routeId as string]) return false;
  for (const act of ev.active) {
    if (
      (act.kind === 'TYPHOON_LANDFALL' || act.kind === 'SLOPE_REPAIR_ORDER') &&
      act.routeIds &&
      act.routeIds.includes(routeId) &&
      !ev.repairedRouteIds.includes(routeId)
    ) {
      return true;
    }
  }
  return false;
}

/** During a typhoon day off, all route claims (normal + tunnel begin) are suspended. */
export function claimsSuspended(state: GameState): boolean {
  return hasActiveKind(state, 'TYPHOON_DAY_OFF');
}

/** During a typhoon day off, station construction is suspended. */
export function stationsSuspended(state: GameState): boolean {
  return hasActiveKind(state, 'TYPHOON_DAY_OFF');
}

/** Extra cards required to claim `routeId` while a sky-lantern surcharge is active (0 or 1). */
export function skyLanternSurcharge(state: GameState, routeId: RouteId): 0 | 1 {
  return skyLanternDoubles(state, routeId) ? 1 : 0;
}

/** Are `routeId`'s points doubled by an active sky-lantern event? (same predicate as the surcharge) */
export function skyLanternDoubles(state: GameState, routeId: RouteId): boolean {
  const ev = state.events;
  if (!ev) return false;
  for (const act of ev.active) {
    if (act.kind === 'SKY_LANTERN' && act.routeIds && act.routeIds.includes(routeId)) return true;
  }
  return false;
}

/** Extra tunnel-reveal cards contributed by an active aftershock (1 while active, else 0). */
export function tunnelRevealExtra(state: GameState): number {
  return hasActiveKind(state, 'AFTERSHOCK') ? 1 : 0;
}

/** Effective tunnel reveal count, including mutually composable event effects. */
export function effectiveTunnelRevealCount(state: GameState): number {
  const base = state.events?.boringMachine ? 2 : state.ruleParams.tunnelRevealCount;
  return base + tunnelRevealExtra(state);
}

/** Extra card draws granted per turn by an active typhoon day off (1 while active, else 0). */
export function dayOffExtraDraw(state: GameState): number {
  return hasActiveKind(state, 'TYPHOON_DAY_OFF') ? 1 : 0;
}

/**
 * Consume the first-claim reopen bonus for `routeId`, if any. Returns the (possibly unchanged)
 * state and the bonus points (0 or 2). Removing the route id is idempotent — a second claimer of a
 * reopened double-route sibling finds it already gone and earns nothing.
 */
export function takeReopenBonus(
  state: GameState,
  routeId: RouteId,
): { state: GameState; bonus: 0 | 2 } {
  const ev = state.events;
  if (!ev || !ev.reopenBonus.includes(routeId)) return { state, bonus: 0 };
  const reopenBonus = ev.reopenBonus.filter((r) => r !== routeId);
  return { state: { ...state, events: { ...ev, reopenBonus } }, bonus: 2 };
}

// ─────────────────────────────────── positive-event queries (M3) ────────────────────────────────

/** Is a viral-hotspot marker present on `cityId`? Returns its level (0 = none, 1, or 2). */
export function hotspotLevel(state: GameState, cityId: CityId): number {
  return state.events?.hotspots[cityId as string] ?? 0;
}

/** Is a stamp-rally window currently active (new-city claim bonuses in effect)? */
export function stampRallyActive(state: GameState): boolean {
  return hasActiveKind(state, 'STAMP_RALLY');
}

/** Is a railway-gala zero-cost-station window currently open? */
export function freeStationAvailable(state: GameState): boolean {
  return state.events?.freeStation !== undefined;
}

/**
 * Consume the gala free-station window game-wide (first-come). Returns a fresh state with the
 * `freeStation` key removed ENTIRELY (never set to `undefined`, keeping clone/digest clean). A
 * no-op — same reference — when the window is not open.
 */
export function consumeFreeStation(state: GameState): GameState {
  const ev = state.events;
  if (!ev || ev.freeStation === undefined) return state;
  const { freeStation: _omit, ...rest } = ev;
  return { ...state, events: rest };
}

/** The endpoint-city pairs of every route `player` currently owns (their OWN network edges). */
export function playerOwnEdges(board: Board, state: GameState, player: PlayerId): Edge[] {
  const edges: Edge[] = [];
  for (const [routeId, cell] of Object.entries(state.ownership)) {
    if ('owner' in cell && cell.owner === player) {
      const r = board.routeById.get(routeId);
      if (r) edges.push({ a: r.a as string, b: r.b as string });
    }
  }
  return edges;
}

/** The set of city ids touched by `player`'s owned routes (endpoints of their own network). */
export function playerNetworkCities(board: Board, state: GameState, player: PlayerId): Set<string> {
  const cities = new Set<string>();
  for (const [routeId, cell] of Object.entries(state.ownership)) {
    if ('owner' in cell && cell.owner === player) {
      const r = board.routeById.get(routeId);
      if (r) {
        cities.add(r.a as string);
        cities.add(r.b as string);
      }
    }
  }
  return cities;
}

// ─── expansion-event queries/resources ─────────────────────────────────────────────

export const EMPTY_EVENT_RESOURCES: EventResources = Object.freeze({
  bentoTokens: 0,
  blessings: 0,
  claimDiscounts: 0,
  repairPermits: 0,
});

export function eventResources(state: GameState, player: PlayerId): EventResources {
  return state.events?.resources[player as string] ?? EMPTY_EVENT_RESOURCES;
}

export function updateEventResources(
  state: GameState,
  player: PlayerId,
  update: (current: EventResources) => EventResources,
): GameState {
  const ev = state.events;
  if (!ev) return state;
  return {
    ...state,
    events: {
      ...ev,
      resources: { ...ev.resources, [player as string]: update(eventResources(state, player)) },
    },
  };
}

export function activeEvent(state: GameState, kind: RandomEventKind) {
  return state.events?.active.find((a) => a.kind === kind);
}

export function springFestivalActive(state: GameState): boolean {
  return hasActiveKind(state, 'SPRING_FESTIVAL_RUSH');
}

export function turnDirection(state: GameState): 1 | -1 {
  return springFestivalActive(state) ? -1 : 1;
}

export function ticketOfferCount(state: GameState): number {
  return springFestivalActive(state) ? 4 : state.ruleParams.ticketDrawCount;
}

export function allSeatsReservedActive(state: GameState): boolean {
  return hasActiveKind(state, 'ALL_SEATS_RESERVED');
}

export function hiveOfSparksActive(state: GameState): boolean {
  return hasActiveKind(state, 'HIVE_OF_SPARKS');
}

export function harvestFestivalActive(state: GameState): boolean {
  return hasActiveKind(state, 'HARVEST_FESTIVAL_EXPRESS');
}

export function activeEventCity(state: GameState, kind: RandomEventKind): CityId | null {
  return (activeEvent(state, kind)?.cityId as CityId | undefined) ?? null;
}

export function routeTouchesCity(board: Board, routeId: RouteId, cityId: CityId): boolean {
  const route = board.routeById.get(routeId as string);
  return !!route && (route.a === cityId || route.b === cityId);
}

export function routeTouchesRegion(board: Board, routeId: RouteId, region: string): boolean {
  const route = board.routeById.get(routeId as string);
  if (!route) return false;
  return (
    board.cityById.get(route.a as string)?.region === region ||
    board.cityById.get(route.b as string)?.region === region
  );
}

export function activeBentoCity(state: GameState): CityId | null {
  return activeEventCity(state, 'BENTO_RUSH');
}

export function activeNightMarketCity(state: GameState): CityId | null {
  return activeEventCity(state, 'STATION_FRONT_NIGHT_MARKET');
}

/** Whether this player can currently perform at least one legal free night-market exchange. */
export function canUseNightMarketSwap(board: Board, state: GameState, player: PlayerId): boolean {
  const city = activeNightMarketCity(state);
  const hand = state.players[player as string]?.hand;
  if (
    city === null ||
    !hand ||
    state.turn.nightMarketSwapUsed ||
    !playerNetworkCities(board, state, player).has(city as string) ||
    !Object.values(hand).some((count) => count > 0)
  )
    return false;
  return state.market.some(
    (card) => card !== null && !(card === 'LOCOMOTIVE' && allSeatsReservedActive(state)),
  );
}

export function processionCurrentCity(state: GameState): CityId | null {
  const act = activeEvent(state, 'GODDESS_PROCESSION');
  if (!act?.cityPath) return null;
  return (act.cityPath[act.position ?? 0] as CityId | undefined) ?? null;
}

export function activeHarvestRegion(state: GameState): string | null {
  return activeEvent(state, 'HARVEST_FESTIVAL_EXPRESS')?.region ?? null;
}

/** Decrement the hidden boring-machine marker by the number of real cards drawn. */
export function advanceBoringMarker(
  state: GameState,
  cardsDrawn: number,
): { state: GameState; endedId: string | null } {
  const ev = state.events;
  const marker = ev?.boringMachine;
  if (!ev || !marker || cardsDrawn <= 0) return { state, endedId: null };
  const remaining = marker.remainingDraws - cardsDrawn;
  if (remaining > 0) {
    return {
      state: {
        ...state,
        events: { ...ev, boringMachine: { ...marker, remainingDraws: remaining } },
      },
      endedId: null,
    };
  }
  const { boringMachine: _omit, ...rest } = ev;
  return { state: { ...state, events: rest }, endedId: marker.eventId };
}
