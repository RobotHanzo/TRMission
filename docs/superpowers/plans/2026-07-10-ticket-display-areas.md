# Custom-map Mission-Ticket Display Areas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each mission (destination) ticket's mini-map follow the active custom map's geography instead of the hardcoded Taiwan silhouette, and let a map author choose the displayed area (crop/zoom) per ticket with a map-wide default and a safe whole-map fallback.

**Architecture:** A presentation-only `TicketView` spec (`full` / `auto` / `zoom`) lives on `TicketDef.view` (per-ticket) and `MapGeography.defaultTicketView` (map default), both in `@trm/map-data`. A pure resolver turns a spec + endpoints + `baseView` into an SVG `viewBox` rectangle. `RoutePreview` becomes a purely presentational component fed by the active game catalog (in-game) or the editor draft (builder live preview). No engine, proto/wire, or `hashContent`-formula changes: the fields ride inside already-hashed structures (like `RouteDef.bow`).

**Tech Stack:** TypeScript, React + Vite + vitest (`@trm/web`), NestJS + zod + vitest (`@trm/server`), pure TS + vitest (`@trm/map-data`), Yarn 4 workspaces + Turborepo.

## Global Constraints

- The 6th card colour is **PURPLE** everywhere (never PINK); seat colours are abstract indices client-side. (Not touched here, but do not introduce violations.)
- `@trm/engine` must never gain `Date`/`Math.random`/unseeded randomness. (This plan does not touch the engine.)
- `apps/web` pins **Vite ^5** — do not bump.
- **Never `git add -A` / `git add .`** in this worktree — stage only the exact files each task changed (other agents may be working here). Every commit step lists explicit paths.
- Adding an optional field to `GameContent`/`TicketDef`/`MapGeography` must **never** write the key as an explicit `undefined` (project uses `exactOptionalPropertyTypes`): omit the key entirely (spread-if-defined, or delete-the-key setters).
- UI ships **Traditional Chinese (primary) + English**; every new user-facing string goes through `apps/web/src/i18n/index.ts` in both locales.
- Validation issue codes are rendered by the web `ValidationPanel` as `t('builder.validation.<code>', params)` AND by `@trm/map-data`'s `formatIssue` (canonical English) — add both for every new code.
- Determinism/hash: a ticket without `view` and a geography without `defaultTicketView` must hash byte-identically to today. The pinned Taiwan hash in `packages/map-data/test/hash-extension.spec.ts` and `test/versions.spec.ts` must stay green.

---

### Task 1: `TicketView` type on `@trm/map-data`

**Files:**
- Modify: `packages/map-data/src/types.ts`

**Interfaces:**
- Produces: `TicketView = { mode: 'full' } | { mode: 'auto' } | { mode: 'zoom'; level: number }`; `TicketDef.view?: TicketView`; `MapGeography.defaultTicketView?: TicketView`. (Consumed by every later task.)

There is no behavior to test yet (types only); this task's deliverable is verified by `yarn workspace @trm/map-data typecheck` staying green and later tasks compiling against it.

- [ ] **Step 1: Add the `TicketView` type and the two optional fields**

In `packages/map-data/src/types.ts`, add the type just above `TicketDef` (after the `RouteDef` interface, before `TicketDef`):

```ts
/**
 * Presentation-only "displayed area" for a mission ticket's mini-map (ignored by the engine).
 *  - `full`  → the whole map (baseView).
 *  - `auto`  → auto-crop: the bounding box of the ticket's two cities, padded; always contains both.
 *  - `zoom`  → auto-frame centered on the midpoint of the two cities; `level` 0 (whole map) … 1 (tight).
 */
export type TicketView =
  | { readonly mode: 'full' }
  | { readonly mode: 'auto' }
  | { readonly mode: 'zoom'; readonly level: number };
```

Add `view?` to `TicketDef`:

```ts
export interface TicketDef {
  readonly id: TicketId;
  readonly a: CityId;
  readonly b: CityId;
  readonly value: number;
  readonly deck: 'LONG' | 'SHORT';
  /** Per-ticket displayed-area override; absent ⇒ inherit the map default (see MapGeography). */
  readonly view?: TicketView;
}
```

Add `defaultTicketView?` to `MapGeography` (after the `crop` field, inside the interface):

```ts
  /** Map-wide default displayed area for tickets that set no `view` of their own. */
  readonly defaultTicketView?: TicketView;
```

- [ ] **Step 2: Typecheck**

Run: `yarn workspace @trm/map-data typecheck`
Expected: PASS (no consumers broken — both fields are optional).

- [ ] **Step 3: Commit**

```bash
git add packages/map-data/src/types.ts
git commit -m "feat(map-data): TicketView type + optional ticket/geography display-area fields"
```

---

### Task 2: Display-area resolver (`ticket-view.ts`)

**Files:**
- Create: `packages/map-data/src/ticket-view.ts`
- Modify: `packages/map-data/src/index.ts` (add `export * from './ticket-view';`)
- Test: `packages/map-data/test/ticket-view.spec.ts`

**Interfaces:**
- Consumes: `TicketView`, `TicketDef`, `MapGeography` from `./types` (Task 1).
- Produces:
  - `interface ViewRect { x: number; y: number; w: number; h: number }`
  - `interface ViewXY { x: number; y: number }`
  - `TICKET_ZOOM_MIN = 0`, `TICKET_ZOOM_MAX = 1`
  - `ticketViewSpec(ticket: Pick<TicketDef,'view'>, geo?: Pick<MapGeography,'defaultTicketView'>): TicketView`
  - `ticketViewRect(spec: TicketView, a: ViewXY, b: ViewXY, base: ViewRect): ViewRect`
  - `ticketRect(ticket: Pick<TicketDef,'view'>, a: ViewXY, b: ViewXY, base: ViewRect, geo?: Pick<MapGeography,'defaultTicketView'>): ViewRect`

