import type { RouteId, CityId, TicketId } from '@trm/shared';
import type { GameContent, RouteDef, CityDef, TicketDef } from '@trm/map-data';

/**
 * Static, precomputed lookups over a map's content. The board never changes during a game,
 * so it lives outside GameState and is passed alongside it to every engine function. This
 * keeps state small (no duplicated static data) and serialization clean.
 */
export interface Board {
  readonly content: GameContent;
  readonly cityIds: readonly CityId[];
  readonly routeById: ReadonlyMap<string, RouteDef>;
  readonly cityById: ReadonlyMap<string, CityDef>;
  readonly ticketById: ReadonlyMap<string, TicketDef>;
  /** city → ids of routes incident to it. */
  readonly incident: ReadonlyMap<string, readonly RouteId[]>;
  /** routeId → sibling routeId for double-route pairs (only present for paired routes). */
  readonly doubleSibling: ReadonlyMap<string, RouteId>;
}

export function buildBoard(content: GameContent): Board {
  const routeById = new Map<string, RouteDef>();
  const cityById = new Map<string, CityDef>();
  const ticketById = new Map<string, TicketDef>();
  const incident = new Map<string, RouteId[]>();
  const doubleSibling = new Map<string, RouteId>();

  for (const c of content.cities) {
    cityById.set(c.id as string, c);
    incident.set(c.id as string, []);
  }
  const byGroup = new Map<string, RouteDef[]>();
  for (const r of content.routes) {
    routeById.set(r.id as string, r);
    incident.get(r.a as string)?.push(r.id);
    incident.get(r.b as string)?.push(r.id);
    if (r.doubleGroup) {
      const g = byGroup.get(r.doubleGroup) ?? [];
      g.push(r);
      byGroup.set(r.doubleGroup, g);
    }
  }
  for (const members of byGroup.values()) {
    if (members.length === 2) {
      const [m0, m1] = members as [RouteDef, RouteDef];
      doubleSibling.set(m0.id as string, m1.id);
      doubleSibling.set(m1.id as string, m0.id);
    }
  }
  for (const t of content.tickets) ticketById.set(t.id as string, t);

  return {
    content,
    cityIds: content.cities.map((c) => c.id),
    routeById,
    cityById,
    ticketById,
    incident,
    doubleSibling,
  };
}

export const getRoute = (board: Board, id: RouteId): RouteDef | undefined => board.routeById.get(id as string);
export const getTicket = (board: Board, id: TicketId): TicketDef | undefined =>
  board.ticketById.get(id as string);
export const siblingOf = (board: Board, id: RouteId): RouteId | undefined =>
  board.doubleSibling.get(id as string);
export const incidentRoutes = (board: Board, city: CityId): readonly RouteId[] =>
  board.incident.get(city as string) ?? [];
