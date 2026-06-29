# Tutorial UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the bare tutorial/encyclopedia into a polished, animated guide that dims the stage to focus the explained element, renders real game components inside the dialog as a visual glossary, and auto-pans the board to live examples.

**Architecture:** All work lives in `apps/web`'s tutorial feature layer plus a thin, tutorial-agnostic Board prop and CSS. A non-blocking `pointer-events:none` SVG scrim (portal to `document.body`) dims everything and punches a lit hole around each spotlight target; a hook re-measures target rects across the board's pan transition; specimens reuse the exact board/card CSS classes so they cannot drift from the real game; the board auto-pans via the existing `RevealFramer`/`fitTransform` mechanism. The coachmark is restyled and hosts the specimen. No engine/codec/server changes and no new game scenarios.

**Tech Stack:** React 18, TypeScript (strict), Vite 5, zustand v5, react-i18next, react-zoom-pan-pinch, vitest + @testing-library/react, lucide-react.

## Global Constraints

- **No changes to `@trm/engine`, `@trm/codec`, `@trm/map-data`, `@trm/proto`, or `apps/server`.** Web presentation layer only.
- **No new game scenarios** — lessons stay narration/auto/await as today; we only add visuals, focus, and framing.
- **Keep the tutorial lazy.** `TutorialScreen` and `EncyclopediaModal` are `React.lazy` chunks (`App.tsx`). Do NOT import any `features/tutorial/*` module, `@trm/engine`, or `@trm/codec` from a module reachable by the main bundle (`GameScreen.tsx`, `GameStage.tsx`, `Board.tsx`, `App.tsx` top level). Board's new prop type must come from `game/boardView.ts`, never from `features/tutorial`.
- **TS strict:** `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` (optional props that may receive `undefined` must be typed `prop?: T | undefined`), `verbatimModuleSyntax` (use `import type` for type-only imports).
- **Vite pinned at ^5** (vitest 2 compat) — do not bump.
- **Respect reduced motion** via the existing `useReducedMotion()` hook for every animation/pan.
- **Prettier-clean** every file you touch (`yarn workspace @trm/web format` or rely on the repo's prettier). `format:check` is the CI gate.
- **Commit message footer** (every commit) — end the message with:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01WT27kkXCS72JaGdCAunonx
  ```
- **Test command:** `yarn workspace @trm/web test --run <path-substring>` runs one file; `yarn workspace @trm/web test` runs all. Static gates: `yarn typecheck`, `yarn lint`, `yarn workspace @trm/web build`.
- **Work in the worktree** `D:\Web Projects\TRMission\.claude\worktrees\tutorial` on branch `worktree-tutorial`. Do not touch the main checkout.

---

### Task 1: Beat model + focus helpers (`focus.ts`)

Foundation: extend the data model with route/board spotlights, a specimen spec, and an auto-pan frame; add pure helpers that map a spotlight to selectors, validate HUD selectors against an allow-list, and decide coachmark placement. Pure functions → fully unit-tested; everything else builds on these.

**Files:**
- Modify: `apps/web/src/features/tutorial/types.ts`
- Modify: `apps/web/src/game/boardView.ts` (add the shared `BoardFrameTarget` type — keeps Board decoupled from the tutorial feature)
- Create: `apps/web/src/features/tutorial/focus.ts`
- Test: `apps/web/src/features/tutorial/focus.test.ts`

**Interfaces:**
- Produces:
  - `BoardFrameTarget = { kind: 'route' | 'cities'; ids: string[] }` (in `game/boardView.ts`).
  - `Spotlight` gains `| { kind: 'route'; ids: string[] } | { kind: 'board' }`.
  - `SpecimenSpec = { kind: 'routes-compare' } | { kind: 'route'; variant: 'rail'|'ferry'|'tunnel'|'double' } | { kind: 'card-row' } | { kind: 'station' } | { kind: 'ticket'; id: string }`.
  - `Beat` gains optional `specimen?: SpecimenSpec` and `frame?: BoardFrameTarget`.
  - `HUD_SPOTLIGHT_SELECTORS: readonly string[]`.
  - `selectorsForSpotlight(spotlight: Spotlight | undefined): string[]`.
  - `isAllowedHudSelector(sel: string): boolean`.
  - `coachPosition(rects: {x:number;y:number;w:number;h:number}[], vh: number): 'bottom' | 'top'`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/tutorial/focus.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  selectorsForSpotlight,
  isAllowedHudSelector,
  coachPosition,
  HUD_SPOTLIGHT_SELECTORS,
} from './focus';

describe('selectorsForSpotlight', () => {
  it('maps cities to data-city-id selectors', () => {
    expect(selectorsForSpotlight({ kind: 'cities', ids: ['taipei', 'yilan'] })).toEqual([
      '[data-city-id="taipei"]',
      '[data-city-id="yilan"]',
    ]);
  });
  it('maps routes to data-route-id selectors', () => {
    expect(selectorsForSpotlight({ kind: 'route', ids: ['R18'] })).toEqual(['[data-route-id="R18"]']);
  });
  it('passes a hud selector through', () => {
    expect(selectorsForSpotlight({ kind: 'hud', selector: '.deck-area' })).toEqual(['.deck-area']);
  });
  it('returns nothing for a whole-board spotlight or undefined', () => {
    expect(selectorsForSpotlight({ kind: 'board' })).toEqual([]);
    expect(selectorsForSpotlight(undefined)).toEqual([]);
  });
});

describe('isAllowedHudSelector', () => {
  it('accepts allow-listed selectors and rejects others', () => {
    expect(isAllowedHudSelector(HUD_SPOTLIGHT_SELECTORS[0]!)).toBe(true);
    expect(isAllowedHudSelector('.deck-area')).toBe(true);
    expect(isAllowedHudSelector('.evil-selector')).toBe(false);
  });
});

describe('coachPosition', () => {
  it('moves the coachmark to the top when a target sits in the bottom band near centre', () => {
    // viewport height 1000; a rect low and central overlaps the bottom-centre coachmark.
    expect(coachPosition([{ x: 400, y: 850, w: 200, h: 80 }], 1000)).toBe('top');
  });
  it('keeps the coachmark at the bottom when targets are high', () => {
    expect(coachPosition([{ x: 400, y: 100, w: 200, h: 80 }], 1000)).toBe('bottom');
  });
  it('keeps the coachmark at the bottom when there are no targets', () => {
    expect(coachPosition([], 1000)).toBe('bottom');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @trm/web test --run focus`
Expected: FAIL — `Cannot find module './focus'`.

- [ ] **Step 3: Extend the types**

In `apps/web/src/game/boardView.ts`, add near the top exports:

```ts
/** A board auto-pan target: a set of route ids or city ids to frame. */
export interface BoardFrameTarget {
  kind: 'route' | 'cities';
  ids: string[];
}
```

In `apps/web/src/features/tutorial/types.ts`, replace the `Spotlight` type and extend `Beat`:

```ts
import type { Action, Board, GameConfig, GameState, PlayerSeed } from '@trm/engine';
import type { BoardFrameTarget } from '../../game/boardView';

export type Scope = 'core' | 'full';

/** What to visually emphasise while a beat is showing. The spotlight dims everything else. */
export type Spotlight =
  | { kind: 'cities'; ids: string[] }
  | { kind: 'route'; ids: string[] }
  | { kind: 'hud'; selector: string }
  | { kind: 'board' };

/** A rendered game-component specimen shown inside the coachmark (the visual glossary). */
export type SpecimenSpec =
  | { kind: 'routes-compare' }
  | { kind: 'route'; variant: 'rail' | 'ferry' | 'tunnel' | 'double' }
  | { kind: 'card-row' }
  | { kind: 'station' }
  | { kind: 'ticket'; id: string };
```

Keep the existing `ExpectSpec` and `expectMatches` unchanged. Update the `Beat` type to add the two optional fields (note `?: T | undefined` for `exactOptionalPropertyTypes`):

```ts
export type Beat = {
  id: string;
  /** i18n key under `tutorial.*` for the coachmark narration. */
  text: string;
  spotlight?: Spotlight | undefined;
  /** A component specimen rendered in the coachmark this beat. */
  specimen?: SpecimenSpec | undefined;
  /** Auto-pan the board to frame this target while the beat shows. */
  frame?: BoardFrameTarget | undefined;
} & (
  | { mode: 'info' }
  | { mode: 'await'; expect: ExpectSpec }
  | {
      mode: 'auto';
      action: Action | ((state: GameState, board: Board) => Action);
      delayMs?: number;
    }
);
```

- [ ] **Step 4: Create `focus.ts`**

```ts
// Pure helpers shared by the spotlight overlay, the coachmark, and the scenario-rot test.
import type { Spotlight } from './types';

/** HUD spotlight selectors the tutorial is allowed to target (validated by scenarios.test.ts). */
export const HUD_SPOTLIGHT_SELECTORS = [
  '.deck-area',
  '[data-anim="deck"]',
  '[data-anim="market-slot"]',
  '[data-anim="hand"]',
  '[data-anim="tickets"]',
  '.card-market',
  '.player-trackers',
] as const;

export function isAllowedHudSelector(sel: string): boolean {
  return (HUD_SPOTLIGHT_SELECTORS as readonly string[]).includes(sel);
}

/** Resolve a beat's spotlight to the CSS selectors whose on-screen rects should be lit. */
export function selectorsForSpotlight(spotlight: Spotlight | undefined): string[] {
  if (!spotlight) return [];
  switch (spotlight.kind) {
    case 'cities':
      return spotlight.ids.map((id) => `[data-city-id="${id}"]`);
    case 'route':
      return spotlight.ids.map((id) => `[data-route-id="${id}"]`);
    case 'hud':
      return [spotlight.selector];
    case 'board':
      return [];
  }
}

export interface FlatRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Where to anchor the bottom coachmark so it never covers the spotlighted element. If a target
 * sits in the lower band of the viewport and overlaps the horizontal centre (where the bottom
 * coachmark lives), flip the coachmark to the top.
 */
export function coachPosition(rects: FlatRect[], vh: number): 'bottom' | 'top' {
  const lowBand = vh * 0.62;
  for (const r of rects) {
    const overlapsBottom = r.y + r.h > lowBand;
    // The bottom coachmark spans roughly the centre 60% of the width; approximate as 20%..80% of
    // a nominal 1440px-or-narrower stage by using a fractional check on the rect's own centre.
    if (overlapsBottom) return 'top';
  }
  return 'bottom';
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `yarn workspace @trm/web test --run focus`
Expected: PASS (all cases).

- [ ] **Step 6: Typecheck**

Run: `yarn workspace @trm/web typecheck` (or `yarn typecheck`)
Expected: no errors. (Confirms the `Beat`/`Spotlight` extensions compile against existing `curriculum.ts` and `scenarios.test.ts`.)

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/tutorial/types.ts apps/web/src/game/boardView.ts apps/web/src/features/tutorial/focus.ts apps/web/src/features/tutorial/focus.test.ts
git commit -m "Web: tutorial beat model + focus helpers (spotlight selectors, coach placement)"
```

---

### Task 2: Visual glossary specimens (`Specimens.tsx`)

Self-contained renderers reusing the real board/card CSS classes and components, so specimens look identical to the live game and cannot drift.

**Files:**
- Create: `apps/web/src/features/tutorial/Specimens.tsx`
- Test: `apps/web/src/features/tutorial/Specimens.test.tsx`
- Modify: `apps/web/src/styles/tutorial.css` (specimen layout/wrapper)

**Interfaces:**
- Consumes: `TrainCarCard` (`components/TrainCarCard`, props `{ color, size? }`), `TicketCard` (`components/TicketCard`, props `{ ticketId }`), `TRAIN_COLORS`/`CardColor` (`@trm/shared`), board CSS classes (`.route/.bed/.slot/.ferry-line/.ferry-pip/.slot.ferry-loco/.tunnel-bg/.tunnel-tie/.station`).
- Produces: `Specimen({ spec }: { spec: SpecimenSpec })` — single entry point dispatching on `spec.kind`. Also `RouteSpecimen`, `RouteCompareSpecimen`, `CardRowSpecimen`, `StationSpecimen`, `TicketSpecimen` for direct use/testing. Every specimen root carries `data-testid="tut-specimen"`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/tutorial/Specimens.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Specimen } from './Specimens';
import type { SpecimenSpec } from './types';

