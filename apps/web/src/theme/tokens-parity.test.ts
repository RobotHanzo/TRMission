// The cartography palette exists twice by necessity: TS (@trm/map-data render tokens — the
// OG card reads it) and CSS (tokens.css --tr-* custom properties — theming must stay in CSS).
// This test is the drift gate between the two.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { MAP_PALETTE_LIGHT, MAP_PALETTE_DARK, type MapPalette } from '@trm/map-data';

// Read the stylesheet off disk: vitest's CSS pipeline swallows `?raw` imports (they resolve
// to an empty string), and this test wants the literal authored text anyway. vitest runs
// with the workspace (apps/web) as cwd, both directly and under turbo.
const tokensCss = readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8');

const CART_VARS: Record<keyof MapPalette, string> = {
  sea: '--tr-sea',
  seaLine: '--tr-sea-line',
  land: '--tr-land',
  coast: '--tr-coast',
  relief: '--tr-relief',
  surface: '--tr-surface',
  ink: '--tr-ink',
  blue: '--tr-blue',
};

/** The --tr-* declarations inside the first block opened by `selector`. */
function varsIn(selector: string): Record<string, string> {
  const start = tokensCss.indexOf(selector);
  expect(start, `selector not found in tokens.css: ${selector}`).toBeGreaterThanOrEqual(0);
  const open = tokensCss.indexOf('{', start);
  const close = tokensCss.indexOf('}', open);
  const body = tokensCss.slice(open + 1, close);
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--tr-[a-z0-9-]+):\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

describe('tokens.css ⇄ @trm/map-data palette parity', () => {
  it('light theme matches MAP_PALETTE_LIGHT', () => {
    const css = varsIn(':root {');
    for (const [key, cssVar] of Object.entries(CART_VARS)) {
      expect(css[cssVar], cssVar).toBe(MAP_PALETTE_LIGHT[key as keyof MapPalette]);
    }
  });

  it('dark theme matches MAP_PALETTE_DARK (blue inherits from light)', () => {
    const css = varsIn(":root[data-theme='dark']");
    for (const [key, cssVar] of Object.entries(CART_VARS)) {
      if (key === 'blue') {
        // Dark never overrides --tr-blue; the TS palette mirrors that by carrying light's value.
        expect(css[cssVar]).toBeUndefined();
        expect(MAP_PALETTE_DARK.blue).toBe(MAP_PALETTE_LIGHT.blue);
      } else {
        expect(css[cssVar], cssVar).toBe(MAP_PALETTE_DARK[key as keyof MapPalette]);
      }
    }
  });

  it('the OS-preference fallback block repeats the dark cartography values', () => {
    const css = varsIn(":root:not([data-theme='light']):not([data-theme='dark'])");
    for (const [key, cssVar] of Object.entries(CART_VARS)) {
      if (key === 'blue') continue;
      expect(css[cssVar], cssVar).toBe(MAP_PALETTE_DARK[key as keyof MapPalette]);
    }
  });
});
