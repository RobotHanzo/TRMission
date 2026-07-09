# Triple Rails + Parallel-Track Bug Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize the map's parallel-track model from exactly-2 "double" pairs to groups of 2 **or** 3 (one group per city pair, capped at 3), fixing the builder's "4 rails" bug and adding authored triple rails end-to-end.

**Architecture:** The `RouteDef.doubleGroup` field (`'A'`–`'J'`) is unchanged in name/shape but now identifies a 2- or 3-member parallel group. The engine's pairwise `doubleSibling` gains a `parallelGroup` (route → other members); claim/lock/exclusivity generalize over group membership using a new `openTrackCount(groupSize, players, singleFor23)` scaling helper that is exactly backward-compatible for doubles. The builder replaces "Convert to double" with a `[1][2][3]` track control backed by a normalizing `setPairTrackCount` store action. Rendering already spreads N members, so it needs no change.

**Tech Stack:** TypeScript monorepo (Yarn 4 + Turborepo). `@trm/map-data` + `@trm/engine` (pure TS, vitest). `apps/web` (React + Vite 5 + zustand + vitest + @testing-library/react). Engine purity is ESLint-enforced (no `Date`/`Math.random`).

## Global Constraints

- Determinism: `@trm/engine/src/**` must not use `Date`, `new Date()`, `Math.random`, `crypto.randomUUID`, or `Date.now`; iterate arrays (deterministic order), never rely on `Set`/`Map` iteration order for game logic. Copied verbatim from CLAUDE.md.
- Do **not** rename the `doubleGroup` field or the `doubleRouteSingleFor23` rule param (wired through lobby/admin/proto/persistence).
- Do **not** edit v4 authored content (`packages/map-data/src/routes.ts`) or its pinned hash (`packages/map-data/test/versions.spec.ts`) — another session owns the v4 migration. Validation stays lenient so `content.spec` stays green.
- Max parallelism is **3**. Never author or build a 4th parallel track.
- 6th card colour is **PURPLE** (never PINK); seat colours are abstract indices. (Not touched here, but repo-wide.)
- Multi-session worktree: stage only files you changed; never `git add -A`/`git add .`.
- The 8 route colours come from `TRAIN_COLORS` (`@trm/shared`) + `'GRAY'`.

---

### Task 1: map-data validation — allow 2–3 member groups, cap parallelism per pair

**Files:**
- Modify: `packages/map-data/src/validate.ts`
- Test: `packages/map-data/test/parallel-groups.spec.ts` (create)

**Interfaces:**
- Consumes: existing `validateContent(content): ValidationResult`, `pairKey`, `formatIssue`.
- Produces: `validateContent` now emits issue codes `doubleGroupInvalidSize` `{group,count}`, `tooManyParallelRoutes` `{pair,count}`, `multipleGroupsOnPair` `{pair,groups}` (in addition to the retained `doubleGroupDifferentPairs`/`doubleGroupLengthMismatch`). `ContentStats.doublePairCount` unchanged (counts distinct groups).

- [ ] **Step 1: Write the failing tests**

Create `packages/map-data/test/parallel-groups.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateContent } from '../src/validate';
import { buildRouteGeometryFor } from '../src/geometry';
import type { GameContent } from '../src/types';
import type { RouteColor } from '@trm/shared';

const city = (id: string, x = 0, y = 0) =>
  ({ id, nameZh: id, nameEn: id, x, y, region: 'r', isIsland: false }) as GameContent['cities'][number];
const route = (
  id: string,
  a: string,
  b: string,
  color: RouteColor,
  doubleGroup?: string,
  length = 1,
) =>
  ({ id, a, b, color, length, ferryLocos: 0, isTunnel: false, ...(doubleGroup ? { doubleGroup } : {}) }) as GameContent['routes'][number];
const content = (routes: GameContent['routes'][number][]): GameContent => ({
  meta: { mapId: 'm', version: 1, nameZh: 'm', nameEn: 'm' },
  // two cities connected + a third so the graph is connected regardless of parallel edges
  cities: [city('a', 0, 0), city('b', 10, 0), city('c', 20, 0)],
  routes: [...routes, route('link', 'b', 'c', 'RED')],
  tickets: [],
});

describe('parallel-group validation', () => {
  it('accepts a 3-member (triple) group of equal length between one pair', () => {
    const res = validateContent(
      content([
        route('t1', 'a', 'b', 'RED', 'A'),
        route('t2', 'a', 'b', 'BLUE', 'A'),
        route('t3', 'a', 'b', 'GREEN', 'A'),
      ]),
    );
    expect(res.ok).toBe(true);
  });

  it('accepts a plain single route alongside a 2-member group on the same pair (v4 taipei-banqiao shape)', () => {
    const res = validateContent(
      content([
        route('u', 'a', 'b', 'ORANGE'),
        route('g1', 'a', 'b', 'GREEN', 'H'),
        route('g2', 'a', 'b', 'GRAY', 'H'),
      ]),
    );
    expect(res.ok).toBe(true); // 3 routes, one group H → allowed
  });

  it('rejects a 4-member group', () => {
    const res = validateContent(
      content([
        route('q1', 'a', 'b', 'RED', 'A'),
        route('q2', 'a', 'b', 'BLUE', 'A'),
        route('q3', 'a', 'b', 'GREEN', 'A'),
        route('q4', 'a', 'b', 'YELLOW', 'A'),
      ]),
    );
    expect(res.ok).toBe(false);
    expect(res.issues.map((i) => i.code)).toContain('doubleGroupInvalidSize');
    expect(res.issues.map((i) => i.code)).toContain('tooManyParallelRoutes');
  });

  it('rejects two distinct groups on the same city pair (the "4 rails" bug)', () => {
    const res = validateContent(
      content([
        route('a1', 'a', 'b', 'RED', 'A'),
        route('a2', 'a', 'b', 'BLUE', 'A'),
        route('b1', 'a', 'b', 'GREEN', 'B'),
        route('b2', 'a', 'b', 'YELLOW', 'B'),
      ]),
    );
    expect(res.ok).toBe(false);
    expect(res.issues.map((i) => i.code)).toContain('multipleGroupsOnPair');
  });

  it('rejects a 1-member group', () => {
    const res = validateContent(content([route('s', 'a', 'b', 'RED', 'A')]));
    expect(res.ok).toBe(false);
    expect(res.issues.map((i) => i.code)).toContain('doubleGroupInvalidSize');
  });

  it('rejects a triple whose members differ in length', () => {
    const res = validateContent(
      content([
        route('m1', 'a', 'b', 'RED', 'A', 2),
        route('m2', 'a', 'b', 'BLUE', 'A', 2),
        route('m3', 'a', 'b', 'GREEN', 'A', 3),
      ]),
    );
    expect(res.ok).toBe(false);
    expect(res.issues.map((i) => i.code)).toContain('doubleGroupLengthMismatch');
  });

  it('renders a 3-member group as three evenly spaced parallel tracks', () => {
    const { geometry } = buildRouteGeometryFor(
      [city('a', 0, 0), city('b', 10, 0)],
      [
        route('t1', 'a', 'b', 'RED', 'A'),
        route('t2', 'a', 'b', 'BLUE', 'A'),
        route('t3', 'a', 'b', 'GREEN', 'A'),
      ],
    );
    // perp offsets separate the three tracks; gaps are equal-and-opposite around 0.
    const perps = ['t1', 't2', 't3'].map((id) => geometry.get(id)!.perp);
    const signed = perps.map((p) => p.y); // chord is horizontal → nudge is along y
    const sorted = [...signed].sort((a, b) => a - b);
    expect(sorted[0]).toBeLessThan(0);
    expect(Math.abs(sorted[1])).toBeLessThan(1e-9); // middle track centred
    expect(sorted[2]).toBeGreaterThan(0);
    expect(Math.abs(sorted[0] + sorted[2])).toBeLessThan(1e-9); // symmetric
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn workspace @trm/map-data test --run parallel-groups`
Expected: FAIL — the triple case reports `doubleGroupInvalidSize` is not yet a code and the current code emits `doubleGroupWrongCount` for the 3-member group (so `res.ok` is false for the "accepts triple" test).

