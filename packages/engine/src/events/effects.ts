import type { RouteId } from '@trm/shared';
import type { GameState } from '../types/state';
import type { RandomEventKind } from '../types/events-state';

/**
 * Pure rule-effect queries for the random-events feature (M2).
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
    if (act.kind === 'TYPHOON_LANDFALL' && act.routeIds) {
      for (const rid of act.routeIds) {
        if (!state.ownership[rid as string]) out.add(rid as string);
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
    if (act.kind === 'TYPHOON_LANDFALL' && act.routeIds && act.routeIds.includes(routeId)) {
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
