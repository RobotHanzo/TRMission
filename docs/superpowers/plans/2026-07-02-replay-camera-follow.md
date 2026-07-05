# Replay Camera-Follow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In replay mode, auto-pan the map to whatever action is currently playing out (route claim,
station build) for any player, human or bot — reusing the existing tutorial auto-pan mechanism
(`BoardFrameTarget` / `SpotlightFramer`) instead of touching live `CameraSync`.

**Architecture:** Add an `instant` flag to the existing `BoardFrameTarget`/`SpotlightFramer` auto-pan
plumbing so it can snap (0ms) as well as glide (600ms). Expose one new boolean (`animate`) from
`useReplayPlayer` telling callers whether the current step was reached by an animated forward step or
a silent rebuild (seek/prev/perspective-switch). Add a small pure function mapping a replayed `Action`
to a `BoardFrameTarget`. Wire all three together in `ReplayScreen.tsx`, gated on the existing
`followActing` toggle (the eye icon), defaulted on when a replay loads.

**Tech Stack:** React 18 + TypeScript, Zustand (`store/ui.ts`), `@trm/engine` (`Action` union),
Vitest + `@testing-library/react`, `react-zoom-pan-pinch` (untouched by this plan).

**Design doc:** `docs/superpowers/specs/2026-07-02-replay-camera-follow-design.md`

## Global Constraints

- No changes to `@trm/engine`, live gameplay, `CameraSync`, or spectator camera behavior — this plan
  only touches `apps/web`'s replay-specific and shared board-framing code.
- No change to how perspective switching redacts state — this plan only concerns camera framing.
- No new UI elements — the eye icon (`followActing` toggle) already renders on the replay screen; this
  plan makes it functional there.
- Existing tutorial/encyclopedia auto-pan (`frameTarget` on non-replay screens) must keep its exact
  current behavior (600ms glide, or 0ms under `prefers-reduced-motion`) — the `instant` field defaults
  to falsy for every caller that doesn't set it.
- `yarn workspace @trm/web test`, `yarn lint`, and `yarn typecheck` must pass after every task.

---

### Task 1: `instant` framing + `frameDurationMs` in `boardView.ts`

**Files:**

- Modify: `apps/web/src/game/boardView.ts`
- Test: `apps/web/src/game/boardView.test.ts`

**Interfaces:**

- Produces: `BoardFrameTarget.instant?: boolean` (new optional field); `frameDurationMs(target:
BoardFrameTarget, reducedMotion: boolean): number` — returns `0` when `target.instant` or
  `reducedMotion` is true, else `600`.

- [ ] **Step 1: Write the failing test**

Add to the end of `apps/web/src/game/boardView.test.ts` (and add `frameDurationMs` plus
`type BoardFrameTarget` to the existing import from `./boardView` at the top of the file):

```ts
import {
  transformToView,
  viewToTransform,
  boardProjection,
  visibleFraction,
  frameDurationMs,
  type BoardTransform,
  type BoardProjection,
  type BoardFrameTarget,
} from './boardView';
```

```ts
describe('frameDurationMs — glide vs snap duration for an auto-pan target', () => {
  const target = (instant?: boolean): BoardFrameTarget => ({
    kind: 'cities',
    ids: ['taipei'],
    ...(instant !== undefined ? { instant } : {}),
  });

  it('glides (600ms) by default, motion allowed', () => {
    expect(frameDurationMs(target(), false)).toBe(600);
  });

  it('glides (600ms) when instant is explicitly false, motion allowed', () => {
    expect(frameDurationMs(target(false), false)).toBe(600);
  });

  it('snaps (0ms) when instant is true, even with motion allowed', () => {
    expect(frameDurationMs(target(true), false)).toBe(0);
  });

  it('snaps (0ms) under reduced motion, even when instant is false', () => {
    expect(frameDurationMs(target(false), true)).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @trm/web test --run boardView`
Expected: FAIL — `frameDurationMs` is not exported from `./boardView` (TypeScript/import error, or
`frameDurationMs is not a function`).

- [ ] **Step 3: Implement**

In `apps/web/src/game/boardView.ts`, change the `BoardFrameTarget` interface (currently):

```ts
/** A board auto-pan target: a set of route ids or city ids to frame. */
export interface BoardFrameTarget {
  kind: 'route' | 'cities';
  ids: string[];
}
```

to:

```ts
/** A board auto-pan target: a set of route ids or city ids to frame. */
export interface BoardFrameTarget {
  kind: 'route' | 'cities';
  ids: string[];
  /** Skip the glide and snap straight to the target (used by replay seeks/jumps). */
  instant?: boolean;
}
```

Then add this function anywhere below it in the same file (e.g. directly after the interface):

```ts
/** The auto-pan transform duration (ms) for `target`: instant/reduced-motion snap to 0, else glide. */
export function frameDurationMs(target: BoardFrameTarget, reducedMotion: boolean): number {
  return target.instant || reducedMotion ? 0 : 600;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn workspace @trm/web test --run boardView`
Expected: PASS — all `boardView` tests, including the four new `frameDurationMs` cases, green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/game/boardView.ts apps/web/src/game/boardView.test.ts
git commit -m "feat(web): add instant framing + frameDurationMs to boardView"
```

---

### Task 2: Wire `SpotlightFramer` to `frameDurationMs`

This is a mechanical substitution with no new observable behavior for existing callers (every current
`frameTarget` caller — tutorial, encyclopedia — never sets `instant`, so `frameDurationMs` returns
exactly what the inline expression returned before). There is no new test; the existing tutorial/
encyclopedia/board suites are the regression guard.

**Files:**

- Modify: `apps/web/src/components/Board.tsx`

**Interfaces:**

- Consumes: `frameDurationMs(target, reducedMotion)` from Task 1 (`apps/web/src/game/boardView.ts`).

- [ ] **Step 1: Update the import**

In `apps/web/src/components/Board.tsx`, find (around line 25):

```ts
import {
  transformToView,
  viewToTransform,
  boardProjection,
  visibleFraction,
  type BoardTransform,
} from '../game/boardView';
```

Replace with:

```ts
import {
  transformToView,
  viewToTransform,
  boardProjection,
  visibleFraction,
  frameDurationMs,
  type BoardTransform,
} from '../game/boardView';
```

- [ ] **Step 2: Use it in `SpotlightFramer`**

Find, inside `SpotlightFramer` (around line 409):

```ts
    const t = viewToTransform({ cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, span }, proj, w, h);
    setTransform(t.positionX, t.positionY, t.scale, reduced ? 0 : 600, 'easeOut');
  }, [key, reduced]);
  return null;
}
```

Replace with:

```ts
    const t = viewToTransform({ cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, span }, proj, w, h);
    setTransform(t.positionX, t.positionY, t.scale, frameDurationMs(target, reduced), 'easeOut');
  }, [key, target, reduced]);
  return null;
}
```

Note the dependency array gains `target` — the effect body now reads `target.instant`, so it must be a
dependency (it was previously read only inside the `if (!target ...)` guard and the geometry lookups,
which `key` already summarizes; `target.instant` is a second property of the same object `key` doesn't
capture).

- [ ] **Step 3: Run the regression suite**

Run: `yarn workspace @trm/web test --run Board`
Run: `yarn workspace @trm/web test --run TutorialSpotlight`
Run: `yarn workspace @trm/web test --run EncyclopediaModal`
Run: `yarn workspace @trm/web test --run GameStage.gate`

Expected: PASS for all four — no assertions changed, this confirms the substitution is
behavior-neutral for every existing `frameTarget` caller.

- [ ] **Step 4: Typecheck**

Run: `yarn workspace @trm/web typecheck`
Expected: PASS, no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/Board.tsx
git commit -m "feat(web): SpotlightFramer respects frameTarget.instant"
```

---

### Task 3: `animate` signal on `useReplayPlayer`

**Files:**

- Modify: `apps/web/src/features/replay/useReplayPlayer.ts`
- Test: `apps/web/src/features/replay/useReplayPlayer.test.ts`

**Interfaces:**

- Produces: `ReplayControls.animate: boolean` — `true` immediately after a `next()`-driven step,
  `false` after any `applyTo()`-driven change (`seek`, `prev`, `setViewer`, and the initial mount).

- [ ] **Step 1: Write the failing test**

Add this test inside the existing `describe('useReplayPlayer', ...)` block in
`apps/web/src/features/replay/useReplayPlayer.test.ts` (after the `prev()` test):

