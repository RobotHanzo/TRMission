import { TRAIN_COLORS, asCityId, asRouteId, asTicketId } from '@trm/shared';
import type { RouteLength } from '@trm/shared';
import type { CityDef, GameContent, RouteDef, TicketDef } from '../src/index';

const LENGTH_CYCLE: readonly RouteLength[] = [1, 2, 3, 4];

/** N cities on a circle; k0 is an island so island-bonus paths are exercised. */
export function ringCities(n: number): CityDef[] {
  return Array.from({ length: n }, (_, i) => ({
    id: asCityId(`k${i}`),
    nameZh: `站${i}`,
    nameEn: `Stop ${i}`,
    x: Math.round(50 + 40 * Math.cos((2 * Math.PI * i) / n)),
    y: Math.round(50 + 40 * Math.sin((2 * Math.PI * i) / n)),
    region: 'test',
    isIsland: i === 0,
  }));
}

/** Ring edges with cycling lengths/colours plus one long GRAY chord (k0 ↔ k(n/2)). */
export function ringRoutes(n: number): RouteDef[] {
  const routes: RouteDef[] = [];
  for (let i = 0; i < n; i++) {
    routes.push({
      id: asRouteId(`TR${i}`),
      a: asCityId(`k${i}`),
      b: asCityId(`k${(i + 1) % n}`),
      color: TRAIN_COLORS[i % TRAIN_COLORS.length]!,
      length: LENGTH_CYCLE[i % LENGTH_CYCLE.length]!,
      ferryLocos: 0,
      isTunnel: false,
    });
  }
  routes.push({
    id: asRouteId('TRX0'),
    a: asCityId('k0'),
    b: asCityId(`k${Math.floor(n / 2)}`),
    color: 'GRAY',
    length: 6,
    ferryLocos: 0,
    isTunnel: false,
  });
  return routes;
}

/** Simple authored tickets: longs span the ring, shorts hop two stops. */
export function ticketsFor(nLong: number, nShort: number, n: number): TicketDef[] {
  const tickets: TicketDef[] = [];
  for (let i = 0; i < nLong; i++) {
    tickets.push({
      id: asTicketId(`TL${i}`),
      a: asCityId(`k${i % n}`),
      b: asCityId(`k${(i + Math.floor(n / 2)) % n}`),
      value: 10,
      deck: 'LONG',
    });
  }
  for (let i = 0; i < nShort; i++) {
    tickets.push({
      id: asTicketId(`TS${i}`),
      a: asCityId(`k${i % n}`),
      b: asCityId(`k${(i + 2) % n}`),
      value: 5,
      deck: 'SHORT',
    });
  }
  return tickets;
}

export function testContent(overrides: Partial<GameContent> = {}): GameContent {
  const n = 12;
  return {
    meta: { mapId: 'test', version: 1, nameZh: '測試地圖', nameEn: 'Test Map' },
    cities: ringCities(n),
    routes: ringRoutes(n),
    tickets: ticketsFor(6, 20, n),
    ...overrides,
  };
}
