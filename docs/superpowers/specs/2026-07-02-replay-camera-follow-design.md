# Replay camera-follow — design

## Goal

In live gameplay, the "follow acting player" camera (the eye icon, `followActing` in `store/ui.ts`)
auto-pans the board to whatever the current bot is building — `CameraSync` in `Board.tsx` glides to a
bot's most recent `routeClaimed`/`tunnelRevealed`/`stationBuilt` event. Replay (`ReplayScreen.tsx`)
reuses the same `Board`/`GameStage` components but mounts them with `sandbox`, which is exactly the
flag that disables `CameraSync` — so today replay has **no camera-follow at all**, even though the eye
icon still renders (inertly) on the replay screen.

Extend replay so the camera auto-pans to whatever action is currently playing out, **for every
player, human or bot** — there's no live camera to mirror for a human in replay (camera position was
never part of the recorded action log), so the bot's "infer the spot from the action" mechanism is the
only viable one, applied uniformly.

## Where it plugs in

Not a new camera component. `Board.tsx` already has a second, independent auto-pan mechanism used by
the tutorial: a `frameTarget` prop (`BoardFrameTarget = { kind: 'route' | 'cities', ids: string[] }`)
consumed by `SpotlightFramer`, a headless child mounted **unconditionally** (not gated by `sandbox`)
inside the pan/zoom `TransformWrapper`. Replay already renders `GameStage` in that same tree
(`ReplayStage` in `ReplayScreen.tsx`) — it simply never passes `frameTarget`. Wiring one through is the
entire feature; `CameraSync` (the live/bot mechanism) is untouched.

## Mechanism

1. **`game/boardView.ts`** — add an optional field to `BoardFrameTarget`:
   ```ts
   export interface BoardFrameTarget {
     kind: 'route' | 'cities';
     ids: string[];
     /** Skip the glide — snap straight to the target (used for replay seeks). */
     instant?: boolean;
   }
   ```
2. **`Board.tsx`'s `SpotlightFramer`** — the `setTransform(..., reduced ? 0 : 600, 'easeOut')` call
   becomes `setTransform(..., target.instant || reduced ? 0 : 600, 'easeOut')`. Existing tutorial call
   sites never set `instant`, so this is behavior-neutral for them.
3. **`features/replay/useReplayPlayer.ts`** — expose one new boolean, `animate`, alongside the existing
   `ReplayControls` fields: `true` immediately after an animated forward `next()`, `false` after any
   silent `applyTo()`-driven change (`seek`, `prev`, `setViewer`, and the initial genesis mount). This
   is the "was the current step reached by stepping forward, or by jumping?" signal `SpotlightFramer`
   needs to pick glide vs. snap — `CameraSync`'s event-diffing approach has no equivalent concept and
   doesn't need one live, so this stays local to the replay hook.
4. **`screens/ReplayScreen.tsx`'s `ReplayStage`** — derive a `frameTarget` from the action that produced
   the current step, `actions[player.step - 1]`:
   - `CLAIM_ROUTE` → `{ kind: 'route', ids: [action.routeId], instant: !player.animate }`
   - `BUILD_STATION` → `{ kind: 'cities', ids: [action.cityId], instant: !player.animate }`
   - everything else (`DRAW_BLIND`, `DRAW_FACEUP`, `DRAW_TICKETS`, `KEEP_TICKETS`,
     `KEEP_INITIAL_TICKETS`, `RESOLVE_TUNNEL`, `PASS`) or `step === 0` → `null`

   Gate the whole derivation on `followActing` (from `store/ui.ts`) so the target is `null` whenever
   follow is off — this is what makes the eye icon, already rendered on the replay screen today, do
   something. Pass the result straight through to the existing `frameTarget` prop on `GameStage`.

5. **Default on** — `ReplayStage` sets `followActing` to `true` once on mount (`useEffect`, empty deps),
   so replay always opens with follow active regardless of whatever live play last left the shared
   toggle at. The user can still turn it off with the eye icon, same as live.

No changes to `CameraSync`, to `Board.tsx`'s mount conditions, or to the gesture-disengage wiring:
`onPanningStart`/`onWheelStart`/`onPinchStart`/`onDoubleClick` already call `disengageFollow()`
regardless of `sandbox`, so manually panning/zooming during replay already turns `followActing` off
today (currently a no-op since nothing reacted to it in replay; after this change it stops the
auto-pan, matching live behavior).

## Data flow