- [ ] **Step 1: Write the failing test**

Create `packages/map-data/test/ticket-view.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ticketViewSpec, ticketViewRect, ticketRect } from '../src/ticket-view';

const base = { x: 0, y: 0, w: 100, h: 100 };
const a = { x: 40, y: 40 };
const b = { x: 50, y: 50 };

describe('ticketViewSpec (precedence)', () => {
  it('uses the ticket view when present', () => {
    expect(ticketViewSpec({ view: { mode: 'zoom', level: 0.3 } }, { defaultTicketView: { mode: 'auto' } })).toEqual({
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
    expect(ticketViewRect({ mode: 'zoom', level: 1 }, a, b, base)).toEqual({ x: 36, y: 36, w: 18, h: 18 });
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/map-data test --run ticket-view`
Expected: FAIL (cannot resolve `../src/ticket-view`).

- [ ] **Step 3: Implement the resolver**

Create `packages/map-data/src/ticket-view.ts`:

```ts
import type { TicketDef, MapGeography, TicketView } from './types';

export interface ViewRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}
export interface ViewXY {
  readonly x: number;
  readonly y: number;
}

export const TICKET_ZOOM_MIN = 0;
export const TICKET_ZOOM_MAX = 1;

// Auto-crop tuning (board units, 0..100 space).
const AUTO_PAD_FRAC = 0.6; // padding as a fraction of the larger endpoint span
const AUTO_PAD_MIN = 8; // minimum padding on each side
const AUTO_MIN_SPAN = 25; // minimum box edge, so two near cities aren't a pinhole
const ZOOM_TIGHT_FRAC = 0.18; // box size at zoom level 1, as a fraction of baseView

const clampNum = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Shrink a rect to fit inside `base`, then slide it back inside `base`. */
function clampToBase(r: ViewRect, base: ViewRect): ViewRect {
  const w = Math.min(r.w, base.w);
  const h = Math.min(r.h, base.h);
  const x = clampNum(r.x, base.x, base.x + base.w - w);
  const y = clampNum(r.y, base.y, base.y + base.h - h);
  return { x, y, w, h };
}

const centeredRect = (cx: number, cy: number, w: number, h: number): ViewRect => ({
  x: cx - w / 2,
  y: cy - h / 2,
  w,
  h,
});

/** ticket.view ?? geography.defaultTicketView ?? whole-map. */
export function ticketViewSpec(
  ticket: Pick<TicketDef, 'view'>,
  geo?: Pick<MapGeography, 'defaultTicketView'>,
): TicketView {
  return ticket.view ?? geo?.defaultTicketView ?? { mode: 'full' };
}

/** Resolve a spec + the ticket's two endpoints into an SVG viewBox rectangle inside `base`. */
export function ticketViewRect(spec: TicketView, a: ViewXY, b: ViewXY, base: ViewRect): ViewRect {
  if (spec.mode === 'full') return base;

  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;

  if (spec.mode === 'auto') {
    const spanX = Math.abs(a.x - b.x);
    const spanY = Math.abs(a.y - b.y);
    const pad = Math.max(AUTO_PAD_MIN, AUTO_PAD_FRAC * Math.max(spanX, spanY));
    const w = Math.max(spanX + 2 * pad, AUTO_MIN_SPAN);
    const h = Math.max(spanY + 2 * pad, AUTO_MIN_SPAN);
    return clampToBase(centeredRect(cx, cy, w, h), base);
  }

  // zoom
  const level = clampNum(spec.level, TICKET_ZOOM_MIN, TICKET_ZOOM_MAX);
  const factor = 1 - level * (1 - ZOOM_TIGHT_FRAC);
  return clampToBase(centeredRect(cx, cy, base.w * factor, base.h * factor), base);
}

/** Convenience: resolve precedence and compute the rect in one call. */
export function ticketRect(
  ticket: Pick<TicketDef, 'view'>,
  a: ViewXY,
  b: ViewXY,
  base: ViewRect,
  geo?: Pick<MapGeography, 'defaultTicketView'>,
): ViewRect {
  return ticketViewRect(ticketViewSpec(ticket, geo), a, b, base);
}
```

- [ ] **Step 4: Export it from the package barrel**

In `packages/map-data/src/index.ts`, add after `export * from './geometry';` (keep the existing block ordering):

```ts
export * from './ticket-view';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `yarn workspace @trm/map-data test --run ticket-view`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add packages/map-data/src/ticket-view.ts packages/map-data/src/index.ts packages/map-data/test/ticket-view.spec.ts
git commit -m "feat(map-data): ticket display-area resolver (full/auto/zoom → viewBox rect)"
```

---

### Task 3: Validation + hash tripwire

**Files:**
- Modify: `packages/map-data/src/validate.ts`
- Test: `packages/map-data/test/ticket-view.spec.ts` (append), `packages/map-data/test/hash-extension.spec.ts` (append)

