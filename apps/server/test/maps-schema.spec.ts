import { describe, it, expect } from 'vitest';
import { TicketViewSchema, MapDraftSchema } from '../src/maps/maps.schemas';

describe('TicketViewSchema', () => {
  it('accepts full/auto/zoom', () => {
    expect(TicketViewSchema.safeParse({ mode: 'full' }).success).toBe(true);
    expect(TicketViewSchema.safeParse({ mode: 'auto' }).success).toBe(true);
    expect(TicketViewSchema.safeParse({ mode: 'zoom', level: 0.5 }).success).toBe(true);
  });
  it('rejects an out-of-range zoom level and unknown modes', () => {
    expect(TicketViewSchema.safeParse({ mode: 'zoom', level: 2 }).success).toBe(false);
    expect(TicketViewSchema.safeParse({ mode: 'zoom' }).success).toBe(false); // level required
    expect(TicketViewSchema.safeParse({ mode: 'wat' }).success).toBe(false);
  });
});

describe('MapDraftSchema keeps display-area fields', () => {
  it('keeps a ticket view instead of stripping it', () => {
    const parsed = MapDraftSchema.parse({
      cities: [],
      routes: [],
      tickets: [{ id: 't1', a: 'a', b: 'b', value: 2, deck: 'SHORT', view: { mode: 'auto' } }],
    });
    expect(parsed.tickets[0]?.view).toEqual({ mode: 'auto' });
  });
  it('keeps a geography defaultTicketView', () => {
    const parsed = MapDraftSchema.parse({
      cities: [],
      routes: [],
      tickets: [],
      geography: {
        baseView: { x: 0, y: 0, w: 1, h: 1 },
        land: [],
        crop: { lonMin: 0, lonMax: 1, latMin: 0, latMax: 1 },
        defaultTicketView: { mode: 'zoom', level: 0.3 },
      },
    });
    expect(parsed.geography?.defaultTicketView).toEqual({ mode: 'zoom', level: 0.3 });
  });
  it('keeps a geography borders overlay', () => {
    const parsed = MapDraftSchema.parse({
      cities: [],
      routes: [],
      tickets: [],
      geography: {
        baseView: { x: 0, y: 0, w: 1, h: 1 },
        land: [],
        crop: { lonMin: 0, lonMax: 1, latMin: 0, latMax: 1 },
        borders: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
          ],
        ],
      },
    });
    expect(parsed.geography?.borders).toEqual([
      [
        [0, 0],
        [1, 0],
        [1, 1],
      ],
    ]);
  });
  it('keeps authored auspicious pairs instead of stripping them', () => {
    const parsed = MapDraftSchema.parse({
      cities: [],
      routes: [],
      tickets: [],
      auspiciousPairs: [{ id: 'lucky-1', a: 'TAIPEI', b: 'KAOHSIUNG' }],
    });
    expect(parsed.auspiciousPairs).toEqual([{ id: 'lucky-1', a: 'TAIPEI', b: 'KAOHSIUNG' }]);
  });
});

describe('MapDraftSchema bounds a saved geography baseView', () => {
  const withView = (baseView: { x: number; y: number; w: number; h: number }) => ({
    cities: [],
    routes: [],
    tickets: [],
    geography: { baseView, land: [], crop: { lonMin: 0, lonMax: 1, latMin: 0, latMax: 1 } },
  });

  it('still accepts anything a real draft produces, with room to spare', () => {
    // The builder's projection emits a ~108-unit square view and official forks are the same
    // order (Taiwan is 84x98 at -4,-2); the bound sits orders of magnitude above both.
    expect(MapDraftSchema.safeParse(withView({ x: -4, y: -2, w: 84, h: 98 })).success).toBe(true);
    expect(
      MapDraftSchema.safeParse(withView({ x: -5000, y: 5000, w: 10_000, h: 10_000 })).success,
    ).toBe(true);
  });

  it('refuses an absurd view at write time (the OG card grids across baseView)', () => {
    expect(MapDraftSchema.safeParse(withView({ x: 0, y: 0, w: 4e9, h: 100 })).success).toBe(false);
    expect(MapDraftSchema.safeParse(withView({ x: 0, y: 0, w: 100, h: 1e15 })).success).toBe(false);
    expect(MapDraftSchema.safeParse(withView({ x: 1e18, y: 0, w: 100, h: 100 })).success).toBe(
      false,
    );
  });
});
