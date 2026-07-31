import { asCityId, asRouteId, asTicketId } from '@trm/shared';
import type { RouteLength } from '@trm/shared';
import { CONTENT_REGISTRY } from '@trm/map-data';
import type { CityTier, GameContent } from '@trm/map-data';
import { api, type MapContentDto } from '../net/rest';

/** Every official map ships in the bundle, so its content resolves with no network call. Keyed off
 *  the version registry, not `OFFICIAL_MAPS`: a game started against a map that has since been
 *  edited stores the hash of the content it was published with, and that archived version renders
 *  here exactly the way the server rebuilds its board from it. */
const bundled: ReadonlyMap<string, GameContent> = CONTENT_REGISTRY;
const cache = new Map<string, GameContent>();
const inflight = new Map<string, Promise<GameContent>>();

/** The wire shape carries plain strings; GameContent uses branded ids (already server-validated,
 *  so the casts are a trust boundary, not a leap of faith — mirrors the server's draftFromDto). */
function contentFromDto(dto: MapContentDto): GameContent {
  return {
    meta: dto.meta,
    cities: dto.cities.map(({ tier, ...c }) => ({
      ...c,
      id: asCityId(c.id),
      ...(tier !== undefined ? { tier: tier as CityTier } : {}),
    })),
    routes: dto.routes.map((r) => ({
      id: asRouteId(r.id),
      a: asCityId(r.a),
      b: asCityId(r.b),
      color: r.color as GameContent['routes'][number]['color'],
      length: r.length as RouteLength,
      ferryLocos: r.ferryLocos,
      isTunnel: r.isTunnel,
      ...(r.doubleGroup !== undefined ? { doubleGroup: r.doubleGroup } : {}),
      ...(r.bow !== undefined ? { bow: r.bow } : {}),
      ...(r.brokenCarriages !== undefined ? { brokenCarriages: r.brokenCarriages } : {}),
    })),
    tickets: dto.tickets.map((t) => ({
      ...t,
      id: asTicketId(t.id),
      a: asCityId(t.a),
      b: asCityId(t.b),
    })),
    ...(dto.auspiciousPairs !== undefined
      ? {
          auspiciousPairs: dto.auspiciousPairs.map((pair) => ({
            id: pair.id,
            a: asCityId(pair.a),
            b: asCityId(pair.b),
          })),
        }
      : {}),
    ...(dto.geography !== undefined ? { geography: dto.geography } : {}),
    ...(dto.rules !== undefined ? { rules: dto.rules } : {}),
  };
}

/**
 * Resolve a contentHash to its GameContent: the bundled official maps resolve synchronously
 * with no network call; anything else is fetched once from `/maps/content/:hash` (immutable, so
 * a resolved hash is cached forever) and de-duped across concurrent callers.
 */
export function resolveContent(hash: string): GameContent | Promise<GameContent> {
  const known = bundled.get(hash) ?? cache.get(hash);
  if (known) return known;
  const pending = inflight.get(hash);
  if (pending) return pending;
  const p = api.mapContent(hash).then((dto) => {
    const content = contentFromDto(dto);
    cache.set(hash, content);
    inflight.delete(hash);
    return content;
  });
  inflight.set(hash, p);
  return p;
}
