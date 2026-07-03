# Unified Map Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the in-game map the single source of truth for all map rendering — a shared token module for every visual constant, a presentational `<MapScene>` component for all web surfaces, and the OG card importing tokens instead of copied literals.

**Architecture:** New `packages/map-data/src/render-tokens.ts` holds all map colours + dimensions (consumed by web CSS via injected CSS custom properties and by the server's string-SVG OG card directly). New `apps/web/src/components/MapScene.tsx` (extracted from `Board.tsx`) draws the whole scene; `Board`/`MapBackdrop`/`EditorCanvas` become thin consumers.

**Tech Stack:** TypeScript, React 19, Vite 5 (pinned), vitest, @trm/map-data (TS-source workspace package), NestJS + resvg on the server.

**Spec:** `docs/superpowers/specs/2026-07-03-unified-map-rendering-design.md`

## Global Constraints

- **No visual or behavioural change to any surface.** Known-harmless DOM additions are listed per task; anything else is a defect.
- The 6th card colour is **PURPLE** everywhere — never PINK.
- `apps/web` stays on **Vite ^5**; do not touch the pin.
- `@trm/map-data`'s `CONTENT_HASH` must not change — `render-tokens.ts` is pure data and is never folded into `hashContent`. `packages/map-data/test/versions.spec.ts` is the tripwire; it must keep passing.
- The server stays on swc (never tsx/esbuild); no React is added to `apps/server`.
- Multiple agents may share this worktree: **never `git add -A` / `git add .`** — stage only the exact paths listed in each commit step.
- Every commit message ends with:
  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01AjsDgRLS3gowENDE6WDRZm
  ```
- All commands run from the repo root `D:\Web Projects\TRMission`.

---

### Task 1: Shared render tokens in `@trm/map-data`

**Files:**
- Create: `packages/map-data/src/render-tokens.ts`
- Modify: `packages/map-data/src/index.ts` (add one export line)
- Test: `packages/map-data/test/render-tokens.spec.ts`

**Interfaces:**
- Consumes: nothing (pure data module).
- Produces (later tasks import these from `@trm/map-data`):
  - `MAP_PALETTE_LIGHT`, `MAP_PALETTE_DARK`: `MapPalette` — `{ sea, seaLine, land, coast, relief, surface, ink, blue: string }`
  - `MAP_INKS`: theme-independent inks `{ carEdge, tie, tieOpacity, tunnelBg, tunnelBgOpacity, ferryLine, ferryLocoEdge }`
  - `ROUTE_COLOR_HEX`: `Record<'RED'|'ORANGE'|'YELLOW'|'GREEN'|'BLUE'|'PURPLE'|'BLACK'|'WHITE'|'LOCOMOTIVE'|'GRAY', string>`
  - `LIVERY_COLORS: readonly string[]` (6 entries, spectrum order)
  - `MAP_DIMS` (board-unit numbers + dash strings; keys listed in the code below)
  - `mapCssVars(): Record<string, string>` — the `--m-*` CSS custom-property map

- [ ] **Step 1: Write the failing test**

Create `packages/map-data/test/render-tokens.spec.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/map-data test --run render-tokens`
Expected: FAIL — cannot resolve `MAP_PALETTE_LIGHT` (module does not exist).

- [ ] **Step 3: Write the module**

Create `packages/map-data/src/render-tokens.ts`:

```ts
// Shared cartography render tokens — the visual constants behind the board's rendering,
// extracted so the web board CSS (apps/web/src/styles/game.css, via mapCssVars()) and the
// server's OG map card (apps/server/src/og/map-svg.ts) draw from ONE definition and can
// never drift. Pure data: nothing here touches the authored content tables, so CONTENT_HASH
// is unaffected. Dimensions are in board units at base zoom (--inv-scale / --marker-scale = 1).

/** The themed cartography palette (mirrored 1:1 by tokens.css's --tr-* custom properties —
 *  a parity test in apps/web enforces the mirror, since CSS theming can't import TS). */
export interface MapPalette {
  readonly sea: string;
  readonly seaLine: string;
  readonly land: string;
  readonly coast: string;
  readonly relief: string;
  readonly surface: string;
  readonly ink: string;
  readonly blue: string;
}

export const MAP_PALETTE_LIGHT: MapPalette = {
  sea: '#d6e4ec',
  seaLine: 'rgba(31, 90, 130, 0.2)',
  land: '#efe6cf',
  coast: '#b9a47b',
  relief: '#d9c9a1',
  surface: '#fffdf8',
  ink: '#1f2328',
  blue: '#0f5fa6',
};

export const MAP_PALETTE_DARK: MapPalette = {
  sea: '#15222b',
  seaLine: 'rgba(150, 190, 215, 0.17)',
  land: '#2a2e25',
  coast: '#515a44',
  relief: '#39402e',
  surface: '#232629',
  ink: '#ececec',
  // tokens.css does not override --tr-blue in dark mode; the EMU blue carries through.
  blue: '#0f5fa6',
};

/** Theme-independent inks (identical in light and dark board CSS). */
export const MAP_INKS = {
  /** Car slot / ferry pip outline. */
  carEdge: '#2a2520',
  /** Tunnel sleeper tie fill. */
  tie: '#3d352b',
  tieOpacity: 0.9,
  /** The wide faint glint behind a tunnel's ties. */
  tunnelBg: '#b0b0b0',
  tunnelBgOpacity: 0.18,
  /** Dotted open-sea ferry crossing. */
  ferryLine: '#9aa0a6',
  /** White ring around a ferry's rainbow locomotive pips. */
  ferryLocoEdge: '#fff',
} as const;

/** The 8 train colours + GRAY + the wild locomotive — canonical hexes. The web's
 *  CARD_COLOR_TOKENS (glyphs, ink-on-colour, zh names) builds on these. */
export const ROUTE_COLOR_HEX = {
  RED: '#D72631',
  ORANGE: '#EE7B30',
  YELLOW: '#F2C14E',
  GREEN: '#3A9D5C',
  BLUE: '#0F5FA6',
  PURPLE: '#7B4DA6',
  BLACK: '#2B2D31',
  WHITE: '#E8EAED',
  LOCOMOTIVE: '#9AA0A6',
  GRAY: '#8A8E96',
} as const;

/** The six locomotive liveries in spectrum order — the wild "rainbow" (ferry pips, loco card wash). */
export const LIVERY_COLORS: readonly string[] = (
  ['RED', 'ORANGE', 'YELLOW', 'GREEN', 'BLUE', 'PURPLE'] as const
).map((k) => ROUTE_COLOR_HEX[k]);

/** Every shared map dimension, in board units at base zoom. */
export const MAP_DIMS = {
  // Roadbed under the cars.
  bedW: 2.8,
  bedOwnedW: 3.1,
  bedOpacity: 0.95,
  // Car slots (x/width along the path come from geometry; these are the across-track props).
  slotH: 1.44,
  slotRx: 0.42,
  slotStrokeW: 0.3,
  slotOwnedStrokeW: 0.42,
  // Tunnels: wide faint glint + diagonal sleeper ties.
  tunnelBgW: 6,
  tieW: 8,
  tieH: 0.28,
  // Ferries: dotted crossing + round pips + rainbow loco rects.
  ferryLineW: 0.5,
  ferryDash: '0.1 2.55',
  ferryPipR: 0.7,
  ferryPipStrokeW: 0.25,
  ferryLocoStrokeW: 0.5,
  // Interaction + colour-blind aid.
  hitW: 4.2,
  glyphR: 1.6,
  glyphStrokeW: 0.22,
  // City markers.
  cityR: 1.15,
  islandR: 1.4,
  cityStrokeW: 0.4,
  hubW: 2.5,
  hubH: 1.6,
  hubRx: 0.8,
  // Cartography.
  graticuleW: 0.32,
  graticuleDashA: 0.9,
  graticuleDashB: 1.7,
  landStrokeW: 0.45,
  landSurfW: 2.4,
  landSurfOpacity: 0.6,
  geoIslandStrokeW: 0.4,
  reliefOpacity: 0.55,
  reliefRidgeW: 0.3,
  reliefRidgeDash: '0.5 0.9',
} as const;

/**
 * The dimensions as CSS custom properties for the board stylesheet. game.css reads ONLY these
 * vars for its map dimensions (no literals), so the web board and the OG card cannot drift.
 * MapScene pins them on its <svg> root; the standalone tutorial specimens spread them too.
 */
export function mapCssVars(): Record<string, string> {
  const D = MAP_DIMS;
  return {
    '--m-grat-w': String(D.graticuleW),
    '--m-grat-dash-a': String(D.graticuleDashA),
    '--m-grat-dash-b': String(D.graticuleDashB),
    '--m-land-surf-w': String(D.landSurfW),
    '--m-land-surf-o': String(D.landSurfOpacity),
    '--m-land-stroke-w': String(D.landStrokeW),
    '--m-geo-island-w': String(D.geoIslandStrokeW),
    '--m-relief-o': String(D.reliefOpacity),
    '--m-relief-ridge-w': String(D.reliefRidgeW),
    '--m-relief-ridge-dash': D.reliefRidgeDash,
    '--m-bed-w': String(D.bedW),
    '--m-bed-o': String(D.bedOpacity),
    '--m-bed-owned-w': String(D.bedOwnedW),
    '--m-slot-h': String(D.slotH),
    '--m-slot-rx': String(D.slotRx),
    '--m-slot-stroke-w': String(D.slotStrokeW),
    '--m-slot-owned-stroke-w': String(D.slotOwnedStrokeW),
    '--m-car-edge': MAP_INKS.carEdge,
    '--m-tunnel-bg-w': String(D.tunnelBgW),
    '--m-tunnel-bg-ink': MAP_INKS.tunnelBg,
    '--m-tunnel-bg-o': String(MAP_INKS.tunnelBgOpacity),
    '--m-tie-w': String(D.tieW),
    '--m-tie-h': String(D.tieH),
    '--m-tie-ink': MAP_INKS.tie,
    '--m-tie-o': String(MAP_INKS.tieOpacity),
    '--m-ferry-line-w': String(D.ferryLineW),
    '--m-ferry-line-ink': MAP_INKS.ferryLine,
    '--m-ferry-dash': D.ferryDash,
    '--m-ferry-pip-r': String(D.ferryPipR),
    '--m-ferry-pip-stroke-w': String(D.ferryPipStrokeW),
    '--m-ferry-loco-stroke-w': String(D.ferryLocoStrokeW),
    '--m-ferry-loco-edge': MAP_INKS.ferryLocoEdge,
    '--m-hit-w': String(D.hitW),
    '--m-glyph-r': String(D.glyphR),
    '--m-glyph-stroke-w': String(D.glyphStrokeW),
    '--m-city-r': String(D.cityR),
    '--m-island-r': String(D.islandR),
    '--m-city-stroke-w': String(D.cityStrokeW),
    '--m-hub-w': String(D.hubW),
    '--m-hub-h': String(D.hubH),
    '--m-hub-rx': String(D.hubRx),
  };
}
```

In `packages/map-data/src/index.ts`, after the line `export * from './taiwan-geography';` add:

```ts
export * from './render-tokens';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn workspace @trm/map-data test --run render-tokens` → PASS (5 tests).
Run: `yarn workspace @trm/map-data test` → all map-data suites PASS (versions.spec.ts proves `CONTENT_HASH` is untouched).
Run: `yarn workspace @trm/map-data typecheck` and `yarn workspace @trm/map-data lint` → clean.

- [ ] **Step 5: Commit**

```bash
git add packages/map-data/src/render-tokens.ts packages/map-data/src/index.ts packages/map-data/test/render-tokens.spec.ts
git commit -m "feat(map-data): shared cartography render tokens"
```
(with the trailer from Global Constraints.)

---

### Task 2: Web theme sources hexes from shared tokens + tokens.css parity test

**Files:**
- Modify: `apps/web/src/theme/colors.ts`
- Test: `apps/web/src/theme/tokens-parity.test.ts` (create)

**Interfaces:**
- Consumes: `ROUTE_COLOR_HEX`, `LIVERY_COLORS`, `MAP_PALETTE_LIGHT`, `MAP_PALETTE_DARK` from `@trm/map-data` (Task 1).
- Produces: `theme/colors.ts` keeps its existing exports (`CARD_COLOR_TOKENS`, `GRAY_TOKEN`, `LIVERY_COLORS`, `LOCOMOTIVE_GRADIENT`, `SEAT_COLORS`) **plus a new `seatColor(seat: number): string`** helper (moved here from `Board.tsx`'s local one; Tasks 3–4 use it).

- [ ] **Step 1: Write the failing parity test**

Create `apps/web/src/theme/tokens-parity.test.ts`:

```ts
// The cartography palette exists twice by necessity: TS (@trm/map-data render tokens — the
// OG card reads it) and CSS (tokens.css --tr-* custom properties — theming must stay in CSS).
// This test is the drift gate between the two.
import { describe, it, expect } from 'vitest';
import { MAP_PALETTE_LIGHT, MAP_PALETTE_DARK, type MapPalette } from '@trm/map-data';
import tokensCss from '../styles/tokens.css?raw';

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
```

- [ ] **Step 2: Run test to verify it currently passes only for values, or fails on import**

Run: `yarn workspace @trm/web test --run tokens-parity`
Expected: PASS already (values are currently equal) — this test's job is to fail on FUTURE drift. If it fails now, a value has already drifted: stop and report which one instead of changing either side.

- [ ] **Step 3: Re-source `theme/colors.ts` hexes from the shared module**

Replace the whole of `apps/web/src/theme/colors.ts` with:

```ts
import type { CardColor } from '@trm/shared';
import { ROUTE_COLOR_HEX, LIVERY_COLORS as MAP_LIVERY_COLORS } from '@trm/map-data';

// Original TRMission palette (NOT copied from any board game): EMU-blue primary +
// express-ember accent, with the 8 train colours chosen for distinct hue AND a
// luminance spread so they survive greyscale. The hexes themselves are canonical in
// @trm/map-data's render tokens (shared with the server's OG card); this module layers
// the web-only concerns on top: ink-on-colour, zh names, and the colour-blind glyphs.
export interface ColorToken {
  /** Engine card colour. */
  readonly key: CardColor;
  readonly hex: string;
  /** Readable ink colour on top of `hex`. */
  readonly ink: string;
  readonly nameZh: string;
  /** Non-colour fallback glyph (colour-blind mode). */
  readonly glyph: string;
}

export const CARD_COLOR_TOKENS: Record<CardColor, ColorToken> = {
  RED: { key: 'RED', hex: ROUTE_COLOR_HEX.RED, ink: '#FFFFFF', nameZh: '紅', glyph: '▲' },
  ORANGE: { key: 'ORANGE', hex: ROUTE_COLOR_HEX.ORANGE, ink: '#241300', nameZh: '橙', glyph: '◆' },
  YELLOW: { key: 'YELLOW', hex: ROUTE_COLOR_HEX.YELLOW, ink: '#241B00', nameZh: '黃', glyph: '●' },
  GREEN: { key: 'GREEN', hex: ROUTE_COLOR_HEX.GREEN, ink: '#FFFFFF', nameZh: '綠', glyph: '■' },
  BLUE: { key: 'BLUE', hex: ROUTE_COLOR_HEX.BLUE, ink: '#FFFFFF', nameZh: '藍', glyph: '✚' },
  PURPLE: { key: 'PURPLE', hex: ROUTE_COLOR_HEX.PURPLE, ink: '#FFFFFF', nameZh: '紫', glyph: '✦' },
  BLACK: { key: 'BLACK', hex: ROUTE_COLOR_HEX.BLACK, ink: '#FFFFFF', nameZh: '黑', glyph: '⬢' },
  WHITE: { key: 'WHITE', hex: ROUTE_COLOR_HEX.WHITE, ink: '#1B1C1E', nameZh: '白', glyph: '○' },
  // The wild card reads as "any colour" — themed as the rainbow locomotive (彩虹車頭).
  LOCOMOTIVE: {
    key: 'LOCOMOTIVE',
    hex: ROUTE_COLOR_HEX.LOCOMOTIVE,
    ink: '#13161A',
    nameZh: '彩虹車頭',
    glyph: '★',
  },
};

/** Gray routes (any single colour). */
export const GRAY_TOKEN = {
  hex: ROUTE_COLOR_HEX.GRAY,
  ink: '#1B1C1E',
  nameZh: '灰',
  glyph: '—',
} as const;

/**
 * The six locomotive liveries, in spectrum order — the "rainbow" that stands for the wild
 * LOCOMOTIVE card. Canonical in @trm/map-data (the OG card's ferry pips use the same list).
 */
export const LIVERY_COLORS = MAP_LIVERY_COLORS;

/**
 * Rainbow wash for the wild LOCOMOTIVE card (the six liveries) — so a face-up loco in the
 * card market reads as "any colour" rather than a flat grey chip.
 */
export const LOCOMOTIVE_GRADIENT = `linear-gradient(135deg, ${LIVERY_COLORS.join(', ')})`;

/** Seat colours — deliberately distinct from the 8 card colours (ADR A11). */
export const SEAT_COLORS = ['#0E8C8C', '#C0398B', '#E8A33D', '#5A6B7B', '#7CB342'] as const;

/** A seat index's display colour (wraps past 5 seats defensively). */
export const seatColor = (seat: number): string => SEAT_COLORS[seat % 5] ?? '#888';
```

- [ ] **Step 4: Run the web suite**

Run: `yarn workspace @trm/web test` → PASS (hex values are identical, so card/market/board tests are unaffected).
Run: `yarn workspace @trm/web typecheck` → clean. (`GRAY_TOKEN.hex` widens from a literal type to `string`; if any consumer pinned the literal type, fix that consumer to accept `string`.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/theme/colors.ts apps/web/src/theme/tokens-parity.test.ts
git commit -m "refactor(web): source card colours from shared render tokens + tokens.css parity gate"
```

---

### Task 3: `MapScene` — the single map scene component

**Files:**
- Create: `apps/web/src/components/MapScene.tsx`
- Test: `apps/web/src/components/MapScene.test.tsx`

**Interfaces:**
- Consumes: `mapCssVars`, `RouteGeometry`, `MapGeography` from `@trm/map-data`; `Geography`, `CustomGeography` from `./Geography`; `RouteShape`, `FerryLocoGradientDef` from `./RouteShape`; `CARD_COLOR_TOKENS`, `GRAY_TOKEN`, `seatColor` from `../theme/colors` (Task 2); `View` type from `../game/geography`.
- Produces (Tasks 4–6 consume): `MapScene<C, R>` component, and the types `SceneCity`, `SceneRoute`, `RouteOwnership`, `MapSceneProps` — exact shapes in the code below. Prop semantics later tasks rely on:
  - `geography`: `undefined` → hand-authored Taiwan layer; `null` → no geography; `MapGeography` → custom rings.
  - Route hit path renders when `alwaysHitRoutes` OR (`canAct` && route unowned && `onRouteClick` given); `claimable` class only in the latter case.
  - `cityHitArea: 'marker'` (default; click + `<title>` on the dot/hub only, gated on buildable) vs `'group'` (whole group clickable, no marker title).
  - Route groups carry `data-route-id`, city groups `data-city-id`, always.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/MapScene.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { buildRouteGeometryFor } from '@trm/map-data';
import { MapScene } from './MapScene';

const cities = [
  { id: 'a', x: 10, y: 10 },
  { id: 'b', x: 40, y: 10 },
  { id: 'c', x: 25, y: 40, isIsland: true },
];
const routes = [
  { id: 'r1', a: 'a', b: 'b', color: 'RED', length: 3, isTunnel: false, ferryLocos: 0 },
  { id: 'r2', a: 'b', b: 'c', color: 'GRAY', length: 2, isTunnel: false, ferryLocos: 1 },
];
const { geometry, hubs } = buildRouteGeometryFor(cities, routes);
const base = {
  cities,
  routes,
  geometry,
  hubs,
  view: { x: 0, y: 0, w: 50, h: 50 },
  geography: null,
} as const;

describe('MapScene', () => {
  it('renders the network with the exact board classes and data attributes', () => {
    const { container } = render(<MapScene {...base} />);
    expect(container.querySelector('svg.board')).toBeTruthy();
    expect(container.querySelectorAll('path.bed').length).toBe(2);
    expect(container.querySelectorAll('rect.slot:not(.ferry-loco)').length).toBe(3); // r1's cars
    expect(container.querySelectorAll('circle.ferry-pip').length).toBe(1); // r2: 2 slots − 1 loco
    expect(container.querySelectorAll('rect.slot.ferry-loco').length).toBe(1);
    expect(container.querySelector('[data-route-id="r1"]')).toBeTruthy();
    expect(container.querySelector('[data-city-id="c"] circle.city-dot')).toBeTruthy();
    expect(container.querySelector('[data-city-id="c"]')!.classList.contains('island')).toBe(true);
    // Nothing optional leaks in by default: no labels, no hit paths, no claim affordances.
    expect(container.querySelectorAll('text.city-label').length).toBe(0);
    expect(container.querySelectorAll('path.hit').length).toBe(0);
    expect(container.querySelectorAll('.claimable').length).toBe(0);
  });

  it('claim mode: hit + claimable only on unowned routes; owned ferry hides its rainbow', () => {
    const owned = new Map([['r2', { ownerSeat: 1 }]]);
    const { container } = render(
      <MapScene {...base} owned={owned} canAct onRouteClick={() => {}} />,
    );
    expect(container.querySelectorAll('path.hit').length).toBe(1); // r1 only
    expect(container.querySelector('[data-route-id="r1"]')!.classList.contains('claimable')).toBe(
      true,
    );
    expect(container.querySelector('[data-route-id="r2"]')!.classList.contains('owned')).toBe(
      true,
    );
    expect(container.querySelectorAll('rect.slot.ferry-loco').length).toBe(0);
  });

  it('labels, class hooks, and always-hit compose (the editor shape)', () => {
    const { container, getByText } = render(
      <MapScene
        {...base}
        cityLabel={(c) => c.id.toUpperCase()}
        cityClass={(c) => (c.id === 'a' ? 'editor-city editor-city--selected' : 'editor-city')}
        routeClass={() => 'editor-route'}
        alwaysHitRoutes
        cityHitArea="group"
      />,
    );
    expect(getByText('A')).toBeTruthy();
    expect(container.querySelectorAll('path.hit').length).toBe(2);
    expect(
      container.querySelector('[data-city-id="a"]')!.classList.contains('editor-city--selected'),
    ).toBe(true);
    expect(
      container.querySelector('[data-route-id="r1"]')!.classList.contains('editor-route'),
    ).toBe(true);
    expect(container.querySelectorAll('.claimable').length).toBe(0);
  });

  it('stations, glow seats, and ticket-target halos render like the board', () => {
    const { container } = render(
      <MapScene
        {...base}
        stations={new Map([['a', 2]])}
        glowingRoutes={new Map([['r1', 0]])}
        glowingStations={new Map([['a', 2]])}
        highlightCities={new Set(['b'])}
      />,
    );
    expect(container.querySelector('[data-city-id="a"] circle.station')).toBeTruthy();
    expect(container.querySelector('[data-city-id="a"] circle.station-ring')).toBeTruthy();
    expect(
      container.querySelector('[data-route-id="r1"]')!.classList.contains('just-claimed'),
    ).toBe(true);
    expect(container.querySelector('[data-city-id="b"]')!.classList.contains('ticket-target')).toBe(
      true,
    );
    expect(container.querySelector('[data-city-id="b"] circle.ticket-target-halo')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/web test --run MapScene`
Expected: FAIL — `./MapScene` does not exist.

- [ ] **Step 3: Implement `MapScene.tsx`**

Create `apps/web/src/components/MapScene.tsx`. This is `Board.tsx`'s SVG body (lines 644–847 of the current file) verbatim in structure, generalized only where a prop replaces a Board-local:

```tsx
// The single source of truth for drawing the map scene — geography, railway network, city
// markers — extracted from the in-game Board. Every map surface (the live board, the login
// backdrop, the map builder's canvas) renders THROUGH this component, each variation being
// nothing but props, so none of them can drift from the in-game map. Purely presentational:
// no stores, no i18n, no content singletons — everything arrives by props. The server's OG
// map card mirrors this scene in string SVG from the same @trm/map-data geometry + tokens.
import type { CSSProperties, MouseEvent, ReactNode, Ref } from 'react';
import type { MapGeography, RouteGeometry } from '@trm/map-data';
import { mapCssVars } from '@trm/map-data';
import type { View } from '../game/geography';
import { CARD_COLOR_TOKENS, GRAY_TOKEN, seatColor } from '../theme/colors';
import { Geography, CustomGeography } from './Geography';
import { RouteShape, FerryLocoGradientDef } from './RouteShape';

/** The minimal city/route shape the scene needs — satisfied by both the live content's
 *  branded CityDef/RouteDef and the map builder's plain-string CityDraft/RouteDraft. */
export interface SceneCity {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly isIsland?: boolean | undefined;
}
export interface SceneRoute {
  readonly id: string;
  readonly a: string;
  readonly b: string;
  readonly color: string;
  readonly length: number;
  readonly isTunnel?: boolean | undefined;
  readonly ferryLocos?: number | undefined;
}

/** A route's claim state (from the snapshot): owned by a seat, or locked (double sibling). */
export interface RouteOwnership {
  readonly ownerSeat?: number | undefined;
  readonly locked?: boolean | undefined;
}

const colorOf = (rc: string): string =>
  rc === 'GRAY'
    ? GRAY_TOKEN.hex
    : (CARD_COLOR_TOKENS[rc as keyof typeof CARD_COLOR_TOKENS]?.hex ?? '#888');
const glyphOf = (rc: string): string =>
  rc === 'GRAY'
    ? GRAY_TOKEN.glyph
    : (CARD_COLOR_TOKENS[rc as keyof typeof CARD_COLOR_TOKENS]?.glyph ?? GRAY_TOKEN.glyph);

export interface MapSceneProps<C extends SceneCity, R extends SceneRoute> {
  /* ── content ── */
  cities: readonly C[];
  routes: readonly R[];
  geometry: ReadonlyMap<string, RouteGeometry>;
  hubs: ReadonlySet<string>;
  /** A custom map's cropped-world land rings; `undefined` → the hand-authored Taiwan coast;
   *  `null` → no geography layer at all (the builder before a crop exists). */
  geography?: MapGeography | null | undefined;
  /** The scene's viewBox (the active catalog's baseView, or a draft's). */
  view: View;

  /* ── game state (all optional — omitted renders the plain base-colour network) ── */
  owned?: ReadonlyMap<string, RouteOwnership> | undefined;
  /** cityId → seat of the player whose station stands there. */
  stations?: ReadonlyMap<string, number> | undefined;
  /** routeId → seat: routes currently running their claim glow. */
  glowingRoutes?: ReadonlyMap<string, number> | undefined;
  /** cityId → seat: stations currently running their just-built ring. */
  glowingStations?: ReadonlyMap<string, number> | undefined;
  /** Cities to softly highlight (offered-ticket endpoints): ticket-target class + halo. */
  highlightCities?: ReadonlySet<string> | undefined;
  canAct?: boolean | undefined;
  colorBlind?: boolean | undefined;
  /** Draw the required-loco rainbow pips on unclaimed ferries (default true; the login
   *  backdrop turns them off to keep its quiet all-pips look). */
  showFerryLocos?: boolean | undefined;

  /* ── labels + per-surface class hooks ── */
  /** City label text; omitted → no labels at all. */
  cityLabel?: ((city: C) => string) | undefined;
  /** Label level-of-detail tier ('major'/'secondary'/'tertiary'/'minor'); non-minor tiers
   *  become classes on the city group (see game/lod.ts + the [data-zoom] CSS). */
  cityTier?: ((cityId: string) => string) | undefined;
  /** Tooltip for a claimable route's hit path. */
  routeTitle?: ((route: R) => string) | undefined;
  /** Extra class(es) appended to a route group (the editor's editor-route states). */
  routeClass?: ((route: R) => string) | undefined;
  /** Extra class(es) appended to a city group (the editor's editor-city states). */
  cityClass?: ((city: C) => string) | undefined;
  /** Render a hit path on every route regardless of claimability (the editor's selection). */
  alwaysHitRoutes?: boolean | undefined;
  /** Where a city click lands: the marker only (the board — labels stay inert, marker gets a
   *  <title>) or the whole group incl. label (the editor). Default 'marker'. */
  cityHitArea?: 'marker' | 'group' | undefined;

  /* ── interaction ── */
  onRouteClick?: ((routeId: string) => void) | undefined;
  onCityClick?: ((cityId: string) => void) | undefined;

  /* ── svg root ── */
  svgRef?: Ref<SVGSVGElement> | undefined;
  onSvgClick?: ((e: MouseEvent<SVGSVGElement>) => void) | undefined;
  preserveAspectRatio?: string | undefined;
  /** Extra class on the `svg.board` root (e.g. the editor's `editor-canvas`). */
  className?: string | undefined;
  /** Merged over the token vars (e.g. the backdrop pinning `--inv-scale`). */
  style?: CSSProperties | undefined;
  ariaLabel?: string | undefined;
  /** Overlay layers drawn above the cities (the board's ticket sweeps / trail reveal). */
  children?: ReactNode;
}

export function MapScene<C extends SceneCity, R extends SceneRoute>({
  cities,
  routes,
  geometry,
  hubs,
  geography,
  view,
  owned,
  stations,
  glowingRoutes,
  glowingStations,
  highlightCities,
  canAct,
  colorBlind,
  showFerryLocos,
  cityLabel,
  cityTier,
  routeTitle,
  routeClass,
  cityClass,
  alwaysHitRoutes,
  cityHitArea,
  onRouteClick,
  onCityClick,
  svgRef,
  onSvgClick,
  preserveAspectRatio,
  className,
  style,
  ariaLabel,
  children,
}: MapSceneProps<C, R>) {
  const viewBox = `${view.x} ${view.y} ${view.w} ${view.h}`;
  // The shared dimension tokens ride on the root, so every game.css rule below resolves them.
  const rootStyle: CSSProperties = { ...(mapCssVars() as CSSProperties), ...style };
  return (
    <svg
      ref={svgRef}
      className={className ? `board ${className}` : 'board'}
      viewBox={viewBox}
      role="img"
      {...(ariaLabel !== undefined ? { 'aria-label': ariaLabel } : {})}
      {...(preserveAspectRatio !== undefined ? { preserveAspectRatio } : {})}
      style={rootStyle}
      {...(onSvgClick ? { onClick: onSvgClick } : {})}
    >
      <FerryLocoGradientDef />
      {geography === undefined ? (
        <Geography />
      ) : geography === null ? null : (
        <CustomGeography geography={geography} />
      )}

      {routes.map((r) => {
        const g = geometry.get(r.id);
        if (!g) return null;

        const o = owned?.get(r.id);
        const claimable = !!canAct && !o && !!onRouteClick;
        const clickable = claimable || (!!alwaysHitRoutes && !!onRouteClick);
        // Unclaimed → route colour; claimed → owner's seat colour; locked → muted grey.
        const fill =
          o?.ownerSeat !== undefined
            ? seatColor(o.ownerSeat)
            : o?.locked
              ? '#9aa0a6'
              : colorOf(r.color);
        const carOpacity = o?.locked ? 0.45 : 1;
        const isFerry = (r.ferryLocos ?? 0) > 0;
        const kind = r.isTunnel ? ' tunnel' : isFerry ? ' ferry' : '';
        const glowSeat = glowingRoutes?.get(r.id);
        const extra = routeClass ? ` ${routeClass(r)}` : '';
        const cls =
          'route' +
          (claimable ? ' claimable' : '') +
          (o ? ' owned' : '') +
          (glowSeat !== undefined ? ' just-claimed' : '') +
          kind +
          extra;
        // The owner's seat colour, exposed to CSS so a claimed route tints its whole roadbed
        // (the "background") to its owner — and the glow bloom reuses the same `--seat`.
        const seatCss = glowSeat ?? o?.ownerSeat;
        // Double-route siblings split apart by a perpendicular nudge that counter-scales with
        // the track weight (--inv-scale), so the twin tracks stay snug at any zoom.
        const groupStyle: CSSProperties = {
          ...(g.perp.x || g.perp.y
            ? {
                transform: `translate(calc(${g.perp.x.toFixed(3)}px * var(--inv-scale)), calc(${g.perp.y.toFixed(3)}px * var(--inv-scale)))`,
              }
            : null),
          ...(seatCss !== undefined ? ({ '--seat': seatColor(seatCss) } as CSSProperties) : null),
        };
        const pick = onRouteClick
          ? (e: MouseEvent) => {
              e.stopPropagation();
              onRouteClick(r.id);
            }
          : undefined;

        return (
          <g
            key={r.id}
            className={cls}
            data-route-id={r.id}
            style={groupStyle}
            onClick={clickable ? pick : undefined}
          >
            <RouteShape
              geometry={g}
              isTunnel={!!r.isTunnel}
              isFerry={isFerry}
              // Unclaimed ferries show their required-loco block; once owned, every pip takes
              // the owner's colour (no rainbow), so the highlight count drops to zero.
              ferryLocos={o || showFerryLocos === false ? 0 : (r.ferryLocos ?? 0)}
              length={r.length}
              fill={fill}
              carOpacity={carOpacity}
            />

            {(claimable || alwaysHitRoutes) && (
              <path className="hit" d={g.path}>
                {routeTitle && <title>{routeTitle(r)}</title>}
              </path>
            )}
            {/* Colour-blind aid: a glyph chip naming the colour you pay (length is the car count). */}
            {colorBlind && !o && (
              <g className="glyph-badge">
                <circle cx={g.mid.x} cy={g.mid.y} />
                <text x={g.mid.x} y={g.mid.y}>
                  {glyphOf(r.color)}
                </text>
              </g>
            )}
          </g>
        );
      })}

      {cities.map((c) => {
        const stationSeat = stations?.get(c.id);
        const hasStation = stationSeat !== undefined;
        const buildable = !!canAct && !hasStation && !!onCityClick;
        const isHub = hubs.has(c.id);
        // Tier drives the cartographic label level-of-detail (see game/lod.ts + the
        // [data-zoom] rules in game.css); islands always keep their label.
        const tier = cityTier?.(c.id);
        const isTarget = highlightCities?.has(c.id) ?? false;
        const extra = cityClass ? ` ${cityClass(c)}` : '';
        const cls =
          'city' +
          (c.isIsland ? ' island' : '') +
          (isHub ? ' hub' : '') +
          (tier && tier !== 'minor' ? ` ${tier}` : '') +
          (isTarget ? ' ticket-target' : '') +
          extra;
        const pick = onCityClick
          ? (e: MouseEvent) => {
              e.stopPropagation();
              onCityClick(c.id);
            }
          : undefined;
        const onMarker = cityHitArea === 'group' ? undefined : buildable ? pick : undefined;
        const onGroup = cityHitArea === 'group' ? pick : undefined;
        const markerTitle =
          cityHitArea !== 'group' && cityLabel ? <title>{cityLabel(c)}</title> : null;
        const builtSeat = glowingStations?.get(c.id);
        const justBuilt = builtSeat !== undefined;
        return (
          <g key={c.id} data-city-id={c.id} className={cls} onClick={onGroup}>
            {/* Offered-ticket endpoint: a soft halo behind the marker so the player can trace
                the railways a ticket needs while the chooser holds the rail. */}
            {isTarget && <circle className="ticket-target-halo" cx={c.x} cy={c.y} />}
            {/* Junctions where many lines converge read as a wider slot-shaped station;
                ordinary stops stay round. Geometry comes from CSS (so it can grow with
                zoom via --marker-scale); the transform just plants it on the city. */}
            {isHub ? (
              <rect
                className={buildable ? 'city-hub buildable' : 'city-hub'}
                transform={`translate(${c.x} ${c.y})`}
                onClick={onMarker}
              >
                {markerTitle}
              </rect>
            ) : (
              <circle
                className={buildable ? 'city-dot buildable' : 'city-dot'}
                cx={c.x}
                cy={c.y}
                onClick={onMarker}
              >
                {markerTitle}
              </circle>
            )}
            {hasStation &&
              (isHub ? (
                <rect
                  className={justBuilt ? 'station-hub just-built' : 'station-hub'}
                  transform={`translate(${c.x} ${c.y})`}
                  style={{ fill: seatColor(stationSeat) }}
                />
              ) : (
                <circle
                  className={justBuilt ? 'station just-built' : 'station'}
                  cx={c.x}
                  cy={c.y}
                  style={{ fill: seatColor(stationSeat) }}
                />
              ))}
            {justBuilt && (
              <circle
                className="station-ring"
                cx={c.x}
                cy={c.y}
                r={0.5}
                style={{ '--seat': seatColor(builtSeat) } as CSSProperties}
              />
            )}
            {cityLabel && (
              <text className="city-label" x={c.x} y={c.y}>
                {cityLabel(c)}
              </text>
            )}
          </g>
        );
      })}

      {children}
    </svg>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn workspace @trm/web test --run MapScene` → PASS (4 tests).
Run: `yarn workspace @trm/web typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/MapScene.tsx apps/web/src/components/MapScene.test.tsx
git commit -m "feat(web): MapScene — the single presentational map scene"
```

---

### Task 4: Board renders through MapScene

**Files:**
- Modify: `apps/web/src/components/Board.tsx`
- Test: existing `apps/web/src/components/Board.test.tsx` (unchanged; must pass)

**Interfaces:**
- Consumes: `MapScene` (Task 3), `seatColor` from theme (Task 2), `ACTIVE_GEOGRAPHY` from `../game/catalog` (new import).
- Produces: `Board`'s public props are **unchanged** (`GameStage`, tutorial, replay keep working untouched).

- [ ] **Step 1: Rewire Board's render**

In `apps/web/src/components/Board.tsx`:

1. **Imports** — remove `RouteColor` type, `GeographyLayer`, `RouteShape`/`FerryLocoGradientDef`, `CARD_COLOR_TOKENS`/`GRAY_TOKEN`/`SEAT_COLORS`; add:
   ```ts
   import { seatColor } from '../theme/colors';
   import { ACTIVE_BASE_VIEW, ACTIVE_GEOGRAPHY } from '../game/catalog';
   import { MapScene } from './MapScene';
   ```
   (`ACTIVE_BASE_VIEW` was already imported from catalog; fold into one line. Keep `CITIES`, `ROUTES`, `cityById`, `routeById`, `cityName`, `ROUTE_GEOMETRY`, `HUB_CITIES`, `zoomBucket`, `cityTier` — the framers, POI lookup, glow gate, and sweeps still use them.)
2. **Delete** the local helpers now inside MapScene: the `seatColor` const (line 45) and `colorOf`/`glyphOf` (lines 62–65).
3. Replace the `<svg className="board" …>…</svg>` element (everything from `<svg` to `</svg>` inside `<TransformComponent>`) with:

```tsx
          <MapScene
            cities={CITIES}
            routes={ROUTES}
            geometry={ROUTE_GEOMETRY}
            hubs={HUB_CITIES}
            geography={ACTIVE_GEOGRAPHY ?? undefined}
            view={ACTIVE_BASE_VIEW}
            owned={owned}
            stations={stationCities}
            glowingRoutes={startedGlowRoutes}
            glowingStations={glowingStations}
            highlightCities={highlightCities}
            canAct={canAct}
            colorBlind={colorBlind}
            cityLabel={(c) => cityName(c.id, locale)}
            cityTier={cityTier}
            routeTitle={(r) => `${cityName(r.a, locale)}–${cityName(r.b, locale)} · ${r.length}`}
            onRouteClick={onPickRoute}
            onCityClick={onPickCity}
            ariaLabel="Taiwan railway map"
          >
            {/* Ticket-completion sweep: seat-colour glow drawn start→end along the owned path. */}
            {sweeps.map((sw) => (
              <g key={sw.id} className="sweep-layer" pointerEvents="none">
                {sw.path.map((rid, i) => {
                  const sg = ROUTE_GEOMETRY.get(rid);
                  if (!sg) return null;
                  return (
                    <path
                      key={i}
                      className="sweep-seg"
                      d={sg.path}
                      pathLength={1}
                      style={
                        { '--seat': seatColor(sw.seat), '--delay': `${i * 0.32}s` } as CSSProperties
                      }
                    />
                  );
                })}
              </g>
            ))}

            {/* Longest-trail review: a persistent seat-colour sweep along the player's longest route. */}
            {routeReveal && (
              <g className="sweep-layer reveal-layer" pointerEvents="none">
                {routeReveal.path.map((rid, i) => {
                  const sg = ROUTE_GEOMETRY.get(rid);
                  if (!sg) return null;
                  return (
                    <path
                      key={rid}
                      className="sweep-seg"
                      d={sg.path}
                      pathLength={1}
                      style={
                        {
                          '--seat': seatColor(routeReveal.seat),
                          '--delay': `${i * 0.12}s`,
                        } as CSSProperties
                      }
                    />
                  );
                })}
              </g>
            )}
          </MapScene>
```

Notes:
- `ACTIVE_GEOGRAPHY` is `MapGeography | null` — pass `geography={ACTIVE_GEOGRAPHY ?? undefined}` so the Taiwan layer renders when it's null (MapScene's `null` means "no geography"). **Use `?? undefined`, not the raw value.**
- `c.id` / `r.a` / `r.b` are branded ids; they're assignable to `string`, so `cityName(c.id, locale)` compiles without casts.
- Everything else in the file (viewport div, TransformWrapper + all headless children, glow timers, `frameHome`, `CameraSync`, `RouteGlowGate`, `SpotlightFramer`, `RevealFramer`, `MapControls`) stays exactly as it is. The `viewBox` local const at the top of `Board()` is now unused — delete it.

- [ ] **Step 2: Run the board tests**

Run: `yarn workspace @trm/web test --run Board`
Expected: PASS — same role/aria, `path.bed` count, `rect.slot` count, `rect.city-hub` count, `臺北` label, `data-route-id` / `data-city-id` attributes.

- [ ] **Step 3: Run the whole web suite + typecheck**

Run: `yarn workspace @trm/web test` and `yarn workspace @trm/web typecheck`
Expected: PASS / clean (GameStage, tutorial `useScenarioPlayer`, replay all consume Board's unchanged props).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/Board.tsx
git commit -m "refactor(web): Board renders through MapScene"
```

---

### Task 5: Login backdrop renders through MapScene

**Files:**
- Modify: `apps/web/src/components/MapBackdrop.tsx`

**Interfaces:**
- Consumes: `MapScene` (Task 3), live content singletons (`CITIES`, `ROUTES`, `ROUTE_GEOMETRY`, `HUB_CITIES`), `BASE_VIEW`.
- Produces: `MapBackdrop` unchanged externally (no props).

- [ ] **Step 1: Replace the hand-rolled loops**

Replace the whole of `apps/web/src/components/MapBackdrop.tsx` with:

```tsx
import { memo, type CSSProperties } from 'react';
import { CITIES, ROUTES } from '../game/content';
import { ROUTE_GEOMETRY, HUB_CITIES } from '../game/routeGeometry';
import { BASE_VIEW } from '../game/geography';
import { MapScene } from './MapScene';
import '../styles/game.css';

// `.board` reads --inv-scale (≈1/zoom) for its track/marker weights, but that var is normally set
// live on the in-game `.board-viewport`. The backdrop has no viewport, so pin it to the home value.
const STATIC_BOARD_STYLE = { '--inv-scale': 0.53 } as CSSProperties;

/**
 * A static, non-interactive render of the Taiwan board — the same cartography and railway network
 * the game draws (through the same MapScene), in their base route colours, with no labels,
 * ownership, glow, or pan/zoom. Used purely as the decorative (blurred) backdrop on the login
 * screen; `preserveAspectRatio="slice"` makes it cover the area like `background-size: cover`.
 * `showFerryLocos={false}` keeps its quiet all-pips ferry look. Memoised: it never changes.
 */
export const MapBackdrop = memo(function MapBackdrop() {
  return (
    <div className="login-backdrop" aria-hidden>
      <MapScene
        cities={CITIES}
        routes={ROUTES}
        geometry={ROUTE_GEOMETRY}
        hubs={HUB_CITIES}
        view={BASE_VIEW}
        preserveAspectRatio="xMidYMid slice"
        showFerryLocos={false}
        style={STATIC_BOARD_STYLE}
      />
    </div>
  );
});
```

Known-harmless DOM additions vs today (document, don't fight): the svg gains `role="img"` (inside an `aria-hidden` div), the unused ferry-gradient `<defs>`, and `data-route-id`/`data-city-id` attributes.

- [ ] **Step 2: Verify**

Run: `yarn workspace @trm/web test` and `yarn workspace @trm/web typecheck` → PASS / clean (LoginScreen/LoginCallback render MapBackdrop in their tests).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/MapBackdrop.tsx
git commit -m "refactor(web): login backdrop renders through MapScene"
```

---

### Task 6: Editor canvas renders through MapScene

**Files:**
- Modify: `apps/web/src/features/builder/editor/EditorCanvas.tsx`

**Interfaces:**
- Consumes: `MapScene` (Task 3). `CityDraft` (has `nameZh`) and `RouteDraft` satisfy `SceneCity`/`SceneRoute` structurally; the generic component types `cityLabel`/`cityClass` callbacks as `CityDraft`.
- Produces: `EditorCanvas` props unchanged (`onBackgroundClick`, `onCityClick`, `onRouteClick`, `highlightCities`).

- [ ] **Step 1: Replace the inner svg**

Replace the whole of `apps/web/src/features/builder/editor/EditorCanvas.tsx` with:

```tsx
import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { MapScene } from '../../../components/MapScene';
import { buildRouteGeometryFor } from '../../../game/routeGeometry';
import { clientToBoardPoint } from './canvasProjection';
import { CanvasControls } from './CanvasControls';
import { ZoomVar } from './ZoomVar';
import { useEditorStore } from './store';
import '../../../styles/game.css';

const DEFAULT_VIEW = { x: 0, y: 0, w: 100, h: 100 };

export interface EditorCanvasProps {
  /** Empty-canvas / land click, in board units — placing a new city, or a no-op if the stage
   *  doesn't handle placement (e.g. the Missions stage never renders this canvas at all). */
  onBackgroundClick?: (point: { x: number; y: number }) => void;
  onCityClick?: (id: string) => void;
  onRouteClick?: (id: string) => void;
  /** City ids to visually highlight (e.g. the two endpoints picked mid-route-creation). */
  highlightCities?: ReadonlySet<string>;
}

/**
 * The shared SVG workspace for the Stops/Routes stages: pan/zoom (matching the live board's
 * feel) around the SAME MapScene the live board renders — the editor variation is nothing but
 * props (draft content, selection/highlight classes, always-on hit paths, zh labels) — so an
 * authored map previews exactly as it will play, independent of the live-game rendering
 * singleton (game/catalog.ts).
 */
export function EditorCanvas({
  onBackgroundClick,
  onCityClick,
  onRouteClick,
  highlightCities,
}: EditorCanvasProps) {
  const { t } = useTranslation();
  const draft = useEditorStore((s) => s.draft);
  const selection = useEditorStore((s) => s.selection);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const zoomVarRef = useRef<HTMLDivElement | null>(null);
  const view = draft.geography?.baseView ?? DEFAULT_VIEW;

  const { geometry, hubs } = useMemo(
    () => buildRouteGeometryFor(draft.cities, draft.routes),
    [draft.cities, draft.routes],
  );

  const handleBackgroundClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!onBackgroundClick || !svgRef.current) return;
    if (e.target !== e.currentTarget && !(e.target as Element).classList.contains('land')) return;
    const pt = clientToBoardPoint(svgRef.current, e.clientX, e.clientY);
    if (pt) onBackgroundClick(pt);
  };

  return (
    <div className="editor-canvas-inner" ref={zoomVarRef}>
      <TransformWrapper minScale={0.5} maxScale={12} initialScale={1} centerOnInit wheel={{ step: 0.0022 }}>
        <ZoomVar targetRef={zoomVarRef} />
        <CanvasControls />
        {/* contentStyle overrides the library's default `width/height: fit-content` on the inner
            content div — without it the SVG's own 100%/100% resolves against an indefinite parent
            and falls back to its tiny intrinsic size instead of filling (and tracking) the viewport. */}
        <TransformComponent
          wrapperStyle={{ width: '100%', height: '100%' }}
          contentStyle={{ width: '100%', height: '100%' }}
        >
          <MapScene
            svgRef={svgRef}
            className="editor-canvas"
            cities={draft.cities}
            routes={draft.routes}
            geometry={geometry}
            hubs={hubs}
            geography={draft.geography ?? null}
            view={view}
            ariaLabel={t('builder.canvasLabel')}
            onSvgClick={handleBackgroundClick}
            alwaysHitRoutes
            cityHitArea="group"
            cityLabel={(c) => c.nameZh}
            routeClass={(r) =>
              'editor-route' +
              (selection?.kind === 'route' && selection.id === r.id ? ' editor-route--selected' : '')
            }
            cityClass={(c) =>
              'editor-city' +
              (selection?.kind === 'city' && selection.id === c.id ? ' editor-city--selected' : '') +
              (highlightCities?.has(c.id) ? ' editor-city--highlighted' : '')
            }
            onRouteClick={onRouteClick}
            onCityClick={onCityClick}
          />
        </TransformComponent>
      </TransformWrapper>
    </div>
  );
}
```

Known-harmless DOM changes vs today (class *presence* is identical, order differs; CSS is order-independent): route/city groups gain `data-route-id`/`data-city-id`; the editor previously never passed `highlightCities` into a halo — it still doesn't (highlight stays a class via `cityClass`, exactly as before).

- [ ] **Step 2: Verify**

Run: `yarn workspace @trm/web test` and `yarn workspace @trm/web typecheck` → PASS / clean.
Then check the builder chunk didn't inflate the main bundle: `yarn workspace @trm/web build` and confirm the builder feature is still its own lazy chunk (compare `dist/assets` chunk names/sizes to a pre-change build if in doubt — MapScene now lands in the main chunk, which is correct: the board already did).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/builder/editor/EditorCanvas.tsx
git commit -m "refactor(builder): editor canvas renders through MapScene"
```

---

### Task 7: game.css dimensions come from the shared tokens

**Files:**
- Modify: `apps/web/src/styles/game.css` (the Cartography + Rail network + Cities sections, ~lines 297–520)
- Modify: `apps/web/src/features/tutorial/Specimens.tsx` (spread `mapCssVars()` on its two standalone SVGs)

**Interfaces:**
- Consumes: `mapCssVars()` from `@trm/map-data` (Task 1) — already pinned on every `MapScene` root since Task 3.
- Produces: game.css map rules read `--m-*` vars; **no dimension literal remains** in the tokenized rules.

- [ ] **Step 1: Give the standalone specimen SVGs the vars**

In `apps/web/src/features/tutorial/Specimens.tsx`:

Add to imports: `import { mapCssVars } from '@trm/map-data';`

In `RouteSpecimen`, change the svg's style prop from
`style={{ ['--inv-scale' as string]: String(SPEC_INV) }}` to:
```tsx
      style={{ ...mapCssVars(), ['--inv-scale' as string]: String(SPEC_INV) }}
```

In `ClaimTrack`, make the same change to its svg's style prop.

- [ ] **Step 2: Convert the CSS rules**

In `apps/web/src/styles/game.css`, apply these exact replacements (each old block is current file content, verbatim):

| Rule | Property changes |
| --- | --- |
| `.graticule line` | `stroke-width: calc(0.32px * var(--inv-scale));` → `stroke-width: calc(var(--m-grat-w) * 1px * var(--inv-scale));`<br>`stroke-dasharray: calc(0.9px * var(--inv-scale)) calc(1.7px * var(--inv-scale));` → `stroke-dasharray: calc(var(--m-grat-dash-a) * 1px * var(--inv-scale)) calc(var(--m-grat-dash-b) * 1px * var(--inv-scale));` |
| `.land-surf` | `stroke-width: 2.4;` → `stroke-width: calc(var(--m-land-surf-w) * 1px);` · `opacity: 0.6;` → `opacity: var(--m-land-surf-o);` |
| `.land` | `stroke-width: 0.45;` → `stroke-width: calc(var(--m-land-stroke-w) * 1px);` |
| `.relief` | `opacity: 0.55;` → `opacity: var(--m-relief-o);` |
| `.relief-ridge` | `stroke-width: 0.3;` → `stroke-width: calc(var(--m-relief-ridge-w) * 1px);` · `stroke-dasharray: 0.5 0.9;` → `stroke-dasharray: var(--m-relief-ridge-dash);` · `opacity: 0.55;` → `opacity: var(--m-relief-o);` |
| `.islands circle` | `stroke-width: 0.4;` → `stroke-width: calc(var(--m-geo-island-w) * 1px);` |
| `.bed` | `stroke-width: calc(2.8px * var(--inv-scale));` → `stroke-width: calc(var(--m-bed-w) * 1px * var(--inv-scale));` · `opacity: 0.95;` → `opacity: var(--m-bed-o);` |
| `.route.owned .bed` | `stroke-width: calc(3.1px * var(--inv-scale));` → `stroke-width: calc(var(--m-bed-owned-w) * 1px * var(--inv-scale));` |
| `.slot` | `y: calc(-0.72px * var(--inv-scale));` → `y: calc(var(--m-slot-h) / -2 * 1px * var(--inv-scale));` · `height: calc(1.44px * var(--inv-scale));` → `height: calc(var(--m-slot-h) * 1px * var(--inv-scale));` · `rx: calc(0.42px * var(--inv-scale));` → `rx: calc(var(--m-slot-rx) * 1px * var(--inv-scale));` · `stroke: #2a2520;` → `stroke: var(--m-car-edge);` · `stroke-width: calc(0.3px * var(--inv-scale));` → `stroke-width: calc(var(--m-slot-stroke-w) * 1px * var(--inv-scale));` |
| `.route.owned .slot` | `stroke-width: calc(0.42px * var(--inv-scale));` → `stroke-width: calc(var(--m-slot-owned-stroke-w) * 1px * var(--inv-scale));` |
| `.tunnel-bg` | `stroke: #b0b0b0;` → `stroke: var(--m-tunnel-bg-ink);` · `stroke-opacity: 0.18;` → `stroke-opacity: var(--m-tunnel-bg-o);` · `stroke-width: calc(6px * var(--inv-scale));` → `stroke-width: calc(var(--m-tunnel-bg-w) * 1px * var(--inv-scale));` |
| `.tunnel-tie` | `x: calc(-4px * var(--inv-scale));` → `x: calc(var(--m-tie-w) / -2 * 1px * var(--inv-scale));` · `width: calc(8px * var(--inv-scale));` → `width: calc(var(--m-tie-w) * 1px * var(--inv-scale));` · `y: calc(-0.14px * var(--inv-scale));` → `y: calc(var(--m-tie-h) / -2 * 1px * var(--inv-scale));` · `height: calc(0.28px * var(--inv-scale));` → `height: calc(var(--m-tie-h) * 1px * var(--inv-scale));` · `fill: #3d352b;` → `fill: var(--m-tie-ink);` · `fill-opacity: 0.9;` → `fill-opacity: var(--m-tie-o);` (keep the inline comments on their lines) |
| `.ferry-line` | `stroke: #9aa0a6;` → `stroke: var(--m-ferry-line-ink);` · `stroke-width: calc(0.5px * var(--inv-scale));` → `stroke-width: calc(var(--m-ferry-line-w) * 1px * var(--inv-scale));` · `stroke-dasharray: 0.1 2.55;` → `stroke-dasharray: var(--m-ferry-dash);` |
| `.ferry-pip` | `stroke: #2a2520;` → `stroke: var(--m-car-edge);` · `stroke-width: calc(0.25px * var(--inv-scale));` → `stroke-width: calc(var(--m-ferry-pip-stroke-w) * 1px * var(--inv-scale));` · `r: calc(0.7px * var(--inv-scale));` → `r: calc(var(--m-ferry-pip-r) * 1px * var(--inv-scale));` |
| `.slot.ferry-loco` | `stroke: #fff;` → `stroke: var(--m-ferry-loco-edge);` · `stroke-width: calc(0.5px * var(--inv-scale));` → `stroke-width: calc(var(--m-ferry-loco-stroke-w) * 1px * var(--inv-scale));` |
| `.hit` | `stroke-width: calc(4.2px * var(--inv-scale));` → `stroke-width: calc(var(--m-hit-w) * 1px * var(--inv-scale));` |
| `.glyph-badge circle` | `stroke-width: calc(0.22px * var(--inv-scale));` → `stroke-width: calc(var(--m-glyph-stroke-w) * 1px * var(--inv-scale));` · `r: calc(1.6px * var(--inv-scale));` → `r: calc(var(--m-glyph-r) * 1px * var(--inv-scale));` |
| `.city-dot` | `stroke-width: calc(0.4px * var(--marker-scale));` → `stroke-width: calc(var(--m-city-stroke-w) * 1px * var(--marker-scale));` · `r: calc(1.15px * var(--marker-scale));` → `r: calc(var(--m-city-r) * 1px * var(--marker-scale));` |
| `.city.island .city-dot` | `r: calc(1.4px * var(--marker-scale));` → `r: calc(var(--m-island-r) * 1px * var(--marker-scale));` |
| `.city-hub` | `x: calc(-1.25px * var(--marker-scale));` → `x: calc(var(--m-hub-w) / -2 * 1px * var(--marker-scale));` · `y: calc(-0.8px * var(--marker-scale));` → `y: calc(var(--m-hub-h) / -2 * 1px * var(--marker-scale));` · `width: calc(2.5px * var(--marker-scale));` → `width: calc(var(--m-hub-w) * 1px * var(--marker-scale));` · `height: calc(1.6px * var(--marker-scale));` → `height: calc(var(--m-hub-h) * 1px * var(--marker-scale));` · `rx: calc(0.8px * var(--marker-scale));` → `rx: calc(var(--m-hub-rx) * 1px * var(--marker-scale));` · `stroke-width: calc(0.4px * var(--marker-scale));` → `stroke-width: calc(var(--m-city-stroke-w) * 1px * var(--marker-scale));` |

Deliberately NOT converted (web-only, no OG counterpart, out of scope per spec): `.compass*`, hover states (`.route.claimable:hover …`), `.station`/`.station-hub`/`.station-ring`, `.city-label`, sweep/glow animation rules, and the dark-theme `.bed`/city fills.

- [ ] **Step 3: Verify**

Run: `yarn workspace @trm/web test` and `yarn workspace @trm/web typecheck` → PASS / clean. (jsdom doesn't compute CSS, so the real check is visual — Task 9.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/styles/game.css apps/web/src/features/tutorial/Specimens.tsx
git commit -m "refactor(web): map dimensions in game.css resolve from the shared render tokens"
```

---

### Task 8: OG map card draws from the shared tokens

**Files:**
- Modify: `apps/server/src/og/map-svg.ts`
- Test: existing `apps/server/test/og.e2e.spec.ts` (unchanged; must pass)

**Interfaces:**
- Consumes: `MAP_PALETTE_LIGHT`, `MAP_INKS`, `MAP_DIMS`, `ROUTE_COLOR_HEX`, `LIVERY_COLORS` from `@trm/map-data` (Task 1).
- Produces: `mapPanelSvg` / `ferryLocoGradientDef` signatures unchanged (`card-svg.ts` untouched).

- [ ] **Step 1: Replace the copied literals with token imports**

In `apps/server/src/og/map-svg.ts`:

1. Extend the `@trm/map-data` import with the tokens and delete the local constant block (`SEA`…`BLUE`, `ROUTE_COLORS`, `LIVERY_COLORS`, `RELIEF`):

```ts
import {
  buildRouteGeometryFor,
  smoothClosedPath,
  TAIWAN_BASE_VIEW,
  TAIWAN_LAND_PATH,
  TAIWAN_CENTRAL_RANGE_PATH,
  TAIWAN_ISLANDS,
  TAIWAN_GRATICULE,
  MAP_PALETTE_LIGHT,
  MAP_INKS,
  MAP_DIMS,
  ROUTE_COLOR_HEX,
  LIVERY_COLORS,
} from '@trm/map-data';
import type { MapGeography, RouteGeometry } from '@trm/map-data';

// The card is always the light theme; dimensions are the shared board tokens at base zoom
// (--inv-scale / --marker-scale = 1), so the card reads exactly like the in-game map and
// CANNOT drift from it — game.css resolves the very same MAP_DIMS via mapCssVars().
const P = MAP_PALETTE_LIGHT;
const D = MAP_DIMS;

// Thumbnail-only derivations (the card's ~500px scale, where the board's full-size tunnel
// dressing smears): ties at 45% length, the tunnel glint at 40% width. These are the ONLY
// visual values that differ from the live board, and both are explicit factors on the
// shared token rather than free-standing numbers.
const OG_TIE_SCALE = 0.45;
const OG_TUNNEL_BG_SCALE = 0.4;
```

2. Replace every use of the old constants (updated header comment: the visual constants now *are* the board's, not a mirror of game.css):
   - `SEA` → `P.sea`, `SEA_LINE` → `P.seaLine`, `LAND` → `P.land`, `COAST` → `P.coast`, `SURFACE` → `P.surface`, `INK` → `P.ink`, `BLUE` → `P.blue`, `RELIEF` → `P.relief`.
   - `ROUTE_COLORS[r.color] ?? ROUTE_COLORS.GRAY!` → `ROUTE_COLOR_HEX[r.color as keyof typeof ROUTE_COLOR_HEX] ?? ROUTE_COLOR_HEX.GRAY`.
   - `ferryLocoGradientDef()` keeps its body but maps over the imported `LIVERY_COLORS`.
3. Replace the literal dimensions:
   - `graticuleLayer`: `stroke-width="0.32"` → `stroke-width="${D.graticuleW}"`; `stroke-dasharray="0.9 1.7"` → `stroke-dasharray="${D.graticuleDashA} ${D.graticuleDashB}"`.
   - `customLandLayer` + `officialTaiwanLandLayer`: land-surf `stroke-width="2.4" opacity="0.6"` → `stroke-width="${D.landSurfW}" opacity="${D.landSurfOpacity}"`; land `stroke-width="0.45"` → `stroke-width="${D.landStrokeW}"`; islands `stroke-width="0.4"` → `stroke-width="${D.geoIslandStrokeW}"`; relief `opacity="0.55"` → `opacity="${D.reliefOpacity}"` (both uses); ridge `stroke-width="0.3" stroke-dasharray="0.5 0.9"` → `stroke-width="${D.reliefRidgeW}" stroke-dasharray="${D.reliefRidgeDash}"`.
   - `routeLayer` — tunnel glint: `stroke="#b0b0b0" stroke-opacity="0.18" stroke-width="2.4"` → `stroke="${MAP_INKS.tunnelBg}" stroke-opacity="${MAP_INKS.tunnelBgOpacity}" stroke-width="${f(D.tunnelBgW * OG_TUNNEL_BG_SCALE)}"`.
   - bed: `stroke-width="2.8" … opacity="0.95"` → `stroke-width="${D.bedW}" … opacity="${D.bedOpacity}"`.
   - ties: `x="-1.8" y="-0.14" width="3.6" height="0.28" fill="#3d352b" fill-opacity="0.9"` → `x="${f((-D.tieW * OG_TIE_SCALE) / 2)}" y="${f(-D.tieH / 2)}" width="${f(D.tieW * OG_TIE_SCALE)}" height="${f(D.tieH)}" fill="${MAP_INKS.tie}" fill-opacity="${MAP_INKS.tieOpacity}"`.
   - ferry line: `stroke="#9aa0a6" stroke-width="0.5" … stroke-dasharray="0.1 2.55"` → `stroke="${MAP_INKS.ferryLine}" stroke-width="${D.ferryLineW}" … stroke-dasharray="${D.ferryDash}"`.
   - ferry loco rect: `y="-0.72" … height="1.44" rx="0.42" … stroke="#fff" stroke-width="0.5"` → `y="${f(-D.slotH / 2)}" … height="${f(D.slotH)}" rx="${D.slotRx}" … stroke="${MAP_INKS.ferryLocoEdge}" stroke-width="${D.ferryLocoStrokeW}"`.
   - ferry pip: `r="0.7" … stroke="#2a2520" stroke-width="0.25"` → `r="${D.ferryPipR}" … stroke="${MAP_INKS.carEdge}" stroke-width="${D.ferryPipStrokeW}"`.
   - car slot rect: `y="-0.72" … height="1.44" rx="0.42" … stroke="#2a2520" stroke-width="0.3"` → `y="${f(-D.slotH / 2)}" … height="${f(D.slotH)}" rx="${D.slotRx}" … stroke="${MAP_INKS.carEdge}" stroke-width="${D.slotStrokeW}"`.
   - `cityLayer` hub: `x="-1.25" y="-0.8" width="2.5" height="1.6" rx="0.8" … stroke-width="0.4"` → `x="${f(-D.hubW / 2)}" y="${f(-D.hubH / 2)}" width="${D.hubW}" height="${D.hubH}" rx="${D.hubRx}" … stroke-width="${D.cityStrokeW}"`.
   - city dot: `r="${island ? 1.4 : 1.15}" … stroke-width="0.4"` → `r="${island ? D.islandR : D.cityR}" … stroke-width="${D.cityStrokeW}"`.
4. When done: `grep -nE '#[0-9a-fA-F]{3,6}|"[0-9]+\.[0-9]+"' apps/server/src/og/map-svg.ts` must show **no colour hexes and no dimension literals** left in this file (numbers inside `f(…)` calls of computed geometry are fine).

- [ ] **Step 2: Run the OG e2e**

Run: `yarn workspace @trm/server test --run og.e2e`
Expected: PASS (the map card asserts render-success + distinct-from-site-card, not pixel bytes; every emitted value is numerically identical to before).

- [ ] **Step 3: Typecheck + lint the server**

Run: `yarn workspace @trm/server typecheck` and `yarn workspace @trm/server lint` → clean.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/og/map-svg.ts
git commit -m "refactor(og): map card draws from the shared render tokens"
```

---

### Task 9: Full validation, visual verification, docs

**Files:**
- Modify: `apps/web/CLAUDE.md` (rendering bullet), `packages/map-data/CLAUDE.md` (structure bullet)

- [ ] **Step 1: Full monorepo gates**

Run from root: `yarn typecheck`, `yarn lint`, `yarn test`, `yarn format` — all must pass/apply cleanly.

- [ ] **Step 2: Visual verification (the real test for Task 7's CSS switch)**

Use the `verify` skill / run skill: `docker compose up -d mongo`, `yarn workspace @trm/server dev`, `yarn workspace @trm/web dev`, then with browser tooling check against pre-change appearance:
1. Login screen (`/login`): the blurred backdrop shows the island + coloured network at the usual weight (Task 7's vars resolving on the MapScene root — if the network renders as hairlines or fat ribbons, a var didn't resolve).
2. In-game board (`TRM_DEV_GAME=1` demo or a quick bot game): roadbeds, cars, tunnel ties, ferry pips/rainbow locos, city dots/hubs/labels, claim hover, colour-blind badges (toggle in settings), dark theme toggle.
3. Tutorial (encyclopedia specimens): route/ferry/tunnel/double specimens at their usual proportions.
4. Builder (`/maps`, registered user): canvas renders draft with selection/highlight/labels.
5. OG PNGs: `curl -o site.png localhost:3001/api/v1/og/site.png` and a shared-map card if one exists; open and eyeball the map panel.

- [ ] **Step 3: Update area docs**

In `apps/web/CLAUDE.md`, in the "Rendering & content" section, amend the `components/Board.tsx` bullet to say the scene itself is drawn by `components/MapScene.tsx` — the single map-scene component shared by the live board, the login `MapBackdrop`, and the builder's `EditorCanvas`, with per-surface props; Board keeps only pan/zoom/camera/glow orchestration.

In `packages/map-data/CLAUDE.md`, add to the Structure section: `render-tokens.ts` — the shared cartography render tokens (palette, inks, dimensions, `mapCssVars()`), consumed by the web board CSS and the server's OG map card; pure data, never part of `hashContent`.

- [ ] **Step 4: Update the knowledge graph**

Run: `graphify update .`

- [ ] **Step 5: Commit**

```bash
git add apps/web/CLAUDE.md packages/map-data/CLAUDE.md
git commit -m "docs: note MapScene + shared render tokens in area CLAUDE.md files"
```
