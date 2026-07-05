# Affected-Routes List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sky Lantern (天燈之夜) and Typhoon Landfall (颱風登陸) event rows in the events panel already
show only a route _count_; add a list of the currently-unclaimed affected routes (by city-pair name)
to their existing info modal, each row clickable to pan the board's camera straight to it.

**Architecture:** Pure UI addition, no server/proto/engine changes. A new `eventSpotlight` field on
the existing `useAnimationsStore` (`apps/web/src/store/animations.ts`) carries a one-shot board-pan
target, mirroring how `ScoreBoard.tsx` already drives the board camera via `routeReveal`/
`setRouteReveal` on the same store. `Board.tsx`'s existing `SpotlightFramer` (today driven only by
the tutorial/replay `frameTarget` prop) falls back to this store field. `EventsPanel.tsx`'s existing
info modal (already showing an event's name + description) grows a new section listing the affected
routes, filtered to ones not already owned/locked, each a button that sets `eventSpotlight` and closes
the modal.

**Tech Stack:** React + TypeScript, zustand, react-i18next, lucide-react icons, vitest +
@testing-library/react.

## Global Constraints

- UI must work in both zh-Hant (primary) and en (fallback) locales.
- `yarn workspace @trm/web test`, `yarn lint`, and `yarn typecheck` must pass before each commit.
- The client never computes game truth — everything here reads the existing
  `snapshot.randomEvents` projection (already mirrored by the store) and `snapshot.ownership`
  (already used by `Board.tsx` via `ownershipMap`). No new server calls.
- Reuse existing global classes (`modal`, `modal-backdrop`, `modal-head`, `cell-view`) — only add the
  three new classes named in Task 4, nothing else.
- Generic for both `SKY_LANTERN` and `TYPHOON_LANDFALL` (both carry `routeIds` on the wire, at both
  the forecast and active stages) — no per-kind special-casing.

---

### Task 1: `eventSpotlight` field on the animations store

**Files:**

- Modify: `apps/web/src/store/animations.ts`
- Test: `apps/web/src/store/animations.test.ts`

**Interfaces:**

- Consumes: `BoardFrameTarget` type from `apps/web/src/game/boardView.ts` (already exists —
  `{ kind: 'route' | 'cities', ids: string[], instant?: boolean }`).
- Produces: `useAnimations.getState().eventSpotlight: BoardFrameTarget | null` and
  `useAnimations.getState().setEventSpotlight(target: BoardFrameTarget): void`, consumed by Task 2.

- [ ] **Step 1: Write the failing test**

Add this test at the end of `apps/web/src/store/animations.test.ts`, just before the file's final
closing `});`:

```ts
it('setEventSpotlight sets the board camera target for events; reset clears it', () => {
  useAnimations.getState().setEventSpotlight({ kind: 'route', ids: ['R1', 'R2'] });
  expect(useAnimations.getState().eventSpotlight).toEqual({ kind: 'route', ids: ['R1', 'R2'] });
  useAnimations.getState().reset();
  expect(useAnimations.getState().eventSpotlight).toBeNull();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @trm/web test --run animations`
Expected: FAIL — `useAnimations.getState().setEventSpotlight is not a function`.

- [ ] **Step 3: Add the import**

In `apps/web/src/store/animations.ts`, find:

```ts
import { create, useStore, type StateCreator } from 'zustand';
import { createContext, useContext } from 'react';
import type { CardColor } from '@trm/shared';
import type { AnimIntent } from '../game/animationModel';
```

Replace with:

```ts
import { create, useStore, type StateCreator } from 'zustand';
import { createContext, useContext } from 'react';
import type { CardColor } from '@trm/shared';
import type { AnimIntent } from '../game/animationModel';
import type { BoardFrameTarget } from '../game/boardView';
```

- [ ] **Step 4: Add the state field to the `AnimState` interface**

Find:

```ts
  /** Longest-trail route highlight shown while reviewing the final scoreboard (null = none). */
  routeReveal: RouteReveal | null;
  pushIntent(intent: AnimIntent): void;
```

Replace with:

```ts
  /** Longest-trail route highlight shown while reviewing the final scoreboard (null = none). */
  routeReveal: RouteReveal | null;
  /** One-shot board camera target requested from the events panel (null = none pending). */
  eventSpotlight: BoardFrameTarget | null;
  pushIntent(intent: AnimIntent): void;
```

- [ ] **Step 5: Add the setter to the `AnimState` interface**

Find:

```ts
  setRouteReveal(seat: number, path: string[]): void;
  clearRouteReveal(): void;
  reset(): void;
```

Replace with:

```ts
  setRouteReveal(seat: number, path: string[]): void;
  clearRouteReveal(): void;
  setEventSpotlight(target: BoardFrameTarget): void;
  reset(): void;
```

- [ ] **Step 6: Seed the field in `initial()`**

Find:

```ts
  routeReveal: null as RouteReveal | null,
});
```

Replace with:

```ts
  routeReveal: null as RouteReveal | null,
  eventSpotlight: null as BoardFrameTarget | null,
});
```

- [ ] **Step 7: Implement the setter in the store creator**

Find:

```ts
  setRouteReveal: (seat, path) => set({ routeReveal: { seat, path } }),
  clearRouteReveal: () => set({ routeReveal: null }),
  reset: () => set(initial()),
```

Replace with:

```ts
  setRouteReveal: (seat, path) => set({ routeReveal: { seat, path } }),
  clearRouteReveal: () => set({ routeReveal: null }),
  setEventSpotlight: (target) => set({ eventSpotlight: target }),
  reset: () => set(initial()),
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `yarn workspace @trm/web test --run animations`
Expected: PASS (all tests in the file, including the new one).

- [ ] **Step 9: Typecheck**

Run: `yarn typecheck`
Expected: exits 0.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/store/animations.ts apps/web/src/store/animations.test.ts
git commit -m "$(cat <<'EOF'
feat(web): add eventSpotlight board-camera target to animations store

Mirrors the existing routeReveal/setRouteReveal pattern ScoreBoard uses
to drive the board camera, for a one-shot pan instead of a persistent
highlight. Nothing consumes it yet.
EOF
)"
```

---

### Task 2: Board camera falls back to `eventSpotlight`

**Files:**

- Modify: `apps/web/src/components/Board.tsx:364-409` (the `SpotlightFramer` component)
- Test: `apps/web/src/components/Board.test.tsx`

**Interfaces:**

- Consumes: `useAnimationsStore((s) => s.eventSpotlight)` from Task 1 (already imported in this file
  as `useAnimationsStore` from `'../store/animations'`).
- Produces: no new exports — `SpotlightFramer`'s existing behavior (tutorial/replay `frameTarget`
  prop) is unchanged; it just gains a fallback source. `Board`'s public props are unchanged.