```ts
it('animate is true after next(), false again after any silent rebuild', () => {
  const actions = scriptActions(10);
  const { hook } = setup(actions, asPlayerId('p1'));
  expect(hook.result.current.animate).toBe(false); // genesis: silent
  act(() => hook.result.current.next());
  expect(hook.result.current.animate).toBe(true); // forward step: animated
  act(() => hook.result.current.seek(0));
  expect(hook.result.current.animate).toBe(false); // seek: silent
  act(() => hook.result.current.next());
  expect(hook.result.current.animate).toBe(true);
  act(() => hook.result.current.prev());
  expect(hook.result.current.animate).toBe(false); // prev: silent
  act(() => hook.result.current.next());
  expect(hook.result.current.animate).toBe(true);
  act(() => hook.result.current.setViewer(asPlayerId('p2')));
  expect(hook.result.current.animate).toBe(false); // perspective switch: silent
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @trm/web test --run useReplayPlayer`
Expected: FAIL — `hook.result.current.animate` is `undefined`, so the first assertion
(`toBe(false)`) fails.

- [ ] **Step 3: Implement**

In `apps/web/src/features/replay/useReplayPlayer.ts`:

1. Add `animate` to the `ReplayControls` interface (currently ends with `seek(step: number): void;`):

```ts
export interface ReplayControls {
  step: number;
  total: number;
  playing: boolean;
  viewer: PlayerId | null;
  atEnd: boolean;
  error: boolean;
  /** True right after an animated forward step(); false after any silent rebuild (seek/prev/
   *  setViewer/initial mount) — the glide-vs-snap signal for the replay camera-follow. */
  animate: boolean;
  setViewer(viewer: PlayerId | null): void;
  play(): void;
  pause(): void;
  next(): void;
  prev(): void;
  seek(step: number): void;
}
```

2. Add the state, right after the existing `const [error, setError] = useState(false);`:

```ts
const [animate, setAnimate] = useState(false);
```

3. In `applyTo`, set it `false` alongside the existing `setStep(clamped)`:

```ts
        stepRef.current = clamped;
        setStep(clamped);
        setAnimate(false);
      } catch {
```

(This replaces the existing `setStep(clamped);\n      } catch {` — just insert the `setAnimate(false);`
line between them.)

4. In `next`, set it `true` alongside the existing `setStep(n)`:

```ts
      stepRef.current = n;
      setStep(n);
      setAnimate(true);
    } catch {
```

(Same pattern — insert `setAnimate(true);` right after `setStep(n);`.)

5. Add `animate` to the returned object (currently ends `next, prev, seek,`):

```ts
return {
  step,
  total: actions.length,
  playing,
  viewer,
  atEnd: step >= actions.length,
  error,
  animate,
  setViewer,
  play,
  pause,
  next,
  prev,
  seek,
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn workspace @trm/web test --run useReplayPlayer`
Expected: PASS — all `useReplayPlayer` tests, including the new `animate` case, green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/replay/useReplayPlayer.ts apps/web/src/features/replay/useReplayPlayer.test.ts
git commit -m "feat(web): expose animate (step vs jump) from useReplayPlayer"
```

---

### Task 4: `frameTargetForAction` mapping

**Files:**

- Create: `apps/web/src/features/replay/frameTarget.ts`
- Test: Create `apps/web/src/features/replay/frameTarget.test.ts`

**Interfaces:**

- Produces: `frameTargetForAction(action: Action | null, instant: boolean): BoardFrameTarget | null`.
- Consumes: `BoardFrameTarget` type from `apps/web/src/game/boardView.ts` (Task 1); `Action` type from
  `@trm/engine`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/replay/frameTarget.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { asPlayerId, asRouteId, asCityId } from '@trm/shared';
import type { Action, Payment } from '@trm/engine';
import { frameTargetForAction } from './frameTarget';

const player = asPlayerId('p1');
const payment: Payment = { color: 'RED', colorCount: 2, locomotives: 0 };

describe('frameTargetForAction', () => {
  it('maps CLAIM_ROUTE to a route frame target', () => {
    const action: Action = { t: 'CLAIM_ROUTE', player, routeId: asRouteId('r1'), payment };
    expect(frameTargetForAction(action, false)).toEqual({
      kind: 'route',
      ids: ['r1'],
      instant: false,
    });
  });

  it('maps BUILD_STATION to a cities frame target', () => {
    const action: Action = { t: 'BUILD_STATION', player, cityId: asCityId('taipei'), payment };
    expect(frameTargetForAction(action, true)).toEqual({
      kind: 'cities',
      ids: ['taipei'],
      instant: true,
    });
  });

  it('passes the instant flag through unchanged', () => {
    const action: Action = { t: 'CLAIM_ROUTE', player, routeId: asRouteId('r2'), payment };
    expect(frameTargetForAction(action, false)?.instant).toBe(false);
    expect(frameTargetForAction(action, true)?.instant).toBe(true);
  });

  it('returns null for non-spatial actions', () => {
    expect(frameTargetForAction({ t: 'PASS', player }, false)).toBeNull();
    expect(frameTargetForAction({ t: 'DRAW_BLIND', player }, false)).toBeNull();
    expect(frameTargetForAction({ t: 'DRAW_FACEUP', player, slot: 0 }, false)).toBeNull();
    expect(frameTargetForAction({ t: 'DRAW_TICKETS', player }, false)).toBeNull();
    expect(frameTargetForAction({ t: 'KEEP_TICKETS', player, keep: [] }, false)).toBeNull();
    expect(frameTargetForAction({ t: 'RESOLVE_TUNNEL', player, commit: true }, false)).toBeNull();
  });

  it('returns null when there is no action (step 0)', () => {
    expect(frameTargetForAction(null, false)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @trm/web test --run frameTarget`
