# Tutorial Mode + In-Game Encyclopedia for TRMission

## Context

TRMission (台鐵任務) is a multiplayer reimplementation of *Ticket to Ride: Europe* mechanics
themed on Taiwan's railways. A new player today is dropped straight into a server game with no
guidance — every rule (drawing rules, ferries, tunnels, stations, ticket penalties, longest trail,
endgame) must be learned by trial and error. There is **no existing tutorial, onboarding, or help
content anywhere** in the codebase.

This plan adds two features:

1. **Tutorial mode** — an *interactive sandbox* that runs a **real local game** by importing the
   pure `@trm/engine` into the web client. The learner performs real actions; the engine validates
   every move (so it can never teach a wrong rule). Scripted opponent moves play between the
   learner's turns to demonstrate flow. At launch the learner chooses **Full curriculum** or
   **Quickstart (core)** scope.
2. **In-game Encyclopedia** — a help button (available *during a live game*) that opens a
   categorized index where each entry is a **short board replay demo + a concise rules blurb**.
   "Replay a specific part" = re-seed the same deterministic scenario, replay its scripted action
   prefix to a checkpoint, then play that lesson's beats.

Both features are powered by **one shared scenario-player core** (same engine, same board/HUD
components, same controller) — the only difference is whether a "beat" waits for the learner to act
(`await`) or auto-plays a scripted action (`auto`).

### Confirmed decisions
- **Interactive sandbox** via local `@trm/engine` (not hand-authored snapshots).
- **Encyclopedia entries = replay demo + short text.**
- **Learner picks scope at start** (Full vs Quickstart).

### Why this is feasible (verified)
- `@trm/engine` is a pure, deterministic, browser-safe reducer (`initGame`, `reduce`, `redactFor`,
  `replay`, `legalActions`, `taiwanBoard`, `CONTENT_HASH` — `packages/engine/src/index.ts`).
- The web render stack (`Board`, `CardMarket`, `PlayerTrackers`, `TicketPanel`, `PaymentModal`,
  `TunnelModal`, `ScoreBoard`, `AnimationLayer`) is driven by the proto `GameSnapshot` + proto
  `GameEvent`. The codec that produces those (`viewToSnapshot`, `eventToProto`) lives in
  `apps/server/src/codec/` and is **100% pure** (no Nest/IO) → extractable into a shared package.
- The action seam is `getSocket().<method>()`; a `SandboxSocket` mirroring that method surface can
  apply actions to a local engine and feed the *same* stores → the entire existing board/animation
  stack renders a local game unchanged.

---

## The curriculum — full list of items to be taught

Organized into chapters → lessons. Each lesson is a `Lesson` object (a scenario). **`scope`** marks
whether it appears in **Quickstart (C)** and/or **Full (F)**. **`enc`** marks lessons that also
become Encyclopedia entries (replay demo + blurb). Rule numbers/constants below are confirmed from
`packages/shared/src/constants.ts` (`DEFAULT_RULE_PARAMS`) and the engine.

### Ch.0 — Goal & overview  *(C, F)*
- **0.1 The objective** — build railways across Taiwan, complete secret mission tickets, score the
  most points. *(C,F, enc)*
- **0.2 The map** — 46 cities (39 main island + 7 offshore islands), routes between adjacent cities;
  pan/zoom the board. *(C,F)*
- **0.3 Where points come from** — preview: claimed routes, completed tickets, station bonus,
  longest-trail bonus. *(C,F, enc)*

### Ch.1 — Components & setup  *(C, F)*
- **1.1 Train cards** — 8 colours **incl. PURPLE (never PINK)** + **LOCOMOTIVE** wild; deck = 12 per
  colour + 14 locomotives. *(C,F, enc)*
- **1.2 Your supply** — start with **45 trains**, **3 stations**, **4 cards**. *(C,F)*
- **1.3 What a mission ticket is** — a ticket names **two cities** (its endpoints); connecting them
  end-to-end with an unbroken chain of **your own** claimed routes by game end earns the ticket's
  **stated points** (failing to connect them loses those points — detailed in 7.2). Tickets are
  **secret from opponents**. *(C,F, enc)*