- [ ] **Step 3: Update `validate.ts` — group size + per-pair checks**

In `packages/map-data/src/validate.ts`, replace the `formatIssue` case for `doubleGroupWrongCount`:

```ts
    case 'doubleGroupWrongCount':
      return `double group ${p.group}: expected exactly 2 routes, got ${p.count}`;
```

with these three cases (keep the two after them):

```ts
    case 'doubleGroupInvalidSize':
      return `parallel group ${p.group}: expected 2 or 3 routes, got ${p.count}`;
    case 'tooManyParallelRoutes':
      return `city pair ${p.pair}: ${p.count} parallel routes exceeds the maximum of 3`;
    case 'multipleGroupsOnPair':
      return `city pair ${p.pair}: has more than one parallel group (${p.groups})`;
```

Then replace the `// --- double-route pairs ---` loop:

```ts
  // --- double-route pairs ---
  for (const [group, members] of doubleGroups) {
    if (members.length !== 2) {
      push('doubleGroupWrongCount', { group, count: members.length });
      continue;
    }
    const [m0, m1] = members as [RouteDef, RouteDef];
    if (pairKey(m0.a as string, m0.b as string) !== pairKey(m1.a as string, m1.b as string)) {
      push('doubleGroupDifferentPairs', { group });
    }
    if (m0.length !== m1.length) {
      push('doubleGroupLengthMismatch', { group });
    }
  }
```

with the generalized version + a per-pair cap:

```ts
  // --- parallel-route groups (2 or 3 members between one city pair) ---
  for (const [group, members] of doubleGroups) {
    if (members.length < 2 || members.length > 3) {
      push('doubleGroupInvalidSize', { group, count: members.length });
      continue;
    }
    const first = members[0] as RouteDef;
    const firstPair = pairKey(first.a as string, first.b as string);
    if (members.some((m) => pairKey(m.a as string, m.b as string) !== firstPair)) {
      push('doubleGroupDifferentPairs', { group });
    }
    if (members.some((m) => m.length !== first.length)) {
      push('doubleGroupLengthMismatch', { group });
    }
  }

  // --- per-pair parallelism cap: at most 3 routes and at most 1 group per city pair ---
  const routesByPair = new Map<string, RouteDef[]>();
  for (const r of routes) {
    const k = pairKey(r.a as string, r.b as string);
    const arr = routesByPair.get(k) ?? [];
    arr.push(r);
    routesByPair.set(k, arr);
  }
  for (const [pair, rs] of routesByPair) {
    if (rs.length > 3) push('tooManyParallelRoutes', { pair, count: rs.length });
    const groups = new Set(rs.map((r) => r.doubleGroup).filter(Boolean));
    if (groups.size > 1) push('multipleGroupsOnPair', { pair, groups: [...groups].join(',') });
  }
```

- [ ] **Step 4: Run the new + existing map-data tests**

Run: `yarn workspace @trm/map-data test --run`
Expected: PASS — `parallel-groups.spec.ts` all green; `content.spec.ts` (`doublePairCount` = 11, `validateContent(TAIWAN_CONTENT).ok`), `double-ferry.spec.ts`, `double-tunnel.spec.ts` still green (bundled content has only size-2 groups + at most 3 routes/pair with one group).

- [ ] **Step 5: Commit**

```bash
git add packages/map-data/src/validate.ts packages/map-data/test/parallel-groups.spec.ts
git commit -m "feat(map-data): validate parallel groups of 2 or 3; cap 3 routes / 1 group per pair"
```

---

### Task 2: engine board — parallel-group membership

**Files:**
- Modify: `packages/engine/src/board.ts`, `packages/engine/src/index.ts`
- Test: `packages/engine/test/board-group.spec.ts` (create)

**Interfaces:**
- Consumes: `buildBoard(content): Board`.
- Produces: `Board.parallelGroup: ReadonlyMap<string, readonly RouteId[]>` (route id → other members of its 2–3 group); helpers `groupMembersOf(board, id): readonly RouteId[]` and `groupSizeOf(board, id): number`; existing `siblingOf`/`doubleSibling` retained (pairwise, size-2 only). All exported from `index.ts`.

- [ ] **Step 1: Write the failing test**

Create `packages/engine/test/board-group.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { asCityId, asRouteId } from '@trm/shared';
import type { GameContent } from '@trm/map-data';
import { buildBoard, groupMembersOf, groupSizeOf, siblingOf } from '../src/board';

const c = (id: string, x = 0) =>
  ({ id: asCityId(id), nameZh: id, nameEn: id, x, y: 0, region: 't', isIsland: false });
const r = (id: string, a: string, b: string, doubleGroup?: string) => ({
  id: asRouteId(id),
  a: asCityId(a),
  b: asCityId(b),
  color: 'RED' as const,
  length: 1 as const,
  ferryLocos: 0,
  isTunnel: false,
  ...(doubleGroup ? { doubleGroup } : {}),
});
const content: GameContent = {
  meta: { mapId: 'm', version: 1, nameZh: 'm', nameEn: 'm' },
  cities: [c('a'), c('b', 10)],
  routes: [
    r('D1', 'a', 'b', 'A'),
    r('D2', 'a', 'b', 'A'),
    r('T1', 'a', 'b', 'B'),
    r('T2', 'a', 'b', 'B'),
    r('T3', 'a', 'b', 'B'),
    r('S1', 'a', 'b'),
  ],
  tickets: [],
};

describe('board parallel groups', () => {
  const board = buildBoard(content);

  it('links the two members of a double group', () => {
    expect([...groupMembersOf(board, asRouteId('D1'))]).toEqual([asRouteId('D2')]);
    expect(groupSizeOf(board, asRouteId('D1'))).toBe(2);
    expect(siblingOf(board, asRouteId('D1'))).toBe(asRouteId('D2'));
  });

  it('links all other members of a triple group', () => {
    expect([...groupMembersOf(board, asRouteId('T2'))].sort()).toEqual(
      [asRouteId('T1'), asRouteId('T3')].sort(),
    );
    expect(groupSizeOf(board, asRouteId('T1'))).toBe(3);
  });

  it('treats a lone route as a size-1 group with no members', () => {
    expect(groupMembersOf(board, asRouteId('S1'))).toEqual([]);
    expect(groupSizeOf(board, asRouteId('S1'))).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn workspace @trm/engine test --run board-group`