**Note on TDD for this task:** `SpotlightFramer`'s actual pan math only runs when the viewport has
real measured layout (`clientWidth`/`clientHeight` > 0), which jsdom never provides — every existing
camera-framing test in this codebase (tutorial `frameTarget`, `RevealFramer`) already only checks
that rendering doesn't crash, never the resulting transform. This task follows that same limit: the
test is a regression/smoke check, not a red-then-green behavioral test, so Step 1 modifies the
component first and Step 2 adds the smoke test.

- [ ] **Step 1: Wire the fallback**

In `apps/web/src/components/Board.tsx`, find (the whole `SpotlightFramer` function):

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
    setTransform(t.positionX, t.positionY, t.scale, frameDurationMs(target, reduced), 'easeOut');
  }, [key, target, reduced]);
  return null;
}
```

Replace with:

```tsx
/**
 * Auto-pan framer: frames the board on a set of routes/cities. Driven by the tutorial/replay
 * `frameTarget` prop when present (sandbox contexts); otherwise falls back to the live game's
 * `eventSpotlight` store field (set from the events panel's affected-routes list). Lives inside the
 * pan/zoom context for `setTransform`; re-fits whenever the effective target changes, inert otherwise.
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
  const eventSpotlight = useAnimationsStore((s) => s.eventSpotlight);
  const effective = target ?? eventSpotlight;
  const key = effective ? `${effective.kind}:${effective.ids.join(',')}` : '';
  useEffect(() => {
    if (!effective || effective.ids.length === 0) return;
    const cityIds =
      effective.kind === 'route'
        ? effective.ids.flatMap((rid) => {
            const r = routeById.get(rid);
            return r ? [r.a as string, r.b as string] : [];
          })
        : effective.ids;
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
    setTransform(t.positionX, t.positionY, t.scale, frameDurationMs(effective, reduced), 'easeOut');
  }, [key, effective, reduced]);
  return null;
}
```

(The call site at `<SpotlightFramer viewportRef={viewportRef} target={frameTarget ?? null} />` does
not change.)

- [ ] **Step 2: Add the regression test**

Replace the full contents of `apps/web/src/components/Board.test.tsx` with:

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { create } from '@bufbuild/protobuf';
import { GameSnapshotSchema } from '@trm/proto';
import { Board } from './Board';
import { useAnimations } from '../store/animations';

const snap = create(GameSnapshotSchema, {
  stateVersion: 1,
  players: [
    {
      id: 'p1',
      seat: 0,
      trainCars: 45,
      stationsRemaining: 3,
      routePoints: 0,
      handCount: 4,
      ticketCount: 2,
    },
  ],
  ownership: [],
  stations: [],
});

describe('Board', () => {
  beforeEach(() => useAnimations.getState().reset());

  it('renders the Taiwan map with the full route graph and localized city names', () => {
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
    expect(screen.getByRole('img', { name: /Taiwan/i })).toBeInTheDocument();
    // Every authored route draws a roadbed path plus a chain of car slots.
    expect(container.querySelectorAll('path.bed').length).toBeGreaterThan(60);
    expect(container.querySelectorAll('rect.slot').length).toBeGreaterThan(80);
    // Multi-route junctions render as slot-shaped hub stations.
    expect(container.querySelectorAll('rect.city-hub').length).toBeGreaterThan(0);
    // A known station label is present in Traditional Chinese.
    expect(screen.getAllByText('臺北').length).toBeGreaterThan(0);
  });

  it('renders random-event overlays driven by snapshot.random_events', () => {
    const eventSnap = create(GameSnapshotSchema, {
      stateVersion: 1,
      players: [
        {
          id: 'p1',
          seat: 0,
          trainCars: 45,
          stationsRemaining: 3,
          routePoints: 0,
          handCount: 4,
          ticketCount: 2,
        },
      ],
      ownership: [],
      stations: [],
      randomEvents: {
        mode: 'intense',
        roundIndex: 1,
        active: [{ id: 'e1', kind: 'SKY_LANTERN', routeIds: ['R3'] }],
        hotspots: [{ cityId: 'taipei', level: 2 }],
        charters: [
          {
            id: 'c1',
            cityA: 'taipei',
            cityB: 'kaohsiung',
            points: 10,
            expiresAfterRound: 5,
            wonByPlayerId: '',
          },
        ],
        reopenBonusRouteIds: ['R4'],
        closedRouteIds: ['R2'],
      },
    });
    const { container } = render(
      <Board
        snapshot={eventSnap}
        locale="zh-Hant"
        colorBlind={false}
        canAct={false}
        onPickRoute={() => {}}
        onPickCity={() => {}}
      />,
    );
    // Closed / sky-lantern / reopen route markers, keyed to the right routes.
    expect(container.querySelector('[data-route-id="R2"][data-closed="true"]')).toBeTruthy();
    expect(container.querySelector('[data-route-id="R3"][data-sky="true"]')).toBeTruthy();
    expect(container.querySelector('[data-route-id="R4"][data-reopen="true"]')).toBeTruthy();
    expect(container.querySelector('.evt-typhoon')).toBeTruthy();
    expect(container.querySelector('.evt-reopen-chip')).toBeTruthy();
    // Hotspot badge on the city, and charter chips on BOTH endpoints of the open charter.
    expect(container.querySelector('[data-city-id="taipei"][data-hotspot="2"]')).toBeTruthy();
    expect(container.querySelector('[data-city-id="taipei"][data-charter="true"]')).toBeTruthy();
    expect(container.querySelector('[data-city-id="kaohsiung"][data-charter="true"]')).toBeTruthy();
  });

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

  it('does not crash when an events-panel spotlight target is pending in the animations store', () => {
    useAnimations.getState().setEventSpotlight({ kind: 'route', ids: ['R3'] });
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
    expect(container.querySelectorAll('path.bed').length).toBeGreaterThan(60);
  });
});
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `yarn workspace @trm/web test --run Board`
Expected: all 4 tests PASS.

- [ ] **Step 4: Typecheck**

Run: `yarn typecheck`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/Board.tsx apps/web/src/components/Board.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): board camera falls back to the events-panel spotlight target

SpotlightFramer was driven only by the tutorial/replay frameTarget
prop, which a live game never passes. It now falls back to the new
eventSpotlight store field so a live game's events panel can pan the
board too, with zero change to the tutorial/replay call sites.
EOF
)"
```

---

### Task 3: i18n — `events.routeListTitle`

**Files:**

- Modify: `apps/web/src/i18n/index.ts:234` (zh-Hant) and `:724` (en)

**Interfaces:**

- Produces: `t('events.routeListTitle')` resolving to `受影響路線` (zh-Hant) / `Affected routes` (en),
  consumed by Task 5.

- [ ] **Step 1: Add the zh-Hant key**

In `apps/web/src/i18n/index.ts`, find:

```ts
        affectedRoutes: '{{n}} 條路線',
        TYPHOON_LANDFALL: { name: '颱風登陸', desc: '封閉部分路線；恢復通車後首位鋪設者可得 +2 分' },
```

Replace with:

```ts
        affectedRoutes: '{{n}} 條路線',
        routeListTitle: '受影響路線',
        TYPHOON_LANDFALL: { name: '颱風登陸', desc: '封閉部分路線；恢復通車後首位鋪設者可得 +2 分' },
```

- [ ] **Step 2: Add the en key**

In the same file, find:

```ts
        affectedRoutes: '{{n}} routes',
        TYPHOON_LANDFALL: {
          name: 'Typhoon Landfall',
```

Replace with:

```ts
        affectedRoutes: '{{n}} routes',
        routeListTitle: 'Affected routes',
        TYPHOON_LANDFALL: {
          name: 'Typhoon Landfall',
```

- [ ] **Step 3: Typecheck**

Run: `yarn typecheck`
Expected: exits 0. (No test asserts this key in isolation — Task 5's tests exercise it.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/i18n/index.ts
git commit -m "$(cat <<'EOF'
feat(web): add events.routeListTitle i18n key (zh-Hant + en)
EOF
)"
```

---

### Task 4: CSS for the affected-routes list

**Files:**

- Modify: `apps/web/src/styles/game.css:1704-1714`

**Interfaces:**

- Produces: `.event-route-section`, `.event-route-list`, `.event-route-item` classes, consumed by
  Task 5's JSX.

- [ ] **Step 1: Add the rules**

In `apps/web/src/styles/game.css`, find:

```css
.event-forecast .event-label {
  font-weight: 700;
  color: var(--tr-accent);
}

/* ─── Notification chips (system messages + event announcements/bonuses) ───────── */
```

Replace with:

```css
.event-forecast .event-label {
  font-weight: 700;
  color: var(--tr-accent);
}