- **1.4 Initial ticket draft** — offered **1 long + 3 short**, must **keep ≥ 2**; rejects go to the
  bottom of their decks. *(C,F, enc)* — interactive: learner keeps tickets in `TicketChooser`.

### Ch.2 — The turn  *(C, F)*
- **2.1 One action per turn** — a turn is exactly one of: draw cards / claim a route / build a
  station / draw tickets. Turn-order indicator. *(C,F, enc)*

### Ch.3 — Drawing train cards  *(C, F)*
- **3.1 Market + deck** — 5 face-up slots + the blind deck. *(C,F)*
- **3.2 Draw two** — take two cards (face-up or blind) to end the turn. *(C,F, enc)* — interactive.
- **3.3 Face-up locomotive rule** — taking a face-up locomotive costs your **whole turn** (can't
  take a 2nd card); a locomotive may **not** be the 2nd face-up card. *(F, enc)*
- **3.4 Blind locomotive** — a locomotive drawn blind as the first card ends the draw (default
  rule). *(F, enc)*
- **3.5 Market recycle** — if **3+ locomotives** are face-up, the whole market is discarded &
  redrawn. *(F, enc)* — auto demo.
- **3.6 Deck reshuffle** — when the deck empties, the discard pile is reshuffled. *(F, enc)* — auto.

### Ch.4 — Claiming routes (core)  *(C, F)*
- **4.1 Claim a route** — pay *length* cards of the route's colour; one train car per segment.
  *(C,F, enc)* — interactive (uses `PaymentModal`).
- **4.2 Locomotives are wild** — substitute for any colour. *(C,F, enc)*
- **4.3 Gray routes** — pay any single colour. *(C,F, enc)*
- **4.4 Route scoring** — immediate points by length: **1→1, 2→2, 3→4, 4→7, 6→15, 8→21**. *(C,F,
  enc)* — auto demo with score floats.
- **4.5 Insufficient cards** — what happens when you can't pay (shortfall hint). *(F)*

### Ch.5 — Special routes  *(F)*
- **5.1 Double (parallel) routes** — two lines between the same cities; in **2–3 player** games
  claiming one **locks** the sibling; in **4–5 player** both stay open; you can never own both
  siblings. *(F, enc)* — auto demo staged at 2p (`SINGLE_ONLY`).
- **5.2 Ferry routes** — require a **minimum number of locomotives** (the loco slots) in payment.
  *(F, enc)* — interactive claim of an island ferry.
- **5.3 Tunnel routes** — pay the route's length like any route (**locomotives are allowed in the
  payment**); then **3 cards are revealed** from the deck. Each revealed card that is a
  **locomotive** *or* matches the **colour you paid with** adds **+1** to a surcharge you must
  **additionally pay** (in that same colour or locomotives) — or **abort** the claim for free (your
  base cards stay in hand). *(F, enc)* — interactive (uses `TunnelModal`).

### Ch.6 — Stations  *(F)*
- **6.1 Build a station** — placed in a city to **borrow one opponent route** there at game end
  (helps complete tickets). Cost escalates: **1st = 1, 2nd = 2, 3rd = 3** cards that must be a
  **single unified colour** (locomotives wild) — e.g. the 2nd station needs **two cards of the same
  colour**; one station per city. *(F, enc)* — interactive.
- **6.2 The station trade-off** — each **unused** station is worth **+4** at game end, so building
  one costs you that bonus — build only when it saves a ticket. *(F, enc)*

### Ch.7 — Mission tickets in depth  *(C, F)*
- **7.1 Completing a ticket** — connect its two cities with a continuous chain of **your** routes
  (or via a station borrow) by game end for **+points**. *(C,F, enc)* — interactive: claim the last
  link, see the completion sweep + fanfare.
- **7.2 The penalty** — an **unfinished** ticket **subtracts** its points. *(C,F, enc)*
- **7.3 Draw more tickets** — spend a turn to draw **3**, keep **≥ 1**. *(F, enc)* — interactive.
- **7.4 Hidden information** — your tickets/hand are secret; opponents show counts only. *(F, enc)*
- **7.5 Forced ticket draw** — once **all your kept tickets are completed** (no incomplete mission
  remains), the engine **automatically draws new tickets at the start of your turn** — your turn
  opens straight into the ticket chooser (draw **3**, keep **≥ 1**), so you never play without an
  objective. *(F, enc)* — interactive (the auto-opened `TicketChooser`). **New engine rule** — see
  §"Engine rule change — forced ticket re-draw".

