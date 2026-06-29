# Tutorial UI Redesign — Focus, Animation & Visual Glossary

**Date:** 2026-06-29
**Scope:** `apps/web` tutorial + in-game encyclopedia presentation layer only. **No `@trm/engine`,
`@trm/codec`, or server changes.** No new game scenarios.

## Problem

The interactive tutorial and the in-game encyclopedia work, but their presentation is bare:

1. The coachmark (`TutorialOverlay`) is a single bottom-pinned card — title, one paragraph,
   progress dots, Next/Back/Replay. Its entire animation budget is one slide-in and a pulse.
2. There is **no focus mechanism**. The `Spotlight` type has a `{ kind: 'hud', selector }` variant
   that is never consumed; only city targets get a soft halo (the same one used during ticket
   draft). Nothing dims, frames, or directs attention. The `TutorialSpotlight` from the original
   plan was never built.
3. **No game component is ever rendered inside the dialog.** Lessons on special routes
   (double/ferry/tunnel), stations, longest trail, and endgame are pure narration. A learner reads
   the word "tunnel" but may not have one on screen, and is never shown how a tunnel, ferry, and
   ordinary railway differ — even though the board already renders each distinctly (tunnels: diagonal
   ties; ferries: dotted sea line + rainbow locomotive pips; railways: coloured slot-cars).

## Goals

- A polished, animated guide that **dims the stage and lifts the explained element out of the
  gloom** while keeping the rest of the board interactive (so `await` beats still work).
- **Render real game components inside the dialog** as a visual glossary, so a learner sees what a
  railway, ferry, tunnel, double route, station, card, and ticket look like, side by side where a
  contrast matters.
- Make the currently text-only lessons **show, not just tell**: each gains an in-dialog specimen, the
  focus dim, and an **auto-pan to a real example** on the board — without authoring new engine
  scenarios.
- Everything benefits the in-game encyclopedia for free (it shares the same overlay + scenario
  player), plus a modest header polish there.

## Confirmed decisions

| Decision | Choice | Consequence |
| --- | --- | --- |
| Focus style | **Dim + glow, non-blocking** | Scrim is `pointer-events: none`; the whole board stays clickable. No hard cutout that could trap the learner mid-`await`. |
| Component visuals | **Full visual glossary** | Specimens for railway, ferry, tunnel, double route, station, the 8 card liveries + locomotive, and a ticket card. |
| Demo depth | **Specimen + spotlight + auto-pan** | Narration-driven lessons gain a specimen, a focus dim, and a board auto-pan to a real example. No new engine scenarios → lowest risk. |
| Coachmark placement | Bottom-anchored, **shifts aside** when it would cover a spotlighted HUD region | The dialog never hides the thing it explains. |
| Encyclopedia list | **Chapter-grouped clickable list** (replaces the bare `<select>`) | |

Design references: product-tour conventions (Intro.js / Shepherd / Userpilot — dim page + spotlight
+ anchored tooltip + progress) and game-onboarding conventions (show-don't-tell, contextual
coach-marks, visual glossary, progressive disclosure).

## Architecture

Six pieces. Each is independently understandable and testable.

### 1. `TutorialSpotlight` — the focus layer (new)

A `createPortal`-to-`document.body` overlay, mounted by `GameStage` when a tutorial/encyclopedia
overlay is active. Mirrors the existing `AnimationLayer` portal pattern.

- **Input:** a resolved list of target rects for the current beat (plus a `reducedMotion` flag).
- **Render:** a full-viewport SVG scrim that darkens everything, with a soft radial "hole" of light
  around each target rect and a gently pulsing ring. Implemented with an SVG `<mask>` (one white
  rounded-rect per target punched out of a black full-screen rect) feeding a semi-opaque dark
  overlay; the rings are separate stroked rects above it. `pointer-events: none` on the whole layer
  (non-blocking focus).
- **Multiple targets:** e.g. a ticket's two endpoint cities → two holes + two rings.
- **No target / target not found:** degrade to a light uniform full-board dim. Never throw.
- **Reduced motion:** static dim, no pulse.