**Interfaces:**
- Produces: `ticketViewIssues(view: TicketView, where: string): ValidationIssue[]`; new issue codes `ticketViewInvalidMode` (params `{ where, mode }`) and `ticketViewLevelOutOfRange` (params `{ where, level }`), wired into `validateContent` (per-ticket `view`) and `validateGeographyIssues` (geography `defaultTicketView`) and `formatIssue`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/map-data/test/ticket-view.spec.ts`:

```ts
import { ticketViewIssues } from '../src/validate';
import { formatIssue } from '../src/index';

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
    const bad = { mode: 'wat' } as unknown as import('../src/types').TicketView;
    expect(ticketViewIssues(bad, 'T1')[0]?.code).toBe('ticketViewInvalidMode');
  });
  it('formats the new codes in English', () => {
    expect(formatIssue({ code: 'ticketViewLevelOutOfRange', params: { where: 'T1', level: 2 } })).toContain(
      '[0, 1]',
    );
    expect(formatIssue({ code: 'ticketViewInvalidMode', params: { where: 'T1', mode: 'wat' } })).toContain('wat');
  });
});
```

Append to `packages/map-data/test/hash-extension.spec.ts` (inside the existing `describe`):

```ts
  it('a ticket view changes the hash; content without one hashes exactly as before', () => {
    const withView: GameContent = {
      ...TAIWAN_CONTENT,
      tickets: TAIWAN_CONTENT.tickets.map((t, i) => (i === 0 ? { ...t, view: { mode: 'auto' as const } } : t)),
    };
    expect(hashContent(withView)).not.toBe(PINNED_HASH);
    expect(hashContent({ ...TAIWAN_CONTENT })).toBe(PINNED_HASH);
  });

  it('a geography defaultTicketView changes the hash vs geography alone', () => {
    const geoOnly: GameContent = { ...TAIWAN_CONTENT, geography: GEO };
    const geoWithDefault: GameContent = {
      ...TAIWAN_CONTENT,
      geography: { ...GEO, defaultTicketView: { mode: 'auto' as const } },
    };
    expect(hashContent(geoWithDefault)).not.toBe(hashContent(geoOnly));
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn workspace @trm/map-data test --run ticket-view hash-extension`
Expected: FAIL (`ticketViewIssues` not exported; new `formatIssue` codes fall through to `default`).

- [ ] **Step 3: Implement the validator helper + wiring**

In `packages/map-data/src/validate.ts`:

Add the import at the top (join the existing type import from `./types`):

```ts
import type { GameContent, RouteDef, MapGeography, MapRules, TicketView } from './types';
```

Add two `formatIssue` cases (before the `default:` case in the `switch`):

```ts
    case 'ticketViewInvalidMode':
      return `${p.where}: unknown display-area mode ${p.mode}`;
    case 'ticketViewLevelOutOfRange':
      return `${p.where}: zoom level ${p.level} is outside the allowed range [0, 1]`;
```

Add the exported helper (place it just above `validateContent`):

```ts
/**
 * Structural check for a {@link TicketView} — a known `mode`, and for `zoom` a finite `level` in
 * [0,1]. `where` labels the offending object (a ticket id, or a token for the map default) so the
 * issue renders usefully. Accepts possibly-malformed authored data, hence the runtime mode check.
 */
export function ticketViewIssues(view: TicketView, where: string): ValidationIssue[] {
  const mode = (view as { mode?: unknown }).mode;
  if (mode !== 'full' && mode !== 'auto' && mode !== 'zoom') {
    return [{ code: 'ticketViewInvalidMode', params: { where, mode: String(mode) } }];
  }
  if (mode === 'zoom') {
    const level = (view as { level?: unknown }).level;
    if (typeof level !== 'number' || !Number.isFinite(level) || level < 0 || level > 1) {
      return [{ code: 'ticketViewLevelOutOfRange', params: { where, level: Number(level) } }];
    }
  }
  return [];
}
```

In `validateContent`, inside the existing `for (const t of tickets)` loop, after the `ticketValueNotPositive` check, add:

```ts
    if (t.view) for (const issue of ticketViewIssues(t.view, tid)) issues.push(issue);
```

In `validateGeographyIssues`, before the final `return issues;`, add:

```ts
  if (geo.defaultTicketView) {
    for (const issue of ticketViewIssues(geo.defaultTicketView, 'defaultTicketView')) push(issue.code, issue.params);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn workspace @trm/map-data test --run ticket-view hash-extension`
Expected: PASS.

- [ ] **Step 5: Run the whole map-data suite (guard the pinned hashes)**

Run: `yarn workspace @trm/map-data test`
Expected: PASS — including `versions.spec.ts` and `content.spec.ts` (Taiwan hash unchanged).

- [ ] **Step 6: Commit**

```bash
git add packages/map-data/src/validate.ts packages/map-data/test/ticket-view.spec.ts packages/map-data/test/hash-extension.spec.ts
git commit -m "feat(map-data): validate ticket display-area specs; hash tripwires"
```

---

### Task 4: `RoutePreview` → presentational, and rewire `TicketCard`

**Files:**
- Modify: `apps/web/src/components/RoutePreview.tsx`
- Modify: `apps/web/src/components/TicketCard.tsx`
- Test: `apps/web/src/components/RoutePreview.test.tsx`

**Interfaces:**
- Consumes: `ticketRect`, `smoothClosedPath`, `TicketView`, `MapGeography` from `@trm/map-data`; `ISLANDS`, `TAIWAN_LAND_PATH`, `CENTRAL_RANGE_PATH` from `../game/geography`; `CITIES`, `ROUTES`, `cityById` from `../game/content`; `ACTIVE_GEOGRAPHY`, `ACTIVE_BASE_VIEW` from `../game/catalog`.
- Produces: `RoutePreview(props: RoutePreviewProps)` where
  ```ts
  interface PreviewCity { id: string; x: number; y: number }
  interface RoutePreviewProps {
    a: PreviewCity; b: PreviewCity;
    cities: readonly PreviewCity[];
    routes: readonly { a: string; b: string }[];
    geography: MapGeography | null;               // null ⇒ draw the Taiwan silhouette
    baseView: { x: number; y: number; w: number; h: number };
    view?: TicketView;                            // per-ticket override
    tone: 'long' | 'short';
  }
  ```

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/RoutePreview.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { RoutePreview } from './RoutePreview';

const cities = [
  { id: 'a', x: 40, y: 40 },
  { id: 'b', x: 60, y: 60 },
];
const routes = [{ a: 'a', b: 'b' }];
const base = { x: 0, y: 0, w: 100, h: 100 };

describe('RoutePreview', () => {
  it('draws the Taiwan silhouette (relief) when geography is null', () => {
    const { container } = render(
      <RoutePreview a={cities[0]} b={cities[1]} cities={cities} routes={routes} geography={null} baseView={base} tone="short" />,
    );
    expect(container.querySelector('.rp-relief')).not.toBeNull();
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 100 100');
  });

  it('draws custom land rings and no Taiwan relief when geography is provided', () => {
    const geography = {
      baseView: base,
      crop: { lonMin: 0, lonMax: 1, latMin: 0, latMax: 1 },
      land: [[[0, 0], [20, 0], [20, 20], [0, 20]] as [number, number][]],
    };
    const { container } = render(
      <RoutePreview a={cities[0]} b={cities[1]} cities={cities} routes={routes} geography={geography} baseView={base} tone="short" />,
    );
    expect(container.querySelector('.rp-relief')).toBeNull();
    expect(container.querySelectorAll('.rp-geo .rp-land').length).toBe(1);
  });

  it('applies a per-ticket zoom view to the viewBox', () => {
    const { container } = render(
      <RoutePreview
        a={cities[0]}
        b={cities[1]}
        cities={cities}
        routes={routes}
        geography={null}
        baseView={base}
        view={{ mode: 'zoom', level: 1 }}
        tone="short"
      />,
    );
    // level 1 → 18×18 centered on (50,50)
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('41 41 18 18');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/web test --run RoutePreview`
Expected: FAIL (RoutePreview still requires `aId`/`bId` and reads globals; new props/`.rp-geo` don't exist).

- [ ] **Step 3: Rewrite `RoutePreview` as presentational**

Replace the entire contents of `apps/web/src/components/RoutePreview.tsx`:

```tsx
import { useMemo } from 'react';
import type { MapGeography, TicketView } from '@trm/map-data';
import { ticketRect, smoothClosedPath } from '@trm/map-data';
import { ISLANDS, TAIWAN_LAND_PATH, CENTRAL_RANGE_PATH } from '../game/geography';

export interface PreviewCity {
  id: string;
  x: number;
  y: number;
}

interface Props {
  a: PreviewCity;
  b: PreviewCity;
  cities: readonly PreviewCity[];
  routes: readonly { a: string; b: string }[];
  /** A custom map's cropped-world cartography, or null to draw the hand-authored Taiwan coast. */
  geography: MapGeography | null;
  baseView: { x: number; y: number; w: number; h: number };
  /** Per-ticket displayed-area override; resolved against the map default carried on `geography`. */
  view?: TicketView;
  /** 'long' tints the connection EMU-blue (long route), 'short' uses ember. */
  tone: 'long' | 'short';
}

/**
 * A miniature of the active board for a mission card: the map silhouette and the faint rail web for
 * context, then the two ticket endpoints pinned and joined by a gentle neutral arc (no specific path
 * is implied — any connection scores). Purely presentational: content, geography, and the displayed
 * area all arrive as props, so the same component draws the in-game card (from the active catalog)
 * and the builder's live preview (from the draft).
 */
export function RoutePreview({ a, b, cities, routes, geography, baseView, view, tone }: Props) {
  const net = useMemo(() => {
    const byId = new Map(cities.map((c) => [c.id, c]));
    let d = '';
    for (const r of routes) {
      const ca = byId.get(r.a);
      const cb = byId.get(r.b);
      if (ca && cb) d += `M${ca.x} ${ca.y}L${cb.x} ${cb.y}`;
    }
    return d;
  }, [cities, routes]);

  const rect = ticketRect({ view }, a, b, baseView, geography ?? undefined);
  const viewBox = `${rect.x} ${rect.y} ${rect.w} ${rect.h}`;

  // A gentle arc bowed perpendicular to the A–B line so it reads as "a connection", never as one
  // prescribed route.
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const bow = Math.min(14, len * 0.26);
  const sign = dx >= 0 ? -1 : 1;
  const cxp = mx + (-dy / len) * bow * sign;
  const cyp = my + (dx / len) * bow * sign;
  const arc = `M${a.x} ${a.y} Q${cxp} ${cyp} ${b.x} ${b.y}`;

  return (
    <svg
      viewBox={viewBox}
      className={`route-preview ${tone === 'long' ? 'rp-long' : 'rp-short'}`}
      role="img"
      aria-hidden
      focusable="false"
      preserveAspectRatio="xMidYMid meet"
    >
      {geography ? (
        <g className="rp-geo">
          {geography.land.map((ring, i) => (
            <path key={i} className="rp-land" d={smoothClosedPath(ring)} />
          ))}
        </g>
      ) : (
        <>
          <path className="rp-land-surf" d={TAIWAN_LAND_PATH} />
          <path className="rp-land" d={TAIWAN_LAND_PATH} />
          <path className="rp-relief" d={CENTRAL_RANGE_PATH} />
          <g className="rp-islands">
            {ISLANDS.map((b2, i) => (
              <circle key={i} cx={b2.cx} cy={b2.cy} r={b2.r} />
            ))}
          </g>
        </>
      )}

      <path className="rp-net" d={net} />

      <path className="rp-arc-casing" d={arc} />
      <path className="rp-arc" d={arc} />

      {[a, b].map((c) => (
        <g key={c.id} className="rp-pin">
          <circle className="rp-pin-halo" cx={c.x} cy={c.y} r="3.4" />
          <circle className="rp-pin-dot" cx={c.x} cy={c.y} r="1.7" />
          <circle className="rp-pin-core" cx={c.x} cy={c.y} r="0.7" />
        </g>
      ))}

      <g className="rp-cities">
        {cities.map((c) =>
          c.id === a.id || c.id === b.id ? null : (
            <circle key={c.id} cx={c.x} cy={c.y} r="0.5" />
          ),
        )}
      </g>
    </svg>
  );
}
```

- [ ] **Step 4: Rewire `TicketCard` to feed props from the active catalog**

In `apps/web/src/components/TicketCard.tsx`, update the imports and the `RoutePreview` usage.

Change the import block near the top to add catalog/content sources:

```tsx
import { useTranslation } from 'react-i18next';
import { ticketById, ticketLabel } from '../game/content';
import { CITIES, ROUTES, cityById } from '../game/content';
import { ACTIVE_GEOGRAPHY, ACTIVE_BASE_VIEW } from '../game/catalog';
import { useUi } from '../store/ui';
import { RoutePreview } from './RoutePreview';
```

Replace the `<RoutePreview aId=... bId=... tone=... />` line inside `body` with a block that resolves the two cities and passes the presentational props (place the `const a`/`const b` lookups just before the `const body = (` line, using `def`):

```tsx
  const a = cityById.get(def.a as string);
  const b = cityById.get(def.b as string);

  const body = (
    <>
      <div className="ticket-map">
        {a && b && (
          <RoutePreview
            a={a}
            b={b}
            cities={CITIES}
            routes={ROUTES}
            geography={ACTIVE_GEOGRAPHY}
            baseView={ACTIVE_BASE_VIEW}
            view={def.view}
            tone={tone}
          />
        )}
        {label.long && <span className="ticket-flag">{t('longRoute')}</span>}
        {selectable && <span className="ticket-check" aria-hidden />}
      </div>
      {/* …rest of body unchanged… */}
```

(`CITIES`/`ROUTES`/`cityById` are `CityDef[]`/`RouteDef[]` — their branded `id`/`a`/`b` are string subtypes, so they satisfy `PreviewCity`/`{a,b}` structurally. `def.view` is the per-ticket `TicketView`.)

- [ ] **Step 5: Run tests + typecheck**

Run: `yarn workspace @trm/web test --run RoutePreview`
Expected: PASS.
Run: `yarn workspace @trm/web typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/RoutePreview.tsx apps/web/src/components/RoutePreview.test.tsx apps/web/src/components/TicketCard.tsx
git commit -m "feat(web): ticket mini-map follows active geography + per-ticket display area"
```

---

### Task 5: Web draft types + editor store setters

**Files:**
- Modify: `apps/web/src/net/rest.ts`
- Modify: `apps/web/src/features/builder/editor/store.ts`
- Test: `apps/web/src/features/builder/editor/store.test.ts`

**Interfaces:**
- Consumes: `TicketView` from `@trm/map-data`.
- Produces: `TicketDraft.view?: TicketView`; `MapGeographyDraft.defaultTicketView?: TicketView`; store actions `setTicketView(id: string, view?: TicketView): void` and `setDefaultTicketView(view?: TicketView): void` (both undo/autosave-tracked; `undefined` **removes** the key).

- [ ] **Step 1: Write the failing test**

Append to `apps/web/src/features/builder/editor/store.test.ts` (reuse the file's existing `useEditorStore`/helpers; add a fresh `describe`):

```ts
import type { TicketView } from '@trm/map-data';

describe('display-area setters', () => {
  it('setTicketView sets and clears a ticket view (clearing removes the key)', () => {
    const s = useEditorStore.getState();
    // assumes a helper `ticket(...)` exists in this file; otherwise seed a draft directly:
    useEditorStore.setState({
      draft: { cities: [], routes: [], tickets: [{ id: 't1', a: 'a', b: 'b', value: 2, deck: 'SHORT' }] },
      undoStack: [],
      redoStack: [],
    });
    const view: TicketView = { mode: 'zoom', level: 0.4 };
    useEditorStore.getState().setTicketView('t1', view);
    expect(useEditorStore.getState().draft.tickets[0].view).toEqual(view);
    useEditorStore.getState().setTicketView('t1', undefined);
    expect('view' in useEditorStore.getState().draft.tickets[0]).toBe(false);
    void s;
  });

  it('setDefaultTicketView writes/removes the key on geography, no-op without geography', () => {
    useEditorStore.setState({
      draft: { cities: [], routes: [], tickets: [] },
      undoStack: [],
      redoStack: [],
    });
    useEditorStore.getState().setDefaultTicketView({ mode: 'auto' });
    expect(useEditorStore.getState().draft.geography).toBeUndefined(); // no geography → no-op

    useEditorStore.setState({
      draft: {
        cities: [],
        routes: [],
        tickets: [],
        geography: { baseView: { x: 0, y: 0, w: 10, h: 10 }, land: [], crop: { lonMin: 0, lonMax: 1, latMin: 0, latMax: 1 } },
      },
      undoStack: [],
      redoStack: [],
    });
    useEditorStore.getState().setDefaultTicketView({ mode: 'auto' });
    expect(useEditorStore.getState().draft.geography?.defaultTicketView).toEqual({ mode: 'auto' });
    useEditorStore.getState().setDefaultTicketView(undefined);
    expect('defaultTicketView' in (useEditorStore.getState().draft.geography ?? {})).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/web test --run store.test`
Expected: FAIL (`setTicketView`/`setDefaultTicketView` are not functions).

- [ ] **Step 3: Add the draft-type fields**

In `apps/web/src/net/rest.ts`:

Add an import for the shared type near the top (with the other `@trm/*` imports, or add a new line):

```ts
import type { TicketView } from '@trm/map-data';
```

Add `view?` to `TicketDraft`:

```ts
export interface TicketDraft {
  id: string;
  a: string;
  b: string;
  value: number;
  deck: 'LONG' | 'SHORT';
  /** Per-ticket displayed-area override for the mission mini-map; absent ⇒ inherit the map default. */
  view?: TicketView;
}
```

Add `defaultTicketView?` to `MapGeographyDraft`:

```ts
export interface MapGeographyDraft {
  baseView: { x: number; y: number; w: number; h: number };
  land: readonly (readonly (readonly [number, number])[])[];
  crop: { lonMin: number; lonMax: number; latMin: number; latMax: number };
  /** Map-wide default displayed area for tickets that set no `view`. */
  defaultTicketView?: TicketView;
}
```

- [ ] **Step 4: Add the store setters**

In `apps/web/src/features/builder/editor/store.ts`:

Add a `TicketView` import (extend the existing `@trm/map-data` import line — currently `import { BOW_LIMIT } from '@trm/map-data';`):

```ts
import { BOW_LIMIT } from '@trm/map-data';
import type { TicketView } from '@trm/map-data';
```

Declare the two actions in the `EditorState` interface, next to the other ticket actions (after `replaceTickets`):

```ts
  setTicketView(id: string, view?: TicketView): void;
  setDefaultTicketView(view?: TicketView): void;
```

Implement them in the store object, right after the `replaceTickets` implementation (before `setGeography`):

```ts
  setTicketView: (id, view) => {
    const { draft } = get();
    mutate(get, set, {
      ...draft,
      tickets: draft.tickets.map((t) => {
        if (t.id !== id) return t;
        if (view === undefined) {
          const { view: _drop, ...rest } = t;
          return rest;
        }
        return { ...t, view };
      }),
    });
  },
  setDefaultTicketView: (view) => {
    const { draft } = get();
    if (!draft.geography) return; // map default only meaningful once the map has geography
    if (view === undefined) {
      const { defaultTicketView: _drop, ...geo } = draft.geography;
      mutate(get, set, { ...draft, geography: geo });
    } else {
      mutate(get, set, { ...draft, geography: { ...draft.geography, defaultTicketView: view } });
    }
  },
```

- [ ] **Step 5: Run tests + typecheck**

Run: `yarn workspace @trm/web test --run store.test`
Expected: PASS.
Run: `yarn workspace @trm/web typecheck`
Expected: PASS (`contentAdapter.ts` carries `view` via its existing `...t` spread and `geography` whole — no change needed there).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/net/rest.ts apps/web/src/features/builder/editor/store.ts apps/web/src/features/builder/editor/store.test.ts
git commit -m "feat(web/builder): draft fields + store setters for ticket display areas"
```

---

### Task 6: Server zod schema

**Files:**
- Modify: `apps/server/src/maps/maps.schemas.ts`
- Test: `apps/server/test/maps-schema.spec.ts`

**Interfaces:**
- Produces: `TicketViewSchema` (discriminated union on `mode`; `zoom.level` finite in `[0,1]`); `.view` optional on `TicketDraftSchema` and `MapContentResponseSchema`'s ticket shape; `.defaultTicketView` optional on `MapGeographyDraftSchema`. `draftFromDto` needs no change (its `...t` ticket spread and whole-`geography` passthrough carry the new fields); `assembleContent`/`resolveForStart` (`maps.service.ts`) need no change.

- [ ] **Step 1: Write the failing test**

Create `apps/server/test/maps-schema.spec.ts`:

```ts
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
    expect(parsed.tickets[0].view).toEqual({ mode: 'auto' });
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/server test --run maps-schema`
Expected: FAIL (`TicketViewSchema` not exported; `view`/`defaultTicketView` stripped by zod).

- [ ] **Step 3: Add the schema**

In `apps/server/src/maps/maps.schemas.ts`, add the shared schema (after the `isRouteLength` helper, before `CityDraftSchema`):

```ts
export const TicketViewSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('full') }),
  z.object({ mode: z.literal('auto') }),
  z.object({ mode: z.literal('zoom'), level: z.number().finite().min(0).max(1) }),
]);
```

Add `.view` to `TicketDraftSchema`:

```ts
export const TicketDraftSchema = z.object({
  id: idString,
  a: idString,
  b: idString,
  value: z.number().int().min(1).max(50),
  deck: z.enum(['LONG', 'SHORT']),
  view: TicketViewSchema.optional(),
});
```

Add `.defaultTicketView` to `MapGeographyDraftSchema` (after the `crop` object):

```ts
  crop: z.object({
    lonMin: z.number().finite(),
    lonMax: z.number().finite(),
    latMin: z.number().finite(),
    latMax: z.number().finite(),
  }),
  defaultTicketView: TicketViewSchema.optional(),
});
```

Add `.view` to the ticket array in `MapContentResponseSchema` so the OpenAPI response shape is accurate (the endpoint returns raw content, but keep the doc honest):

```ts
  tickets: z.array(TicketDraftSchema),
