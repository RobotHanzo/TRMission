import { describe, it, expect } from 'vitest';
import { asCityId, asRouteId } from '@trm/shared';
import { generateTickets, shortestDistances } from '../src/index';
import type { RouteDef, TicketDef } from '../src/index';
import { ringCities, ringRoutes } from './fixtures';

const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

describe('shortestDistances', () => {
  it('uses the minimum length among parallel routes and relaxes through hops', () => {
    const cities = [
      { id: asCityId('a'), nameZh: '甲', nameEn: 'A', x: 0, y: 0, region: 't', isIsland: false },
      { id: asCityId('b'), nameZh: '乙', nameEn: 'B', x: 10, y: 0, region: 't', isIsland: false },
      { id: asCityId('c'), nameZh: '丙', nameEn: 'C', x: 20, y: 0, region: 't', isIsland: false },
    ];
    const route = (id: string, a: string, b: string, length: 1 | 2 | 3 | 4): RouteDef => ({
      id: asRouteId(id),
      a: asCityId(a),
      b: asCityId(b),
      color: 'GRAY',
      length,
      ferryLocos: 0,
      isTunnel: false,
    });
    const routes = [
      route('R1', 'a', 'b', 3),
      route('R2', 'a', 'b', 1), // parallel, shorter — must win
      route('R3', 'b', 'c', 2),
      route('R4', 'a', 'c', 4), // direct, but a→b→c = 3 is shorter
    ];
    const dist = shortestDistances(cities, routes);
    expect(dist.get('a')?.get('b')).toBe(1);
    expect(dist.get('a')?.get('c')).toBe(3);
    expect(dist.get('b')?.get('c')).toBe(2);
    expect(dist.get('a')?.get('a')).toBe(0);
  });
});

describe('generateTickets', () => {
  const cities = ringCities(12);
  const routes = ringRoutes(12);

  it('is deterministic: same seed produces identical tickets', () => {
    const a = generateTickets(cities, routes, { seed: 42 });
    const b = generateTickets(cities, routes, { seed: 42 });
    expect(a).toEqual(b);
  });

  it('varies the SHORT deck with the seed', () => {
    const a = generateTickets(cities, routes, { seed: 1, shortCount: 8, longCount: 3 });
    const b = generateTickets(cities, routes, { seed: 2, shortCount: 8, longCount: 3 });
    expect(a).not.toEqual(b);
  });

  it('produces the requested deck sizes', () => {
    const tickets = generateTickets(cities, routes, { seed: 7, longCount: 4, shortCount: 10 });
    expect(tickets.filter((t) => t.deck === 'LONG')).toHaveLength(4);
    expect(tickets.filter((t) => t.deck === 'SHORT')).toHaveLength(10);
  });

  it('never duplicates a city pair across the generated set', () => {
    const tickets = generateTickets(cities, routes, { seed: 3, longCount: 5, shortCount: 20 });
    const keys = tickets.map((t) => pairKey(t.a as string, t.b as string));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('values equal max(2, distance + island bonus)', () => {
    const tickets = generateTickets(cities, routes, { seed: 11, longCount: 4, shortCount: 12 });
    const dist = shortestDistances(cities, routes);
    const island = new Set(cities.filter((c) => c.isIsland).map((c) => c.id as string));
    for (const t of tickets) {
      const d = dist.get(t.a as string)?.get(t.b as string);
      expect(d).toBeDefined();
      const bonus = island.has(t.a as string) || island.has(t.b as string) ? 1 : 0;
      expect(t.value).toBe(Math.max(2, (d as number) + bonus));
    }
  });

  it('spreads LONG endpoints before reusing a city', () => {
    const tickets = generateTickets(cities, routes, { seed: 5, longCount: 4, shortCount: 4 });
    const uses = new Map<string, number>();
    for (const t of tickets.filter((x) => x.deck === 'LONG')) {
      uses.set(t.a as string, (uses.get(t.a as string) ?? 0) + 1);
      uses.set(t.b as string, (uses.get(t.b as string) ?? 0) + 1);
    }
    // 4 LONGs over 12 cities: the relaxing usage cap must keep every endpoint at ≤ 2 uses.
    for (const [, n] of uses) expect(n).toBeLessThanOrEqual(2);
  });

  it('assigns unique ids and the correct decks', () => {
    const tickets = generateTickets(cities, routes, { seed: 9, longCount: 3, shortCount: 6 });
    const ids = new Set(tickets.map((t) => t.id as string));
    expect(ids.size).toBe(tickets.length);
    for (const t of tickets) expect(t.id as string).toMatch(/^TG/);
  });

  it('throws on a disconnected graph', () => {
    const disconnected = ringRoutes(12).filter(
      (r) => (r.a as string) !== 'k11' && (r.b as string) !== 'k11',
    );
    expect(() => generateTickets(cities, disconnected, { seed: 1 })).toThrow(/connect/i);
  });

  it('caps output at the available pair count instead of looping forever', () => {
    // 12 cities ⇒ 66 pairs; ask for more than exists.
    const tickets: TicketDef[] = generateTickets(cities, routes, {
      seed: 4,
      longCount: 10,
      shortCount: 100,
    });
    expect(tickets.length).toBeLessThanOrEqual(66);
    const keys = tickets.map((t) => pairKey(t.a as string, t.b as string));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('shortMaxValue excludes SHORT tickets whose score is above the cap', () => {
    const uncapped = generateTickets(cities, routes, { seed: 6, longCount: 3, shortCount: 12 });
    const uncappedShortValues = uncapped.filter((t) => t.deck === 'SHORT').map((t) => t.value);
    const maxShortValue = Math.max(...uncappedShortValues);
    const cap = maxShortValue - 1;
    expect(cap).toBeGreaterThanOrEqual(2);

    const capped = generateTickets(cities, routes, {
      seed: 6,
      longCount: 3,
      shortCount: 12,
      shortMaxValue: cap,
    });
    for (const t of capped.filter((x) => x.deck === 'SHORT')) {
      expect(t.value).toBeLessThanOrEqual(cap);
    }
  });

  it('does not throw when shortMaxValue is tighter than the reachable SHORT band', () => {
    // shortMinDistance defaults to 4, so every SHORT candidate's value is ≥ 4 — a cap of 2
    // excludes every candidate, leaving an empty (not thrown) SHORT deck.
    const tickets = generateTickets(cities, routes, {
      seed: 8,
      longCount: 3,
      shortCount: 50,
      shortMaxValue: 2,
    });
    expect(tickets.filter((t) => t.deck === 'SHORT')).toHaveLength(0);
    expect(tickets.filter((t) => t.deck === 'LONG')).toHaveLength(3);
  });
});
