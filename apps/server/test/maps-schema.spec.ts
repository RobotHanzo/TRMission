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
});