Expected: FAIL — `groupMembersOf`/`groupSizeOf` are not exported.

- [ ] **Step 3: Implement in `board.ts`**

Add to the `Board` interface (after the `doubleSibling` line):

```ts
  /** routeId → the OTHER members of its parallel group (2–3 routes); empty for lone routes. */
  readonly parallelGroup: ReadonlyMap<string, readonly RouteId[]>;
```

In `buildBoard`, add next to the other maps:

```ts
  const parallelGroup = new Map<string, readonly RouteId[]>();
```

Replace the `for (const members of byGroup.values())` loop:

```ts
  for (const members of byGroup.values()) {
    if (members.length === 2) {
      const [m0, m1] = members as [RouteDef, RouteDef];
      doubleSibling.set(m0.id as string, m1.id);
      doubleSibling.set(m1.id as string, m0.id);
    }
  }
```

with:

```ts
  for (const members of byGroup.values()) {
    if (members.length < 2 || members.length > 3) continue;
    for (const m of members) {
      parallelGroup.set(
        m.id as string,
        members.filter((x) => x.id !== m.id).map((x) => x.id),
      );
    }
    // Retain the pairwise sibling map for size-2 groups (used by legacy event-effect helpers).
    if (members.length === 2) {
      const [m0, m1] = members as [RouteDef, RouteDef];
      doubleSibling.set(m0.id as string, m1.id);
      doubleSibling.set(m1.id as string, m0.id);
    }
  }
```

Add `parallelGroup` to the returned object, then add the two helpers after `siblingOf`:

```ts
export const groupMembersOf = (board: Board, id: RouteId): readonly RouteId[] =>
  board.parallelGroup.get(id as string) ?? [];
export const groupSizeOf = (board: Board, id: RouteId): number => {
  const others = board.parallelGroup.get(id as string);
  return others ? others.length + 1 : 1;
};
```

In `packages/engine/src/index.ts`, extend the board export line:

```ts
export { buildBoard, getRoute, getTicket, siblingOf, incidentRoutes } from './board';
```

to:

```ts
export {
  buildBoard,
  getRoute,
  getTicket,
  siblingOf,
  groupMembersOf,
  groupSizeOf,
  incidentRoutes,
} from './board';
```

- [ ] **Step 4: Run to verify it passes**

Run: `yarn workspace @trm/engine test --run board-group`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/board.ts packages/engine/src/index.ts packages/engine/test/board-group.spec.ts
git commit -m "feat(engine): add parallelGroup membership (2-3) to Board"
```

---

### Task 3: engine config — `openTrackCount` scaling helper

**Files:**
- Modify: `packages/engine/src/config.ts`, `packages/engine/src/index.ts`
- Test: `packages/engine/test/open-track-count.spec.ts` (create)

**Interfaces:**
- Produces: `openTrackCount(groupSize: number, playerCount: number, singleFor23: boolean): number` = `singleFor23 ? min(groupSize, max(1, playerCount − 2)) : groupSize`. Removes `variantForPlayerCount` / `DoubleRouteVariant` (engine-internal; only `reduce.ts` + index re-export used them).

- [ ] **Step 1: Write the failing test**

Create `packages/engine/test/open-track-count.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { openTrackCount } from '../src/config';