```

(`MapContentResponseSchema` already references `TicketDraftSchema`, so this is covered by the `TicketDraftSchema` edit above — confirm it reads `z.array(TicketDraftSchema)`, and likewise `geography: MapGeographyDraftSchema.optional()`. No further edit needed if so.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn workspace @trm/server test --run maps-schema`
Expected: PASS.

- [ ] **Step 5: Run the maps e2e to confirm no regression**

Run: `yarn workspace @trm/server test --run maps.e2e`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/maps/maps.schemas.ts apps/server/test/maps-schema.spec.ts
git commit -m "feat(server): accept ticket display-area fields on custom-map drafts"
```

---

### Task 7: Builder Missions-stage authoring UI + live preview

**Files:**
- Modify: `apps/web/src/features/builder/editor/stages/MissionsStage.tsx`
- Modify: `apps/web/src/i18n/index.ts`

**Interfaces:**
- Consumes: store `setTicketView`/`setDefaultTicketView` (Task 5); `RoutePreview` + `PreviewCity` (Task 4); `TicketView` from `@trm/map-data`.
- Produces: per-ticket + map-default display-area controls and a live preview in the Missions stage. No new exported symbols.

- [ ] **Step 1: Add i18n keys (both locales)**

In `apps/web/src/i18n/index.ts`, add these keys inside the `builder` object for **zh-Hant** (near the existing `missions`/`autoGenerate` keys):

```ts
        displayArea: '顯示範圍',
        displayInherit: '沿用預設',
        displayFull: '整張地圖',
        displayAuto: '自動裁切',
        displayZoom: '縮放',
        mapDefaultFraming: '預設顯示範圍',
        zoomLevel: '縮放程度',
        ticketPreview: '任務預覽',
        selectTicketToPreview: '選擇一項任務以預覽',
