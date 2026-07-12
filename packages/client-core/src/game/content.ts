import { TAIWAN_CONTENT } from '@trm/map-data';
import type { CityDef, CityTier, GameContent, RouteDef, TicketDef } from '@trm/map-data';
import type { Locale } from '../net/restTypes';

// The active board content. Starts as Taiwan (the bundled default) and is reassigned by
// `game/catalog.ts`'s setActiveContent() when a live game or replay is playing a different map.
// These are `let` exports rather than `const`: ES module bindings are live, so every existing
// consumer that does `import { CITIES, ... } from './content'` automatically sees the swap with
// no changes of its own — only game/catalog.ts (the single place allowed to call the setter) and
// this file need to know the catalog is swappable at all.
export let CITIES: readonly CityDef[] = TAIWAN_CONTENT.cities;
export let ROUTES: readonly RouteDef[] = TAIWAN_CONTENT.routes;
export let TICKETS: readonly TicketDef[] = TAIWAN_CONTENT.tickets;

export let cityById = new Map(CITIES.map((c) => [c.id as string, c]));
export let routeById = new Map(ROUTES.map((r) => [r.id as string, r]));
export let ticketById = new Map(TICKETS.map((t) => [t.id as string, t]));

/** Called only by game/catalog.ts's setActiveContent — swaps the active board content's tables. */
export function applyContentTables(content: GameContent): void {
  CITIES = content.cities;
  ROUTES = content.routes;
  TICKETS = content.tickets;
  cityById = new Map(CITIES.map((c) => [c.id as string, c]));
  routeById = new Map(ROUTES.map((r) => [r.id as string, r]));
  ticketById = new Map(TICKETS.map((t) => [t.id as string, t]));
}

export const cityName = (id: string, locale: Locale): string => {
  const c = cityById.get(id);
  return c ? (locale === 'en' ? c.nameEn : c.nameZh) : id;
};

/** Cartographic label tier for the live board's progressive zoom reveal (see game/lod.ts's
 *  zoomBucket + the [data-zoom] CSS rules). Reads the active content's authored tier, falling
 *  back to 'minor' for content authored before this field existed, or an id outside the active
 *  map — the same graceful-fallback shape cityName already uses. */
export const cityTier = (id: string): CityTier => cityById.get(id)?.tier ?? 'minor';

export interface TicketLabel {
  a: string;
  b: string;
  value: number;
  long: boolean;
}

export const ticketLabel = (id: string, locale: Locale): TicketLabel | null => {
  const t = ticketById.get(id);
  if (!t) return null;
  return {
    a: cityName(t.a as string, locale),
    b: cityName(t.b as string, locale),
    value: t.value,
    long: t.deck === 'LONG',
  };
};