Target resolution and re-measurement live in a small hook:

### 2. `useSpotlightRects` — target measurement (new)

- Maps the beat's `Spotlight` to CSS selectors and reads `getBoundingClientRect()` for each:
  - `{ kind: 'cities', ids }` → `[data-city-id="<id>"]` (new attribute on Board city `<g>`).
  - `{ kind: 'route', ids }` → `[data-route-id="<id>"]` (new attribute on Board route `<g>`).
  - `{ kind: 'hud', selector }` → the given selector, restricted to a known-safe allow-list
    (`.deck-area`, `[data-anim="deck"]`, `[data-anim="market-slot"]`, `[data-anim="hand"]`,
    `[data-anim="tickets"]`, `.player-trackers`, `.card-market`). The allow-list is asserted in tests.
  - `{ kind: 'board' }` / absent → no holes (whole board, light dim) or the board viewport rect.
- **Re-measures** on: beat change, `window` resize, and an rAF loop that runs for a short window
  (≈700 ms) after a beat change so the holes track the board's pan/zoom transition. This reuses the
  timing approach already proven by `RevealFramer`. Returns `DOMRect[]` (empty ⇒ full dim).
- Defensive in jsdom (rects are 0×0) — callers treat an all-zero result as "no holes".

### 3. Board framing + anchors — `Board.tsx` (modified)

- **Auto-pan:** a new optional prop `frameTarget?: { kind: 'route'|'cities'; ids: string[] } | null`.
  When set, a `SpotlightFramer` child (cloned from the existing `RevealFramer`, line ~327) computes
  the bounding box of the named routes (`ROUTE_GEOMETRY`) and/or cities (normalized x/y from
  content) and calls `useControls().setTransform` via `game/geography.ts fitTransform` — the same
  mechanism as `frameHome`. Reduced motion → 0 ms (instant).
- **Anchors:** add `data-city-id={c.id}` to each city `<g>` and `data-route-id={r.id}` to each route
  `<g>`. Harmless, additive; enables spotlight measurement.
- Existing `highlightCities` glow stays (it is also used by the live ticket-draft flow); the new
  spotlight dim composes over it.

### 4. Visual glossary — `Specimens.tsx` (new)

Self-contained renderers that look identical to the board/HUD because they reuse the **same** CSS
classes and components — so they cannot visually drift from the real game.

- `RouteSpecimen({ variant, color?, length? })` — a mini SVG with a straight horizontal path drawn
  with the exact board classes: `.route` + `.bed` + `.slot` (rail), `.ferry-line`/`.ferry-pip`/
  `.slot.ferry-loco` (ferry), `.tunnel-bg`/`.tunnel-tie` (tunnel), and a twinned pair with one
  greyed sibling (double). Wrapper sets `--inv-scale: 1` and `--seat`/colour vars so the static
  specimen renders at a fixed weight. Variants: `'rail' | 'ferry' | 'tunnel' | 'double'`.
- `RouteCompareSpecimen` — `rail`, `ferry`, `tunnel` stacked with labels: the explicit side-by-side
  contrast.
- `CardRowSpecimen` — the 8 liveries + locomotive, reusing `FlyingCard`.
- `StationSpecimen` — reuses the board's `.station` / `.station-ring` marker markup.
- `TicketSpecimen({ id })` — reuses the existing `TicketCard` (real city names resolve from content).

All specimens are pure SVG/CSS with no engine calls (TicketSpecimen only reads ticket content by id,
already safe). Each variant is smoke-tested.

### 5. Coachmark redesign — `TutorialOverlay` (restyled) + `TutorialBeat` (new presentational guts)

- **Specimen zone** at the top hosting the beat's glossary visual (or a chapter icon when none).
- **Chapter pill** + lesson title; **progress bar** replacing the flat dots; lesson nav (prev/next,
  replay, exit).
