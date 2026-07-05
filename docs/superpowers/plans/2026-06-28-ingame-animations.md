# In-game Animations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a client-side animation layer to `apps/web` — draw-card fly-to-hand, ticket-dialog motion, claim/station glow, a skippable ticket-completion fanfare (confetti + start→end path sweep, instant points), plus turn cue, score `+N` float, market flip, and tunnel reveal flip.

**Architecture:** Events already reaching the client (`socket.onEvents` → `store/game.applyEvents`) plus snapshot diffs drive a pure event→intent model. A once-mounted `useAnimationDriver` hook dispatches intents into a transient zustand `animations` store; `Board` and a fixed `<AnimationLayer/>` portal render the motion. Ticket completion is derived client-side (no protocol change) via a local union-find, which also yields the route path to sweep.

**Tech Stack:** React 18, Vite 5 (pinned), zustand, react-i18next, `canvas-confetti`. Vitest + @testing-library/react.

## Global Constraints

- `apps/web` pins **Vite ^5** — do not bump to Vite 6.
- The 6th card colour is **PURPLE** (never PINK). Seat colours are abstract indices 0–4, coloured via `SEAT_COLORS` in `theme/colors.ts`.
- Snapshot is authoritative; the client never computes game truth for authority. Derived values (ticket completion, live ticket points) are **display-only**, like the existing payment preview.
- Hidden information: `PublicPlayerState` carries opponents' counts only. The local player's secrets live in `snapshot.you`. Never assume opponent hand/ticket contents.
- UI strings are i18n keys in `i18n/index.ts` (zh-Hant primary + en). City/ticket names are content, resolved from the catalog.
- Honor `prefers-reduced-motion` (existing block at `styles/game.css:902`).
- All new animation CSS goes in a **new** file `apps/web/src/styles/animations.css` (avoid the parent branch's `global.css` WIP).
- Tests: `yarn workspace @trm/web test --run <substring>`. Typecheck: `yarn workspace @trm/web typecheck`. Lint: `yarn workspace @trm/web lint`.

---

## File map

- Create `apps/web/src/game/tickets.ts` — pure ticket completion + path + live points.
- Create `apps/web/src/game/tickets.test.ts`
- Create `apps/web/src/game/animationModel.ts` — pure events+snapshots → intents.
- Create `apps/web/src/game/animationModel.test.ts`
- Create `apps/web/src/store/animations.ts` — transient animation state (zustand).
- Create `apps/web/src/store/animations.test.ts`
- Create `apps/web/src/hooks/useReducedMotion.ts`
- Create `apps/web/src/hooks/useAnimationDriver.ts`
- Create `apps/web/src/hooks/useAnimationDriver.test.tsx`
- Create `apps/web/src/components/AnimationLayer.tsx` — flights, floats, fanfare portal.
- Create `apps/web/src/components/TicketFanfare.tsx` — the item-4 overlay.
- Create `apps/web/src/components/TicketFanfare.test.tsx`
- Create `apps/web/src/components/FlyingCard.tsx` — flying card face (self real / opponent cover).
- Create `apps/web/src/styles/animations.css`
- Modify `apps/web/src/store/game.ts` — add `lastBatch`.
- Modify `apps/web/src/screens/GameScreen.tsx` — mount driver + AnimationLayer; tag anchors; import css.
- Modify `apps/web/src/components/Board.tsx` — glow classes + path-sweep overlay + `data-city` anchors.
- Modify `apps/web/src/components/CardMarket.tsx` — `data-anim` anchors + flip class.
- Modify `apps/web/src/components/PlayerHand.tsx` / `GameScreen` tray — `data-anim="hand"` / `"tickets"`.
- Modify `apps/web/src/components/PlayerTrackers.tsx` — `data-player-id` anchors + turn cue + live self total.
- Modify `apps/web/src/components/KeepTicketsModal.tsx` — slide-up + fly-to-tray.
- Modify `apps/web/src/components/TunnelModal.tsx` — staggered reveal flip.
- Modify `apps/web/src/i18n/index.ts` — fanfare/banner strings.
- Modify `apps/web/package.json` — add `canvas-confetti` + `@types/canvas-confetti`.

---

### Task 1: Dependencies + CSS scaffold

**Files:**

- Modify: `apps/web/package.json`
- Create: `apps/web/src/styles/animations.css`
- Modify: `apps/web/src/screens/GameScreen.tsx` (add `import '../styles/animations.css';`)

- [ ] **Step 1: Add deps**

```bash
cd "D:/Web Projects/TRMission"
yarn workspace @trm/web add canvas-confetti
yarn workspace @trm/web add -D @types/canvas-confetti
```

- [ ] **Step 2: Create `animations.css` with the keyframes/utility skeleton**

Include (filled in by later tasks, but define the shells now):
`@keyframes anim-glow-bloom`, `@keyframes anim-station-pop`, `@keyframes anim-card-flip-in`,
`@keyframes anim-float-up`, `@keyframes anim-pulse`, `@keyframes anim-slide-up`,
`@keyframes anim-sweep` (stroke-dashoffset draw-on), `@keyframes anim-fanfare-in`.
Add a top-level `@media (prefers-reduced-motion: reduce)` block that neutralizes them.

- [ ] **Step 3: Import css in GameScreen** (next to `import '../styles/game.css';`).

- [ ] **Step 4: Verify build**

Run: `yarn workspace @trm/web typecheck`
Expected: PASS (no usages yet).

- [ ] **Step 5: Commit**

```bash
git add apps/web/package.json apps/web/yarn.lock apps/web/src/styles/animations.css apps/web/src/screens/GameScreen.tsx ../../yarn.lock 2>/dev/null; git add -A apps/web package.json yarn.lock
git commit -m "Web: add canvas-confetti + animations.css scaffold"
```

---

### Task 2: Animation event bus (`store/game.ts`)

**Files:**

- Modify: `apps/web/src/store/game.ts`
- Test: `apps/web/src/store/game.test.ts` (create)

**Interfaces:**

- Produces: `useGame` state gains `lastBatch: { seq: number; events: GameEvent[] } | null`. `applyEvents` increments `seq` and replaces `events` (in addition to existing `recentEvents` append).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { create } from 'zustand';
import { useGame } from './game';

describe('game store animation bus', () => {
  beforeEach(() => useGame.getState().reset());
  it('bumps lastBatch.seq on each applyEvents and carries the batch', () => {
    expect(useGame.getState().lastBatch).toBeNull();
    useGame
      .getState()
      .applyEvents(1, [{ event: { case: 'turnEnded', value: { playerId: 'a' } } } as any]);
    const a = useGame.getState().lastBatch!;
    expect(a.seq).toBe(1);
    expect(a.events).toHaveLength(1);
    useGame.getState().applyEvents(2, []);
    expect(useGame.getState().lastBatch!.seq).toBe(2);
  });
  it('reset clears lastBatch', () => {
    useGame.getState().applyEvents(1, []);
    useGame.getState().reset();
    expect(useGame.getState().lastBatch).toBeNull();
  });
});
```

- [ ] **Step 2: Run → FAIL** (`lastBatch` undefined). `yarn workspace @trm/web test --run game.test`
- [ ] **Step 3: Implement** — add `lastBatch` to the interface + initial `null`; in `applyEvents` set `lastBatch: { seq: (s.lastBatch?.seq ?? 0) + 1, events }`; add `lastBatch: null` to `reset`.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `git commit -m "Web: expose latest event batch from game store for animations"`

---

### Task 3: `game/tickets.ts` — completion, path, live points (pure, TDD)

**Files:**

- Create: `apps/web/src/game/tickets.ts`
- Test: `apps/web/src/game/tickets.test.ts`

**Interfaces:**

- Produces:
  - `completedTicketIds(snapshot: GameSnapshot): Set<string>` — kept tickets of `snapshot.you` whose endpoints are connected over the local player's owned routes plus ≤1 borrowed opponent edge per built station, under the assignment maximizing completions (mirrors `packages/engine/src/graph/connectivity.ts`).
  - `pathForTicket(snapshot: GameSnapshot, ticketId: string): string[]` — ordered route ids from endpoint a→b over the usable edge graph (own + the chosen borrows), or `[]` if not connected.
  - `liveTicketPoints(snapshot: GameSnapshot): number` — sum of `value` over `completedTicketIds`.

**Implementation notes:**

- Owned edges: from `snapshot.ownership` where `cell.case === 'ownerPlayerId'` and value === `snapshot.you.playerId`; map routeId → `routeById` → `{ a, b, routeId }`.
- Station cities: `snapshot.stations` where `playerId === you.playerId` → `cityId`.
- Borrow candidates per station city: routes in `ROUTES` incident to that city, owned by an opponent (ownership `ownerPlayerId` !== me) and **not** locked, excluding my own.
- Assignment: enumerate `[null, ...candidates]` per station (≤3 stations, bounded), union-find own+assigned edges, count completed tickets, keep the assignment with the most completed (tie: fewest borrows) — same tie-break spirit as the engine. Record per-ticket completion under the winning assignment.
- Local union-find (small, inline) keyed on city ids; vertices = all city ids touched.
- `pathForTicket`: BFS over an adjacency built from own edges + the winning assignment's borrowed edges; reconstruct city path, then map each consecutive city pair back to a routeId (prefer an own edge; else the borrowed one).

- [ ] **Step 1: Write failing tests** (use a `snap()` builder producing a minimal `GameSnapshot`-shaped object):

```ts
import { describe, it, expect } from 'vitest';
import { completedTicketIds, pathForTicket, liveTicketPoints } from './tickets';
// helper builds { you:{playerId,keptTicketIds}, players, ownership, stations } with real route/ticket ids from content

it('marks a ticket complete when own routes connect its endpoints', () => {
  const s = snapConnectingTicket('T_xxx'); // owns routes forming a path a..b of ticket T_xxx
  expect(completedTicketIds(s).has('T_xxx')).toBe(true);
});
it('leaves a ticket incomplete when the path is broken', () => {
  const s = snapMissingOneRoute('T_xxx');
  expect(completedTicketIds(s).has('T_xxx')).toBe(false);
});
it('completes via a single station-borrowed opponent edge', () => {
  const s = snapNeedsBorrow('T_xxx');
  expect(completedTicketIds(s).has('T_xxx')).toBe(true);
});
it('does not double-borrow one station for two tickets', () => {
  const s = snapTwoTicketsOneStation();
  expect(completedTicketIds(s).size).toBe(1);
});
it('pathForTicket returns the ordered owned route ids a→b', () => {
  const s = snapConnectingTicket('T_xxx');
  const p = pathForTicket(s, 'T_xxx');
  expect(p.length).toBeGreaterThan(0);
});
it('liveTicketPoints sums completed ticket values', () => {
  const s = snapConnectingTicket('T_xxx');
  expect(liveTicketPoints(s)).toBe(ticketById.get('T_xxx')!.value);
});
```

(Pick concrete city/route/ticket ids by reading `@trm/map-data` content in the test via `ROUTES`/`TICKETS`; build a short ticket's path from `ROUTE_GEOMETRY`/`routeById` adjacency.)

- [ ] **Step 2: Run → FAIL.** `yarn workspace @trm/web test --run tickets.test`
- [ ] **Step 3: Implement `game/tickets.ts`** per the notes.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `git commit -m "Web: client-side ticket completion + path derivation"`

---

### Task 4: `game/animationModel.ts` — events+snapshots → intents (pure, TDD)

**Files:**

- Create: `apps/web/src/game/animationModel.ts`
- Test: `apps/web/src/game/animationModel.test.ts`

**Interfaces:**

- Produces:
  - `type AnimIntent =`
    `| { kind: 'cardFly'; toPlayerId: string; faceUp: boolean; color: CardColor | null; slot: number | null }`
    `| { kind: 'glowRoute'; routeId: string; seat: number }`
    `| { kind: 'glowStation'; cityId: string; seat: number }`
    `| { kind: 'scoreFloat'; playerId: string; amount: number }`
    `| { kind: 'turnCue'; playerId: string; isYou: boolean }`
    `| { kind: 'marketFlip'; slot: number }`
    `| { kind: 'ticketComplete'; ticketId: string; long: boolean; seat: number; path: string[] }`
  - `intentsFromEvents(snapshot: GameSnapshot, events: GameEvent[]): AnimIntent[]` — maps `RouteClaimed`→glowRoute(+scoreFloat from `pointsAwarded`), `StationBuilt`→glowStation, `CardTakenFaceup`/`CardDrawnBlind`→cardFly (faceUp + color: self sees real color; for opponents color=null → cover), `MarketRefilled`/`CardTakenFaceup`→marketFlip(slot), `TurnStarted`→turnCue.
  - `ticketCompletionIntents(prev: Set<string>, curr: Set<string>, snapshot): AnimIntent[]` — for each id in `curr \ prev`, build `ticketComplete` with `long` from `ticketById.deck === 'LONG'`, `seat` = my seat, `path` = `pathForTicket`.

- [ ] **Step 1: Write failing tests** covering: RouteClaimed→glowRoute+scoreFloat; opponent CardDrawnBlind→cardFly with color null (cover); my CardDrawnBlind→color set; StationBuilt→glowStation; TurnStarted→turnCue.isYou correct; ticketCompletionIntents only emits the diff.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** (seat lookup via `seatByPlayer`; self id via `snapshot.you.playerId`).
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `git commit -m "Web: pure event→animation-intent model"`

---

### Task 5: `store/animations.ts` — transient state (TDD)

**Files:**

- Create: `apps/web/src/store/animations.ts`
- Test: `apps/web/src/store/animations.test.ts`

**Interfaces:**

- Produces `useAnimations` with: `glowingRoutes: Map<string, number>` (routeId→seat), `glowingStations: Map<string, number>`, `flights: Flight[]`, `floats: Float[]`, `turnCue: { playerId: string; isYou: boolean; id: number } | null`, `marketFlips: Set<number>`, `fanfare: Fanfare | null`, and actions `pushIntent(i: AnimIntent)`, `clearGlowRoute(id)`, `clearGlowStation(id)`, `removeFlight(id)`, `removeFloat(id)`, `dismissFanfare()`, `clearMarketFlip(slot)`, `reset()`. `Flight`/`Float`/`Fanfare` carry an auto-increment `id`.
- `pushIntent` routes each intent kind into the right slice (e.g., `glowRoute`→set `glowingRoutes`; `ticketComplete`→set `fanfare` (queue if one active, see notes)).

**Notes:** Use a module-scope counter for ids (the engine PRNG rule does NOT apply to the web). Glows are cleared by the consuming component's timeout (Task 8), or store a timestamp the component reads. Keep `pushIntent` synchronous + pure-ish (no timers in the store).

- [ ] **Step 1: Failing tests:** pushIntent('glowRoute') populates glowingRoutes; pushIntent('ticketComplete') sets fanfare; second ticketComplete while one active queues (fanfare stays first, dismissFanfare advances); reset clears all.
- [ ] **Step 2: FAIL → Step 3: implement → Step 4: PASS.**
- [ ] **Step 5: Commit** `git commit -m "Web: transient animation store"`

---

### Task 6: `hooks/useReducedMotion.ts`

**Files:** Create `apps/web/src/hooks/useReducedMotion.ts`

**Interfaces:** Produces `useReducedMotion(): boolean` — subscribes to `matchMedia('(prefers-reduced-motion: reduce)')`, SSR-safe (guards `window`).

- [ ] **Step 1:** Implement (no separate test; covered via component tests).
- [ ] **Step 2:** `yarn workspace @trm/web typecheck` → PASS.
- [ ] **Step 3: Commit** `git commit -m "Web: useReducedMotion hook"`

---

### Task 7: `useAnimationDriver` — wire bus→model→store (TDD)

**Files:**

- Create: `apps/web/src/hooks/useAnimationDriver.ts`
- Test: `apps/web/src/hooks/useAnimationDriver.test.tsx`

**Interfaces:**

- Consumes: `useGame.lastBatch`, `useGame.snapshot`, `completedTicketIds`, `intentsFromEvents`, `ticketCompletionIntents`, `useAnimations.pushIntent`.
- Produces: `useAnimationDriver(): void` — mounted once in GameScreen.

**Behavior:**

- Keep refs `prevCompleted` and `prevBatchSeq`. On mount / first snapshot: initialize `prevCompleted = completedTicketIds(snapshot)` and do **not** fire (prevents reconnect/resume from replaying).
- On a new `lastBatch.seq`: `pushIntent` each of `intentsFromEvents(snapshot, lastBatch.events)`; then compute `curr = completedTicketIds(snapshot)`, push `ticketCompletionIntents(prevCompleted, curr, snapshot)`, set `prevCompleted = curr`.

- [ ] **Step 1: Failing test** (render a tiny component using the hook; drive `useGame.setState` to simulate snapshot then a batch; assert `useAnimations` received intents and that the **first** snapshot did not produce a fanfare even if tickets are already complete).
- [ ] **Step 2: FAIL → Step 3: implement → Step 4: PASS.**
- [ ] **Step 5: Commit** `git commit -m "Web: animation driver (events+snapshot diff → intents)"`

---

### Task 8: Claim & station glow on the board (item 3)

**Files:**

- Modify: `apps/web/src/components/Board.tsx`
- Modify: `apps/web/src/styles/animations.css`

**Approach:** Board subscribes to `useAnimations` `glowingRoutes`/`glowingStations`. A route in the set gets class `just-claimed` (+ inline `--seat` colour); a station city in the set gets `just-built`. A `useEffect` per newly-added id sets a `setTimeout(1200ms)` calling `clearGlowRoute/Station`. CSS: `.route.just-claimed .slot { animation: anim-glow-bloom 1.2s ease-out; }` with a `drop-shadow` bloom in `var(--seat)`; `.station.just-built`/`.station-hub.just-built { animation: anim-station-pop 1s ease-out; }` (scale + ring via filter/box-shadow equivalent on SVG: use `transform` + a temporary `<circle>` ring overlay).

- [ ] **Step 1:** Add subscription + classes + expiry effect to Board.
- [ ] **Step 2:** Add keyframes to animations.css.
- [ ] **Step 3:** `yarn workspace @trm/web typecheck && yarn workspace @trm/web test --run Board.test` → PASS (existing Board tests still green).
- [ ] **Step 4: Commit** `git commit -m "Web: glow routes on claim and stations on build"`

---

### Task 9: `FlyingCard` + AnimationLayer card flights (item 1)

**Files:**

- Create: `apps/web/src/components/FlyingCard.tsx`
- Create: `apps/web/src/components/AnimationLayer.tsx`
- Modify: `apps/web/src/components/CardMarket.tsx` (anchors `data-anim="deck"`, `data-anim="market-slot" data-slot={slot}`)
- Modify: `apps/web/src/components/PlayerHand.tsx` or its wrapper (anchor `data-anim="hand"`)
- Modify: `apps/web/src/components/PlayerTrackers.tsx` (anchor `data-player-id`)
- Modify: `apps/web/src/screens/GameScreen.tsx` (render `<AnimationLayer/>`)
- Modify: `apps/web/src/styles/animations.css`

**Approach:** `AnimationLayer` reads `flights` from the store. For each flight it resolves source rect (deck/market slot via `[data-anim][data-slot]`) and target rect (self → `[data-anim="hand"]`; opponent → `[data-player-id="X"]`) with `getBoundingClientRect()`, renders a `<FlyingCard>` positioned `fixed` at source, then on next frame transitions `transform: translate(dx,dy) scale(...)` to target; `onTransitionEnd` → `removeFlight(id)`. `FlyingCard variant`: `'cover'` (branded back: train glyph + 台鐵任務 / TRMission) or a real card face (reuse `TrainCarCard` read-only when `color` set). Under reduced motion, `removeFlight` immediately (no travel).

- [ ] **Step 1:** Add anchors to CardMarket/PlayerHand/PlayerTrackers.
- [ ] **Step 2:** Implement `FlyingCard` + `AnimationLayer` (flights only); render layer in GameScreen.
- [ ] **Step 3:** CSS for `.flying-card` + transition.
- [ ] **Step 4:** `yarn workspace @trm/web typecheck` → PASS; existing tests green.
- [ ] **Step 5: Commit** `git commit -m "Web: draw-card fly-to-hand (self real card, opponents branded cover)"`

---

### Task 10: Score `+N` floats, turn cue, market flip (item 5 partial)

**Files:**

- Modify: `apps/web/src/components/AnimationLayer.tsx` (floats)
- Modify: `apps/web/src/components/PlayerTrackers.tsx` (turn-cue class)
- Modify: `apps/web/src/components/CardMarket.tsx` (flip class from `marketFlips`)
- Modify: `apps/web/src/styles/animations.css`

**Approach:**

- Floats: AnimationLayer reads `floats`, anchors each to `[data-player-id="X"]` score cell, renders `+N` with `anim-float-up` + count-up (optional); `onAnimationEnd`→`removeFloat`.
- Turn cue: PlayerTrackers applies `is-turn-cue` to the row matching `turnCue.playerId` (keyed by `turnCue.id` so it re-triggers); stronger variant `is-your-turn` when `isYou`. Self-clears via animationend or a timeout.
- Market flip: CardMarket adds `is-flipping` to slots in `marketFlips`; `onAnimationEnd`→`clearMarketFlip(slot)`.

- [ ] **Step 1:** Implement the three.
- [ ] **Step 2:** CSS keyframes.
- [ ] **Step 3:** typecheck + tests green.
- [ ] **Step 4: Commit** `git commit -m "Web: score +N floats, turn-change cue, market refill flip"`

---

### Task 11: Ticket dialog motion (item 2)

**Files:**

- Modify: `apps/web/src/components/KeepTicketsModal.tsx`
- Modify: `apps/web/src/screens/GameScreen.tsx` (tickets tray anchor `data-anim="tickets"`)
- Modify: `apps/web/src/styles/animations.css`

**Approach:** On mount the offered `.ticket-card`s get a staggered `anim-slide-up` (CSS `animation-delay: calc(var(--i) * 60ms)` via inline `--i`). On confirm, before calling `onConfirm`, dispatch flights from each kept card's rect to the `[data-anim="tickets"]` anchor (reuse the store `flights` with a ticket-card face variant) — or, simpler and self-contained: add an `is-confirming` class that runs a fly-out keyframe, then call `onConfirm` after a short timeout (skip the timeout under reduced motion). Choose the class-based approach to avoid cross-wiring the modal to the board layer.

- [ ] **Step 1:** Implement slide-up + confirm fly-out.
- [ ] **Step 2:** CSS.
- [ ] **Step 3:** `yarn workspace @trm/web test --run` (no modal tests break); typecheck.
- [ ] **Step 4: Commit** `git commit -m "Web: ticket dialog slide-up + fly-to-tray on keep"`

---

### Task 12: Tunnel reveal flip (item 5)

**Files:**

- Modify: `apps/web/src/components/TunnelModal.tsx`
- Modify: `apps/web/src/styles/animations.css`

**Approach:** Each `.reveal-card` gets `anim-card-flip-in` with `animation-delay: calc(var(--i) * 180ms)` (inline `--i={i}`), so the three revealed cards flip in sequence. Reduced motion → no delay/flip.

- [ ] **Step 1:** Implement + CSS.
- [ ] **Step 2:** typecheck + tests green.
- [ ] **Step 3: Commit** `git commit -m "Web: tunnel reveal cards flip in one-by-one"`

---

### Task 13: Ticket-completion fanfare (item 4)

**Files:**

- Create: `apps/web/src/components/TicketFanfare.tsx`
- Test: `apps/web/src/components/TicketFanfare.test.tsx`
- Modify: `apps/web/src/components/AnimationLayer.tsx` (render `fanfare`)
- Modify: `apps/web/src/components/Board.tsx` (path sweep overlay from `useAnimations.fanfare?.path`)
- Modify: `apps/web/src/i18n/index.ts` (strings — Task 15 may merge here)
- Modify: `apps/web/src/styles/animations.css`

**Interfaces:**

- `TicketFanfare({ fanfare, reducedMotion, onDone }: { fanfare: Fanfare; reducedMotion: boolean; onDone(): void })`.
- `Fanfare = { id: number; ticketId: string; long: boolean; seat: number; path: string[] }`.

**Approach:**

- Overlay: `position: fixed; inset: 0;` dim backdrop; centered enlarged `TicketCard` (reuse) + localized title (`fanfareTitle`) + value; `anim-fanfare-in`.
- Confetti: import `canvas-confetti`; on mount fire a burst; if `long`, a larger/longer multi-burst (e.g., 2–3 staggered `confetti()` calls). Skip entirely under reduced motion.
- Skip: click backdrop / Escape key / auto-dismiss. Hard cap: `setTimeout(onDone, reducedMotion ? 1500 : 6500)` (< 7000ms). Clear timer on unmount/skip.
- Board sweep: Board reads `fanfare?.path`; renders an SVG overlay `<g class="sweep">` drawing each route's geometry path in `SEAT_COLORS[seat]` with `stroke-dasharray`/`stroke-dashoffset` animated (`anim-sweep`) and `animation-delay` increasing per segment index so it travels start→end. Cleared when fanfare dismisses.
- On dismiss, `AnimationLayer` calls `dismissFanfare()` (advances any queued fanfare).

- [ ] **Step 1: Failing test** (`TicketFanfare.test.tsx`): renders title + value; clicking backdrop calls `onDone`; pressing Escape calls `onDone`; with `reducedMotion` it still renders (static) and `canvas-confetti` is not called (mock it: `vi.mock('canvas-confetti')`); auto-dismiss via fake timers calls `onDone` within cap.
- [ ] **Step 2: Run → FAIL.** `yarn workspace @trm/web test --run TicketFanfare`
- [ ] **Step 3: Implement** `TicketFanfare`, wire into `AnimationLayer`, add the Board sweep overlay.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `git commit -m "Web: skippable ticket-completion fanfare + board path sweep + confetti"`

---

### Task 14: Instant ticket points in score display

**Files:**

- Modify: `apps/web/src/components/PlayerTrackers.tsx`

**Approach:** For the local player's row only, show total = `routePoints + liveTicketPoints(snapshot)` (import from `game/tickets`). The `+N` float (Task 13's `scoreFloat` for the completed ticket value) provides the motion; this makes the displayed number land on the new total. Opponents keep `routePoints`.

**Interfaces:** Consumes `liveTicketPoints` (Task 3). Add a `scoreFloat` for the ticket value in `ticketCompletionIntents` (update Task 4's model: also emit `{ kind:'scoreFloat', playerId: me, amount: value }` per completed ticket) — adjust the Task 4 test accordingly.

- [ ] **Step 1:** Update `animationModel` to also emit a self `scoreFloat` on completion (+ test).
- [ ] **Step 2:** Update PlayerTrackers self total.
- [ ] **Step 3:** typecheck + tests green.
- [ ] **Step 4: Commit** `git commit -m "Web: award + display ticket points instantly on completion (self)"`

---

### Task 15: i18n strings

**Files:** Modify `apps/web/src/i18n/index.ts`

**Approach:** Add keys used above to both zh-Hant and en: `fanfareTitle` ("任務完成" / "Ticket Complete"), `fanfareLong` ("長途任務！" / "Long Haul!"), `skip` ("略過" / "Skip"). Wire them where referenced (TicketFanfare). If already added inline during Task 13, this task just verifies both locales have them.

- [ ] **Step 1:** Add/verify keys in both locales.
- [ ] **Step 2:** `yarn workspace @trm/web test --run` + typecheck → PASS.
- [ ] **Step 3: Commit** `git commit -m "Web: i18n strings for ticket fanfare"`

---

### Task 16: Full verification

- [ ] **Step 1:** `yarn workspace @trm/web typecheck` → PASS
- [ ] **Step 2:** `yarn workspace @trm/web lint` → PASS
- [ ] **Step 3:** `yarn workspace @trm/web test --run` → all PASS
- [ ] **Step 4: Manual/browser smoke:** start Mongo (`docker compose up -d mongo`) + server (`yarn workspace @trm/server dev`, with `TRM_DEV_GAME=1 TRM_BOT_DELAY_MS=500`) + web (`yarn workspace @trm/web dev`); open the board via claude-in-chrome. Observe: draw fly (self real / bot cover), claim glow, station pop, turn cue, score float, market flip, tunnel flip, and force/await a ticket completion for the fanfare + sweep. Capture a GIF.
- [ ] **Step 5:** Confirm reduced-motion path by toggling OS setting (or `matchMedia` mock in a quick test): fanfare static, no confetti.

---

## Self-Review

**Spec coverage:** item 1 → Task 9; item 2 → Task 11; item 3 → Task 8; item 4 → Task 13 (+ sweep, +instant points Task 14); item 5 (turn cue/score float/market flip) → Task 10, (tunnel flip) → Task 12. Shared spine: bus Task 2, tickets Task 3, model Task 4, store Task 5, reduced-motion Task 6, driver Task 7. Deps/CSS Task 1. i18n Task 15. Verify Task 16. No gaps.

**Type consistency:** `AnimIntent` kinds defined in Task 4 are the exact set consumed by `pushIntent` (Task 5) and produced by the driver (Task 7). `Fanfare` shape consistent between store (Task 5), driver/model (`ticketComplete` intent, Task 4), and `TicketFanfare` (Task 13). `completedTicketIds`/`pathForTicket`/`liveTicketPoints` signatures consistent across Tasks 3/4/7/14. `scoreFloat` added in Task 4 model and re-confirmed in Task 14.

**Placeholders:** none — each task names exact files, the interfaces, and concrete test assertions. CSS keyframe names are fixed (`anim-*`) and shared between the css task and consumers.

---

## REVISION 1 — backend reveal of finished tickets (own-track instant, all players)

These backend tasks run **first** (B1→B4), before the web tasks. They make finished tickets public
through the sanctioned projection without weakening the COUNTS-ONLY `PublicPlayerState` invariant.
Web Tasks 3/7/14 are revised below to consume the wire field instead of deriving completion locally.

### Task B1: proto — `completed_tickets` on `GameSnapshot`

**Files:** Modify `packages/proto/proto/trmission/v1/common.proto`; regenerate.

- [ ] **Step 1:** Add `message CompletedTicket { string player_id = 1; string ticket_id = 2; }` and, on `GameSnapshot`, `repeated CompletedTicket completed_tickets = 23;` (use the next free field number — verify by reading the message; do NOT reuse a number).
- [ ] **Step 2:** `yarn workspace @trm/proto generate` → regenerates `src/gen/`.
- [ ] **Step 3:** `yarn workspace @trm/proto test` → PASS (round-trip + PROTOCOL_VERSION).
- [ ] **Step 4: Commit** `git commit -m "Proto: reveal finished tickets via GameSnapshot.completed_tickets"`

### Task B2: engine — own-track completion + redactFor reveal

**Files:**

- Modify `packages/engine/src/graph/connectivity.ts` (add `ownConnectedTicketIds`)
- Modify `packages/engine/src/types/view.ts` (add `completedTickets` to `RedactedView`)
- Modify `packages/engine/src/selectors.ts` (`redactFor` signature + compute)
- Modify `packages/engine/src/game-session.ts` caller is in server — update there in B3
- Modify `packages/engine/src/index.ts` (export `ownConnectedTicketIds` + its types if useful)
- Test: `packages/engine/test/connectivity.spec.ts`, `packages/engine/test/redact.spec.ts`

**Interfaces:**

- Produces: `ownConnectedTicketIds(args: { ownEdges: readonly Edge[]; tickets: readonly { id: string; a: string; b: string }[]; vertices: readonly string[] }): string[]` — ids whose endpoints are connected by `ownEdges`.
- `RedactedView.completedTickets: readonly { player: PlayerId; ticket: TicketId }[]`.
- `redactFor(board: Board, state: GameState, viewer: PlayerId | null): RedactedView`.

- [ ] **Step 1: Failing test (connectivity.spec.ts)**

```ts
import { ownConnectedTicketIds } from '../src/graph/connectivity';
it('ownConnectedTicketIds: marks tickets joined by own edges', () => {
  const r = ownConnectedTicketIds({
    ownEdges: [
      { a: 'X', b: 'Y' },
      { a: 'Y', b: 'Z' },
    ],
    tickets: [
      { id: 't1', a: 'X', b: 'Z' },
      { id: 't2', a: 'X', b: 'Q' },
    ],
    vertices: ['X', 'Y', 'Z', 'Q'],
  });
  expect(r).toEqual(['t1']);
});
```

- [ ] **Step 2: FAIL.** `yarn workspace @trm/engine test --run connectivity`
- [ ] **Step 3: Implement** `ownConnectedTicketIds` (UnionFind over ownEdges; filter tickets by `connected(a,b)`; map to id).
- [ ] **Step 4: PASS.**
- [ ] **Step 5: Failing test (redact.spec.ts)** — update `afterSetup` to also return `board`; change the 3 `redactFor(state, viewer)` calls to `redactFor(board, state, viewer)`. Add: build a state where p0 owns routes connecting one of p0's kept tickets, assert `view.completedTickets` contains `{player: p0, ticket}` for that ticket and is visible from an opponent's view too; assert an unconnected kept ticket is absent.
- [ ] **Step 6: FAIL** (signature/field missing).
- [ ] **Step 7: Implement** — add `completedTickets` to `RedactedView`; in `redactFor` add `board` param; for each player build `ownEdges` (ownership entries with `owner===id` → `getRoute(board,routeId).{a,b}`), `tickets` (`state.players[id].keptTickets` → `getTicket(board, tid).{a,b}` with `id=tid`), `vertices` (cities touched), call `ownConnectedTicketIds`, flat-map to `{player:id, ticket}`.
- [ ] **Step 8: PASS;** run full engine suite `yarn workspace @trm/engine test` (property/golden unaffected — no state shape change, only projection).
- [ ] **Step 9: Commit** `git commit -m "Engine: redactFor reveals own-track completed tickets (public)"`

### Task B3: server codec — map completed_tickets

**Files:**

- Modify `apps/server/src/game/game-session.ts` (`redactFor(this.board, this.state, viewer)`)
- Modify `apps/server/src/codec/snapshot.ts` (map `view.completedTickets` → `completedTickets`)
- Test: `apps/server/test/wire-game.e2e.spec.ts` (extend leak test with a benign subset assertion + comment)

- [ ] **Step 1:** Update `project` caller signature.
- [ ] **Step 2:** In `viewToSnapshot`, add `completedTickets: view.completedTickets.map((c) => ({ playerId: c.player as string, ticketId: c.ticket as string }))`.
- [ ] **Step 3:** In `wire-game.e2e.spec.ts`, add a comment that finished tickets are intentionally public via `completed_tickets`, and (optional) assert that any opponent id in `completed_tickets` is a real player id. Keep existing assertions.
- [ ] **Step 4:** `yarn workspace @trm/server test --run wire-game` → PASS; then `yarn workspace @trm/server test` → PASS.
- [ ] **Step 5: Commit** `git commit -m "Server: carry completed_tickets through the snapshot codec"`

### Web task revisions

**Task 3 (REVISED) — `game/tickets.ts`:** drop client-side completion derivation. Implement only:

- `pathForTicket(snapshot: GameSnapshot, playerId: string, ticketId: string): string[]` — BFS over the routes owned by `playerId` (from `snapshot.ownership`) between the ticket's endpoints (`ticketById`), returning ordered route ids (or `[]`).
- `playerLiveTotal(snapshot: GameSnapshot, playerId: string): number` — that player's `routePoints` + Σ value of their entries in `snapshot.completedTickets`.
  Tests: path found / not found; live total sums revealed completed tickets.

**Task 7 (REVISED) — `useAnimationDriver`:** detect completion by diffing `snapshot.completedTickets`
(grouped by player) across snapshots — not via local union-find. For each newly-added `{playerId,
ticketId}` emit a `ticketComplete` intent `{ playerId, ticketId, isYou: playerId===you, long, seat,
path: pathForTicket(snapshot, playerId, ticketId) }`. Initialise the prev set on first snapshot
(no fire). `intentsFromEvents` still handles claim/station/draw/turn/market.

**Task 13 (REVISED) — fanfare:** `TicketFanfare` only renders for `isYou` completions (full-screen +
confetti + board sweep). Opponent completions render a **subtle cue** in `AnimationLayer`: a small
revealed `TicketCard` anchored near `[data-player-id]` for ~2.5s + the board path glow (reuse the
sweep overlay, shorter) + a score float. No backdrop for opponents.

**Task 14 (REVISED) — score display:** `PlayerTrackers` shows `playerLiveTotal(snapshot, p.id)` for
**every** player (not just self). The completion `scoreFloat` is emitted in the driver (Task 7) for
the completing player.