/* Affected-routes list appended inside a route-targeting event's info modal. */
.event-route-section {
  margin-top: var(--tr-space-3);
  padding-top: var(--tr-space-3);
  border-top: 1px solid var(--tr-surface-2);
}
.event-route-section h4 {
  margin: 0 0 var(--tr-space-2);
  font-size: 13px;
  color: var(--tr-ink-soft);
}
.event-route-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 220px;
  overflow-y: auto;
}
.event-route-item {
  width: 100%;
  text-align: left;
  padding: 6px 8px;
  border: none;
  border-radius: var(--tr-radius-sm);
  background: transparent;
  color: var(--tr-ink);
  font-size: 13px;
  cursor: pointer;
}
.event-route-item:hover {
  background: color-mix(in srgb, var(--tr-ink) 12%, transparent);
}

/* ─── Notification chips (system messages + event announcements/bonuses) ───────── */
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/styles/game.css
git commit -m "$(cat <<'EOF'
feat(web): add CSS for the events-panel affected-routes list
EOF
)"
```

---

### Task 5: EventsPanel route list + click-to-pan

**Files:**

- Modify: `apps/web/src/components/EventsPanel.tsx` (full replacement below)
- Test: `apps/web/src/components/EventsPanel.test.tsx` (full replacement below)

**Interfaces:**

- Consumes: `setEventSpotlight` (Task 1/2), `t('events.routeListTitle')` (Task 3),
  `.event-route-section`/`.event-route-list`/`.event-route-item` (Task 4), `routeById` (already
  exported from `apps/web/src/game/content.ts`), `ownershipMap` (already exported from
  `apps/web/src/game/view.ts`).
- Produces: no new exports — `EventsPanel` remains a self-contained component with no new props.

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `apps/web/src/components/EventsPanel.test.tsx` with:

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { create, type MessageInitShape } from '@bufbuild/protobuf';
import { GameSnapshotSchema, Phase } from '@trm/proto';
import '../i18n';
import { EventsPanel } from './EventsPanel';
import { useGame } from '../store/game';
import { useAnimations } from '../store/animations';

const snapshot = (randomEvents?: MessageInitShape<typeof GameSnapshotSchema>['randomEvents']) =>
  create(GameSnapshotSchema, {
    stateVersion: 1,
    phase: Phase.AWAIT_ACTION,
    currentPlayerId: 'p1',
    turnOrder: ['p1', 'p2'],
    players: [
      { id: 'p1', seat: 0, trainCars: 45, stationsRemaining: 3 },
      { id: 'p2', seat: 1, trainCars: 45, stationsRemaining: 3 },
    ],
    ...(randomEvents ? { randomEvents } : {}),
  });

beforeEach(() => {
  useGame.getState().reset();
  useAnimations.getState().reset();
});

describe('EventsPanel', () => {
  it('renders active, charter, forecast and free-station rows from the snapshot', () => {
    useGame.setState({
      snapshot: snapshot({
        mode: 'intense',
        roundIndex: 2,
        active: [
          { id: 'ev1', kind: 'TYPHOON_LANDFALL', routeIds: ['r1', 'r2'], endsAfterRound: 4 },
        ],
        charters: [
          {
            id: 'c1',
            cityA: 'taipei',
            cityB: 'kaohsiung',
            points: 12,
            expiresAfterRound: 6,
            wonByPlayerId: '',
          },
        ],
        forecast: { id: 'f1', kind: 'SKY_LANTERN', startRound: 3, durationRounds: 2 },
        freeStationAvailable: true,
      }),
    });
    render(<EventsPanel />);

    expect(screen.getByText('事件')).toBeInTheDocument(); // panel title
    expect(screen.getByText('強烈')).toBeInTheDocument(); // intensity chip
    // Active typhoon: localized name, affected route count, and rounds-left (4 − 2 + 1 = 3).
    expect(screen.getByText('颱風登陸')).toBeInTheDocument();
    expect(screen.getByText('2 條路線')).toBeInTheDocument();
    expect(screen.getByText('剩 3 輪')).toBeInTheDocument();
    // Open charter with resolved city names + points.
    expect(screen.getByText(/臺北–高雄.*12/)).toBeInTheDocument();
    // One-round forecast (dimmed row).
    expect(screen.getByText('預報')).toBeInTheDocument();
    expect(screen.getByText('天燈之夜')).toBeInTheDocument();
    expect(screen.getByText('下一輪開始')).toBeInTheDocument();
    // Gala free-station window.
    expect(screen.getByText('本輪首座車站免費')).toBeInTheDocument();
  });

  it('shows the "completed" state for a won charter', () => {
    useGame.setState({
      snapshot: snapshot({
        mode: 'light',
        roundIndex: 1,
        charters: [
          {
            id: 'c1',
            cityA: 'taipei',
            cityB: 'kaohsiung',
            points: 9,
            expiresAfterRound: 5,
            wonByPlayerId: 'p2',
          },
        ],
      }),
    });
    render(<EventsPanel />);
    expect(screen.getByText(/完成觀光專列/)).toBeInTheDocument();
  });

  it('renders nothing when the snapshot carries no random_events block', () => {
    useGame.setState({ snapshot: snapshot() });
    render(<EventsPanel />);
    expect(screen.queryByTestId('events-panel')).toBeNull();
  });

  it("opens the description modal from an active event's info button", () => {
    useGame.setState({
      snapshot: snapshot({
        mode: 'intense',
        roundIndex: 2,
        active: [
          { id: 'ev1', kind: 'TYPHOON_LANDFALL', routeIds: ['r1', 'r2'], endsAfterRound: 4 },
        ],
      }),
    });
    render(<EventsPanel />);

    fireEvent.click(screen.getByLabelText('查看'));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('颱風登陸')).toBeInTheDocument();
    expect(
      within(dialog).getByText('封閉部分路線；恢復通車後首位鋪設者可得 +2 分'),
    ).toBeInTheDocument();
    // 'r1'/'r2' aren't real route ids — the affected-routes section has nothing resolvable, so
    // it doesn't render at all (regression: no stray empty section).
    expect(within(dialog).queryByText('受影響路線')).toBeNull();
  });

  it("opens the description modal from a charter row's info button", () => {
    useGame.setState({
      snapshot: snapshot({
        mode: 'light',
        roundIndex: 1,
        charters: [
          {
            id: 'c1',
            cityA: 'taipei',
            cityB: 'kaohsiung',
            points: 12,
            expiresAfterRound: 6,
            wonByPlayerId: '',
          },
        ],
      }),
    });
    render(<EventsPanel />);

    fireEvent.click(screen.getByLabelText('查看'));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('觀光專開列車')).toBeInTheDocument();
    expect(within(dialog).getByText('以自己的路網連接指定兩座城市即可得分')).toBeInTheDocument();
  });

  it("opens the description modal from the forecast row's info button", () => {
    useGame.setState({
      snapshot: snapshot({
        mode: 'moderate',
        roundIndex: 3,
        forecast: { id: 'f1', kind: 'SKY_LANTERN', startRound: 3, durationRounds: 2 },
      }),
    });
    render(<EventsPanel />);

    fireEvent.click(screen.getByLabelText('查看'));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('天燈之夜')).toBeInTheDocument();
    expect(
      within(dialog).getByText('指定路線分數加倍，但佔領需多付一張車廂卡'),
    ).toBeInTheDocument();
  });

  it('closes the description modal via the close button, backdrop click, and Escape', () => {
    useGame.setState({
      snapshot: snapshot({
        mode: 'intense',
        roundIndex: 2,
        active: [
          { id: 'ev1', kind: 'TYPHOON_LANDFALL', routeIds: ['r1', 'r2'], endsAfterRound: 4 },
        ],
      }),
    });
    const { container } = render(<EventsPanel />);

    fireEvent.click(screen.getByLabelText('查看'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('關閉'));
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByLabelText('查看'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(container.querySelector('.modal-backdrop')!);
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByLabelText('查看'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not show an info button on the free-station banner row', () => {
    useGame.setState({
      snapshot: snapshot({
        mode: 'intense',
        roundIndex: 1,
        freeStationAvailable: true,
      }),
    });
    render(<EventsPanel />);
    const freeRow = screen.getByText('本輪首座車站免費').closest('.event-row') as HTMLElement;
    expect(within(freeRow).queryByLabelText('查看')).toBeNull();
  });

  it("lists unclaimed affected routes on an active event's info modal, and pans the board on click", () => {
    useGame.setState({
      snapshot: create(GameSnapshotSchema, {
        stateVersion: 1,
        phase: Phase.AWAIT_ACTION,
        currentPlayerId: 'p1',
        turnOrder: ['p1', 'p2'],
        players: [
          { id: 'p1', seat: 0, trainCars: 45, stationsRemaining: 3 },
          { id: 'p2', seat: 1, trainCars: 45, stationsRemaining: 3 },
        ],
        // R4 (taipei–tamsui) is already claimed — it must be excluded from the list.
        ownership: [{ routeId: 'R4', cell: { case: 'ownerPlayerId', value: 'p1' } }],
        randomEvents: {
          mode: 'intense',
          roundIndex: 2,
          active: [
            { id: 'ev1', kind: 'SKY_LANTERN', routeIds: ['R2', 'R3', 'R4'], endsAfterRound: 4 },
          ],
        },
      }),
    });
    render(<EventsPanel />);

    fireEvent.click(screen.getByLabelText('查看'));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('受影響路線')).toBeInTheDocument();
    expect(within(dialog).getByText('基隆–臺北')).toBeInTheDocument(); // R2, keelung–taipei
    expect(within(dialog).getByText('瑞芳–臺北')).toBeInTheDocument(); // R3, ruifang–taipei
    expect(within(dialog).queryByText('臺北–淡水')).toBeNull(); // R4 — already owned, excluded

    fireEvent.click(within(dialog).getByText('基隆–臺北'));
    expect(screen.queryByRole('dialog')).toBeNull(); // clicking a route closes the modal
    expect(useAnimations.getState().eventSpotlight).toEqual({ kind: 'route', ids: ['R2'] });
  });

  it("also lists affected routes on the forecast row's info modal", () => {
    useGame.setState({
      snapshot: snapshot({
        mode: 'moderate',
        roundIndex: 3,
        forecast: {
          id: 'f1',
          kind: 'SKY_LANTERN',
          startRound: 3,
          durationRounds: 2,
          routeIds: ['R2', 'R3'],
        },
      }),
    });
    render(<EventsPanel />);

    fireEvent.click(screen.getByLabelText('查看'));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('受影響路線')).toBeInTheDocument();
    expect(within(dialog).getByText('基隆–臺北')).toBeInTheDocument();
    expect(within(dialog).getByText('瑞芳–臺北')).toBeInTheDocument();
  });

  it('does not show an affected-routes section for a non-route event kind', () => {
    useGame.setState({
      snapshot: snapshot({
        mode: 'intense',
        roundIndex: 2,
        active: [{ id: 'ev1', kind: 'AFTERSHOCK', endsAfterRound: 3 }],
      }),
    });
    render(<EventsPanel />);

    fireEvent.click(screen.getByLabelText('查看'));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('餘震特報')).toBeInTheDocument();
    expect(within(dialog).queryByText('受影響路線')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `yarn workspace @trm/web test --run EventsPanel`
Expected: the 8 original tests still PASS; the 3 new tests FAIL (`受影響路線` never appears, and
`setEventSpotlight`/`eventSpotlight` don't exist yet on the store from this component's perspective
since it never calls them).

- [ ] **Step 3: Write the implementation**

Replace the full contents of `apps/web/src/components/EventsPanel.tsx` with:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Info, X } from 'lucide-react';
import type { RandomEventInfo } from '@trm/proto';
import { useGameStore } from '../store/game';
import { useUi } from '../store/ui';
import { useAnimationsStore } from '../store/animations';
import { usePlayerName } from '../game/playerName';
import { cityName, routeById } from '../game/content';
import { ownershipMap } from '../game/view';
import { eventDescKey, eventNameKey, roundsLeft } from '../game/events';

/**
 * Compact side-rail card summarising the live random-events state. Renders ONLY when the snapshot
 * carries a `random_events` block (i.e. the mode is not "off"); everything shown is derived purely
 * from that authoritative projection — active effects, open charters, the one-round forecast, and
 * the gala free-station window. City names resolve by id through the active content catalog. Each
 * kind-bearing row carries an info button opening a modal with that event's full description; for a
 * route-targeting kind (Sky Lantern, Typhoon Landfall) the modal also lists the currently-unclaimed
 * affected routes, each clickable to pan the board's camera straight to it.
 */
export function EventsPanel() {
  const { t } = useTranslation();
  const snapshot = useGameStore((s) => s.snapshot);
  const locale = useUi((s) => s.locale);
  const nameOf = usePlayerName();
  const setEventSpotlight = useAnimationsStore((s) => s.setEventSpotlight);
  const [infoKind, setInfoKind] = useState<string | null>(null);

  useEffect(() => {
    if (!infoKind) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setInfoKind(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [infoKind]);

  const ev = snapshot?.randomEvents;
  const owned = useMemo(() => (snapshot ? ownershipMap(snapshot) : null), [snapshot]);

  // The resolvable, currently-unclaimed route ids for whichever kind's info modal is open. At most
  // one active/forecast instance of a given kind exists at once (the schedule generator's
  // gap-spacing invariant never overlaps two windows), so matching purely on `kind` is unambiguous.
  const infoRouteIds = useMemo(() => {
    if (!ev || !infoKind) return [];
    const active = ev.active.find((a) => a.kind === infoKind)?.routeIds;
    const raw = active ?? (ev.forecast?.kind === infoKind ? ev.forecast.routeIds : []);
    return raw.filter((rid) => !owned?.has(rid) && routeById.has(rid));
  }, [ev, infoKind, owned]);

  if (!ev) return null;

  const me = snapshot?.you?.playerId ?? null;
  const seatOf = (id: string): number => snapshot?.players.find((p) => p.id === id)?.seat ?? 0;
  const forecast = ev.forecast;

  // The affected-target summary for one active entry: a city (hotspot) or a route count (typhoon /
  // sky-lantern), resolved by id — never a hardcoded name.
  const affected = (info: RandomEventInfo): string | null => {
    if (info.kind === 'VIRAL_HOTSPOT' && info.cityId) return cityName(info.cityId, locale);
    if (info.routeIds.length > 0) return t('events.affectedRoutes', { n: info.routeIds.length });
    return null;
  };

  return (
    <section className="events-panel tray-section" data-testid="events-panel">
      <div className="tray-head">
        <h4>{t('events.panelTitle')}</h4>
        <span className="events-chip">{t(`eventsMode_${ev.mode}`)}</span>
      </div>
      <div className="events-body">
        {ev.freeStationAvailable && (
          <div className="event-row event-free">{t('events.freeStation')}</div>
        )}

        {ev.active.map((info) => {
          const left = roundsLeft(info, ev.roundIndex);
          const summary = affected(info);
          return (
            <div key={info.id} className="event-row event-active">
              <span className="event-name">{t(eventNameKey(info.kind))}</span>
              {summary && <span className="event-summary">{summary}</span>}
              {left !== null && (
                <span className="event-rounds">{t('events.roundsLeft', { n: left })}</span>
              )}
              <button
                type="button"
                className="cell-view"
                aria-label={t('view')}
                title={t('view')}
                onClick={() => setInfoKind(info.kind)}
              >
                <Info size={13} aria-hidden />
              </button>
            </div>
          );
        })}

        {ev.charters.map((c) => (
          <div key={c.id} className="event-row event-charter">
            <span className="event-name">
              {t('events.charterOpen', {
                a: cityName(c.cityA, locale),
                b: cityName(c.cityB, locale),
                pts: c.points,
              })}
            </span>
            {c.wonByPlayerId !== '' && (
              <span className="event-won">
                {t('events.charterWon', {
                  name: nameOf({
                    id: c.wonByPlayerId,
                    seat: seatOf(c.wonByPlayerId),
                    isMe: c.wonByPlayerId === me,
                  }),
                })}
              </span>
            )}
            <button
              type="button"
              className="cell-view"
              aria-label={t('view')}
              title={t('view')}
              onClick={() => setInfoKind('CHARTER_SPECIAL')}
            >
              <Info size={13} aria-hidden />
            </button>
          </div>
        ))}

        {forecast && (
          <div className="event-row event-forecast">
            <span className="event-label">{t('events.forecast')}</span>
            <span className="event-name">{t(eventNameKey(forecast.kind))}</span>
            <span className="event-note">{t('events.startsNextRound')}</span>
            <button
              type="button"
              className="cell-view"
              aria-label={t('view')}
              title={t('view')}
              onClick={() => setInfoKind(forecast.kind)}
            >
              <Info size={13} aria-hidden />
            </button>
          </div>
        )}
      </div>

      {infoKind && (
        <div className="modal-backdrop" onClick={() => setInfoKind(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <h3>{t(eventNameKey(infoKind))}</h3>
              <button
                type="button"
                className="icon-button"
                aria-label={t('close')}
                onClick={() => setInfoKind(null)}
              >
                <X size={16} aria-hidden />
              </button>
            </div>
            <p>{t(eventDescKey(infoKind))}</p>
            {infoRouteIds.length > 0 && (
              <div className="event-route-section">
                <h4>{t('events.routeListTitle')}</h4>
                <ul className="event-route-list">
                  {infoRouteIds.map((rid) => {
                    const r = routeById.get(rid);
                    if (!r) return null;
                    return (
                      <li key={rid}>
                        <button
                          type="button"
                          className="event-route-item"
                          onClick={() => {
                            setEventSpotlight({ kind: 'route', ids: [rid] });
                            setInfoKind(null);
                          }}
                        >
                          {cityName(r.a, locale)}–{cityName(r.b, locale)}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `yarn workspace @trm/web test --run EventsPanel`
Expected: all 11 tests PASS.

- [ ] **Step 5: Lint and typecheck**

Run: `yarn lint` and `yarn typecheck`
Expected: both exit 0 with no new errors.

- [ ] **Step 6: Full web test suite**

Run: `yarn workspace @trm/web test`
Expected: exits 0 (no regression in unrelated suites — in particular `ScoreBoard.test.tsx`, which
also touches `useAnimations`' `routeReveal` field, and any suite that renders `Board`/`GameStage`).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/EventsPanel.tsx apps/web/src/components/EventsPanel.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): list affected routes in the sky-lantern/typhoon info modal

Sky Lantern and Typhoon Landfall target specific routes but the panel
only ever showed a count. The existing info modal now lists each
currently-unclaimed affected route by name, clickable to pan the board
straight to it via the new eventSpotlight camera target.
EOF
)"
```

