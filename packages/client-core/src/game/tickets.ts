import type { GameSnapshot } from '@trm/proto';
import { routeById, ticketById } from './content';

/**
 * Ticket completion is authoritative from the wire: the server reveals every player's
 * own-track completed tickets in `snapshot.completedTickets` (finished tickets are public;
 * in-progress ones stay secret). These helpers read that field — the client never re-derives
 * completion — and add the geometry the animation layer needs (the route path to sweep).
 */

/** completed ticket ids grouped by owner player id. */
export function completedByPlayer(snapshot: GameSnapshot): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const c of snapshot.completedTickets) {
    const set = m.get(c.playerId) ?? new Set<string>();
    set.add(c.ticketId);
    m.set(c.playerId, set);
  }
  return m;
}

/** A player's live total: route points + the value of every ticket they have completed. */
export function playerLiveTotal(snapshot: GameSnapshot, playerId: string): number {
  const p = snapshot.players.find((pl) => pl.id === playerId);
  let total = p?.routePoints ?? 0;
  for (const c of snapshot.completedTickets) {
    if (c.playerId === playerId) total += ticketById.get(c.ticketId)?.value ?? 0;
  }
  return total;
}

/**
 * Ordered route ids forming a shortest path between a ticket's two cities over the routes
 * OWNED by `playerId` — the segments to glow start→end during the completion fanfare. `[]` if
 * the player's own routes don't connect the endpoints (e.g. the ticket isn't actually theirs).
 */
export function pathForTicket(
  snapshot: GameSnapshot,
  playerId: string,
  ticketId: string,
): string[] {
  const ticket = ticketById.get(ticketId);
  if (!ticket) return [];
  const a = ticket.a as string;
  const b = ticket.b as string;
  if (a === b) return [];

  // Adjacency over the player's owned routes only.
  const adj = new Map<string, { to: string; routeId: string }[]>();
  const link = (from: string, to: string, routeId: string): void => {
    const list = adj.get(from);
    if (list) list.push({ to, routeId });
    else adj.set(from, [{ to, routeId }]);
  };
  for (const o of snapshot.ownership) {
    if (o.cell.case !== 'ownerPlayerId' || o.cell.value !== playerId) continue;
    const r = routeById.get(o.routeId);
    if (!r) continue;
    link(r.a as string, r.b as string, o.routeId);
    link(r.b as string, r.a as string, o.routeId);
  }

  // BFS from a to b, tracking the route used to reach each city.
  const prev = new Map<string, { from: string; routeId: string }>();
  const seen = new Set<string>([a]);
  const queue: string[] = [a];
  while (queue.length > 0) {
    const cur = queue.shift() as string;
    if (cur === b) break;
    for (const edge of adj.get(cur) ?? []) {
      if (seen.has(edge.to)) continue;
      seen.add(edge.to);
      prev.set(edge.to, { from: cur, routeId: edge.routeId });
      queue.push(edge.to);
    }
  }
  if (!prev.has(b)) return [];

  // Reconstruct a→b.
  const ids: string[] = [];
  let cur = b;
  while (cur !== a) {
    const step = prev.get(cur);
    if (!step) return [];
    ids.push(step.routeId);
    cur = step.from;
  }
  return ids.reverse();
}