```

And the matching **en** keys (near the English `missions`/`autoGenerate`):

```ts
        displayArea: 'Display area',
        displayInherit: 'Default',
        displayFull: 'Whole map',
        displayAuto: 'Auto-fit',
        displayZoom: 'Zoom',
        mapDefaultFraming: 'Default framing',
        zoomLevel: 'Zoom level',
        ticketPreview: 'Mission preview',
        selectTicketToPreview: 'Select a mission to preview',
```

Add the two validation strings under `builder.validation` for **zh-Hant**:

```ts
          ticketViewInvalidMode: '{{where}}：未知的顯示範圍模式 {{mode}}',
          ticketViewLevelOutOfRange: '{{where}}：縮放程度 {{level}} 超出範圍 [0, 1]',
```

…and for **en**:

```ts
          ticketViewInvalidMode: '{{where}}: unknown display-area mode {{mode}}',
          ticketViewLevelOutOfRange: '{{where}}: zoom level {{level}} out of range [0, 1]',
```

- [ ] **Step 2: Add the display-area controls + preview to MissionsStage**

In `apps/web/src/features/builder/editor/stages/MissionsStage.tsx`:

Extend the imports:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dices, Trash2, Wand2 } from 'lucide-react';
import { generateTickets } from '@trm/map-data';
import type { TicketView } from '@trm/map-data';
import { Segmented } from '../../../../components/ui/Segmented';
import { Dropdown, type DropdownOption } from '../../../../components/ui/Dropdown';
import { RoutePreview } from '../../../../components/RoutePreview';
import { useEditorStore } from '../store';
import { draftToContent } from '../contentAdapter';
import type { CityDraft, TicketDraft } from '../../../../net/rest';
```

