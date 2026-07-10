import { asCityId, asRouteId, asTicketId } from '@trm/shared';
import type { RouteLength } from '@trm/shared';
import type { CityTier, GameContent } from '@trm/map-data';
import type { MapDraft } from '../../../net/rest';

/** The wire/editor shape carries plain strings; GameContent (and validateContent/validateForPlay/
 *  generateTickets) use branded ids. The editor never trusts these values into the engine — this
 *  is purely for client-side validation/preview, with the server re-validating at start time. */
export function draftToContent(
  draft: MapDraft,
  meta: { nameZh: string; nameEn: string },
): GameContent {
  return {
    meta: { mapId: 'draft', version: 0, nameZh: meta.nameZh, nameEn: meta.nameEn },
    cities: draft.cities.map(({ tier, ...c }) => ({
      ...c,
      id: asCityId(c.id),
      ...(tier !== undefined ? { tier: tier as CityTier } : {}),
    })),
    routes: draft.routes.map((r) => ({
      id: asRouteId(r.id),
      a: asCityId(r.a),
      b: asCityId(r.b),
      color: r.color as GameContent['routes'][number]['color'],
      length: r.length as RouteLength,
      ferryLocos: r.ferryLocos,
      isTunnel: r.isTunnel,
      ...(r.doubleGroup !== undefined ? { doubleGroup: r.doubleGroup } : {}),
      ...(r.bow !== undefined ? { bow: r.bow } : {}),
    })),
    tickets: draft.tickets.map((t) => ({
      ...t,
      id: asTicketId(t.id),
      a: asCityId(t.a),
      b: asCityId(t.b),
    })),
    ...(draft.geography !== undefined ? { geography: draft.geography } : {}),
    ...(draft.rules !== undefined ? { rules: draft.rules } : {}),
  };
}