## Self-Review Notes

- **Spec coverage:** generic scope (Task 5's helper matches on `kind`, not a hardcoded
  `SKY_LANTERN`/`TYPHOON_LANDFALL` check) ✓; both forecast + active rows ✓ (two dedicated tests);
  ownership filtering ✓ (R4-owned test case); click-to-pan via `eventSpotlight` ✓ (Tasks 1-2 +
  Task 5's click test); modal-merge (no second button) ✓; i18n key ✓; CSS ✓; regression coverage for
  kinds with no routes ✓ and for the pre-existing fake-id (`r1`/`r2`) fixtures ✓.
- **Placeholder scan:** none — every step has complete code and exact commands.
- **Type consistency:** `BoardFrameTarget` (from `game/boardView.ts`) used identically in
  `store/animations.ts` (Task 1), `Board.tsx` (Task 2), and `EventsPanel.tsx`'s
  `setEventSpotlight({ kind: 'route', ids: [rid] })` call (Task 5) — `kind: 'route'` matches the
  type's `'route' | 'cities'` union. `routeById: Map<string, RouteDef>` and `ownershipMap(snapshot):
Map<string, OwnershipInfo>` are used with the same signatures as their existing call sites in
  `Board.tsx`.
- **Task ordering:** Task 5 (the consumer) is last, after every dependency (store field, board
  wiring, i18n key, CSS) it needs already exists — each earlier task is independently testable/
  committable on its own, per the "self-contained deliverable" rule.