Add a small mode helper above the `MissionsStage` component:

```tsx
type ViewMode = 'inherit' | 'full' | 'auto' | 'zoom';

const modeOf = (v?: TicketView): ViewMode => (v ? v.mode : 'inherit');
const levelOf = (v?: TicketView): number => (v && v.mode === 'zoom' ? v.level : 0.5);
/** Map a chosen mode (+ current level) to a TicketView, or undefined for "inherit". */
const toView = (mode: ViewMode, level: number): TicketView | undefined => {
  if (mode === 'inherit') return undefined;
  if (mode === 'zoom') return { mode: 'zoom', level };
  return { mode };
};
```

In the `MissionsStage` component body, pull the new store actions and preview selection state (add next to the existing `const … = useEditorStore(...)` lines and `useState`s):

```tsx
  const setTicketView = useEditorStore((s) => s.setTicketView);
  const setDefaultTicketView = useEditorStore((s) => s.setDefaultTicketView);
  const [previewId, setPreviewId] = useState<string | null>(null);
```

Add a reusable per-ticket control renderer inside the component (before the `return`):

```tsx
  const viewOptions: DropdownOption<ViewMode>[] = [
    { value: 'inherit', label: t('builder.displayInherit') },
    { value: 'full', label: t('builder.displayFull') },
    { value: 'auto', label: t('builder.displayAuto') },
    { value: 'zoom', label: t('builder.displayZoom') },
  ];
  // Map-default control shares the option list minus "inherit" (the default IS the fallback).
  const defaultViewOptions = viewOptions.filter((o) => o.value !== 'inherit');

  const defaultMode = modeOf(draft.geography?.defaultTicketView);
  const defaultLevel = levelOf(draft.geography?.defaultTicketView);

  const renderViewControl = (
    current: TicketView | undefined,
    onChange: (v: TicketView | undefined) => void,
    options: DropdownOption<ViewMode>[],
    ariaLabel: string,
  ) => {
    const mode = modeOf(current);
    const level = levelOf(current);
    return (
      <div className="row" style={{ gap: '0.4em', alignItems: 'center' }}>
        <Dropdown<ViewMode>
          options={options}
          value={mode}
          onChange={(m) => onChange(toView(m, level))}
          ariaLabel={ariaLabel}
        />
        {mode === 'zoom' && (
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={level}
            aria-label={t('builder.zoomLevel')}
            onChange={(e) => onChange({ mode: 'zoom', level: Number(e.target.value) })}
          />
        )}
      </div>
    );
  };
```