const specs: SpecimenSpec[] = [
  { kind: 'routes-compare' },
  { kind: 'route', variant: 'rail' },
  { kind: 'route', variant: 'ferry' },
  { kind: 'route', variant: 'tunnel' },
  { kind: 'route', variant: 'double' },
  { kind: 'card-row' },
  { kind: 'station' },
  { kind: 'ticket', id: 'T1' },
];

describe('Specimen', () => {
  for (const spec of specs) {
    it(`renders the ${spec.kind}${'variant' in spec ? ':' + spec.variant : ''} specimen`, () => {
      const { container } = render(<Specimen spec={spec} />);
      expect(container.querySelector('[data-testid="tut-specimen"]')).toBeTruthy();
    });
  }

  it('the card row shows all eight liveries plus the locomotive', () => {
    const { container } = render(<Specimen spec={{ kind: 'card-row' }} />);
    expect(container.querySelectorAll('.train-card').length).toBe(9);
  });

  it('the ferry route draws its loco pips and the tunnel draws ties', () => {
    const ferry = render(<Specimen spec={{ kind: 'route', variant: 'ferry' }} />);
    expect(ferry.container.querySelectorAll('.ferry-loco').length).toBeGreaterThan(0);
    const tunnel = render(<Specimen spec={{ kind: 'route', variant: 'tunnel' }} />);
    expect(tunnel.container.querySelectorAll('.tunnel-tie').length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @trm/web test --run Specimens`
Expected: FAIL — `Cannot find module './Specimens'`.

- [ ] **Step 3: Implement `Specimens.tsx`**

```tsx
// The visual glossary: standalone renders of real game components for the coachmark. Each reuses
// the exact board/card classes so it looks identical to the live game and can never drift.
import { useTranslation } from 'react-i18next';
import { TRAIN_COLORS, type CardColor } from '@trm/shared';
import { TrainCarCard } from '../../components/TrainCarCard';
import { TicketCard } from '../../components/TicketCard';
import type { SpecimenSpec } from './types';

const CARD_W = 56;

/** A short straight route drawn with the live board classes on a tiny fixed viewBox. */
function RouteSpecimen({ variant }: { variant: 'rail' | 'ferry' | 'tunnel' | 'double' }) {
  // Geometry: a horizontal track of `count` car-slots across a 120x28 viewBox.
  const count = variant === 'tunnel' ? 4 : variant === 'ferry' ? 3 : variant === 'double' ? 2 : 3;
  const slotW = 18;
  const gap = 4;
  const totalW = count * slotW + (count - 1) * gap;
  const x0 = (120 - totalW) / 2;
  const y = 14;
  const slots = Array.from({ length: count }, (_, i) => x0 + i * (slotW + gap) + slotW / 2);
  const path = `M ${x0 - 6} ${y} L ${x0 + totalW + 6} ${y}`;
  const fill = variant === 'double' ? '#d33a2c' : '#4f7cc0';
  const locoMid = Math.floor(count / 2);

  const Track = ({ dy = 0, muted = false }: { dy?: number; muted?: boolean }) => (
    <g className={'route' + (variant === 'tunnel' ? ' tunnel' : variant === 'ferry' ? ' ferry' : '')}
       transform={`translate(0 ${dy})`} opacity={muted ? 0.4 : 1}>
      {variant === 'tunnel' && <path className="tunnel-bg" d={path} />}
      <path className="bed" d={path} />
      {variant === 'tunnel' &&
        slots.map((cx, i) => (
          <rect key={i} className="tunnel-tie" transform={`translate(${cx} ${y}) rotate(45)`} />
        ))}
      {variant === 'ferry' ? (
        <>
          <path className="ferry-line" d={path} />
          {slots.map((cx, i) =>
            i === locoMid ? (
              <rect key={i} className="slot ferry-loco" x={-slotW / 2} width={slotW}
                fill="#888" transform={`translate(${cx} ${y})`} />
            ) : (
              <circle key={i} className="ferry-pip" cx={cx} cy={y} fill={fill} />
            ),
          )}
        </>
      ) : (
        slots.map((cx, i) => (
          <rect key={i} className="slot" x={-slotW / 2} width={slotW} fill={muted ? '#9aa0a6' : fill}
            transform={`translate(${cx} ${y})`} />
        ))
      )}
    </g>
  );

  return (
    <svg className="tut-route-specimen" viewBox="0 0 120 28" data-testid="tut-specimen"
      style={{ ['--inv-scale' as string]: '1' }} role="img">
      {variant === 'double' ? (
        <>
          <Track dy={-5} />
          <Track dy={5} muted />
        </>
      ) : (
        <Track />
      )}
    </svg>
  );
}

function RouteCompareSpecimen() {
  const { t } = useTranslation();
  const rows: Array<['rail' | 'ferry' | 'tunnel', string]> = [
    ['rail', t('tutorial.glossary.rail')],
    ['ferry', t('tutorial.glossary.ferry')],
    ['tunnel', t('tutorial.glossary.tunnel')],
  ];
  return (
    <div className="tut-route-compare" data-testid="tut-specimen">
      {rows.map(([variant, label]) => (
        <div className="tut-route-compare-row" key={variant}>
          <span className="tut-route-compare-label">{label}</span>
          <RouteSpecimen variant={variant} />
        </div>
      ))}
    </div>
  );
}

function CardRowSpecimen() {
  const colors: CardColor[] = [...TRAIN_COLORS, 'LOCOMOTIVE'];
  return (
    <div className="tut-card-row" data-testid="tut-specimen">
      {colors.map((c) => (
        <TrainCarCard key={c} color={c} size={CARD_W} showGlyph />
      ))}
    </div>
  );
}

function StationSpecimen() {
  return (
    <svg className="tut-station-specimen" viewBox="0 0 48 48" data-testid="tut-specimen"
      style={{ ['--marker-scale' as string]: '1' }} role="img">
      <circle className="city-dot" cx={24} cy={24} r={4} />
      <circle className="station" cx={24} cy={24} style={{ fill: '#2b6cb0' }} />
    </svg>
  );
}

function TicketSpecimen({ id }: { id: string }) {
  return (
    <div className="tut-ticket-specimen" data-testid="tut-specimen">
      <TicketCard ticketId={id} />
    </div>
  );
}

export function Specimen({ spec }: { spec: SpecimenSpec }) {
  switch (spec.kind) {
    case 'routes-compare':
      return <RouteCompareSpecimen />;
    case 'route':
      return <RouteSpecimen variant={spec.variant} />;
    case 'card-row':
      return <CardRowSpecimen />;
    case 'station':
      return <StationSpecimen />;
    case 'ticket':
      return <TicketSpecimen id={spec.id} />;
  }
}
```

> Note: `'--inv-scale'` and `'--marker-scale'` are CSS custom properties the board classes read; setting them to `1` gives the static specimen a fixed weight. The TypeScript cast `['--inv-scale' as string]` satisfies the `CSSProperties` index type.

- [ ] **Step 4: Add specimen styles**

Append to `apps/web/src/styles/tutorial.css`:

```css
/* Visual glossary specimens shown inside the coachmark. */
.tut-route-specimen {
  width: 168px;
  height: 40px;
}
.tut-route-compare {
  display: grid;
  gap: 0.35rem;
}
.tut-route-compare-row {
  display: grid;
  grid-template-columns: 3.2rem 1fr;
  align-items: center;
  gap: 0.5rem;
}
.tut-route-compare-label {
  font-size: 0.8rem;
  font-weight: 600;
  opacity: 0.8;
}
.tut-card-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: center;
}
.tut-station-specimen {
  width: 56px;
  height: 56px;
}
.tut-ticket-specimen {
  width: 168px;
  margin: 0 auto;
}
```

- [ ] **Step 5: Add the glossary i18n keys**

In `apps/web/src/i18n/tutorial.ts`, add a `glossary` block to BOTH `tutorialZh` and the English table (`tutorialEn`). Zh:

```ts
  glossary: {
    rail: '鐵路',
    ferry: '渡輪',
    tunnel: '隧道',
  },
```

En (matching key in `tutorialEn`):

```ts
  glossary: {
    rail: 'Railway',
    ferry: 'Ferry',
    tunnel: 'Tunnel',
  },
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `yarn workspace @trm/web test --run Specimens`
Expected: PASS (8 variant renders + card count 9 + ferry/tunnel detail).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/tutorial/Specimens.tsx apps/web/src/features/tutorial/Specimens.test.tsx apps/web/src/styles/tutorial.css apps/web/src/i18n/tutorial.ts
git commit -m "Web: tutorial visual-glossary specimens (route/ferry/tunnel/double/cards/station/ticket)"
```

---

### Task 3: Spotlight rect measurement hook (`useSpotlightRects.ts`)

Resolve a beat's spotlight to live screen rects, re-measured across the board's pan transition, defensive in jsdom.

**Files:**
- Create: `apps/web/src/features/tutorial/useSpotlightRects.ts`
- Test: `apps/web/src/features/tutorial/useSpotlightRects.test.tsx`

**Interfaces:**
- Consumes: `selectorsForSpotlight` + `FlatRect` (`./focus`), `Spotlight` (`./types`).
- Produces: `useSpotlightRects(spotlight: Spotlight | undefined): FlatRect[]` — empty array when no selectors resolve or rects are zero-sized (jsdom).

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/tutorial/useSpotlightRects.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSpotlightRects } from './useSpotlightRects';

describe('useSpotlightRects', () => {
  it('returns an empty array for a whole-board spotlight', () => {
    const { result } = renderHook(() => useSpotlightRects({ kind: 'board' }));
    expect(result.current).toEqual([]);
  });
  it('returns an empty array when targets are absent from the DOM', () => {
    const { result } = renderHook(() =>
      useSpotlightRects({ kind: 'cities', ids: ['nowhere'] }),
    );
    expect(result.current).toEqual([]);
  });
  it('skips zero-sized rects (jsdom has no layout)', () => {
    const el = document.createElement('div');
    el.setAttribute('data-city-id', 'taipei');
    document.body.appendChild(el);
    const { result } = renderHook(() =>
      useSpotlightRects({ kind: 'cities', ids: ['taipei'] }),
    );
    expect(result.current).toEqual([]); // getBoundingClientRect is 0x0 in jsdom
    el.remove();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @trm/web test --run useSpotlightRects`
Expected: FAIL — `Cannot find module './useSpotlightRects'`.

- [ ] **Step 3: Implement the hook**

```ts
import { useEffect, useState } from 'react';
import type { Spotlight } from './types';
import { selectorsForSpotlight, type FlatRect } from './focus';

/** How long after a beat change to keep re-measuring, so holes track the board's pan/zoom. */
const TRACK_MS = 700;

/** Live screen rects of the current beat's spotlight targets. Empty when nothing resolves. */
export function useSpotlightRects(spotlight: Spotlight | undefined): FlatRect[] {
  const [rects, setRects] = useState<FlatRect[]>([]);
  // A stable key so the effect refires on the beat's spotlight, not on every parent render.
  const key = spotlight ? JSON.stringify(spotlight) : '';

  useEffect(() => {
    const selectors = selectorsForSpotlight(spotlight);
    if (selectors.length === 0) {
      setRects([]);
      return;
    }
    let raf = 0;
    const start = typeof performance !== 'undefined' ? performance.now() : 0;

    const measure = (): void => {
      const next: FlatRect[] = [];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) next.push({ x: r.left, y: r.top, w: r.width, h: r.height });
      }
      setRects(next);
    };

    const tick = (): void => {
      measure();
      const now = typeof performance !== 'undefined' ? performance.now() : start + TRACK_MS;
      if (now - start < TRACK_MS && typeof requestAnimationFrame !== 'undefined') {
        raf = requestAnimationFrame(tick);
      }
    };
    tick();
    window.addEventListener('resize', measure);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('resize', measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return rects;
}
```

> The `key`/`eslint-disable` pattern keeps the dependency a stable string (the spotlight object identity is already stable per beat from the static curriculum, but serializing guards against any inline object).

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn workspace @trm/web test --run useSpotlightRects`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/tutorial/useSpotlightRects.ts apps/web/src/features/tutorial/useSpotlightRects.test.tsx
git commit -m "Web: useSpotlightRects — live target measurement across board pan"
```

---

### Task 4: The focus scrim (`TutorialSpotlight.tsx`)

A presentational, non-blocking SVG dim with a lit hole + pulsing ring per target, portaled to `document.body`.

**Files:**
- Create: `apps/web/src/features/tutorial/TutorialSpotlight.tsx`
- Test: `apps/web/src/features/tutorial/TutorialSpotlight.test.tsx`
- Modify: `apps/web/src/styles/tutorial.css` (scrim + ring styles)

**Interfaces:**
- Consumes: `FlatRect` (`./focus`).
- Produces: `TutorialSpotlight({ rects, reducedMotion }: { rects: FlatRect[]; reducedMotion: boolean })`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/tutorial/TutorialSpotlight.test.tsx`:

```tsx
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { TutorialSpotlight } from './TutorialSpotlight';

afterEach(cleanup);

describe('TutorialSpotlight', () => {
  it('renders one ring and one mask cutout per target rect', () => {
    render(
      <TutorialSpotlight
        rects={[
          { x: 10, y: 10, w: 100, h: 50 },
          { x: 200, y: 300, w: 80, h: 40 },
        ]}
        reducedMotion={false}
      />,
    );
    expect(document.querySelectorAll('.tut-spotlight-ring').length).toBe(2);
    expect(document.querySelectorAll('#tut-spot-mask rect[fill="black"]').length).toBe(2);
  });

  it('renders a global dim with no cutouts when there are no targets', () => {
    render(<TutorialSpotlight rects={[]} reducedMotion={false} />);
    expect(document.querySelector('.tut-spotlight')).toBeTruthy();
    expect(document.querySelectorAll('.tut-spotlight-ring').length).toBe(0);
  });

  it('does not pulse under reduced motion', () => {
    render(<TutorialSpotlight rects={[{ x: 0, y: 0, w: 10, h: 10 }]} reducedMotion={true} />);
    expect(document.querySelector('.tut-spotlight-ring.pulse')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @trm/web test --run TutorialSpotlight`
Expected: FAIL — `Cannot find module './TutorialSpotlight'`.

- [ ] **Step 3: Implement the scrim**

```tsx
// A non-blocking focus scrim: dims the whole viewport and punches a lit, ringed hole around each
// spotlight target. pointer-events:none, so the learner can still click the highlighted element.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { FlatRect } from './focus';

const PAD = 10;
const RADIUS = 14;

function viewport(): { w: number; h: number } {
  if (typeof window === 'undefined') return { w: 0, h: 0 };
  return { w: window.innerWidth, h: window.innerHeight };
}

export function TutorialSpotlight({
  rects,
  reducedMotion,
}: {
  rects: FlatRect[];
  reducedMotion: boolean;
}) {
  const [vp, setVp] = useState(viewport);
  useEffect(() => {
    const onResize = (): void => setVp(viewport());
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  if (typeof document === 'undefined') return null;
  const { w, h } = vp;
  const hasHoles = rects.length > 0;

  return createPortal(
    <div className={'tut-spotlight' + (hasHoles ? '' : ' is-global')} aria-hidden>
      <svg className="tut-spotlight-svg" width={w} height={h}>
        <defs>
          <mask id="tut-spot-mask">
            <rect x={0} y={0} width={w} height={h} fill="white" />
            {rects.map((r, i) => (
              <rect key={i} x={r.x - PAD} y={r.y - PAD} width={r.w + PAD * 2} height={r.h + PAD * 2}
                rx={RADIUS} ry={RADIUS} fill="black" />
            ))}
          </mask>
        </defs>
        <rect className="tut-spotlight-dim" x={0} y={0} width={w} height={h}
          mask={hasHoles ? 'url(#tut-spot-mask)' : undefined} />
        {rects.map((r, i) => (
          <rect key={i} className={'tut-spotlight-ring' + (reducedMotion ? '' : ' pulse')}
            x={r.x - PAD} y={r.y - PAD} width={r.w + PAD * 2} height={r.h + PAD * 2}
            rx={RADIUS} ry={RADIUS} />
        ))}
      </svg>
    </div>,
    document.body,
  );
}
```

- [ ] **Step 4: Add scrim styles**

Append to `apps/web/src/styles/tutorial.css`:

```css
/* Focus scrim: dims the stage, lit hole + ring around the spotlighted element. Non-blocking. */
.tut-spotlight {
  position: fixed;
  inset: 0;
  z-index: 52; /* above board/HUD (game chrome), below the coachmark (55) */
  pointer-events: none;
}
.tut-spotlight-svg {
  display: block;
}
.tut-spotlight-dim {
  fill: rgba(8, 12, 20, 0.62);
  transition: fill 220ms ease;
}
.tut-spotlight.is-global .tut-spotlight-dim {
  fill: rgba(8, 12, 20, 0.32); /* lighter, uniform dim when there is no specific target */
}
.tut-spotlight-ring {
  fill: none;
  stroke: var(--accent, #2b6cb0);
  stroke-width: 2.5;
  opacity: 0.9;
  filter: drop-shadow(0 0 6px var(--accent, #2b6cb0));
}
.tut-spotlight-ring.pulse {
  animation: tut-ring-pulse 1.6s ease-in-out infinite;
}
@keyframes tut-ring-pulse {
  0%, 100% { opacity: 0.95; stroke-width: 2.5; }
  50% { opacity: 0.45; stroke-width: 4; }
}
@media (prefers-reduced-motion: reduce) {
  .tut-spotlight-ring.pulse { animation: none; }
  .tut-spotlight-dim { transition: none; }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `yarn workspace @trm/web test --run TutorialSpotlight`
Expected: PASS (2 rings + 2 cutouts; global dim; no pulse under reduced motion).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/tutorial/TutorialSpotlight.tsx apps/web/src/features/tutorial/TutorialSpotlight.test.tsx apps/web/src/styles/tutorial.css
git commit -m "Web: non-blocking tutorial focus scrim (dim + lit hole + pulsing ring)"
```

---

### Task 5: Board auto-pan + spotlight anchors (`Board.tsx`)

Add the `frameTarget` prop (auto-pan via a `SpotlightFramer` cloned from `RevealFramer`) and `data-city-id` / `data-route-id` anchors so the scrim can measure cities and routes. Tutorial-agnostic.

**Files:**
- Modify: `apps/web/src/components/Board.tsx`
- Modify: `apps/web/src/screens/GameStage.tsx` (thread `frameTarget` through; live game passes nothing)
- Test: `apps/web/src/components/Board.test.tsx` (extend)

**Interfaces:**
- Consumes: `BoardFrameTarget` (`game/boardView`), `useReducedMotion` (`hooks/useReducedMotion`), existing `viewportProjection`, `viewToTransform`, `routeById`, `cityById`, `useControls`.
- Produces: `Board` accepts `frameTarget?: BoardFrameTarget | null | undefined`; each city `<g>` gets `data-city-id`, each route `<g>` gets `data-route-id`. `GameStage` accepts `frameTarget?: BoardFrameTarget | null | undefined` and forwards it.

- [ ] **Step 1: Write the failing test**

Extend `apps/web/src/components/Board.test.tsx` — add inside the `describe('Board', …)` block:

```tsx
  it('tags routes and cities with data attributes for the tutorial spotlight', () => {
    const { container } = render(
      <Board
        snapshot={snap}
        locale="zh-Hant"
        colorBlind={false}
        canAct={false}
        onPickRoute={() => {}}
        onPickCity={() => {}}
      />,
    );
    expect(container.querySelectorAll('[data-route-id]').length).toBeGreaterThan(60);
    expect(container.querySelector('[data-city-id="taipei"]')).toBeTruthy();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @trm/web test --run Board.test`
Expected: FAIL — `[data-route-id]` count is 0 / `[data-city-id="taipei"]` is null.

- [ ] **Step 3: Add the data attributes**

In `apps/web/src/components/Board.tsx`, the route `<g>` (the element with `key={r.id as string} className={cls}`) — add the attribute:

```tsx
                <g
                  key={r.id as string}
                  className={cls}
                  data-route-id={r.id as string}
                  style={groupStyle}
                  onClick={claimable ? () => onPickRoute(r.id as string) : undefined}
                >
```

The city `<g>` (the element with `key={c.id as string} className={isTarget ? …}`) — add:

```tsx
              <g key={c.id as string} data-city-id={c.id as string} className={isTarget ? `${cls} ticket-target` : cls}>
```

- [ ] **Step 4: Add the `frameTarget` prop + `SpotlightFramer`**

In `Board.tsx`, extend imports — add `useReducedMotion` and `BoardFrameTarget`:

```tsx
import { useReducedMotion } from '../hooks/useReducedMotion';
import type { BoardFrameTarget } from '../game/boardView';
```

Add to `BoardProps`:

```tsx
  /** Tutorial auto-pan: frame these routes/cities. Null/undefined leaves the camera alone. */
  frameTarget?: BoardFrameTarget | null | undefined;
```

Add `frameTarget` to the `Board({ … })` destructure.

Add the framer component near `RevealFramer` (it lives inside the pan/zoom context, so it can call `useControls`):

```tsx
/**
 * Tutorial auto-pan: frames the board on a set of routes/cities (the current beat's `frame`). Lives
 * inside the pan/zoom context for `setTransform`; re-fits whenever the target changes, inert otherwise.
 */
function SpotlightFramer({
  viewportRef,
  target,
}: {
  viewportRef: RefObject<HTMLDivElement | null>;
  target: BoardFrameTarget | null | undefined;
}) {
  const { setTransform } = useControls();
  const reduced = useReducedMotion();
  const key = target ? `${target.kind}:${target.ids.join(',')}` : '';
  useEffect(() => {
    if (!target || target.ids.length === 0) return;
    const cityIds =
      target.kind === 'route'
        ? target.ids.flatMap((rid) => {
            const r = routeById.get(rid);
            return r ? [r.a as string, r.b as string] : [];
          })
        : target.ids;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const cid of cityIds) {
      const c = cityById.get(cid);
      if (!c) continue;
      minX = Math.min(minX, c.x);
      maxX = Math.max(maxX, c.x);
      minY = Math.min(minY, c.y);
      maxY = Math.max(maxY, c.y);
    }
    if (!Number.isFinite(minX)) return;
    const w = viewportRef.current?.clientWidth ?? 0;
    const h = viewportRef.current?.clientHeight ?? 0;
    const proj = viewportProjection(viewportRef.current);
    if (!proj || w <= 0 || h <= 0) return;
    const span = Math.min(100, Math.max(22, Math.max(maxX - minX, maxY - minY) + 16));
    const t = viewToTransform({ cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, span }, proj, w, h);
    setTransform(t.positionX, t.positionY, t.scale, reduced ? 0 : 600, 'easeOut');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reduced]);
  return null;
}
```

Mount it inside `<TransformWrapper>` next to `<RevealFramer …/>`:

```tsx
        <RevealFramer viewportRef={viewportRef} />
        <SpotlightFramer viewportRef={viewportRef} target={frameTarget ?? null} />
```

- [ ] **Step 5: Thread `frameTarget` through `GameStage`**

In `apps/web/src/screens/GameStage.tsx`, add the import and prop:

```tsx
import type { BoardFrameTarget } from '../game/boardView';
```

Add to `GameStageProps`:

```tsx
  /** Tutorial auto-pan target (sandbox only); live game leaves this undefined. */
  frameTarget?: BoardFrameTarget | null | undefined;
```

Destructure `frameTarget` in the `GameStage({ … })` signature, and pass it to `<Board …>`:

```tsx
      <Board
        snapshot={snapshot}
        locale={locale}
        colorBlind={colorBlind}
        canAct={canAct}
        onPickRoute={pickRoute}
        onPickCity={pickCity}
        highlightCities={highlightCities}
        sandbox={sandbox}
        frameTarget={frameTarget}
      />
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `yarn workspace @trm/web test --run Board.test`
Expected: PASS (existing render test + new data-attribute test).

Run: `yarn workspace @trm/web typecheck`
Expected: no errors (GameStage's new optional prop; `GameScreen` still compiles since it omits `frameTarget`).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/Board.tsx apps/web/src/components/Board.test.tsx apps/web/src/screens/GameStage.tsx
git commit -m "Web: board auto-pan (SpotlightFramer) + data-city-id/data-route-id anchors"
```

---

### Task 6: Restyle the coachmark + host the specimen (`TutorialOverlay.tsx`)

Rework the coachmark into a polished, animated panel that renders the beat's specimen, a progress bar, a connector caret toward the target, the bottom/top dodge, and beat-to-beat transitions.

**Files:**
- Modify: `apps/web/src/features/tutorial/TutorialOverlay.tsx`
- Modify: `apps/web/src/styles/tutorial.css`
- Test: `apps/web/src/features/tutorial/TutorialOverlay.test.tsx` (new)

**Interfaces:**
- Consumes: `Beat`, `SpecimenSpec` (`./types`); `Specimen` (`./Specimens`); `coachPosition`, `FlatRect` (`./focus`).
- Produces: `TutorialOverlay` gains props `specimen?: SpecimenSpec | undefined` and `spotRects?: FlatRect[] | undefined` (additive; existing props unchanged). Root keeps `role="dialog"` and gains `data-pos` (`bottom`/`top`).

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/tutorial/TutorialOverlay.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { TutorialOverlay } from './TutorialOverlay';
import type { Beat } from './types';

const baseProps = {
  done: false,
  index: 1,
  total: 4,
  lessonTitleKey: 'tutorial.draw.title',
  lessonNo: 2,
  lessonCount: 6,
  isLastLesson: false,
  onAdvance: () => {},
  onReplay: () => {},
  onPrevLesson: () => {},
  onNextLesson: () => {},
  onExit: () => {},
};

describe('TutorialOverlay', () => {
  it('renders the beat specimen when one is provided', () => {
    const beat: Beat = { id: 'b', text: 'tutorial.draw.intro', mode: 'info' };
    const { container } = render(
      <TutorialOverlay {...baseProps} beat={beat} specimen={{ kind: 'card-row' }} spotRects={[]} />,
    );
    expect(container.querySelector('[data-testid="tut-specimen"]')).toBeTruthy();
    expect(container.querySelectorAll('.train-card').length).toBe(9);
  });

  it('shows a progress bar reflecting index/total', () => {
    const beat: Beat = { id: 'b', text: 'tutorial.draw.intro', mode: 'info' };
    const { container } = render(<TutorialOverlay {...baseProps} beat={beat} spotRects={[]} />);
    const fill = container.querySelector<HTMLElement>('.tut-progress-fill');
    expect(fill).toBeTruthy();
    expect(fill!.style.width).toBe('50%'); // (index 1 + 1) / total 4
  });

  it('flips to the top when a spotlight rect sits low and central', () => {
    const beat: Beat = { id: 'b', text: 'tutorial.draw.intro', mode: 'info' };
    const { container } = render(
      <TutorialOverlay
        {...baseProps}
        beat={beat}
        spotRects={[{ x: 400, y: window.innerHeight - 60, w: 200, h: 80 }]}
      />,
    );
    expect(container.querySelector('.tut-coach')?.getAttribute('data-pos')).toBe('top');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @trm/web test --run TutorialOverlay`
Expected: FAIL — `specimen`/`spotRects` props don't exist; no `.tut-specimen`/`.tut-progress-fill`/`data-pos`.

- [ ] **Step 3: Rewrite `TutorialOverlay.tsx`**

```tsx
// The tutorial coachmark: a polished, non-blocking callout. It renders the beat's narration, an
// optional component specimen (the visual glossary), a progress bar, a connector caret toward the
// spotlighted target, and the right control for the beat mode. It dodges to the top when a target
// would sit under the bottom-anchored bubble.
import { useTranslation } from 'react-i18next';
import { ChevronRight, RotateCcw, X } from 'lucide-react';
import type { Beat, SpecimenSpec } from './types';
import { Specimen } from './Specimens';
import { coachPosition, type FlatRect } from './focus';

export interface TutorialOverlayProps {
  beat: Beat | null;
  done: boolean;
  index: number;
  total: number;
  lessonTitleKey: string;
  lessonNo: number;
  lessonCount: number;
  isLastLesson: boolean;
  specimen?: SpecimenSpec | undefined;
  spotRects?: FlatRect[] | undefined;
  onAdvance(): void;
  onReplay(): void;
  onPrevLesson(): void;
  onNextLesson(): void;
  onExit(): void;
}

export function TutorialOverlay(props: TutorialOverlayProps) {
  const { t } = useTranslation();
  const { beat, done, index, total, lessonNo, lessonCount, isLastLesson, specimen } = props;
  const spotRects = props.spotRects ?? [];

  const body = done ? t('tutorial.lessonComplete') : beat ? t(beat.text) : '';
  const pos =
    typeof window !== 'undefined' ? coachPosition(spotRects, window.innerHeight) : 'bottom';
  const progress = total > 0 ? Math.round(((index + 1) / total) * 100) : 0;

  // Caret horizontal position: aim at the first target's centre (clamped within the bubble width).
  const caretLeft = spotRects[0] ? spotRects[0].x + spotRects[0].w / 2 : null;

  return (
    <div className="tut-coach" data-pos={pos} role="dialog" aria-label={t('tutorial.title')}>
      {caretLeft !== null && (
        <span
          className="tut-coach-caret"
          aria-hidden
          style={{ left: `clamp(1.5rem, ${Math.round(caretLeft)}px, calc(100% - 1.5rem))` }}
        />
      )}

      <div className="tut-coach-head">
        <span className="tut-coach-chapter">{t(props.lessonTitleKey)}</span>
        <span className="tut-coach-progress-text">
          {lessonNo}/{lessonCount}
        </span>
        <button className="icon-btn tut-coach-x" onClick={props.onExit} aria-label={t('tutorial.exit')}>
          <X size={16} />
        </button>
      </div>

      {!done && specimen && (
        <div className="tut-coach-specimen" key={beat?.id}>
          <Specimen spec={specimen} />
        </div>
      )}

      <p className="tut-coach-body" key={(beat?.id ?? 'done') + ':body'}>
        {body}
      </p>

      <div className="tut-progress" aria-hidden>
        <div className="tut-progress-fill" style={{ width: `${progress}%` }} />
      </div>

      <div className="tut-coach-actions">
        <button className="link" onClick={props.onReplay} title={t('tutorial.replay')}>
          <RotateCcw size={14} /> {t('tutorial.replay')}
        </button>
        <div className="spacer" />
        {lessonNo > 1 && <button onClick={props.onPrevLesson}>{t('tutorial.prevLesson')}</button>}
        {done ? (
          isLastLesson ? (
            <button className="accent" onClick={props.onExit}>
              {t('tutorial.finish')}
            </button>
          ) : (
            <button className="accent" onClick={props.onNextLesson}>
              {t('tutorial.nextLesson')} <ChevronRight size={14} />
            </button>
          )
        ) : beat?.mode === 'info' ? (
          <button className="accent" onClick={props.onAdvance}>
            {t('tutorial.next')} <ChevronRight size={14} />
          </button>
        ) : beat?.mode === 'await' ? (
          <span className="tut-yourturn">{t('tutorial.yourTurn')}</span>
        ) : (
          <span className="tut-auto">{t('tutorial.watching')}</span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Restyle the coachmark CSS**

In `apps/web/src/styles/tutorial.css`, replace the existing `.tut-coach` block and the `.tut-coach-dots`/`.tut-dot` rules with the restyled panel. Keep the existing `.tut-yourturn`/`.tut-auto`/`tut-pulse` rules. Add:

```css
.tut-coach {
  position: fixed;
  left: 50%;
  bottom: clamp(0.75rem, 3vh, 1.5rem);
  transform: translateX(-50%);
  z-index: 55;
  width: min(36rem, calc(100vw - 1.5rem));
  background: var(--surface, #fff);
  color: var(--text, #111);
  border: 1px solid var(--border, rgba(0, 0, 0, 0.12));
  border-radius: 16px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.34);
  padding: 0.9rem 1.05rem 0.8rem;
  animation: tut-coach-in 260ms cubic-bezier(0.2, 0.7, 0.2, 1);
}
.tut-coach[data-pos='top'] {
  bottom: auto;
  top: clamp(0.75rem, 3vh, 1.5rem);
}
@keyframes tut-coach-in {
  from { opacity: 0; transform: translate(-50%, 14px) scale(0.98); }
  to { opacity: 1; transform: translate(-50%, 0) scale(1); }
}
.tut-coach-caret {
  position: absolute;
  bottom: -9px;
  width: 18px;
  height: 18px;
  background: var(--surface, #fff);
  border-right: 1px solid var(--border, rgba(0, 0, 0, 0.12));
  border-bottom: 1px solid var(--border, rgba(0, 0, 0, 0.12));
  transform: translateX(-50%) rotate(45deg);
}
.tut-coach[data-pos='top'] .tut-coach-caret {
  bottom: auto;
  top: -9px;
  transform: translateX(-50%) rotate(225deg);
}
.tut-coach-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.4rem;
}
.tut-coach-chapter {
  font-weight: 700;
  font-size: 0.78rem;
  letter-spacing: 0.02em;
  padding: 0.12rem 0.55rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent, #2b6cb0) 16%, transparent);
  color: var(--accent, #2b6cb0);
}
.tut-coach-progress-text {
  font-size: 0.8rem;
  opacity: 0.6;
}
.tut-coach-x { margin-left: auto; }
.tut-coach-specimen {
  display: grid;
  place-items: center;
  padding: 0.6rem 0.5rem;
  margin: 0.2rem 0 0.5rem;
  background: color-mix(in srgb, var(--text, #111) 4%, transparent);
  border-radius: 12px;
  animation: tut-specimen-in 320ms ease-out;
}
@keyframes tut-specimen-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
.tut-coach-body {
  margin: 0.1rem 0 0.6rem;
  line-height: 1.55;
  animation: tut-body-in 240ms ease-out;
}
@keyframes tut-body-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
.tut-progress {
  height: 5px;
  border-radius: 999px;
  background: var(--border, rgba(0, 0, 0, 0.14));
  overflow: hidden;
  margin-bottom: 0.6rem;
}
.tut-progress-fill {
  height: 100%;
  background: var(--accent, #2b6cb0);
  border-radius: 999px;
  transition: width 360ms cubic-bezier(0.2, 0.7, 0.2, 1);
}
.tut-coach-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.tut-coach-actions .spacer { flex: 1; }
.tut-coach-actions button {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}
@media (prefers-reduced-motion: reduce) {
  .tut-coach,
  .tut-coach-specimen,
  .tut-coach-body { animation: none; }
  .tut-progress-fill { transition: none; }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `yarn workspace @trm/web test --run TutorialOverlay`
Expected: PASS (specimen renders; progress 50%; top dodge).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/tutorial/TutorialOverlay.tsx apps/web/src/features/tutorial/TutorialOverlay.test.tsx apps/web/src/styles/tutorial.css
git commit -m "Web: restyle tutorial coachmark — specimen, progress bar, caret, dodge, transitions"
```

---

### Task 7: Wire focus + framing into the runners (`TutorialScreen` + `EncyclopediaModal`)

Lift `useSpotlightRects`, render the scrim alongside the coachmark (keeping GameStage tutorial-agnostic and the chunk lazy), and pass `frameTarget`/`specimen`/`spotRects` through.

**Files:**
- Modify: `apps/web/src/features/tutorial/TutorialScreen.tsx`
- Modify: `apps/web/src/features/tutorial/EncyclopediaModal.tsx`

**Interfaces:**
- Consumes: `useSpotlightRects` (`./useSpotlightRects`), `TutorialSpotlight` (`./TutorialSpotlight`), `useReducedMotion` (`../../hooks/useReducedMotion`), `GameStage` `frameTarget` prop (Task 5), `TutorialOverlay` `specimen`/`spotRects` props (Task 6).
- Produces: no new exports; the overlay slot becomes `<><TutorialSpotlight/><TutorialOverlay/></>`.

- [ ] **Step 1: Update `TutorialRunner` in `TutorialScreen.tsx`**

Replace the imports block additions and the `TutorialRunner` body. Add imports:

```tsx
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { useSpotlightRects } from './useSpotlightRects';
import { TutorialSpotlight } from './TutorialSpotlight';
```

Rewrite `TutorialRunner`'s render (replacing the `spotlightCities`/return section):

```tsx
  const { t } = useTranslation();
  const player = useScenarioPlayer(lesson, useGame);
  const snapshot = useGame((s) => s.snapshot);
  const reduced = useReducedMotion();
  const beat = player.beat;
  const spotlight = beat?.spotlight;
  const rects = useSpotlightRects(spotlight);
  const spotlightCities = spotlight?.kind === 'cities' ? spotlight.ids : undefined;
  const frameTarget = beat?.frame ?? null;

  if (!snapshot) return <div className="card">{t('connecting')}</div>;

  return (
    <GameStage
      snapshot={snapshot}
      commands={player.commands}
      onLeave={onExit}
      spotlightCities={spotlightCities}
      frameTarget={frameTarget}
      overlay={
        <>
          <TutorialSpotlight rects={rects} reducedMotion={reduced} />
          <TutorialOverlay
            beat={beat}
            done={player.done}
            index={player.index}
            total={player.total}
            lessonTitleKey={lesson.titleKey}
            lessonNo={lessonNo}
            lessonCount={lessonCount}
            isLastLesson={isLast}
            specimen={beat?.specimen}
            spotRects={rects}
            onAdvance={player.next}
            onReplay={player.restart}
            onPrevLesson={onPrevLesson}
            onNextLesson={onNextLesson}
            onExit={onExit}
          />
        </>
      }
    />
  );
```

- [ ] **Step 2: Update `EncyclopediaPlayer` in `EncyclopediaModal.tsx`**

Add the same imports:

```tsx
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { useSpotlightRects } from './useSpotlightRects';
import { TutorialSpotlight } from './TutorialSpotlight';
```

Rewrite the `EncyclopediaPlayer` body the same way (it uses the isolated `store`):

```tsx
  const { t } = useTranslation();
  const store = useGameStoreApi();
  const player = useScenarioPlayer(entry, store);
  const snapshot = useGameStore((s) => s.snapshot);
  const reduced = useReducedMotion();
  const beat = player.beat;
  const spotlight = beat?.spotlight;
  const rects = useSpotlightRects(spotlight);
  const spotlightCities = spotlight?.kind === 'cities' ? spotlight.ids : undefined;
  const frameTarget = beat?.frame ?? null;

  if (!snapshot) return <div className="card">{t('connecting')}</div>;

  return (
    <GameStage
      snapshot={snapshot}
      commands={player.commands}
      sandbox
      onLeave={onClose}
      spotlightCities={spotlightCities}
      frameTarget={frameTarget}
      overlay={
        <>
          <TutorialSpotlight rects={rects} reducedMotion={reduced} />
          <TutorialOverlay
            beat={beat}
            done={player.done}
            index={player.index}
            total={player.total}
            lessonTitleKey={entry.titleKey}
            lessonNo={1}
            lessonCount={1}
            isLastLesson
            specimen={beat?.specimen}
            spotRects={rects}
            onAdvance={player.next}
            onReplay={player.restart}
            onPrevLesson={() => {}}
            onNextLesson={onClose}
            onExit={onClose}
          />
        </>
      }
    />
  );
```

- [ ] **Step 3: Typecheck + run the existing tutorial/store suites**

Run: `yarn workspace @trm/web typecheck`
Expected: no errors.

Run: `yarn workspace @trm/web test --run sandboxProvider`
Expected: PASS — the encyclopedia isolation test still passes (live `useGame` snapshot stays null while the sandbox renders).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/tutorial/TutorialScreen.tsx apps/web/src/features/tutorial/EncyclopediaModal.tsx
git commit -m "Web: wire focus scrim + auto-pan + specimens into tutorial & encyclopedia runners"
```

---

### Task 8: Enrich the curriculum + scenario-rot guard (`curriculum.ts`)

Attach specimens, spotlights, and auto-pan frames to the teaching beats using real content ids, and extend the replay test to validate every reference.

**Files:**
- Modify: `apps/web/src/features/tutorial/curriculum.ts`
- Modify: `apps/web/src/features/tutorial/scenarios.test.ts`

Content ids (verified in `packages/map-data/src/routes.ts`): tunnel **R18** (taipei–yilan), ferry **R82** (chiayi–penghu), double **R6**/**R7** (taipei–banqiao), claim demo **R16** (hsinchu–zhunan). City ids: `taipei`, `yilan`, `chiayi`, `penghu`, `banqiao`, `hsinchu`, `zhunan`.

**Interfaces:**
- Consumes: `cityById`, `routeById`, `ticketById` (`../../game/content`), `HUD_SPOTLIGHT_SELECTORS`/`isAllowedHudSelector` (`./focus`).
- Produces: enriched `LESSONS` beats (additive fields only).

- [ ] **Step 1: Write the failing test (reference validation)**

Append to `apps/web/src/features/tutorial/scenarios.test.ts` a new `describe`:

```ts
import { cityById, routeById, ticketById } from '../../game/content';
import { isAllowedHudSelector } from './focus';

describe('tutorial beat visual references resolve to real content', () => {
  for (const lesson of LESSONS) {
    for (const beat of lesson.beats) {
      const sp = beat.spotlight;
      if (sp?.kind === 'cities') {
        it(`${lesson.id}/${beat.id} spotlight cities exist`, () => {
          for (const id of sp.ids) expect(cityById.get(id), id).toBeTruthy();
        });
      }
      if (sp?.kind === 'route') {
        it(`${lesson.id}/${beat.id} spotlight routes exist`, () => {
          for (const id of sp.ids) expect(routeById.get(id), id).toBeTruthy();
        });
      }
      if (sp?.kind === 'hud') {
        it(`${lesson.id}/${beat.id} hud selector is allow-listed`, () => {
          expect(isAllowedHudSelector(sp.selector), sp.selector).toBe(true);
        });
      }
      if (beat.frame) {
        it(`${lesson.id}/${beat.id} frame ids exist`, () => {
          for (const id of beat.frame!.ids) {
            const ok = beat.frame!.kind === 'route' ? routeById.get(id) : cityById.get(id);
            expect(ok, id).toBeTruthy();
          }
        });
      }
      if (beat.specimen?.kind === 'ticket') {
        it(`${lesson.id}/${beat.id} ticket specimen exists`, () => {
          expect(ticketById.get(beat.specimen!.kind === 'ticket' ? beat.specimen!.id : ''), 'ticket').toBeTruthy();
        });
      }
    }
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @trm/web test --run scenarios`
Expected: FAIL — the new `import { cityById … }` resolves, but if any enriched reference is wrong it fails; with the current (un-enriched) curriculum the new `describe` registers no failing specs, so to make the step meaningful, first add the enrichment in Step 3 then re-run. (If the suite is green here, that only means no references exist yet.)

- [ ] **Step 3: Enrich the curriculum beats**

In `apps/web/src/features/tutorial/curriculum.ts`, apply these additive edits (only the changed beats shown — keep all other fields):

**welcome.map** beat → add board spotlight + frame home is implicit (no frame needed; `board` spotlight gives the light global dim):

```ts
      { id: 'map', text: 'tutorial.welcome.map', mode: 'info', spotlight: { kind: 'board' } },
```

**welcome.score** beat → spotlight the trackers:

```ts
      { id: 'score', text: 'tutorial.welcome.score', mode: 'info', spotlight: { kind: 'hud', selector: '.player-trackers' } },
```

**draw.intro** beat → already spotlights `.deck-area`; add the card-row specimen:

```ts
      {
        id: 'intro',
        text: 'tutorial.draw.intro',
        mode: 'info',
        spotlight: { kind: 'hud', selector: '.deck-area' },
        specimen: { kind: 'card-row' },
      },
```

**draw.loco** beat → show the locomotive among the row (reuse card-row):

```ts
      { id: 'loco', text: 'tutorial.draw.loco', mode: 'info', specimen: { kind: 'card-row' } },
```

**claim.demo** beat → add a rail specimen + frame R16 (keep the existing cities spotlight + action):

```ts
      {
        id: 'demo',
        text: 'tutorial.claim.demo',
        mode: 'auto',
        delayMs: 1200,
        spotlight: { kind: 'cities', ids: ['hsinchu', 'zhunan'] },
        frame: { kind: 'route', ids: ['R16'] },
        specimen: { kind: 'route', variant: 'rail' },
        action: (s, board) => {
          const route = board.content.routes.find((r) => (r.id as string) === 'R16')!;
          const pays = enumerateClaimPayments(board, s, P0, route);
          return { t: 'CLAIM_ROUTE', player: P0, routeId: route.id, payment: pays[0]! };
        },
      },
```

**special** lesson beats → add the compare specimen + per-type specimen, spotlight + frame the real routes:

```ts
    beats: [
      { id: 'intro', text: 'tutorial.special.intro', mode: 'info', specimen: { kind: 'routes-compare' } },
      {
        id: 'double',
        text: 'tutorial.special.double',
        mode: 'info',
        specimen: { kind: 'route', variant: 'double' },
        spotlight: { kind: 'route', ids: ['R6', 'R7'] },
        frame: { kind: 'route', ids: ['R6', 'R7'] },
      },
      {
        id: 'ferry',
        text: 'tutorial.special.ferry',
        mode: 'info',
        specimen: { kind: 'route', variant: 'ferry' },
        spotlight: { kind: 'route', ids: ['R82'] },
        frame: { kind: 'route', ids: ['R82'] },
      },
      {
        id: 'tunnel',
        text: 'tutorial.special.tunnel',
        mode: 'info',
        specimen: { kind: 'route', variant: 'tunnel' },
        spotlight: { kind: 'route', ids: ['R18'] },
        frame: { kind: 'route', ids: ['R18'] },
      },
    ],
```

> This adds a new `intro` beat to the `special` lesson. Add the matching i18n key `tutorial.special.intro` in Task 8 Step 4. The `scenarios.test.ts` uniqueness test already covers the new beat id.

**stations** lesson → add the station specimen:

```ts
    beats: [
      { id: 'what', text: 'tutorial.stations.what', mode: 'info', specimen: { kind: 'station' } },
      { id: 'cost', text: 'tutorial.stations.cost', mode: 'info', specimen: { kind: 'station' } },
      { id: 'bonus', text: 'tutorial.stations.bonus', mode: 'info' },
    ],
```

**tickets** lesson → add a ticket specimen on the first beat (use ticket id `T1` — verified present in Step 1's validation once enriched):

```ts
      { id: 'complete', text: 'tutorial.tickets.complete', mode: 'info', specimen: { kind: 'ticket', id: 'T1' } },
```

**endgame.scoring** → spotlight the trackers:

```ts
      { id: 'scoring', text: 'tutorial.endgame.scoring', mode: 'info', spotlight: { kind: 'hud', selector: '.player-trackers' } },
```

> Before relying on ticket id `T1`, confirm it exists: `routeById`/`ticketById` come from content. If `T1` is absent, the Step-5 test fails loudly — in that case open `packages/map-data/src/tickets.ts`, pick the first ticket id, and use it. (The enrichment intentionally routes this through the validation test rather than guessing silently.)

- [ ] **Step 4: Add the new i18n keys**

In `apps/web/src/i18n/tutorial.ts`, add to the `special` block in BOTH `tutorialZh` and `tutorialEn` an `intro` key. Zh:

```ts
    intro: '台鐵的路線分成三種：一般鐵路、跨海渡輪與穿山隧道。下面比較它們的外觀：',
```

En:

```ts
    intro: 'Routes come in three kinds: ordinary railways, sea ferries, and mountain tunnels. Compare how they look below:',
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `yarn workspace @trm/web test --run scenarios`
Expected: PASS — every lesson still replays through the engine; every enriched spotlight/frame/specimen/ticket reference resolves; beat ids stay unique.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/tutorial/curriculum.ts apps/web/src/features/tutorial/scenarios.test.ts apps/web/src/i18n/tutorial.ts
git commit -m "Web: enrich tutorial beats with specimens/spotlights/auto-pan + scenario-rot guard"
```

---

### Task 9: Chapter-grouped encyclopedia list (`EncyclopediaModal.tsx`)

Replace the bare `<select>` topic picker with a chapter-grouped clickable list.

**Files:**
- Modify: `apps/web/src/features/tutorial/EncyclopediaModal.tsx`
- Modify: `apps/web/src/styles/tutorial.css`
- Modify: `apps/web/src/i18n/tutorial.ts` (chapter group labels)
- Test: `apps/web/src/features/tutorial/EncyclopediaModal.test.tsx` (new)

**Interfaces:**
- Consumes: `encyclopediaEntries()` (`./curriculum`), `SandboxProvider` (`../../store/sandboxProvider`).
- Produces: a grouped list UI; selecting an entry sets `idx`. No new exports.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/tutorial/EncyclopediaModal.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import EncyclopediaModal from './EncyclopediaModal';

describe('EncyclopediaModal', () => {
  it('renders a grouped, clickable entry list (not a bare select)', () => {
    const { container } = render(<EncyclopediaModal onClose={() => {}} />);
    expect(container.querySelector('.enc-list')).toBeTruthy();
    expect(container.querySelector('select.enc-select')).toBeNull();
    expect(container.querySelectorAll('.enc-entry').length).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @trm/web test --run EncyclopediaModal`
Expected: FAIL — `.enc-list` is null / `select.enc-select` still present.

- [ ] **Step 3: Replace the picker in `EncyclopediaModal.tsx`**

Replace the `<header className="enc-head">…</header>` + `<select>` with a sidebar list. Group entries by `chapter`. New default export body:

```tsx
export default function EncyclopediaModal({ onClose }: { onClose(): void }) {
  const { t } = useTranslation();
  const entries = useMemo(() => encyclopediaEntries(), []);
  const [idx, setIdx] = useState(0);
  const entry = entries[idx];
  if (!entry) return null;

  // Group entries by chapter, preserving order.
  const groups = useMemo(() => {
    const m = new Map<number, { entry: (typeof entries)[number]; i: number }[]>();
    entries.forEach((e, i) => {
      const arr = m.get(e.chapter) ?? [];
      arr.push({ entry: e, i });
      m.set(e.chapter, arr);
    });
    return [...m.entries()];
  }, [entries]);

  return (
    <div className="enc-backdrop" role="dialog" aria-label={t('tutorial.open')}>
      <div className="enc-shell enc-shell--split">
        <aside className="enc-list">
          <div className="enc-list-head">
            <strong className="enc-title">{t('tutorial.open')}</strong>
            <button className="icon-btn enc-x" onClick={onClose} aria-label={t('close')}>
              <X size={18} />
            </button>
          </div>
          {groups.map(([chapter, items]) => (
            <div className="enc-group" key={chapter}>
              <div className="enc-group-label">{t(`tutorial.chapters.c${chapter}`)}</div>
              {items.map(({ entry: e, i }) => (
                <button
                  key={e.id}
                  className={'enc-entry' + (i === idx ? ' is-active' : '')}
                  onClick={() => setIdx(i)}
                >
                  {t(e.titleKey)}
                </button>
              ))}
            </div>
          ))}
        </aside>
        <div className="enc-main">
          <p className="enc-blurb">{t(entry.blurbKey)}</p>
          <div className="enc-stage">
            <SandboxProvider key={entry.id}>
              <EncyclopediaPlayer entry={entry} onClose={onClose} />
            </SandboxProvider>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add chapter labels + list styles**

In `apps/web/src/i18n/tutorial.ts`, add a `chapters` block to BOTH tables. Zh:

```ts
  chapters: {
    c0: '基礎',
    c3: '抽牌',
    c4: '路線',
    c5: '特殊路線',
    c6: '車站',
    c7: '任務卡',
    c8: '最長路線',
    c9: '結算',
  },
```

En:

```ts
  chapters: {
    c0: 'Basics',
    c3: 'Drawing',
    c4: 'Routes',
    c5: 'Special routes',
    c6: 'Stations',
    c7: 'Tickets',
    c8: 'Longest trail',
    c9: 'Endgame',
  },
```

In `apps/web/src/styles/tutorial.css`, replace the `.enc-head`/`.enc-select` rules with the split layout:

```css
.enc-shell--split {
  display: grid;
  grid-template-columns: minmax(11rem, 15rem) 1fr;
  min-height: 0;
}
.enc-list {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.6rem;
  border-right: 1px solid var(--border, rgba(0, 0, 0, 0.12));
  overflow-y: auto;
}
.enc-list-head {
  display: flex;
  align-items: center;
  margin-bottom: 0.35rem;
}
.enc-list-head .enc-x { margin-left: auto; }
.enc-group { margin-bottom: 0.5rem; }
.enc-group-label {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  opacity: 0.55;
  padding: 0.2rem 0.4rem;
}
.enc-entry {
  display: block;
  width: 100%;
  text-align: start;
  padding: 0.4rem 0.55rem;
  border-radius: 8px;
  background: transparent;
  border: none;
  cursor: pointer;
  color: inherit;
}
.enc-entry:hover { background: color-mix(in srgb, var(--text, #111) 6%, transparent); }
.enc-entry.is-active {
  background: color-mix(in srgb, var(--accent, #2b6cb0) 18%, transparent);
  color: var(--accent, #2b6cb0);
  font-weight: 600;
}
.enc-main {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
}
.enc-main .enc-blurb {
  margin: 0;
  padding: 0.6rem 0.85rem;
  font-size: 0.85rem;
  opacity: 0.8;
  border-bottom: 1px solid var(--border, rgba(0, 0, 0, 0.12));
}
@media (max-width: 640px) {
  .enc-shell--split { grid-template-columns: 1fr; }
  .enc-list { flex-direction: row; flex-wrap: wrap; border-right: none; border-bottom: 1px solid var(--border, rgba(0, 0, 0, 0.12)); }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `yarn workspace @trm/web test --run EncyclopediaModal`
Expected: PASS — grouped `.enc-list` with multiple `.enc-entry`, no `<select>`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/tutorial/EncyclopediaModal.tsx apps/web/src/features/tutorial/EncyclopediaModal.test.tsx apps/web/src/styles/tutorial.css apps/web/src/i18n/tutorial.ts
git commit -m "Web: chapter-grouped encyclopedia entry list (replaces bare select)"
```

---

### Task 10: Full verification + browser e2e

Confirm nothing regressed, the chunk stays lazy, and the experience works end-to-end.

**Files:** none (verification only; fix-forward any failure in the owning task's files).

- [ ] **Step 1: Full web suite**

Run: `yarn workspace @trm/web test`
Expected: PASS — all prior suites (`GameScreen`, `Board`, `ScoreBoard`, `useAnimationDriver`, `sandboxProvider`, `scenarios`, …) plus the new `focus`, `Specimens`, `useSpotlightRects`, `TutorialSpotlight`, `TutorialOverlay`, `EncyclopediaModal` tests. Expect ≥ 170 tests green.

- [ ] **Step 2: Cross-workspace static gates**

Run: `yarn typecheck`
Expected: 9/9 workspaces pass (no engine/codec/server churn).

Run: `yarn lint`
Expected: clean (the two `eslint-disable-next-line react-hooks/exhaustive-deps` lines are intentional and scoped).

Run: `yarn workspace @trm/web build`
Expected: build succeeds; the tutorial/encyclopedia + `@trm/engine`/`@trm/codec` remain in a **separate lazy chunk** (verify the build output lists a `TutorialScreen`/`EncyclopediaModal` chunk distinct from the main entry — same as before this change).

- [ ] **Step 3: Confirm prettier-clean**

Run: `yarn workspace @trm/web exec prettier --check "src/features/tutorial/**/*.{ts,tsx}" "src/styles/tutorial.css" "src/components/Board.tsx" "src/screens/GameStage.tsx" "src/i18n/tutorial.ts"`
Expected: all matched files clean. If any are flagged, run the same with `--write` and amend the owning commit.

- [ ] **Step 4: Browser e2e (local dev, no server needed)**

Run the dev server: `yarn workspace @trm/web dev` (note the printed port).

Using the Chrome MCP tools, verify:
1. Navigate to `/tutorial` → launcher shows Full/Quickstart.
2. Start **Full** → board renders; the welcome `map` beat shows the light global dim; advancing to `draw` shows the **card-row specimen** in the coachmark and a **lit hole around the deck** with the rest dimmed; the deck is still clickable (draw a card → the await beat advances).
3. Advance to **special routes** → the board **auto-pans** to the Taipei–Yilan tunnel, the dim frames it, and the coachmark shows the **rail/ferry/tunnel comparison** then the per-type specimens; the coachmark **dodges to the top** if it would cover the framed route.
4. Confirm **no console errors** (read console messages).
5. Open the in-game **encyclopedia** (book icon) during the tutorial → grouped chapter list; pick "Tunnels" → same auto-pan + specimen on its isolated sandbox; close it → the tutorial coachmark is exactly where it was (isolation holds).
6. Toggle OS reduced-motion (or emulate) → pans are instant, rings don't pulse.

Stop the dev server when done.

- [ ] **Step 5: Final commit (if any fix-forward was needed)**

```bash
git add -A
git commit -m "Web: tutorial UI redesign — verification fixups"
```

(If Steps 1–4 passed with no changes, skip this commit.)

---

## Self-Review

**Spec coverage:**
- Focus layer (dim+glow, non-blocking) → Tasks 3, 4, 7. ✔
- Auto-pan to real examples → Task 5 (`SpotlightFramer`) + Task 8 (frames). ✔
- Full visual glossary (railway/ferry/tunnel/double/station/cards/ticket) → Task 2. ✔
- Restyled animated coachmark + progress + caret + dodge → Task 6. ✔
- Beat model extension (additive) → Task 1. ✔
- Curriculum enrichment per lesson → Task 8. ✔
- Encyclopedia inherits + chapter-grouped list → Tasks 7, 9. ✔
- Reduced motion throughout → Tasks 4, 5, 6 (gated). ✔
- Lazy chunk preserved (GameStage stays tutorial-agnostic; scrim rendered inside the lazy `overlay`) → Task 7 design + Task 10 build check. ✔
- Tests: focus, specimens, hook, scrim, overlay, encyclopedia, scenario-rot reference validation → Tasks 1–9; no-regression + e2e → Task 10. ✔
- Error handling (missing target → global dim; jsdom 0-rects → empty; never block input) → Tasks 3, 4. ✔

**Placeholder scan:** No TBD/TODO; every code step shows complete code; ids are concrete (R18/R82/R6/R7/R16; cities verified). The one conditional ("if `T1` is absent, use the first ticket id") is an explicit, test-guarded fallback, not a silent placeholder.

**Type consistency:** `BoardFrameTarget` defined once in `game/boardView.ts`, consumed by `types.ts`, `Board`, `GameStage`. `FlatRect` defined in `focus.ts`, consumed by the hook, scrim, and overlay. `SpecimenSpec` defined in `types.ts`, consumed by `Specimens.tsx` and `TutorialOverlay`. `selectorsForSpotlight`/`isAllowedHudSelector`/`coachPosition` names are used consistently across Tasks 1, 3, 6, 8. `useSpotlightRects` returns `FlatRect[]` everywhere. ✔
