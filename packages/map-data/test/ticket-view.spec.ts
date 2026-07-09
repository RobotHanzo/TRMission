import { describe, it, expect } from 'vitest';
import { ticketViewSpec, ticketViewRect, ticketRect } from '../src/ticket-view';
import { ticketViewIssues } from '../src/validate';
import { formatIssue } from '../src/index';
import type { TicketView } from '../src/types';

const base = { x: 0, y: 0, w: 100, h: 100 };
const a = { x: 40, y: 40 };
const b = { x: 50, y: 50 };

describe('ticketViewSpec (precedence)', () => {
  it('uses the ticket view when present', () => {
    expect(
      ticketViewSpec(
        { view: { mode: 'zoom', level: 0.3 } },
        { defaultTicketView: { mode: 'auto' } },
      ),
    ).toEqual({
      mode: 'zoom',
      level: 0.3,
    });
  });
  it('falls back to the map default when the ticket has none', () => {
    expect(ticketViewSpec({}, { defaultTicketView: { mode: 'auto' } })).toEqual({ mode: 'auto' });
  });
  it('falls back to full when neither is set', () => {
    expect(ticketViewSpec({}, {})).toEqual({ mode: 'full' });
    expect(ticketViewSpec({}, undefined)).toEqual({ mode: 'full' });
  });
});

describe('ticketViewRect', () => {
  it('full → the whole base view', () => {
    expect(ticketViewRect({ mode: 'full' }, a, b, base)).toEqual(base);
  });
  it('auto → padded bbox of the two cities, centered', () => {
    // span 10, pad max(8, 0.6*10)=8 → 26×26, centered on (45,45)
    expect(ticketViewRect({ mode: 'auto' }, a, b, base)).toEqual({ x: 32, y: 32, w: 26, h: 26 });
  });
  it('auto → clamps to base when the padded bbox is larger than the map', () => {
    expect(ticketViewRect({ mode: 'auto' }, { x: 5, y: 5 }, { x: 95, y: 95 }, base)).toEqual(base);
  });
  it('zoom level 0 → the whole base view', () => {
    expect(ticketViewRect({ mode: 'zoom', level: 0 }, a, b, base)).toEqual(base);
  });
  it('zoom level 1 → tight box centered on the midpoint', () => {
    // w = 100 * 0.18 = 18, centered on (45,45)
    expect(ticketViewRect({ mode: 'zoom', level: 1 }, a, b, base)).toEqual({
      x: 36,
      y: 36,
      w: 18,
      h: 18,
    });
  });
  it('zoom clamps an out-of-range level into [0,1]', () => {
    expect(ticketViewRect({ mode: 'zoom', level: 5 }, a, b, base)).toEqual(
      ticketViewRect({ mode: 'zoom', level: 1 }, a, b, base),
    );
  });
});

describe('ticketRect (spec + rect)', () => {
  it('resolves precedence then computes the rect', () => {
    expect(ticketRect({}, a, b, base, { defaultTicketView: { mode: 'full' } })).toEqual(base);
    expect(ticketRect({ view: { mode: 'zoom', level: 0 } }, a, b, base, undefined)).toEqual(base);
  });
});

describe('ticketViewIssues', () => {
  it('accepts a valid spec', () => {
    expect(ticketViewIssues({ mode: 'auto' }, 'T1')).toEqual([]);
    expect(ticketViewIssues({ mode: 'zoom', level: 0.5 }, 'T1')).toEqual([]);
  });
  it('rejects an out-of-range zoom level', () => {
    expect(ticketViewIssues({ mode: 'zoom', level: 2 }, 'T1')).toEqual([
      { code: 'ticketViewLevelOutOfRange', params: { where: 'T1', level: 2 } },
    ]);
  });
  it('rejects an unknown mode', () => {
    // deliberately malformed (untrusted authored data)
    const bad = { mode: 'wat' } as unknown as TicketView;
    expect(ticketViewIssues(bad, 'T1')[0]?.code).toBe('ticketViewInvalidMode');
  });
  it('formats the new codes in English', () => {
    expect(
      formatIssue({ code: 'ticketViewLevelOutOfRange', params: { where: 'T1', level: 2 } }),
    ).toContain('[0, 1]');
    expect(
      formatIssue({ code: 'ticketViewInvalidMode', params: { where: 'T1', mode: 'wat' } }),
    ).toContain('wat');
  });
});