Expected: FAIL — cannot resolve module `./frameTarget` (the file doesn't exist yet).

- [ ] **Step 3: Implement**

Create `apps/web/src/features/replay/frameTarget.ts`:

```ts
// Maps a replayed action to the board region it acts on, for the replay auto-follow camera —
// mirrors which live bot actions move the camera (route claims, station builds); everything else
// (draws, ticket keeps, tunnel resolves, passes) leaves the camera where it is.
import type { Action } from '@trm/engine';
import type { BoardFrameTarget } from '../../game/boardView';

/** The board region `action` acts on, or null if it has no spatial location. */
export function frameTargetForAction(
  action: Action | null,
  instant: boolean,
): BoardFrameTarget | null {
  if (!action) return null;
  if (action.t === 'CLAIM_ROUTE') return { kind: 'route', ids: [action.routeId], instant };
  if (action.t === 'BUILD_STATION') return { kind: 'cities', ids: [action.cityId], instant };
  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn workspace @trm/web test --run frameTarget`
Expected: PASS — all six `frameTargetForAction` cases green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/replay/frameTarget.ts apps/web/src/features/replay/frameTarget.test.ts
git commit -m "feat(web): map replayed actions to board frame targets"
```

---

### Task 5: Wire `ReplayStage` — default-on follow + per-step framing

**Files:**

- Modify: `apps/web/src/screens/ReplayScreen.tsx`
- Test: Modify `apps/web/src/screens/ReplayScreen.test.tsx`

**Interfaces:**

- Consumes: `player.animate` (Task 3), `frameTargetForAction` (Task 4), `useUi`'s `followActing` /
  `setFollowActing` (already exist in `apps/web/src/store/ui.ts`), `GameStage`'s existing
  `frameTarget` prop (already exists, `apps/web/src/screens/GameStage.tsx`).

- [ ] **Step 1: Write the failing test**

In `apps/web/src/screens/ReplayScreen.test.tsx`, add a mock (needed once real `GameStage` rendering is
reached — mirrors the existing pattern in `GameStage.gate.test.tsx`) right after the existing
`vi.mock(...)` calls at the top of the file:

```ts
vi.mock('../hooks/useAnimationDriver', () => ({ useAnimationDriver: vi.fn() }));
```

Add these imports to the top of the file, alongside the existing ones:

```ts
import { ENGINE_VERSION, SCHEMA_VERSION, CONTENT_HASH } from '@trm/engine';
```

Add a new `describe` block at the end of the file:

```ts
describe('ReplayScreen camera-follow default', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSession.setState({ user: { ...signedIn } });
    useUi.setState({ view: 'replay', replayGameId: 'g1', followActing: false });
    window.history.replaceState(null, '', '/replay/g1');
  });

  it('defaults follow-acting on once a replay finishes loading', async () => {
    mocked.replay.mockResolvedValue(
      payload({
        engineVersion: ENGINE_VERSION,
        schemaVersion: SCHEMA_VERSION,
        config: {
          seed: 's1',
          players: [
            { id: 'u1', seat: 0 },
            { id: 'u2', seat: 1 },
          ],
          contentHash: CONTENT_HASH,
        },
        actions: [],
        players: [
          { userId: 'u1', seat: 0, displayName: 'Tester' },
          { userId: 'u2', seat: 1, displayName: 'Other' },
        ],
      }),
    );
    render(<ReplayScreen />);
    await screen.findByRole('slider');
    expect(useUi.getState().followActing).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @trm/web test --run ReplayScreen`
Expected: FAIL — the new test's `expect(useUi.getState().followActing).toBe(true)` fails because
nothing sets it yet (it was explicitly seeded `false` in `beforeEach`).

- [ ] **Step 3: Implement**

In `apps/web/src/screens/ReplayScreen.tsx`, add an import for the new mapping function, alongside the
existing imports:

```ts
import { frameTargetForAction } from '../features/replay/frameTarget';
```

Then, inside the `ReplayStage` function, find:

```ts
  const { t } = useTranslation();
  const gameStore = useGameStoreApi();
  const logStore = useLogStoreApi();
  const stores = useMemo(() => ({ game: gameStore, log: logStore }), [gameStore, logStore]);
  const player = useReplayPlayer(board, config, actions, initialViewer, stores, finalDigest);
  const snapshot = useGameStore((s) => s.snapshot);

  if (player.error) {
```

Replace with:

```ts
  const { t } = useTranslation();
  const gameStore = useGameStoreApi();
  const logStore = useLogStoreApi();
  const stores = useMemo(() => ({ game: gameStore, log: logStore }), [gameStore, logStore]);
  const player = useReplayPlayer(board, config, actions, initialViewer, stores, finalDigest);
  const snapshot = useGameStore((s) => s.snapshot);
  const followActing = useUi((s) => s.followActing);
  const setFollowActing = useUi((s) => s.setFollowActing);

  // Replay is meant to be watched — default auto-follow on regardless of whatever live play left
  // the shared toggle at. The eye icon (rendered by MapControls, sandbox or not) still turns it off.
  useEffect(() => {
    setFollowActing(true);
  }, [setFollowActing]);

  const currentAction = player.step > 0 ? (actions[player.step - 1] ?? null) : null;
  const frameTarget = followActing
    ? frameTargetForAction(currentAction, !player.animate)
    : null;

  if (player.error) {
```

Add `useUi` to the existing import from `'../store/ui'` at the top of the file — it's already imported
there (`import { useUi } from '../store/ui';`), so no import change is needed for that symbol.

Finally, find:

```ts
      <div className="replay-stage">
        <GameStage snapshot={snapshot} commands={null} sandbox onLeave={onLeave} />
      </div>
```

Replace with:

```ts
      <div className="replay-stage">
        <GameStage
          snapshot={snapshot}
          commands={null}
          sandbox
          frameTarget={frameTarget}
          onLeave={onLeave}
        />
      </div>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn workspace @trm/web test --run ReplayScreen`
Expected: PASS — all `ReplayScreen` tests, including the new camera-follow-default test, green.

- [ ] **Step 5: Typecheck**

Run: `yarn workspace @trm/web typecheck`
Expected: PASS, no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/screens/ReplayScreen.tsx apps/web/src/screens/ReplayScreen.test.tsx
git commit -m "feat(web): auto-follow the acting player's action in replay"
```

---

### Task 6: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full web test suite**

Run: `yarn workspace @trm/web test`
Expected: PASS, 0 failures.

- [ ] **Step 2: Lint + typecheck the whole repo**

Run: `yarn lint`
Run: `yarn typecheck`
Expected: PASS for both (this plan touches no other workspace, but `@trm/web` depends on `@trm/engine`
and `@trm/shared` types, so a full typecheck confirms nothing drifted).

- [ ] **Step 3: Manual verification in the browser**

Start the stack (needs Docker for Mongo, per the root `CLAUDE.md`):

```bash
docker compose up -d mongo
yarn workspace @trm/server dev
yarn workspace @trm/web dev
```

Play or bot-simulate a short game to completion (or use an existing finished game from
`/history`), then open its replay (`/replay/:gameId`) and confirm:

- Pressing "next" (or letting autoplay run) glides the camera to each route claim / station build as
  it happens.
- Dragging the scrubber to a different step snaps the camera instantly to that step's action (no
  glide), or leaves the camera in place for a non-spatial step (card draw, ticket keep, pass).
- The eye icon is lit (follow on) by default when the replay opens; clicking it turns follow off, and
  further stepping/seeking no longer moves the camera.
- Switching perspective (the player-pill row) never moves the camera, only the visible hand/tickets.
- Manually dragging/zooming the board while follow is on turns the eye icon off (same as live play).

- [ ] **Step 4: Report results**

No commit for this task — it's verification-only. If any check fails, return to the relevant task
above, fix, and re-run its tests before continuing.