Add the map-default control inside the first `.card` div, just after the `row between` block that holds the Segmented + auto-generate button:

```tsx
        <div className="row between">
          <span className="muted">{t('builder.mapDefaultFraming')}</span>
          {draft.geography &&
            renderViewControl(
              draft.geography.defaultTicketView,
              (v) => setDefaultTicketView(v),
              defaultViewOptions,
              t('builder.mapDefaultFraming'),
            )}
        </div>
```

Add a header cell to the table `<thead>` row (before the empty `<th />`):

```tsx
                <th>{t('builder.value')}</th>
                <th>{t('builder.displayArea')}</th>
                <th />
```

Add the matching per-row cell in the `rows.map(...)` `<tr>` (after the value `<td>`, before the delete `<td>`), and make the row click select it for preview:

```tsx
              {rows.map((tk) => (
                <tr
                  key={tk.id}
                  onClick={() => setPreviewId(tk.id)}
                  className={previewId === tk.id ? 'is-selected' : undefined}
                >
                  <td>{cityName(tk.a)}</td>
                  <td>{cityName(tk.b)}</td>
                  <td>{tk.value}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {renderViewControl(
                      tk.view,
                      (v) => setTicketView(tk.id, v),
                      viewOptions,
                      t('builder.displayArea'),
                    )}
                  </td>
                  <td>
                    <button
                      className="icon-btn"
                      onClick={() => removeTicket(tk.id)}
                      aria-label={t('builder.deleteTicket')}
                    >
                      <Trash2 size={14} aria-hidden />
                    </button>
                  </td>
                </tr>
              ))}
```