- Forward step (button or autoplay tick) → `useReplayPlayer.next()` → `step` increments, `animate`
  becomes `true` → `ReplayStage` recomputes `frameTarget` with `instant: false` → `SpotlightFramer`
  glides the camera over 600ms (0ms under `prefers-reduced-motion`, unchanged accessibility behavior).
- Seek (scrubber drag), prev, or a perspective switch (`setViewer`) → `applyTo()` → `animate` becomes
  `false` → `frameTarget` recomputed with `instant: true` → `SpotlightFramer` snaps with no glide.
- A perspective switch re-targets the _same_ step, so the derived `frameTarget` is unchanged
  (`SpotlightFramer`'s effect keys on `` `${kind}:${ids.join(',')}` ``) — the camera does not move on a
  pure viewer change, only the redacted hand/tickets do.
- Non-spatial actions, and step 0 (before any action), produce `frameTarget: null` → `SpotlightFramer`
  no-ops → camera stays wherever it was, mirroring live bot-follow's silence on non-spatial bot moves.

## Edge cases

- **Tunnels:** `CLAIM_ROUTE`'s `routeId` covers both a plain route claim and a tunnel attempt (the
  pending/resolve split is a later `RESOLVE_TUNNEL` action). Replay therefore pans to a tunnel the
  instant the claim is attempted, whether or not `RESOLVE_TUNNEL` later aborts it — slightly earlier
  than live (which pans on the `tunnelRevealed` _event_), but within the same turn, not user-visible as
  a meaningful difference.
- **Reduced motion:** still forces 0ms regardless of step vs. seek — `target.instant || reduced`, not
  `target.instant && reduced`.
- **Repeated seeks to the same step:** `SpotlightFramer`'s effect dependency is the target's key
  string, not the `animate`/`instant` flag alone; landing on an already-current key is a no-op
  regardless (the camera's already there), so this needs no special handling.

## Implementation surface

All in `apps/web`:

1. `src/game/boardView.ts` — add `instant?: boolean` to `BoardFrameTarget`, plus a small pure
   `frameDurationMs(target, reducedMotion)` helper so the duration decision is unit-testable without
   the pan/zoom library or a real `<svg>` `getCTM()` (unavailable in jsdom).
2. `src/components/Board.tsx` — `SpotlightFramer` calls `frameDurationMs` instead of inlining the
   duration expression; no other change.
3. `src/features/replay/useReplayPlayer.ts` — add `animate` to `ReplayControls` and set it in `next()`
   / `applyTo()`.
4. `src/features/replay/frameTarget.ts` (new) — `frameTargetForAction(action, instant)`, the pure
   action→`BoardFrameTarget` mapping, factored out so it's unit-testable independent of React/DOM.
5. `src/screens/ReplayScreen.tsx` — in `ReplayStage`: derive `frameTarget` from `actions[step - 1]` via
   `frameTargetForAction`, gated on `followActing`; pass it to `GameStage`; set `followActing = true` on
   mount.
6. **Tests:**
   - `src/game/boardView.test.ts` — `frameDurationMs`'s four cases (instant/reduced-motion × true/false).
   - `src/features/replay/frameTarget.test.ts` — the action→`frameTarget` mapping (route/city/null cases).
   - `src/features/replay/useReplayPlayer.test.ts` — `animate` is `true` after `next()`, `false` after
     `seek()`, `prev()`, and `setViewer()`.
   - `src/screens/ReplayScreen.test.tsx` — the follow-defaults-on-mount behavior. (`Board.test.tsx` gets
     no new case: jsdom's `<svg>` has no real `getCTM()`, so `SpotlightFramer`'s `setTransform` call is
     never reached end-to-end there — Task 2 in the implementation plan is a regression-only change,
     verified by the existing tutorial/encyclopedia suites plus the two unit-tested pure functions above.)

## Out of scope

- No change to `CameraSync`, live gameplay, or spectator camera behavior.
- No change to how perspective switching redacts state — this only concerns camera framing.
- No new UI — the eye icon already exists on the replay screen; this makes it functional.

## Success criteria

- Opening a replay auto-pans to each route claim / station build as the log steps forward, gliding
  smoothly, without any code change to live `CameraSync`.
- Seeking (scrubber) or switching perspective snaps the camera instantly to the current step's action
  location (or leaves it put, for non-spatial actions) with no glide animation.
- The eye icon toggles replay auto-follow on/off, defaulting to on when the replay screen opens.
- Manually panning/zooming the board during replay disengages follow, same as live.
- `yarn workspace @trm/web test`, `yarn lint`, and `yarn typecheck` pass.