- **Connector caret** pointing from the bubble toward the nearest spotlighted target rect (derived
  from `useSpotlightRects`); hidden when there is no on-screen target.
- **Two layouts:**
  - `compact` — `await`/`auto` beats: small, bottom-anchored, HUD stays usable.
  - `feature` — `info` beats carrying a large specimen (e.g. the route comparison): larger, more
    central, dim behind.
  - **Dodge:** when bottom-anchored and a spotlighted HUD rect overlaps the coachmark's bottom band,
    shift the coachmark to the opposite corner so it never covers the explained element. Computed
    from the resolved target rects.
- **Motion** (all gated on `prefers-reduced-motion`, via the existing `useReducedMotion`):
  beat-to-beat crossfade/slide keyed by beat id, specimen draw-in, entrance/exit, the existing
  "your turn" pulse, animated progress bar.

### 6. Beat model + curriculum enrichment — `types.ts` + `curriculum.ts` (modified, additive)

`types.ts`:
- `Spotlight` gains `{ kind: 'route'; ids: string[] }` and `{ kind: 'board' }`.
- `Beat` gains optional `specimen?: SpecimenSpec` and `frame?: { kind: 'route'|'cities'; ids:
  string[] }` (auto-pan target). `SpecimenSpec` is a small discriminated union mirroring the
  `Specimens.tsx` variants (`routes-compare`, `route`, `card-row`, `station`, `ticket`).
- All fields optional ⇒ existing lessons and `scenarios.test.ts` keep passing unchanged.

`curriculum.ts` — attach specimens / spotlights / pan targets to teaching beats:
- **welcome.map** → `spotlight {kind:'board'}`, frame home.
- **draw** → `CardRowSpecimen`; spotlight `[data-anim="deck"]` / market; loco beat shows a
  locomotive specimen.
- **claim** → `RouteSpecimen rail`; spotlight + frame the R16 route; score-table beat unchanged copy.
- **special** → `RouteCompareSpecimen` on the intro; `double`/`ferry`/`tunnel` beats each show their
  specimen; **ferry** frames a real island crossing, **tunnel** frames Taipei–Yilan.
- **stations** → `StationSpecimen`; cost beat narrates the unified-colour escalation (1/2/3 same
  colour); spotlight a hub city.
- **tickets** → `TicketSpecimen`; forced-draw beat keeps its copy.
- **longest** → spotlight/frame a sample chain; narration + (optional) trail emphasis.
- **endgame** → spotlight trackers / score area.

The chosen route/ferry/tunnel/city ids are validated by `scenarios.test.ts` against real content.

### Encyclopedia — `EncyclopediaModal.tsx` (modified)

Inherits the spotlight, specimens, and animations automatically (same `TutorialOverlay` + scenario
player + `GameStage`). Header polish: replace the bare `<select>` with a **chapter-grouped clickable
list** built from `encyclopediaEntries()` grouped by `chapter`. Store isolation
(`SandboxProvider`) is untouched — the live game stays pristine.

## Data flow

```
useScenarioPlayer → current Beat
  → TutorialScreen / EncyclopediaModal derive { spotlight, frame, specimen } from the beat
    → GameStage
       ├─ Board: receives frameTarget (auto-pan) + data-city-id/data-route-id anchors
       ├─ TutorialSpotlight: useSpotlightRects(spotlight) → dim + holes + rings (re-measured
       │    on transform/resize/beat)
       └─ TutorialOverlay/TutorialBeat: renders specimen + narration + progress + connector caret,
            dodging the spotlighted rect
```

The board pans first; the spotlight re-measures during the transition window so the holes land on
the framed element.

## Files

**New**
- `apps/web/src/features/tutorial/TutorialSpotlight.tsx`
- `apps/web/src/features/tutorial/useSpotlightRects.ts`
- `apps/web/src/features/tutorial/Specimens.tsx`
- `apps/web/src/features/tutorial/TutorialBeat.tsx`
- `apps/web/src/features/tutorial/Specimens.test.tsx`