### Ch.8 — Longest trail  *(F)*
- **8.1 Longest continuous trail** — the player with the longest unbroken trail (no segment reused)
  earns **+10** at game end; ties break to earliest in turn order. *(F, enc)* — auto demo with the
  trail highlight (reuse the scoreboard route-reveal).

### Ch.9 — Endgame & scoring  *(C, F)*
- **9.1 Endgame trigger** — when a player drops to **≤ 2 trains**, every player (incl. the trigger)
  takes **one final turn**. *(C,F, enc)* — auto demo with the "final round" cue.
- **9.2 All-pass ending** — a full round of passes also ends the game (pass is only legal with no
  other move). *(F, enc)*
- **9.3 Final scoring** — route points (already counted) + ticket net (completed − failed) + station
  bonus (+4 each unused) + longest-trail (+10). *(C,F, enc)* — auto demo to `ScoreBoard`.
- **9.4 Tiebreakers** — score → most tickets → fewest stations used → holds longest trail. *(F,
  enc)*

### Ch.10 — Strategy tips (light, optional)  *(F)*
- **10.1 Play to your tickets; manage your hand; race vs. block; mind the station bonus.** *(F)* —
  short info beats, no new rules.

**Quickstart (core) path** = 0.1, 0.3, 1.x, 2.1, 3.1–3.2, 4.1–4.4, 7.1–7.2, 9.1, 9.3.
**Full** = all of the above.

### Encyclopedia index (grouped tabs)
Basics (Ch.0–2) · Cards & Drawing (Ch.3) · Routes (Ch.4) · Special Routes (Ch.5) · Stations (Ch.6)
· Tickets (Ch.7) · Longest Trail (Ch.8) · Endgame & Scoring (Ch.9). Each entry = the lesson's replay
demo (auto/click-to-step) + its `blurbKey` text. Openable from the in-game header button.

---

## Architecture

### Shared scenario-player core
Both features share four layers:

1. **`SandboxSocket`** (`apps/web/src/net/sandboxSocket.ts`) — a local-engine driver that
   structurally satisfies the `GameSocket` command surface (`keepInitialTickets`, `keepTickets`,
   `drawBlind`, `drawFaceUp`, `drawTickets`, `claimRoute`, `buildStation`, `resolveTunnel`, `pass` —
   verified in `apps/web/src/net/socket.ts`). Every method funnels through one `dispatch(action)`:
   `reduce(board, state, action)` → on success update local state and project via the **shared
   codec** (`viewToSnapshot(redactFor(...))` + `eventToProto(...)`) into the bound game/animation
   stores; on failure call `setRejection`. Adds `auto(action)` (scripted opponent/demo beats),
   `restore(prefix)` (re-init seed + replay to checkpoint), and an `onAction(action, out)` hook the
   tutorial uses to detect the learner's move. No network I/O.