describe('openTrackCount', () => {
  it('matches the current double behavior when the setting is on', () => {
    expect(openTrackCount(2, 2, true)).toBe(1);
    expect(openTrackCount(2, 3, true)).toBe(1);
    expect(openTrackCount(2, 4, true)).toBe(2);
    expect(openTrackCount(2, 5, true)).toBe(2);
  });

  it('scales a triple: 1 at 2-3p, 2 at 4p, 3 at 5p when the setting is on', () => {
    expect(openTrackCount(3, 2, true)).toBe(1);
    expect(openTrackCount(3, 3, true)).toBe(1);
    expect(openTrackCount(3, 4, true)).toBe(2);
    expect(openTrackCount(3, 5, true)).toBe(3);
  });

  it('opens every track regardless of player count when the setting is off', () => {
    expect(openTrackCount(2, 2, false)).toBe(2);
    expect(openTrackCount(3, 2, false)).toBe(3);
    expect(openTrackCount(3, 5, false)).toBe(3);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn workspace @trm/engine test --run open-track-count`
Expected: FAIL — `openTrackCount` not exported.

- [ ] **Step 3: Implement in `config.ts` (additive — leave `variantForPlayerCount` in place for now)**

Append to `packages/engine/src/config.ts` (keep the existing `DoubleRouteVariant`/`variantForPlayerCount` — Task 4 removes them once `reduce.ts` stops using them, so the engine stays buildable between tasks):

```ts
/**
 * How many tracks of a parallel group (2 or 3 routes between one pair) may be claimed.
 * With `doubleRouteSingleFor23` on (the default), the count scales with the player count:
 * 2–3p → 1, 4p → 2, 5p → 3 (clamped to the group's size), which is exactly the historical
 * double behavior (2 open at 4–5p, 1 open at 2–3p). With the flag off, every track is open.
 */
export const openTrackCount = (
  groupSize: number,
  playerCount: number,
  singleFor23: boolean,
): number => (singleFor23 ? Math.min(groupSize, Math.max(1, playerCount - 2)) : groupSize);
```

In `packages/engine/src/index.ts`, add the `openTrackCount` value export next to the existing config exports (leave the `variantForPlayerCount`/`DoubleRouteVariant` exports for now):

```ts
export { variantForPlayerCount, openTrackCount } from './config';
```

- [ ] **Step 4: Run to verify it passes**

Run: `yarn workspace @trm/engine test --run open-track-count`
Expected: PASS. The full engine build stays green (nothing was removed yet).

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/config.ts packages/engine/src/index.ts packages/engine/test/open-track-count.spec.ts
git commit -m "feat(engine): replace variantForPlayerCount with openTrackCount scaling helper"
```

---

### Task 4: engine reduce + invariants — generalized claim guard, lock, exclusivity

**Files:**
- Modify: `packages/engine/src/reduce.ts`, `packages/engine/src/invariants.ts`
- Test: `packages/engine/test/rules.spec.ts` (add a `describe('triple routes', …)` block)

**Interfaces:**
- Consumes: `groupMembersOf`, `groupSizeOf` (Task 2), `openTrackCount` (Task 3).
- Produces: claiming a track locks all remaining group members once the group's owned count reaches `openTrackCount(...)`; owning two members of a group is rejected with `DOUBLE_ROUTE_OWN_BOTH`; invariant forbids a player owning two members of a group. Doubles behave identically to before.

- [ ] **Step 1: Write the failing tests**

In `packages/engine/test/rules.spec.ts`, add after the existing `describe('double routes', …)` block a purpose-built triple board (mirrors the `double-ferry` pattern already in the file):

```ts
describe('triple routes', () => {
  // Custom 3-member parallel group so we can exercise the open-track scaling; the bundled
  // Taiwan map has no triple by its authoring convention.
  const tripleContent: GameContent = {
    meta: { mapId: 'test-triple', version: 1, nameZh: '三軌測試', nameEn: 'Triple Test' },
    cities: [
      { id: asCityId('x1'), nameZh: '甲', nameEn: 'X1', x: 0, y: 0, region: 'test', isIsland: false },
      { id: asCityId('x2'), nameZh: '乙', nameEn: 'X2', x: 10, y: 0, region: 'test', isIsland: false },
    ],
    routes: [
      { id: asRouteId('T1'), a: asCityId('x1'), b: asCityId('x2'), color: 'RED', length: 1, ferryLocos: 0, isTunnel: false, doubleGroup: 'A' },
      { id: asRouteId('T2'), a: asCityId('x1'), b: asCityId('x2'), color: 'BLUE', length: 1, ferryLocos: 0, isTunnel: false, doubleGroup: 'A' },
      { id: asRouteId('T3'), a: asCityId('x1'), b: asCityId('x2'), color: 'GREEN', length: 1, ferryLocos: 0, isTunnel: false, doubleGroup: 'A' },
    ],
    tickets: [],
  };
  const tripleBoard = buildBoard(tripleContent);
  const applyT = (state: GameState, action: Action) => reduce(tripleBoard, state, action);
  const claim = (routeId: string, color: CardColor): Action => ({
    t: 'CLAIM_ROUTE',
    player: p0,
    routeId: asRouteId(routeId),
    payment: { color, colorCount: 1, locomotives: 0 },
  });

  it('locks BOTH other tracks in a 2-player game (only 1 open)', () => {
    const state = st({ numPlayers: 2, hands: { p0: { RED: 1 } } });
    const res = applyT(state, claim('T1', 'RED'));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.state.ownership['T1']).toEqual({ owner: p0 });
    expect(res.value.state.ownership['T2']).toEqual({ locked: true });
    expect(res.value.state.ownership['T3']).toEqual({ locked: true });
  });

  it('opens 2 of 3 tracks in a 4-player game: first claim locks nothing, second locks the third', () => {
    const p1 = asPlayerId('p1');
    const state = st({ numPlayers: 4, hands: { p0: { RED: 1 }, p1: { BLUE: 1 } } });
    const r1 = applyT(state, claim('T1', 'RED'));
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.value.state.ownership['T2']).toBeUndefined();
    expect(r1.value.state.ownership['T3']).toBeUndefined();
    const r2 = applyT(r1.value.state, {
      t: 'CLAIM_ROUTE',
      player: p1,
      routeId: asRouteId('T2'),
      payment: { color: 'BLUE', colorCount: 1, locomotives: 0 },
    });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.value.state.ownership['T2']).toEqual({ owner: p1 });
    expect(r2.value.state.ownership['T3']).toEqual({ locked: true });
  });

  it('opens all 3 tracks in a 5-player game', () => {
    const p1 = asPlayerId('p1');
    const p2 = asPlayerId('p2');
    const state = st({ numPlayers: 5, hands: { p0: { RED: 1 }, p1: { BLUE: 1 }, p2: { GREEN: 1 } } });
    const r1 = applyT(state, claim('T1', 'RED'));
    if (!r1.ok) throw new Error('r1');
    const r2 = applyT(r1.value.state, {
      t: 'CLAIM_ROUTE', player: p1, routeId: asRouteId('T2'),
      payment: { color: 'BLUE', colorCount: 1, locomotives: 0 },
    });
    if (!r2.ok) throw new Error('r2');
    expect(r2.value.state.ownership['T3']).toBeUndefined(); // still open
    const r3 = applyT(r2.value.state, {
      t: 'CLAIM_ROUTE', player: p2, routeId: asRouteId('T3'),
      payment: { color: 'GREEN', colorCount: 1, locomotives: 0 },
    });
    expect(r3.ok).toBe(true);
    if (!r3.ok) return;
    expect(r3.value.state.ownership['T3']).toEqual({ owner: p2 });
  });

  it('rejects one player owning two tracks of a triple', () => {
    const owned: Record<string, OwnerCell> = { T1: { owner: p0 } };
    const state = st({ numPlayers: 5, hands: { p0: { BLUE: 1 } }, ownership: owned });
    const res = applyT(state, claim('T2', 'BLUE'));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('DOUBLE_ROUTE_OWN_BOTH');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn workspace @trm/engine test --run rules`
Expected: FAIL — triple locking not implemented (`T2`/`T3` not locked); also `reduce.ts` currently imports the now-removed `variantForPlayerCount`/`siblingOf`-only path (compile error until Step 3).

- [ ] **Step 3: Update `reduce.ts`**

Change the import line:

```ts
import { getRoute, siblingOf } from './board';
import { variantForPlayerCount } from './config';
```

to:

```ts
import { getRoute, groupMembersOf } from './board';
import { openTrackCount } from './config';
```

Now `variantForPlayerCount`/`DoubleRouteVariant` have no remaining users — delete them. In `packages/engine/src/config.ts` remove:

```ts
/** Player counts of 2–3 use the "only one of each double-route" variant (SINGLE_ONLY) when
 *  `doubleRouteSingleFor23` is enabled. With the flag off all games use BOTH. */
export type DoubleRouteVariant = 'SINGLE_ONLY' | 'BOTH';

export const variantForPlayerCount = (n: number, singleFor23: boolean): DoubleRouteVariant =>
  n <= 3 && singleFor23 ? 'SINGLE_ONLY' : 'BOTH';
```

and in `packages/engine/src/index.ts` change:

```ts
export type { GameConfig, PlayerSeed, DoubleRouteVariant } from './config';
export { variantForPlayerCount, openTrackCount } from './config';
```

to:

```ts
export type { GameConfig, PlayerSeed } from './config';
export { openTrackCount } from './config';
```

In `validateClaim`, replace the sibling guard:

```ts
  const sib = siblingOf(board, routeId);
  if (sib) {
    const sibCell = state.ownership[sib as string];
    if (sibCell && 'owner' in sibCell && sibCell.owner === player) {
      return err(violation('DOUBLE_ROUTE_OWN_BOTH', 'cannot own both of a double route'));
    }
  }
  return ok(route);
```

with:

```ts
  for (const other of groupMembersOf(board, routeId)) {
    const oc = state.ownership[other as string];
    if (oc && 'owner' in oc && oc.owner === player) {
      return err(violation('DOUBLE_ROUTE_OWN_BOTH', 'cannot own two tracks of a parallel route'));
    }
  }
  return ok(route);
```

In `applyClaimEffects`, replace the lock block:

```ts
  // Sibling lock is emitted AFTER the claim/bonus events; buffer it here.
  const lockedEvents: GameEvent[] = [];
  const variant = variantForPlayerCount(
    state.turnOrder.length,
    state.ruleParams.doubleRouteSingleFor23,
  );
  if (variant === 'SINGLE_ONLY') {
    const sib = siblingOf(board, route.id);
    if (sib && !next.ownership[sib as string]) {
      next = setOwnership(next, sib as string, { locked: true });
      lockedEvents.push({ e: 'DOUBLE_ROUTE_LOCKED', routeId: sib, visibility: 'PUBLIC' });
    }
  }
```

with:

```ts
  // Parallel-group lock is emitted AFTER the claim/bonus events; buffer it here. Once the group's
  // owned tracks reach the open-track count, every remaining track locks. For a 2-member group at
  // 2–3p this reduces to the historical "lock the one sibling."
  const lockedEvents: GameEvent[] = [];
  const groupMembers = groupMembersOf(board, route.id);
  if (groupMembers.length > 0) {
    const open = openTrackCount(
      groupMembers.length + 1,
      state.turnOrder.length,
      state.ruleParams.doubleRouteSingleFor23,
    );
    let owned = 1; // the route just claimed
    for (const other of groupMembers) {
      const oc = next.ownership[other as string];
      if (oc && 'owner' in oc) owned++;
    }
    if (owned >= open) {
      for (const other of groupMembers) {
        if (!next.ownership[other as string]) {
          next = setOwnership(next, other as string, { locked: true });
          lockedEvents.push({ e: 'DOUBLE_ROUTE_LOCKED', routeId: other, visibility: 'PUBLIC' });
        }
      }
    }
  }
```

In the `legalActions`/`hasClaimMove` availability scan (the `for (const route of board.content.routes)` loop), replace:

```ts
      const sib = siblingOf(board, route.id);
      if (sib) {
        const sc = state.ownership[sib as string];
        if (sc && 'owner' in sc && sc.owner === player) continue;
      }
```

with:

```ts
      const ownsGroupMember = groupMembersOf(board, route.id).some((other) => {
        const sc = state.ownership[other as string];
        return sc && 'owner' in sc && sc.owner === player;
      });
      if (ownsGroupMember) continue;
```

- [ ] **Step 4: Update `invariants.ts`**

Replace the exclusivity block:

```ts
  // 3. Ownership exclusivity: no player owns both edges of a double-route pair.
  for (const [routeId, cell] of Object.entries(state.ownership)) {
    if ('owner' in cell) {
      const sib = board.doubleSibling.get(routeId);
      if (sib) {
        const sc = state.ownership[sib as string];
        if (sc && 'owner' in sc && sc.owner === cell.owner) {
          problems.push(
            `double-route exclusivity: ${cell.owner as string} owns both ${routeId} and ${sib as string}`,
          );
        }
      }
    }
  }
```

with:

```ts
  // 3. Ownership exclusivity: no player owns two members of a parallel group.
  for (const [routeId, cell] of Object.entries(state.ownership)) {
    if ('owner' in cell) {
      for (const other of board.parallelGroup.get(routeId) ?? []) {
        const sc = state.ownership[other as string];
        if (sc && 'owner' in sc && sc.owner === cell.owner) {
          problems.push(
            `parallel-route exclusivity: ${cell.owner as string} owns both ${routeId} and ${other as string}`,
          );
        }
      }
    }
  }
```

- [ ] **Step 5: Run the full engine suite (triples + regression + goldens)**

Run: `yarn workspace @trm/engine test --run`
Expected: PASS — new `triple routes` block green; existing `double routes`, `double-ferry`, `double-tunnel`, golden-replay, invariants/property suites all still green (double behavior byte-identical). If a golden digest changed, STOP — the double path was altered; re-verify the `openTrackCount`/lock equivalence before proceeding.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/reduce.ts packages/engine/src/invariants.ts packages/engine/test/rules.spec.ts
git commit -m "feat(engine): generalize double-route claim/lock/exclusivity to 2-3 parallel groups"
```

---

### Task 5: builder store — `setPairTrackCount` replaces `convertToDouble`

**Files:**
- Modify: `apps/web/src/features/builder/editor/store.ts`
- Test: `apps/web/src/features/builder/editor/store.test.ts` (replace the `convertToDouble` cases)

**Interfaces:**
- Consumes: `mutate`, `newRouteId`, `nextDoubleGroupLetter`, `RouteDraft`.
- Produces: `setPairTrackCount(id: string, count: 1 | 2 | 3): void` on `EditorState` — normalizes all routes on the target's city pair into a single group of `count` (mint/drop siblings, one shared letter, equal length = target's, minted siblings recoloured). One undo step. `convertToDouble` removed.

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/features/builder/editor/store.test.ts`, delete the six `convertToDouble …` `it(...)` blocks and the `reverts convertToDouble …` block, and add:

```ts
  describe('setPairTrackCount', () => {
    it('1→2 mints a sibling, one group, alternate colour, equal length', () => {
      const s = useEditorStore.getState();
      s.placeCity(city('c1'));
      s.placeCity(city('c2', 10));
      s.addRoute(route('r1', 'c1', 'c2', { color: 'RED', length: 3 }));

      s.setPairTrackCount('r1', 2);

      const routes = useEditorStore.getState().draft.routes;
      expect(routes).toHaveLength(2);
      const group = routes.find((r) => r.id === 'r1')!.doubleGroup;
      expect(group).toBe('A');
      const sibling = routes.find((r) => r.id !== 'r1')!;
      expect(sibling).toMatchObject({ a: 'c1', b: 'c2', length: 3, color: 'BLUE', doubleGroup: 'A' });
    });

    it('2→3 mints a third track, all one group, equal length', () => {
      const s = useEditorStore.getState();
      s.placeCity(city('c1'));
      s.placeCity(city('c2', 10));
      s.addRoute(route('r1', 'c1', 'c2', { doubleGroup: 'A' }));
      s.addRoute(route('r2', 'c1', 'c2', { color: 'BLUE', doubleGroup: 'A' }));

      s.setPairTrackCount('r1', 3);

      const routes = useEditorStore.getState().draft.routes;
      expect(routes).toHaveLength(3);
      expect(new Set(routes.map((r) => r.doubleGroup))).toEqual(new Set(['A']));
      expect(routes.every((r) => r.a === 'c1' && r.b === 'c2' && r.length === 2)).toBe(true);
    });

    it('3→2 drops one track', () => {
      const s = useEditorStore.getState();
      s.placeCity(city('c1'));
      s.placeCity(city('c2', 10));
      s.addRoute(route('r1', 'c1', 'c2', { doubleGroup: 'A' }));
      s.addRoute(route('r2', 'c1', 'c2', { doubleGroup: 'A' }));
      s.addRoute(route('r3', 'c1', 'c2', { doubleGroup: 'A' }));

      s.setPairTrackCount('r1', 2);

      const routes = useEditorStore.getState().draft.routes;
      expect(routes).toHaveLength(2);
      expect(routes.map((r) => r.id).sort()).toEqual(['r1', 'r2']);
    });

    it('2→1 strips the group, leaving a single plain route', () => {
      const s = useEditorStore.getState();
      s.placeCity(city('c1'));
      s.placeCity(city('c2', 10));
      s.addRoute(route('r1', 'c1', 'c2', { doubleGroup: 'A' }));
      s.addRoute(route('r2', 'c1', 'c2', { doubleGroup: 'A' }));

      s.setPairTrackCount('r1', 1);

      const routes = useEditorStore.getState().draft.routes;
      expect(routes).toHaveLength(1);
      expect(routes[0]).toMatchObject({ id: 'r1' });
      expect(routes[0]!.doubleGroup).toBeUndefined();
    });

    it('picks the next free group letter when others exist', () => {
      const s = useEditorStore.getState();
      s.placeCity(city('c1'));
      s.placeCity(city('c2', 10));
      s.placeCity(city('c3', 20));
      s.addRoute(route('x1', 'c1', 'c2', { doubleGroup: 'A' }));
      s.addRoute(route('x2', 'c1', 'c2', { doubleGroup: 'A' }));
      s.addRoute(route('r3', 'c2', 'c3'));

      s.setPairTrackCount('r3', 2);

      const routes = useEditorStore.getState().draft.routes;
      expect(routes.find((r) => r.id === 'r3')!.doubleGroup).toBe('B');
    });

    it('normalizes a messy pair (two groups on one pair) into a single clean group', () => {
      const s = useEditorStore.getState();
      s.placeCity(city('c1'));
      s.placeCity(city('c2', 10));
      s.addRoute(route('a1', 'c1', 'c2', { doubleGroup: 'A' }));
      s.addRoute(route('a2', 'c1', 'c2', { doubleGroup: 'A' }));
      s.addRoute(route('b1', 'c1', 'c2', { doubleGroup: 'B' }));
      s.addRoute(route('b2', 'c1', 'c2', { doubleGroup: 'B' }));

      s.setPairTrackCount('a1', 2);

      const routes = useEditorStore.getState().draft.routes;
      expect(routes).toHaveLength(2);
      expect(new Set(routes.map((r) => r.doubleGroup))).toEqual(new Set(['A']));
    });

    it('reverts a track-count change in a single undo step', () => {
      const s = useEditorStore.getState();
      s.placeCity(city('c1'));
      s.placeCity(city('c2', 10));
      s.addRoute(route('r1', 'c1', 'c2'));

      s.setPairTrackCount('r1', 2);
      expect(useEditorStore.getState().draft.routes).toHaveLength(2);

      useEditorStore.getState().undo();

      const routes = useEditorStore.getState().draft.routes;
      expect(routes).toHaveLength(1);
      expect(routes[0]!.doubleGroup).toBeUndefined();
    });
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn workspace @trm/web test --run store.test`
Expected: FAIL — `setPairTrackCount` is not a function.

- [ ] **Step 3: Implement in `store.ts`**

In the `EditorState` interface, replace:

```ts
  convertToDouble(id: string): void;
```

with:

```ts
  /** Normalize all routes on the target route's city pair into ONE parallel group of `count`
   *  tracks (1 = single/no group, 2 = double, 3 = triple). Mints or drops sibling routes as
   *  needed and re-groups them under a single letter; one undo step. */
  setPairTrackCount(id: string, count: 1 | 2 | 3): void;
```

Replace the entire `convertToDouble: (id) => { … },` implementation with:

```ts
  setPairTrackCount: (id, count) => {
    const { draft } = get();
    const target = draft.routes.find((r) => r.id === id);
    if (!target) return;
    const clamped = Math.max(1, Math.min(3, Math.round(count)));
    const onPair = (r: RouteDraft): boolean =>
      (r.a === target.a && r.b === target.b) || (r.a === target.b && r.b === target.a);
    // Target first, then the pair's other routes in draft order.
    const pairRoutes = [target, ...draft.routes.filter((r) => r.id !== target.id && onPair(r))];
    const others = draft.routes.filter((r) => !onPair(r));

    if (clamped === 1) {
      const { doubleGroup: _drop, ...survivor } = target;
      mutate(get, set, { ...draft, routes: [...others, survivor] });
      return;
    }

    // Reuse the pair's existing group letter if any; otherwise the next free one.
    const existingLetter = pairRoutes.map((r) => r.doubleGroup).find(Boolean);
    const group =
      existingLetter ??
      nextDoubleGroupLetter([
        ...new Set(draft.routes.map((r) => r.doubleGroup).filter(Boolean)),
      ] as string[]);
    // Minted siblings mirror the target (ferry stays GRAY; otherwise flip RED↔BLUE).
    const siblingColor =
      target.ferryLocos > 0 ? target.color : target.color === 'RED' ? 'BLUE' : 'RED';

    const grouped: RouteDraft[] = [];
    for (let i = 0; i < clamped; i++) {
      const existing = pairRoutes[i];
      if (existing) {
        grouped.push({ ...existing, length: target.length, doubleGroup: group });
      } else {
        grouped.push({
          ...target,
          id: newRouteId(),
          color: siblingColor,
          length: target.length,
          doubleGroup: group,
        });
      }
    }
    mutate(get, set, { ...draft, routes: [...others, ...grouped] });
  },
```

- [ ] **Step 4: Run to verify it passes**

Run: `yarn workspace @trm/web test --run store.test`
Expected: PASS — all `setPairTrackCount` cases green; the rest of `store.test.ts` (setRouteBow, undo/redo, save, geography, tickets) unchanged and green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/builder/editor/store.ts apps/web/src/features/builder/editor/store.test.ts
git commit -m "feat(builder): setPairTrackCount normalizes a pair into one 1-3 track group"
```

---

### Task 6: builder UI + i18n — `[1][2][3]` track control, no duplicate-pair draws

**Files:**
- Modify: `apps/web/src/features/builder/editor/stages/RoutesStage.tsx`
- Modify: `apps/web/src/i18n/index.ts` (builder label + validation code strings)
- Test: `apps/web/src/features/builder/editor/stages/RoutesStage.test.tsx` (rewrite the double cases)

**Interfaces:**
- Consumes: `setPairTrackCount` (Task 5), `Segmented`, `useEditorStore`, `validateContent` codes (Task 1) via i18n keys.
- Produces: inspector shows a `Parallel tracks [1][2][3]` control bound to the selected route's pair; the new-route form has the same selector; clicking a second city that already has a route between the pair selects that route instead of drawing a duplicate.

- [ ] **Step 1: Write the failing tests**

Rewrite `apps/web/src/features/builder/editor/stages/RoutesStage.test.tsx`. Keep the file's imports, the `EditorCanvas` mock, `baseCities`, and `beforeEach` setup, but change `baseRoutes` to two lone routes on distinct pairs and replace the `describe('RoutesStage', …)` body:

```ts
const baseRoutes: RouteDraft[] = [
  { id: 'r1', a: 'c1', b: 'c2', color: 'RED', length: 2, ferryLocos: 0, isTunnel: false },
  { id: 'r3', a: 'c2', b: 'c3', color: 'RED', length: 2, ferryLocos: 0, isTunnel: false },
];
```

Add `c3` to `baseCities`:

```ts
const baseCities: CityDraft[] = [
  { id: 'c1', nameZh: '甲', nameEn: 'A', x: 10, y: 50, region: 'r', isIsland: false },
  { id: 'c2', nameZh: '乙', nameEn: 'B', x: 60, y: 50, region: 'r', isIsland: false },
  { id: 'c3', nameZh: '丙', nameEn: 'C', x: 90, y: 50, region: 'r', isIsland: false },
];
```

Add a `route-r3` and `city-c3` button to the `EditorCanvas` mock (mirroring the existing `route-r1`/`city-c1` buttons). Then:

```ts
describe('RoutesStage', () => {
  it('shows the parallel-tracks control at 1 for a lone route', () => {
    render(<RoutesStage />);
    fireEvent.click(screen.getByText('route-r1'));
    const group = screen.getByRole('radiogroup', { name: '平行軌道' });
    expect(within(group).getByRole('radio', { name: '1' })).toHaveAttribute('aria-checked', 'true');
  });

  it('clicking [2] turns a lone route into a clean double', () => {
    render(<RoutesStage />);
    fireEvent.click(screen.getByText('route-r1'));
    const group = screen.getByRole('radiogroup', { name: '平行軌道' });
    fireEvent.click(within(group).getByRole('radio', { name: '2' }));

    const routes = useEditorStore.getState().draft.routes;
    const onPair = routes.filter((r) => r.a === 'c1' && r.b === 'c2');
    expect(onPair).toHaveLength(2);
    expect(new Set(onPair.map((r) => r.doubleGroup))).toEqual(new Set(['A']));
  });

  it('clicking [3] turns a lone route into a clean triple', () => {
    render(<RoutesStage />);
    fireEvent.click(screen.getByText('route-r1'));
    const group = screen.getByRole('radiogroup', { name: '平行軌道' });
    fireEvent.click(within(group).getByRole('radio', { name: '3' }));

    const onPair = useEditorStore.getState().draft.routes.filter((r) => r.a === 'c1' && r.b === 'c2');
    expect(onPair).toHaveLength(3);
    expect(new Set(onPair.map((r) => r.doubleGroup)).size).toBe(1);
  });

  it('creates a double directly from the new-route form via the track selector', () => {
    render(<RoutesStage />);
    fireEvent.click(screen.getByText('city-c1'));
    fireEvent.click(screen.getByText('city-c3')); // c1-c3 is a brand-new pair
    const group = screen.getByRole('radiogroup', { name: '平行軌道' });
    fireEvent.click(within(group).getByRole('radio', { name: '2' }));
    fireEvent.click(screen.getByText('儲存'));

    const created = useEditorStore.getState().draft.routes.filter(
      (r) => (r.a === 'c1' && r.b === 'c3') || (r.a === 'c3' && r.b === 'c1'),
    );
    expect(created).toHaveLength(2);
    expect(new Set(created.map((r) => r.doubleGroup)).size).toBe(1);
  });

  it('selecting two cities that already have a route selects it instead of drawing a duplicate', () => {
    render(<RoutesStage />);
    fireEvent.click(screen.getByText('city-c1'));
    fireEvent.click(screen.getByText('city-c2')); // r1 already connects c1-c2
    // no new-route form (would show 儲存); the existing route is selected → its track control shows
    expect(screen.queryByText('儲存')).not.toBeInTheDocument();
    expect(useEditorStore.getState().selection).toEqual({ kind: 'route', id: 'r1' });
    expect(useEditorStore.getState().draft.routes.filter((r) => r.a === 'c1' && r.b === 'c2')).toHaveLength(1);
  });
});
```

Add `within` to the testing-library import:

```ts
import { render, screen, fireEvent, within } from '@testing-library/react';
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn workspace @trm/web test --run RoutesStage`
Expected: FAIL — no `平行軌道` radiogroup; the convert button/make-double switch are gone from the test expectations but still in the component.

- [ ] **Step 3: Add i18n keys**

In `apps/web/src/i18n/index.ts`, in the **zh-Hant** `builder` block, after `deleteRoute: '刪除路線',` add:

```ts
        parallelTracks: '平行軌道',
```

and in the **en** `builder` block, after `deleteRoute: 'Delete route',` add:

```ts
        parallelTracks: 'Parallel tracks',
```

In the **zh-Hant** `validation` block, replace the `doubleGroupWrongCount` line with:

```ts
          doubleGroupInvalidSize: '平行軌道組 {{group}}：應有 2 或 3 條路線，實際為 {{count}} 條',
          tooManyParallelRoutes: '車站組合 {{pair}}：{{count}} 條平行路線超過上限 3 條',
          multipleGroupsOnPair: '車站組合 {{pair}}：同一組車站有超過一組平行軌道（{{groups}}）',
```

In the **en** `validation` block, replace the `doubleGroupWrongCount` line with:

```ts
          doubleGroupInvalidSize: 'Parallel group {{group}}: expected 2 or 3 routes, got {{count}}',
          tooManyParallelRoutes: 'City pair {{pair}}: {{count}} parallel routes exceeds the maximum of 3',
          multipleGroupsOnPair: 'City pair {{pair}}: has more than one parallel group ({{groups}})',
```

- [ ] **Step 4: Rewrite `RoutesStage.tsx`**

Change the store-hook imports at the top of the component — replace:

```ts
  const convertToDouble = useEditorStore((s) => s.convertToDouble);
```

with:

```ts
  const setPairTrackCount = useEditorStore((s) => s.setPairTrackCount);
```

and remove the now-unused `nextDoubleGroupLetter` import (keep `newRouteId`):

```ts
import { useEditorStore, newRouteId } from '../store';
```

Add a `Segmented` import:

```ts
import { Segmented } from '../../../../components/ui/Segmented';
```

Replace the `onCityClick` handler's second-click branch. Change:

```ts
            if (id === pendingFrom) {
              setPendingFrom(null);
              return;
            }
            setDraftPair({ a: pendingFrom, b: id });
            setPendingFrom(null);
```

to (select an existing route instead of drawing a duplicate pair):

```ts
            if (id === pendingFrom) {
              setPendingFrom(null);
              return;
            }
            const existing = draft.routes.find(
              (r) =>
                (r.a === pendingFrom && r.b === id) || (r.a === id && r.b === pendingFrom),
            );
            setPendingFrom(null);
            if (existing) {
              select({ kind: 'route', id: existing.id });
              return;
            }
            setDraftPair({ a: pendingFrom, b: id });
```

Replace the whole `draftPair ? ( <RouteForm … /> )` block's `onSubmit` and drop `existingDoubleGroups`:

```tsx
        {draftPair ? (
          <RouteForm
            title={t('builder.newRoute', { a: cityName(draftPair.a), b: cityName(draftPair.b) })}
            initial={{
              id: newRouteId(),
              a: draftPair.a,
              b: draftPair.b,
              color: 'RED',
              length: 2,
              ferryLocos: 0,
              isTunnel: false,
            }}
            onCancel={() => setDraftPair(null)}
            onSubmit={(newRoute, trackCount) => {
              addRoute(newRoute);
              if (trackCount > 1) setPairTrackCount(newRoute.id, trackCount as 2 | 3);
              setDraftPair(null);
            }}
          />
        ) : selectedRoute ? (
```

Replace the `selectedRoute` branch's `<RouteForm … />` (drop `existingDoubleGroups`, replace `extra`):

```tsx
          <RouteForm
            title={t('builder.editRoute', {
              a: cityName(selectedRoute.a),
              b: cityName(selectedRoute.b),
            })}
            initial={selectedRoute}
            hideDouble
            onCancel={() => select(null)}
            onSubmit={(route) => updateRoute(selectedRoute.id, route)}
            extra={
              <>
                <label className="field">
                  <span className="field-label">{t('builder.parallelTracks')}</span>
                  <Segmented<string>
                    options={[
                      { value: '1', label: '1' },
                      { value: '2', label: '2' },
                      { value: '3', label: '3' },
                    ]}
                    value={String(
                      Math.min(
                        3,
                        draft.routes.filter(
                          (r) =>
                            (r.a === selectedRoute.a && r.b === selectedRoute.b) ||
                            (r.a === selectedRoute.b && r.b === selectedRoute.a),
                        ).length,
                      ),
                    )}
                    onChange={(v) => setPairTrackCount(selectedRoute.id, Number(v) as 1 | 2 | 3)}
                    ariaLabel={t('builder.parallelTracks')}
                  />
                </label>
                <button className="danger" onClick={() => removeRoute(selectedRoute.id)}>
                  <Trash2 size={14} aria-hidden /> {t('builder.deleteRoute')}
                </button>
              </>
            }
          />
```

Now update `RouteForm` itself. Change its props type — replace:

```ts
  existingDoubleGroups: string[];
  hideDouble?: boolean;
  onCancel(): void;
  onSubmit(route: RouteDraft, makeDouble: boolean): void;
```

with:

```ts
  hideDouble?: boolean;
  onCancel(): void;
  onSubmit(route: RouteDraft, trackCount: number): void;
```

and its destructured params — remove `existingDoubleGroups`. Replace the `makeDouble` state:

```ts
  const [makeDouble, setMakeDouble] = useState(false);
```

with:

```ts
  const [trackCount, setTrackCount] = useState(1);
```

Replace the make-double Switch block:

```tsx
      {!hideDouble && (
        <div className="row between setting-row">
          <span className="field-label">{t('builder.makeDouble')}</span>
          <Switch checked={makeDouble} onChange={setMakeDouble} label={t('builder.makeDouble')} />
        </div>
      )}
```

with a track selector:

```tsx
      {!hideDouble && (
        <label className="field">
          <span className="field-label">{t('builder.parallelTracks')}</span>
          <Segmented<string>
            options={[
              { value: '1', label: '1' },
              { value: '2', label: '2' },
              { value: '3', label: '3' },
            ]}
            value={String(trackCount)}
            onChange={(v) => setTrackCount(Number(v))}
            ariaLabel={t('builder.parallelTracks')}
          />
        </label>
      )}
```

Replace the submit `onClick` (remove the `doubleGroup` spread and pass `trackCount`):

```tsx
        <button
          className="primary"
          onClick={() =>
            onSubmit(
              {
                ...initial,
                color,
                length,
                isTunnel,
                ferryLocos,
                ...(makeDouble ? { doubleGroup: nextDoubleGroupLetter(existingDoubleGroups) } : {}),
              },
              makeDouble,
            )
          }
        >
```

with:

```tsx
        <button
          className="primary"
          onClick={() =>
            onSubmit(
              { ...initial, color, length, isTunnel, ferryLocos },
              trackCount,
            )
          }
        >
```

Finally, remove the now-unused `Switch` import if nothing else in the file uses it (the ferry/tunnel `Switch` for `isTunnel` remains — **keep** the import; only the make-double Switch usage is removed).

- [ ] **Step 5: Run the web builder tests**

Run: `yarn workspace @trm/web test --run RoutesStage store.test`
Expected: PASS — `RoutesStage.test.tsx` (rewritten) and `store.test.ts` both green.

- [ ] **Step 6: Typecheck + lint the web app (catches leftover unused imports/keys)**

Run: `yarn workspace @trm/web typecheck && yarn workspace @trm/web lint`
Expected: PASS — no unused `Switch`/`nextDoubleGroupLetter`/`convertToDouble` references; no `makeDouble`/`convertToDouble` i18n usages remain (the keys may stay defined; leaving them is fine).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/builder/editor/stages/RoutesStage.tsx apps/web/src/features/builder/editor/stages/RoutesStage.test.tsx apps/web/src/i18n/index.ts
git commit -m "feat(builder): [1][2][3] parallel-track control; no duplicate-pair draws"
```

---

### Task 7: full-repo validation

**Files:** none (verification only).

- [ ] **Step 1: Build + typecheck + lint + test across all workspaces**

Run: `yarn build && yarn typecheck && yarn lint && yarn test`
Expected: PASS everywhere. Key gates: engine golden replays unchanged; `@trm/map-data` `content.spec` green (`validateContent(TAIWAN_CONTENT).ok === true`, `doublePairCount === 11`); web builder + store tests green.

- [ ] **Step 2: Manual smoke via the verify skill (optional but recommended)**

Drive the builder Routes stage: select a route → `[2]` → double renders as two parallel tracks; `[3]` → three evenly spaced tracks; `[1]` → back to single; drawing between two already-connected cities selects the existing route rather than stacking. Confirm the live `ValidationPanel` shows no new errors on a clean map and flags a hand-built 4th track.

- [ ] **Step 3: Commit any lint/format fixups**

```bash
git add -u
git commit -m "chore: format/lint fixups for parallel-track feature"
```

(Only if there were fixups; skip otherwise. Stage individual files, not `-A`.)

---

## Self-Review

**Spec coverage:**
- §Model (doubleGroup = 2–3, one per pair) → Tasks 1 (validation), 2 (board), 5 (store normalization).
- §1 Rendering (no change; 3 tracks) → Task 1 Step 1 geometry test.
- §2 Engine (board, config, reduce, invariants, events) → Tasks 2, 3, 4. Event-effect (typhoon/charter) pairwise behavior retained via `siblingOf`/`doubleSibling` (untouched) — matches spec §2e out-of-scope note.
- §3 Usable-track scaling → Task 3 (`openTrackCount`) + Task 4 (lock). Backward-compat asserted in Task 4 Step 5 (goldens) + Task 3 table.
- §5 Builder store → Task 5. §Builder UI → Task 6.
- §6 Validation → Task 1. §i18n → Task 6 (builder + validation codes).
- §7 Content — untouched, per Decision 4; validation kept lenient so `content.spec` stays green (Task 1 Step 4).

**Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows full code and exact run commands with expected output.

**Type consistency:** `setPairTrackCount(id, count: 1|2|3)` used identically in store (Task 5) and UI (Task 6). `groupMembersOf`/`groupSizeOf`/`openTrackCount` defined in Tasks 2–3 and consumed with matching signatures in Task 4. Issue codes `doubleGroupInvalidSize`/`tooManyParallelRoutes`/`multipleGroupsOnPair` emitted in Task 1 and given i18n keys in Task 6. `parallelGroup` on `Board` defined in Task 2, read in Task 4's invariants.

**Scope check:** One coherent feature (parallel-track generalization) across map-data → engine → web, ordered by the monorepo dependency graph. Independently reviewable tasks, each with its own test cycle.