**Modified**
- `apps/web/src/features/tutorial/types.ts` — extend `Spotlight`, `Beat`, add `SpecimenSpec`.
- `apps/web/src/features/tutorial/curriculum.ts` — enrich beats.
- `apps/web/src/features/tutorial/TutorialOverlay.tsx` — restyle, host specimen, progress bar,
  connector, dodge, layouts.
- `apps/web/src/features/tutorial/TutorialScreen.tsx` — derive + thread spotlight/frame/specimen.
- `apps/web/src/features/tutorial/EncyclopediaModal.tsx` — thread the same; chapter-grouped list.
- `apps/web/src/screens/GameStage.tsx` — accept spotlight/frame, mount `TutorialSpotlight`, pass
  `frameTarget` to Board.
- `apps/web/src/components/Board.tsx` — `data-city-id`/`data-route-id` attrs, `frameTarget` prop +
  `SpotlightFramer`.
- `apps/web/src/styles/tutorial.css` — major restyle: coachmark, spotlight scrim, specimen layout,
  transitions, encyclopedia list.
- `apps/web/src/i18n/tutorial.ts` — glossary captions / new strings.
- `apps/web/src/features/tutorial/scenarios.test.ts` — assert specimen/spotlight/frame references
  resolve (route & city ids exist; hud selectors are on the allow-list; ticket ids exist).

## Error handling & edge cases

- Spotlight target absent → light full-board dim, no holes; never throws.
- jsdom has no layout → rects are 0×0 → treated as "no holes"; tests assert structure, not pixels.
- The scrim never blocks the learner's required action (non-blocking by construction).
- Reduced motion → static dim, instant pan, no transitions/pulse.
- Encyclopedia isolation preserved — no change to store wiring; the live `useGame` snapshot stays
  untouched while the modal is open (existing isolation test still guards this).
- Specimen ↔ board drift impossible — specimens reuse the same classes/components.

## Testing

- **`scenarios.test.ts`** (extended): every lesson still replays through the real reducer; every
  beat's `specimen`/`spotlight`/`frame` references resolve to real content ids and allow-listed
  selectors.
- **`Specimens.test.tsx`** (new): each specimen variant mounts without crashing (smoke).
- **No regression:** full `@trm/web` suite (existing `GameScreen`/`Board`/`ScoreBoard`/
  `useAnimationDriver` + the encyclopedia isolation test), plus engine/codec/server suites stay
  green.
- **Static gates:** `yarn typecheck`, `yarn lint`, `yarn build` (confirm the tutorial chunk stays
  lazy; `@trm/engine`/`@trm/codec` do not leak into the main bundle).
- **Browser e2e (Chrome MCP, local dev — no server needed):** launcher → focus dim appears around
  the deck → card-row specimen visible → advance to special routes → board auto-pans to the tunnel,
  dim frames it, the rail/ferry/tunnel comparison renders → open the in-game encyclopedia during a
  live game, confirm the same visuals and that the live turn banner/snapshot is unchanged on close.

## Risks & mitigations

- **Spotlight re-measure vs. pan timing** — rAF re-measure window after each beat change (proven by
  `RevealFramer`) + resize listener; defensive fallback to full dim.
- **Specimen visual drift** — reuse identical CSS classes/components; no parallel styling.
- **Bundle bloat** — all new code lands in the already-lazy tutorial chunk; verified by `vite build`.
- **Reduced-motion correctness** — single `useReducedMotion` gate threaded through spotlight,
  framing, and coachmark transitions.
- **Scenario rot** — `scenarios.test.ts` replays every lesson and validates every new reference, so
  any content/rule change that breaks a target fails CI, not users.

## Out of scope

- New interactive engine scenarios (no scripted tunnel/ferry/station claims) — explicitly deferred
  per the "specimen + spotlight + auto-pan" choice.
- Any `@trm/engine` / `@trm/codec` / server change.
- Hard cutout / click-blocking focus (rejected in favour of non-blocking dim).