2. **Lesson/Beat data model** (`apps/web/src/features/tutorial/types.ts`):
   `Lesson { id, chapter, titleKey, blurbKey, scopes, kind, setup, prefix?, beats }`.
   `Beat` = narration (i18n key) + optional `spotlight` (route/city/HUD-region) + `framing` +
   `allow` (gated affordances), and one mode: `info` (advance on click), `auto`
   (`{ by, action }` scripted, optional `autoAdvanceMs`), or `await` (`{ expect }` — a declarative
   `ExpectSpec` compiled to a predicate over the learner's action/result).

3. **`useScenarioPlayer`** (`apps/web/src/features/tutorial/useScenarioPlayer.ts`) — headless
   controller tracking `beatIndex`; runs `auto` beats, waits for matching `await` actions (via
   `SandboxSocket.onAction`), gently re-prompts on non-matching legal moves, and exposes
   `replayLesson()`/`next`/`prev`/`progress`.

4. **Store isolation** so the in-game encyclopedia never disturbs the live game. `store/game.ts` and
   `store/animations.ts` are module singletons read directly by `Board`, `CardMarket`,
   `PlayerTrackers`, `AnimationLayer`, `ScoreBoard`, and the driver hooks (verified). Extract
   `createGameStore()`/`createAnimationsStore()`, keep the existing `useGame`/`useAnimations`
   singleton exports, and add a React Context + `useGameStore()`/`useAnimationsStore()` hooks
   defaulting to the singleton (zero behavior change for the live game). The in-game encyclopedia
   wraps its subtree in a `SandboxProvider` supplying **fresh** store instances — so the live
   WebSocket game keeps running untouched behind the modal.

### Codec extraction → new `@trm/codec` package
Extract `apps/server/src/codec/` (`enums.ts`, `snapshot.ts`, `events.ts`, `commands.ts`,
`frames.ts`, `index.ts`) verbatim into **`packages/codec/`** (`@trm/codec`), depending on
`@trm/engine` + `@trm/proto` + `@trm/shared` + `@bufbuild/protobuf`. TS-source export (no build
step), **no `node` types** so it stays browser-safe. Slots into the build graph after `engine`/`proto`,
before `apps/*` (turbo infers from `workspace:*` edges). **Only 4 import sites to repoint** (verified):
`apps/server/src/ws/hub.ts`, `apps/server/src/ws/connection.ts`, `apps/server/test/helpers.ts`,
`apps/server/test/codec.spec.ts` (move this spec into `packages/codec/test/`). Add `@trm/codec` to
both `apps/server` and `apps/web` `package.json`. This honors the project's "single `redactFor`
projection is the only thing that reaches the wire" principle — sharing, not duplicating, the codec.

### Rendering reuse — `GameStage`
Extract the board+HUD body and action handlers from `apps/web/src/screens/GameScreen.tsx` into a
presentational `GameStage` (`{ snapshot, commands: GameCommands, sandbox?, overlay?, onLeave? }`)
that reads `useGameStore()`. `GameScreen` becomes a thin shell (keeps connect/roster/rejection
effects, passes `getSocket()` as `commands`). The tutorial/encyclopedia render the same `GameStage`
with `commands = SandboxSocket` and an `overlay` (the coachmark/spotlight). `Board` gains
`sandbox?` (suppress `CameraSync`'s `socket.cameraUpdate` broadcast + follow — line 223) and a
`spotlight?` prop driving a **`SpotlightFramer`** child cloned from the existing `RevealFramer`
(`Board.tsx:327`, uses `useControls().setTransform`).

### Engine rule change — forced ticket re-draw (rule 7.5)
A new rule in `@trm/engine`: when a turn begins for a player whose **kept tickets are all already
completed** (zero incomplete missions, judged by the live own-track `completedTickets` set), the
engine **auto-initiates a ticket draw** instead of opening `AWAIT_ACTION` — the player's turn starts
in `TICKET_SELECTION` with a fresh offer (draw `ticketDrawCount` = 3, keep ≥ `minKeepNormal` = 1).
Implementation: in the turn-advance path (`packages/engine/src/turn.ts` `endTurn` / begin-next-turn,
reusing the offer logic in `applyDrawTickets`, `reduce.ts`), after computing the next current player,
check `keptTickets.every(t ∈ completedTickets)`; if so **and at least one ticket deck is non-empty**,
produce the offer + `TICKET_SELECTION` phase. If **both decks are empty**, fall back to a normal
`AWAIT_ACTION` turn (cannot force an impossible draw). The auto-transition into `TICKET_SELECTION` is
itself the signal the UI needs (the existing `TicketChooser` renders for that phase) — **no proto
change required**; an optional `forced` event marker is a nice-to-have, deferred. This consumes the
player's turn (the existing `KEEP_TICKETS → endTurn` flow advances to the next player), and since
they keep ≥ 1 (typically incomplete) ticket they aren't re-forced next turn (a fully-completable
fresh draw simply re-forces until an incomplete one is kept or the deck empties — bounded).
**Versioning:** this changes game behavior, so bump `ENGINE_VERSION`
(`packages/engine/src/types/state.ts`) and **regenerate the golden-replay digest fixtures** (the
determinism CI gate); per the version-pin ADR, replay refusing to cross engine versions is the
intended guard. The local-engine tutorial then demonstrates 7.5 for free (complete the last ticket →
next turn auto-opens the chooser).

---

## New files

**Package**
- `packages/codec/{package.json,tsconfig.json,CLAUDE.md}` + `src/{enums,snapshot,events,commands,frames,index}.ts` (moved) + `test/codec.spec.ts` (moved).

**Web — sandbox & shared stage**
- `apps/web/src/net/commands.ts` — `GameCommands` interface (shared by `GameSocket` + `SandboxSocket`) + `fromProtoPayment` helper.
- `apps/web/src/net/sandboxSocket.ts` — the local-engine driver.
- `apps/web/src/screens/GameStage.tsx` — presentational board+HUD extracted from `GameScreen`.
- `apps/web/src/store/sandboxProvider.tsx` — fresh store instances + sandbox animation driver for the in-game encyclopedia.

**Web — tutorial/encyclopedia feature (lazy-loaded chunk)**
- `apps/web/src/features/tutorial/types.ts` — Lesson/Beat/Spotlight/Framing/ExpectSpec model.
- `apps/web/src/features/tutorial/useScenarioPlayer.ts` — beat controller.
- `apps/web/src/store/tutorial.ts` — session store: chosen scope, lesson list/indices, completed set persisted to `localStorage` (`trm.tutorialSeen`, `trm.tutorialProgress`).
- `apps/web/src/features/tutorial/curriculum.ts` — ordered lesson index + scope filters + encyclopedia grouping.
- `apps/web/src/features/tutorial/scenarios/ch0..ch10*.ts` (+ `index.ts`) — the authored `Lesson[]` per chapter (above).
- `apps/web/src/features/tutorial/TutorialScreen.tsx` — full-screen route: launcher → `SandboxProvider` + `GameStage sandbox` + `TutorialOverlay`.
- `apps/web/src/features/tutorial/TutorialLauncher.tsx` — Full vs Quickstart choice.
- `apps/web/src/features/tutorial/TutorialOverlay.tsx` — orchestrates beats (spotlight + coachmark + Next/Back/Skip/Replay + progress).
- `apps/web/src/features/tutorial/TutorialBeat.tsx` — coachmark/callout bubble.
- `apps/web/src/features/tutorial/TutorialSpotlight.tsx` — dimming + cutout highlight (portal to `document.body`, re-measured on transform).
- `apps/web/src/features/tutorial/EncyclopediaModal.tsx` — in-game help: chapter/entry list + compact `GameStage sandbox` replay + blurb.
- `apps/web/src/styles/tutorial.css` — overlay/spotlight/coachmark/launcher/encyclopedia styles.
- `apps/web/src/i18n/tutorial.ts` — `tutorial.*` namespaced zh-Hant + en strings (own module).

**Tests**
- `packages/engine/test/forcedTicketDraw.spec.ts` — rule 7.5: a player with all kept tickets completed auto-enters `TICKET_SELECTION` at turn start; both-decks-empty falls back to `AWAIT_ACTION`; no infinite re-force.
- `apps/web/src/features/tutorial/scenarios/scenarios.test.ts` — replay every lesson's prefix + auto/expected actions through `reduce`, assert `.ok` (scenario-rot guard).
- `apps/web/src/net/sandboxSocket.test.ts` — action → bound store snapshot/events update.
- `apps/web/src/features/tutorial/useScenarioPlayer.test.tsx` — beat advancement (auto + matching await).

---

## Modified files

- `packages/engine/src/turn.ts` (+ the draw-offer helper in `reduce.ts`) and `packages/engine/src/types/state.ts` (`ENGINE_VERSION` bump) — the **forced ticket re-draw** rule (7.5); regenerate the golden-replay digest fixtures used by the determinism CI gate.
- `apps/web/package.json`, `apps/server/package.json` — add `@trm/codec`; web also adds `@trm/engine` (imported **only** from the lazy tutorial chunk + `sandboxSocket.ts`).
- `apps/server/src/ws/{hub,connection}.ts`, `apps/server/test/{helpers,codec.spec}.ts` — repoint codec imports to `@trm/codec`.
- `apps/web/src/store/game.ts`, `apps/web/src/store/animations.ts` — add `create*Store()` factory + Context + `use*Store()` hook; keep singleton exports.
- `apps/web/src/components/{Board,CardMarket,PlayerTrackers,AnimationLayer,ScoreBoard}.tsx`, `apps/web/src/hooks/{useAnimationDriver,useSoundDriver}.ts` — swap singleton reads → context hooks (default preserves live behavior). `Board` also gains `sandbox?`/`spotlight?` props + `SpotlightFramer`.
- `apps/web/src/screens/GameScreen.tsx` — slim to a shell delegating to `GameStage`.
- `apps/web/src/screens/HomeScreen.tsx` — add a Tutorial entry card + first-time auto-offer (when `!localStorage['trm.tutorialSeen']`).
- `apps/web/src/components/AppHeader.tsx` — add an Encyclopedia button (Lucide `BookOpen`) mirroring the settings-gear pattern; visible in-game and on home.
- `apps/web/src/store/ui.ts` — add `'tutorial'` to `View`, `enterTutorial()`, `/tutorial` handling in `syncFromUrl`/`pushPath`; encyclopedia is a modal boolean.
- `apps/web/src/App.tsx` — lazy `TutorialScreen` + `EncyclopediaModal` via `React.lazy`/`Suspense`.
- `apps/web/src/i18n/index.ts` — import + spread `tutorialStrings`.
- `apps/web/CLAUDE.md`, root `CLAUDE.md`, `apps/server/CLAUDE.md` — document `@trm/codec` + the tutorial/sandbox seam.

---

## Reuse map
- **Engine** (`@trm/engine`): `initGame`/`reduce`/`redactFor`/`legalActions`/`enumerateClaimPayments`/`taiwanBoard`/`CONTENT_HASH`/`hasAnyLegalMove`.
- **Codec** (`@trm/codec`): `viewToSnapshot`/`eventToProto`/`phaseToPb`/`cardOrNullToPb` — the only RedactedView→wire path.
- **Render components** (pure props): `Board`, `CardMarket`, `PlayerHand`, `PlayerTrackers`, `TicketPanel`, `TicketChooser` (collapsible "peek" pattern → encyclopedia compact layout), `PaymentModal`, `TunnelModal`, `ScoreBoard`.
- **Board framing**: `RevealFramer`/`frameHome`/`CameraSync` (`Board.tsx`), `game/boardView.ts` `viewToTransform`, `game/geography.ts` `fitTransform`, `game/routeGeometry.ts` `ROUTE_GEOMETRY`, `game/content.ts` `cityById` — to spotlight/auto-pan to a route/city.
- **Animation pipeline**: `store/game.ts` `applySnapshot`/`applyEvents`, `useAnimationDriver`, `store/animations.ts`, `AnimationLayer` — sandbox gets glows/flights/fanfare/score-floats free.
- **UX helpers**: `game/payments.ts`, `game/tunnel.ts`, `game/tickets.ts`, `game/view.ts` (move with `GameStage`).
- **Chrome/CSS**: `.modal-backdrop`/`.modal`/`icon-btn` (`styles/app.css`, per `SettingsModal`), `AnimationLayer`'s `createPortal` pattern, `--i` staggered animations (`styles/animations.css`).
- **Content i18n**: `game/content.ts` `cityName`/`ticketLabel`/`routeById` for narration (never duplicate city/ticket names into tutorial strings).

---

## Build sequence
0. **Engine rule 7.5** (self-contained, land first): implement forced ticket re-draw in `@trm/engine`, bump `ENGINE_VERSION`, add `forcedTicketDraw.spec.ts`, regenerate golden-replay digests. Gate: `yarn workspace @trm/engine test` green. Commit.
1. **Extract `@trm/codec`** (pure refactor): new package, move 6 files + spec, repoint 4 imports + 2 `package.json`s. Gate: `yarn workspace @trm/server typecheck && test` (esp. `codec`, `wire-game.e2e`) green. Commit.
2. **Wire engine+codec into web**: add deps; smoke test `viewToSnapshot(redactFor(initGame(taiwanBoard(), cfg), viewer), …)` runs under Vite/vitest.
3. **`GameCommands` + `GameStage` factor**: keep `GameScreen.test.tsx` green (live game unchanged).
4. **Store factory + Context**: `createGameStore`/`createAnimationsStore` + context hooks; mechanical swaps; existing component/hook tests are the guardrail.
5. **`SandboxSocket`** green against its unit test.
6. **Scenario model + first lesson (Ch.3 draw)** + `useScenarioPlayer` + `scenarios.test.ts` (replay through `reduce`, modeled on `packages/engine/test/helpers.ts`).
7. **Overlay UI**: `TutorialSpotlight`/`TutorialBeat`/`TutorialOverlay` + Board `spotlight` prop + `SpotlightFramer` + `tutorial.css`; manual dev verify of spotlight/auto-pan.
8. **Launcher + routing**: `TutorialLauncher` (Full/Quickstart), `curriculum.ts`, `store/tutorial.ts`, `/tutorial` route + lazy mount, HomeScreen entry + first-time auto-offer.
9. **Encyclopedia**: `EncyclopediaModal` + `SandboxProvider` isolation + AppHeader button; verify opening mid-live-game leaves the live `useGame` snapshot untouched.
10. **Author remaining scenarios Ch.0–10 + i18n**; expand `scenarios.test.ts` to cover all lessons.

---

## Risks & mitigations
- **Bundle bloat** — import `@trm/engine`/`@trm/codec` only from the lazily-imported tutorial chunk; `App.tsx` uses `React.lazy`/`Suspense`. Confirm a separate chunk via `vite build`.
- **Live game must stay pristine** while the in-game encyclopedia is open — isolated `create*Store()` instances via `SandboxProvider`; `SandboxSocket` does no I/O; `Board sandbox` suppresses camera broadcast/follow. Live singletons + WebSocket never written.
- **Scenario rot** — `scenarios.test.ts` replays every scenario through the real reducer, so any rule/content/`CONTENT_HASH` change that breaks a script fails CI, not users.
- **Engine rule 7.5 side-effects** — changing turn behavior shifts golden-replay digests (must regenerate) and requires an `ENGINE_VERSION` bump; guard the deck-empty fallback and the bounded re-force edge with the new engine spec. Land it as its own commit (step 0) so the digest churn is isolated and reviewable.
- **i18n volume** — all strings in `i18n/tutorial.ts` (`tutorial.*` namespace), one import+spread into `index.ts`; reuse content helpers for names.
- **Spotlight + react-zoom-pan-pinch** — frame inside `TransformWrapper` via `useControls().setTransform` (proven `RevealFramer`); cutout overlay portaled to `document.body`, re-measured from the target's `getBoundingClientRect()` on each transform tick.
- **Deterministic opponents** — scripted literal `auto` actions, no RNG; pinned by scenario tests.
- **Store-context regressions** — default context = live singleton; existing component/hook suites guard behavior.

---

## Verification
- **Engine rule 7.5**: `yarn workspace @trm/engine test --run forcedTicketDraw` + the full engine suite (golden-replay digests regenerated and green).
- **Unit**: `yarn workspace @trm/web test --run sandboxSocket` and `--run scenarios` (replay all lessons, assert `.ok` + expected end-state); `useScenarioPlayer` advancement test.
- **No regression**: `yarn workspace @trm/web test` (existing `GameScreen`/`Board`/`ScoreBoard`/`useAnimationDriver` specs) + `yarn workspace @trm/server test` (codec + `wire-game.e2e` through `@trm/codec`).
- **End-to-end (browser MCP)**: `yarn workspace @trm/web dev` (tutorial is fully local, no server needed). Home → Tutorial → Quickstart → perform a draw/claim, assert the coachmark advances and the route glows; open the in-game Encyclopedia during a live game, replay an entry, close it, assert the live turn banner/snapshot is unchanged.
- **Static gates**: `yarn typecheck`, `yarn lint`, `yarn build` (confirm the lazy tutorial chunk and that `@trm/codec` typechecks browser-side with no `node` types).
