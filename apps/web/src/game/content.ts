import { TAIWAN_CONTENT } from '@trm/map-data';
import type { CityDef, RouteDef, TicketDef } from '@trm/map-data';
import type { Locale } from '../store/ui';

// Static board content (the only map for now). City/ticket names are localized
// straight from the catalog — zh-Hant primary, en secondary.
export const CITIES: readonly CityDef[] = TAIWAN_CONTENT.cities;
export const ROUTES: readonly RouteDef[] = TAIWAN_CONTENT.routes;
export const TICKETS: readonly TicketDef[] = TAIWAN_CONTENT.tickets;

export const cityById = new Map(CITIES.map((c) => [c.id as string, c]));
export const routeById = new Map(ROUTES.map((r) => [r.id as string, r]));
export const ticketById = new Map(TICKETS.map((t) => [t.id as string, t]));

export const cityName = (id: string, locale: Locale): string => {
  const c = cityById.get(id);
  return c ? (locale === 'en' ? c.nameEn : c.nameZh) : id;
};

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
