import { describe, it, expect } from 'vitest';
import {
  MAP_PALETTE_LIGHT,
  MAP_PALETTE_DARK,
  MAP_INKS,
  MAP_DIMS,
  ROUTE_COLOR_HEX,
  LIVERY_COLORS,
  mapCssVars,
  CONTENT_HASH,
  TAIWAN_CONTENT,
  hashContent,
} from '../src/index';

describe('render tokens', () => {
  it('exposes the six liveries in spectrum order, derived from the route colours', () => {
    expect(LIVERY_COLORS).toEqual([
      ROUTE_COLOR_HEX.RED,
      ROUTE_COLOR_HEX.ORANGE,
      ROUTE_COLOR_HEX.YELLOW,
      ROUTE_COLOR_HEX.GREEN,
      ROUTE_COLOR_HEX.BLUE,
      ROUTE_COLOR_HEX.PURPLE,
    ]);
  });

  it('names the sixth colour PURPLE (never PINK)', () => {
    expect(Object.keys(ROUTE_COLOR_HEX)).toContain('PURPLE');
    expect(Object.keys(ROUTE_COLOR_HEX)).not.toContain('PINK');
  });

  it('dark palette overrides every cartography colour except the EMU blue', () => {
    expect(MAP_PALETTE_DARK.sea).not.toBe(MAP_PALETTE_LIGHT.sea);
    expect(MAP_PALETTE_DARK.blue).toBe(MAP_PALETTE_LIGHT.blue);
  });

  it('mapCssVars covers every dimension with a --m- prefixed string value', () => {
    const vars = mapCssVars();
    for (const [k, v] of Object.entries(vars)) {
      expect(k.startsWith('--m-')).toBe(true);
      expect(typeof v).toBe('string');
      expect(v.length).toBeGreaterThan(0);
    }
    // Spot-check the values the board CSS is about to depend on.
    expect(vars['--m-bed-w']).toBe('2.8');
    expect(vars['--m-slot-h']).toBe('1.44');
    expect(vars['--m-tie-w']).toBe('8');
    expect(vars['--m-city-r']).toBe('1.15');
    expect(vars['--m-hub-w']).toBe('2.5');
    expect(vars['--m-car-edge']).toBe(MAP_INKS.carEdge);
    expect(vars['--m-ferry-dash']).toBe(MAP_DIMS.ferryDash);
  });

  it('render tokens never fold into the content hash', () => {
    expect(hashContent(TAIWAN_CONTENT)).toBe(CONTENT_HASH);
  });
});