(The new input-row `<tr>` at the bottom of `<tbody>` needs one extra empty `<td />` so its column count matches — add a `<td />` after the value input cell and before the add-button cell.)

Add the live preview panel after the closing `</table>`'s wrapping `.editor-table-scroll` div (still inside the `.card`):

```tsx
        {(() => {
          const geo = draft.geography;
          const tk = draft.tickets.find((x) => x.id === previewId) ?? rows[0];
          const a = tk && draft.cities.find((c) => c.id === tk.a);
          const b = tk && draft.cities.find((c) => c.id === tk.b);
          if (!geo || !tk || !a || !b) {
            return <p className="muted">{t('builder.selectTicketToPreview')}</p>;
          }
          return (
            <div className="editor-ticket-preview">
              <span className="muted">{t('builder.ticketPreview')}</span>
              <div className="ticket-map">
                <RoutePreview
                  a={{ id: a.id, x: a.x, y: a.y }}
                  b={{ id: b.id, x: b.x, y: b.y }}
                  cities={draft.cities}
                  routes={draft.routes}
                  geography={geo}
                  baseView={geo.baseView}
                  view={tk.view}
                  tone={tk.deck === 'LONG' ? 'long' : 'short'}
                />
              </div>
            </div>
          );
        })()}
```

(`draft.cities` are `CityDraft` (`id`/`x`/`y` strings/numbers) — assignable to `readonly PreviewCity[]`; `draft.routes` provide `{a,b}`. `geo` is `MapGeographyDraft`, structurally a `MapGeography`.)

- [ ] **Step 3: Typecheck + run the builder tests**

Run: `yarn workspace @trm/web typecheck`
Expected: PASS.
Run: `yarn workspace @trm/web test --run MissionsStage store.test RoutePreview`
Expected: PASS (existing MissionsStage tests still pass; if a test asserts a fixed column count, update it to include the new Display column).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/builder/editor/stages/MissionsStage.tsx apps/web/src/i18n/index.ts
git commit -m "feat(web/builder): per-ticket + map-default display-area authoring with live preview"
```

---

### Task 8: Full-repo gate + manual verification

**Files:** none (validation only)

- [ ] **Step 1: Typecheck + lint + test + format across all workspaces**

Run: `yarn typecheck`
Expected: PASS.
Run: `yarn lint`
Expected: PASS (engine purity + eslint rules).
Run: `yarn test`
Expected: PASS (all workspaces, incl. map-data pinned-hash/version specs and web/server suites).
Run: `yarn format:check`
Expected: PASS (run `yarn format` first if it flags files, then re-stage/commit).

- [ ] **Step 2: Manual smoke — the Taiwan game is unchanged**

Start the app (`docker compose up -d mongo`, `yarn workspace @trm/server dev`, `yarn workspace @trm/web dev`), start a Taiwan game, open the ticket chooser: mission cards render the Taiwan silhouette exactly as before (no per-ticket views set → whole-map fallback).

- [ ] **Step 3: Manual smoke — a custom map shows its own geography + framing**

With a `mapBuilder`-enabled account: open `/maps`, edit a non-Taiwan custom map, go to the **Missions** stage. Confirm: the map-default control changes framing; a ticket set to **Auto** or **Zoom** updates its live preview; save, start a game with that map, and confirm the in-game mission cards draw the **custom** land silhouette (not Taiwan) with each ticket's chosen displayed area. An untouched ticket uses the map default (or whole-map if none).

- [ ] **Step 4: Update graphify**

Run: `graphify update .`
(Keeps the knowledge graph current after the code changes, per the project's CLAUDE.md.)

- [ ] **Step 5: Final commit (if format/graphify produced changes)**

```bash
# stage only files this plan touched that format/graphify modified, then:
git commit -m "chore: formatting + graphify refresh for ticket display areas"
```

---

## Self-Review

**Spec coverage:**
- Correctness (custom geography on tickets) → Task 4 (RoutePreview presentational + TicketCard). ✓
- `TicketView` model (`full`/`auto`/`zoom`) + `defaultTicketView` → Task 1 (types), Task 2 (resolver). ✓
- Resolution precedence + whole-map fallback → Task 2 (`ticketViewSpec`/`ticketRect`) + tests. ✓
- Auto-crop + zoom math with constants → Task 2. ✓
- No `hashContent` change; absent fields hash identically → Task 3 (hash-extension cases). ✓
- Validation + issue codes + `formatIssue` + i18n → Task 3 (map-data) + Task 7 (i18n keys). ✓
- Rendering refactor to presentational → Task 4. ✓
- Authoring UI (map default + per-ticket + live preview) → Task 7. ✓
- Plumbing (web draft types, store setters, adapters, server zod, start seam) → Task 5 (web) + Task 6 (server); adapters/`assembleContent`/`resolveForStart` confirmed no-change (spread carries fields). ✓
- Testing across layers → Tasks 2/3 (map-data), 4 (web render), 5 (store), 6 (server schema), 8 (full gate + manual). ✓

**Placeholder scan:** No TBD/TODO; every code step shows the actual code; every command has an expected result. ✓

**Type consistency:** `TicketView` (Task 1) is the single type used by the resolver (Task 2), web draft types + store setters (Task 5), zod (`TicketViewSchema`, Task 6), `RoutePreview` props (Task 4), and the builder UI (Task 7). Resolver names (`ticketViewSpec`/`ticketViewRect`/`ticketRect`, `ViewRect`/`ViewXY`) are used identically in Tasks 2 and 4. Store action names (`setTicketView`/`setDefaultTicketView`) match between Task 5 (definition) and Task 7 (use). Issue codes (`ticketViewInvalidMode`/`ticketViewLevelOutOfRange`) match between Task 3 (`formatIssue`) and Task 7 (i18n keys). ✓
