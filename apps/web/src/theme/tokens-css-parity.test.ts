// styles/tokens.css must stay in lockstep with the shared chrome palette in
// @trm/client-core/theme/tokens — mobile styles directly from the TS module, so a CSS-only edit
// here would silently fork the two apps' look. (Same contract shape as tokens-parity.test.ts,
// which gates the cartography palette against @trm/map-data.)
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DARK_TOKENS, LIGHT_TOKENS } from '@trm/client-core/theme/tokens';

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'styles', 'tokens.css'),
  'utf8',
);

/** The `--tr-<name>` values inside one selector block of tokens.css. */
function block(selector: string): Map<string, string> {
  const start = css.indexOf(selector);
  expect(start, `selector ${selector} present`).toBeGreaterThanOrEqual(0);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  const vars = new Map<string, string>();
  for (const m of body.matchAll(/--tr-([\w-]+):\s*([^;]+);/g)) {
    vars.set(m[1]!, m[2]!.trim().replace(/\s*\/\*.*$/, ''));
  }
  return vars;
}

const CSS_NAME: Record<string, string> = {
  blue: 'blue',
  ember: 'ember',
  accent: 'accent',
  paper: 'paper',
  surface: 'surface',
  surface2: 'surface-2',
  ink: 'ink',
  inkSoft: 'ink-soft',
  line: 'line',
  danger: 'danger',
  ok: 'ok',
  brandNavy: 'brand-navy',
  sea: 'sea',
  seaLine: 'sea-line',
  land: 'land',
  coast: 'coast',
  relief: 'relief',
};

describe('tokens.css ↔ @trm/client-core chrome tokens', () => {
  it('light theme (:root) matches LIGHT_TOKENS', () => {
    const vars = block(':root {');
    for (const [key, cssName] of Object.entries(CSS_NAME)) {
      expect(vars.get(cssName), `--tr-${cssName}`).toBe(
        LIGHT_TOKENS[key as keyof typeof LIGHT_TOKENS],
      );
    }
  });

  it("dark theme (:root[data-theme='dark']) matches DARK_TOKENS where it overrides", () => {
    const vars = block(":root[data-theme='dark']");
    for (const [cssName, value] of vars) {
      const key = Object.entries(CSS_NAME).find(([, v]) => v === cssName)?.[0];
      if (!key) continue; // radius/space/shadow/font vars are layout, not palette
      expect(value, `--tr-${cssName} (dark)`).toBe(DARK_TOKENS[key as keyof typeof DARK_TOKENS]);
    }
  });
});
