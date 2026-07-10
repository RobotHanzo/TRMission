// The pure decisions behind "follow the acting player" — ported from apps/web/src/components/
// Board.tsx (latestActionPoi + disengageFollow's predicate), minus the DOM. BoardView wires these
// to the camera hook; keeping them here lets the behaviour pin down in plain jest.
import type { GameEvent } from '@trm/proto';
import { cityById } from '../game/content';
import { ROUTE_GEOMETRY } from '../game/routeGeometry';

/**
 * Board coordinate (+ a stable key) of `playerId`'s most recent spatial action in the event tail.
 * Scoped to that player so following a bot glides only to ITS moves — never to a stale action from
 * the previous turn (which matters now that follow can stay armed through the viewer's own turn).
 */
export function latestActionPoi(
  events: readonly GameEvent[],
  playerId: string,
): { x: number; y: number; key: string } | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]?.event;
    if (!e) continue;
    if (e.case === 'routeClaimed' || e.case === 'tunnelRevealed') {
      if (e.value.playerId !== playerId) continue;
      const g = ROUTE_GEOMETRY.get(e.value.routeId);
      if (g) return { x: g.mid.x, y: g.mid.y, key: `${e.case}:${e.value.routeId}:${i}` };
    } else if (e.case === 'stationBuilt') {
      if (e.value.playerId !== playerId) continue;
      const c = cityById.get(e.value.cityId);
      if (c) return { x: c.x, y: c.y, key: `station:${e.value.cityId}:${i}` };
    }
  }
  return null;
}

/** Ports Board.tsx disengageFollow's decision: a manual gesture takes the camera back —
 *  UNLESS it's my own turn (my camera IS the broadcast source; follow stays armed). */
export const shouldDisengageFollow = (followActing: boolean, myTurn: boolean): boolean =>
  followActing && !myTurn;
