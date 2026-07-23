# Mobile layouts for all pages — implementation plan (apps/web)

## Context

TRMission's web client is desktop-first: no page has a phone-tier breakpoint (narrowest existing
media queries are 920px in `game.css` and 900px in `replay.css`), and several layouts hard-code
widths that overflow a 360–430px viewport. The goal: **every page usable and viewable on mobile
phones** (portrait ~360–430px, touch), with desktop pixel-identical.

Exploration confirmed the hard part is *layout only*:
- The viewport meta is already correct (`index.html:5`); design tokens exist (`styles/tokens.css`).
- All gameplay is click/tap-based (no hover-gated functionality; hover is decoration only).
- Board pan/pinch-zoom already works on touch via `react-zoom-pan-pinch` (both the game `Board.tsx`
  and the builder `EditorCanvas.tsx`/`CropStage.tsx` use it; `touch-action:none` at `game.css:266`).
- A reactive `useMediaQuery` hook exists (`src/hooks/useMediaQuery.ts`), already used by
  `GameStage.tsx:99` to gate the wide comms column — the same pattern extends to a phone tier.

Verified breakage points: the app header overflows (non-wrapping actions + full display name +
5 icon buttons); RoomScreen's map-picker `.setting-row` crushes; HistoryScreen rows overflow
(`min-width:160px` meta); MapsScreen's create row (2 inputs + button) is unusable; the game stage's
≤920px fallback is a single scrolling column (board scrolls out of view — poor, not unusable);
EncyclopediaModal embeds a demo board with a pinned 260px rail; the map editor needs its 10em stage
rail + 21em inspector restacked; Replay needs minor polish.

## Strategy (decisions)

- **Phone breakpoint: `@media (max-width: 700px)`**, sitting under the existing 920px tier
  (700–920px tablet behavior unchanged). TS twin: `export const PHONE_QUERY = '(max-width: 700px)'`
  in `src/hooks/useMediaQuery.ts`; each CSS block gets a `/* phone tier — keep in sync with
  PHONE_QUERY */` comment. Media queries live in each feature's own CSS file (existing convention).
  Exception: EncyclopediaModal keeps its pre-existing 680px block — extend it, don't move it.
- **`(pointer: coarse)` for hit-target enlargement only** (≥40px icon buttons/tabs), never layout —
  desktop mice are `pointer: fine`, so desktop stays pixel-identical. (App convention is 32px
  `.icon-btn`; only touch devices grow.)
- **Additive CSS first; JSX changes only where structure must differ** (game dock, header name span,
  App main class), gated with `useMediaQuery(PHONE_QUERY)` like the existing `wide` gate. jsdom
  returns `false` from `useMediaQuery` → all existing tests keep exercising the desktop DOM.
- **Source order matters**: new ≤700px blocks in `game.css` must sit *after* the ≤920px block
  (`game.css:1205`) — equal specificity, later wins.
- Every new user-facing string gets zh-Hant + en entries in `src/i18n/index.ts`.

Each phase compiles, passes typecheck/lint/test, gets `graphify update .`, and lands as its own
commit (stage only own files; never `git add -A`).

---

## Phase 0 — Foundations (zero desktop change)

1. `src/hooks/useMediaQuery.ts`: add `export const PHONE_QUERY = '(max-width: 700px)';` with a
   comment pointing at the CSS twins.
2. `index.html`: viewport meta → `width=device-width, initial-scale=1.0, viewport-fit=cover`
   (enables `env(safe-area-inset-*)` on notched phones).
3. `styles/app.css` `.modal` (~line 217–229): add `max-height: 90dvh;` after the existing
   `max-height: 90vh;` (progressive fallback; fixes mobile-URL-bar clipping for Settings, Payment,
   Tunnel, ScoreBoard, kicked-dialog).
4. Append `(pointer: coarse)` blocks:
   - `app.css`: `.icon-btn { min-width: 40px; min-height: 40px; }`
   - `game.css`: `.map-controls button { width: 40px; height: 40px; }` and
     `.comms-tabs button { min-height: 40px; }`

Commit: `fix(web): mobile foundations — dvh modals, safe-area viewport, coarse-pointer tap targets`

## Phase 1 — App shell + lobby screens (header, Room, History, Maps list)

Highest everyday value, almost pure CSS.

1. `src/components/AppHeader.tsx:75`: wrap the bare display name in
   `<span className="user-chip-name">{user.displayName}</span>` (keep the existing chip `title`).
   Existing header tests matching the name text still pass (`getByText` matches inside spans).
2. `styles/app.css` — append:

```css
/* phone tier — keep in sync with PHONE_QUERY */
@media (max-width: 700px) {
  .app-header { padding: var(--tr-space-2) var(--tr-space-3); gap: var(--tr-space-2); }
  .header-actions { flex-wrap: wrap; justify-content: flex-end; }
  .user-chip-name { display: none; }                /* avatar/icon-only chip */
  .header-status { min-width: 0; gap: var(--tr-space-2); }  /* min-width:0 so the label can shrink */
  .turn-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .app-main { padding: var(--tr-space-4) var(--tr-space-3); }

  /* Room + Settings: setting rows wrap; the map picker stacks its controls full-width. */
  .setting-row { flex-wrap: wrap; row-gap: var(--tr-space-2); }
  .setting-row > .row { flex: 1 1 100%; flex-wrap: wrap; min-width: 0; }
  .setting-row select { flex: 1 1 100%; min-width: 0; }
  .member-list li { flex-wrap: wrap; }
}
```

   This fixes RoomScreen's map row (`RoomScreen.tsx:285-342`) with **no RoomScreen JSX change**
   (label keeps line 1; Segmented + `<select>` drop to a full-width line 2) and covers
   SettingsModal rows for free.
3. `styles/history.css` — append:

```css
@media (max-width: 700px) {
  .history-row { flex-wrap: wrap; }
  .history-meta { min-width: 0; }
  .history-players { flex: 1 1 100%; order: 3; }
  .history-row > button { margin-left: auto; }
}
```

4. `styles/builder.css` (lazy chunk) — append the maps-list rules:

```css
@media (max-width: 700px) {
  .maps-screen .row { flex-wrap: wrap; }
  .maps-screen .row > input { flex: 1 1 10em; min-width: 0; }
}
```

Login/LoginCallback/HomeScreen/SettingsModal are already fluid — verify only.

Commit: `fix(web): phone-tier layout for header, room settings, history, maps list`

## Phase 2 — Game stage phone dock (the core)

**Design:** on a phone, a live game becomes **board on top (fills remaining height) + a bottom
dock**: a 5-tab bar (Hand / Draw / Missions / Players / Log·Chat) over a fixed-height scrollable
panel (~34dvh). The board stays visible at all times — no scrolling away from the map. Reuses the
existing rail building blocks verbatim: `GameStage.tsx` already defines `trackers`, `market`,
`handSection`, `ticketsSection`, `comms` as separate consts (lines 225–306), and the tab-bar
a11y pattern already exists (`.comms-tabs`, lines 330–362). `boardLayout` (rail/tray) is
deliberately ignored on phone — the dock is the only sensible phone layout (document with a code
comment; the Settings toggle becomes inert there). **Live games only (`!sandbox`)**:
tutorial/encyclopedia/replay sandboxes keep the ≤920px stacked column, because coachmarks/captions
anchor to DOM nodes that a hidden dock tab would unmount.

1. `src/App.tsx:76-80`: when `view === 'game'`, render `app-main app-main--game app-main--live`
   (one extra class), so game.css can re-assert the fixed-viewport shell at ≤700px without
   dragging tutorial/replay/mapEditor (which need page scroll) along.
2. `src/screens/GameStage.tsx`:
   - `const phone = useMediaQuery(PHONE_QUERY) && !sandbox;` next to `wide` (line 99).
   - `const [dockTab, setDockTab] = useState<'hand'|'draw'|'missions'|'players'|'comms'>('hand');`
   - Root class (line 309): `` `game ${phone ? 'game--dock' : `game--${boardLayout}`}${sandbox ? ' game--sandbox' : ''}` ``
   - New first branch in the layout ternary (line 316), before `sandbox ? … : wide ? …`:

```tsx
phone ? (
  <div className={`game-dock${needKeep ? ' game-dock--chooser' : ''}`}>
    {needKeep ? (
      <div className="dock-panel">{railInner}</div>   /* TicketChooser takeover; board stays visible */
    ) : (
      <>
        <div className="dock-tabs" role="tablist" aria-label={t('dockTabsLabel')}>
          {/* 5 buttons: same role="tab"/aria-selected/aria-controls pattern as .comms-tabs.
              Hand and Missions carry .tray-count badges (myPub?.handCount, keptTicketIds.length). */}
        </div>
        <div className="dock-panel" role="tabpanel">
          {dockTab === 'hand' ? handSection
           : dockTab === 'draw' ? market
           : dockTab === 'missions' ? ticketsSection
           : dockTab === 'players' ? trackers
           : comms}
        </div>
      </>
    )}
  </div>
) : sandbox ? ( /* unchanged */ ) : wide ? ( /* unchanged */ ) : ( /* unchanged tabbed rail */ )
```

   - No `.game-hand-strip` renders on phone (it only exists in the other branches — verify).
   - PaymentModal / TunnelModal / ScoreBoard / Toasts / AnimationLayer / overlay: untouched.
3. `src/components/Board.tsx` — **`MapControls` is defined here (line 418), not a separate file.**
   Render the fullscreen button (lines 486–493) only when `document.fullscreenEnabled` (iPhone
   Safari has no element Fullscreen API — hide the dead button).
4. `styles/game.css` — append **after** the ≤920px block (line 1205), with an anchoring comment:

```css
/* ── Phone (≤700px): board fills the screen; a tabbed dock sits at the bottom. Live games only —
      the sandbox keeps the ≤920 stacked column so tutorial/enc anchors stay mounted.
      Must come AFTER the ≤920 block (equal specificity). Keep in sync with PHONE_QUERY. ── */
@media (max-width: 700px) {
  .app-main--live.app-main--game {          /* re-assert what the ≤920 block relaxed */
    overflow: hidden; display: flex; padding: var(--tr-space-2);
  }
  .game--dock {
    --tr-dock-h: min(34dvh, 300px);
    display: grid; height: auto; gap: var(--tr-space-2);
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr) auto;
    grid-template-areas: 'banner' 'board' 'dock';   /* empty banner row collapses to 0 */
  }
  .game--dock .spectator-banner { grid-area: banner; }
  .game--dock .game-board { min-height: 0; }
  .game--dock .board-viewport { min-height: 200px; }   /* relax the 360px floor (game.css:237) */
  .game-dock {
    grid-area: dock; display: flex; flex-direction: column; gap: var(--tr-space-1);
    min-height: 0; padding-bottom: env(safe-area-inset-bottom, 0px);
  }
  .dock-tabs { display: flex; gap: var(--tr-space-1); }
  .dock-tabs button {
    flex: 1; min-width: 0; min-height: 40px; padding: var(--tr-space-1); font-size: 0.8rem;
    display: inline-flex; align-items: center; justify-content: center; gap: 4px;
    white-space: nowrap; overflow: hidden;
    background: var(--tr-surface-2); border: 1px solid var(--tr-line);
  }
  .dock-tabs button.active { background: var(--tr-ember); border-color: var(--tr-ember); color: #fff; }
  .dock-panel { height: var(--tr-dock-h); overflow-y: auto; display: flex; flex-direction: column; gap: var(--tr-space-2); }
  .game-dock--chooser { --tr-dock-h: min(55dvh, 480px); }
  .game-dock--chooser .dock-panel { height: auto; max-height: var(--tr-dock-h); }
  /* Hand keeps full-size 132px cards; sideways thumb-scroll instead of wrapping. */
  .dock-panel .hand { flex-wrap: nowrap; overflow-x: auto; padding-bottom: var(--tr-space-1); }
  /* Toasts clear the dock instead of covering the tab bar (Toast renders inside .game, so it
     inherits --tr-dock-h). */
  .game--dock .toast { bottom: calc(var(--tr-dock-h, 0px) + 72px); }
  .game--dock .toast.toast-notice { bottom: calc(var(--tr-dock-h, 0px) + 120px); }
  /* 3-card payment rows overflow a 360px modal — let them wrap. */
  .card-options .payment-card { flex-wrap: wrap; }
}
```

5. `src/i18n/index.ts` — new keys (zh-Hant + en). Reuse existing keys where natural
   (`cards` → Hand tab, `tickets` → Missions tab, `tabComms` → Log·Chat tab); add only what's
   missing, e.g.:

   | key | zh-Hant | en |
   |---|---|---|
   | `dockTabsLabel` | 遊戲面板切換 | Game panels |
   | `dockDraw` | 抽牌 | Draw |
   | `dockPlayers` | 玩家 | Players |

6. Tests: new `GameStage` phone test — stub `window.matchMedia` (`matches: query === PHONE_QUERY`,
   with `addEventListener`/`removeEventListener` no-ops), render with an existing snapshot fixture,
   assert: dock tab bar renders; clicking Missions shows TicketPanel; a `pendingOfferTicketIds`
   snapshot swaps the dock for the TicketChooser; no `.game-hand-strip`. Existing tests untouched.

Commit: `feat(web): phone game layout — board + bottom tabbed dock`

## Phase 3 — Encyclopedia demo + tutorial check

`styles/tutorial.css` — extend the **existing** `@media (max-width: 680px)` block (line 447):

```css
  .enc-demo-stage { height: auto; }
  .enc-demo-stage .game { height: auto; }
  /* Two-class specificity beats game.css's ≤920 .game-board{min-height:60vh}. */
  .enc-demo-stage .game-board { min-height: 200px; height: 34vh; }
  .enc-demo-stage .board-viewport { min-height: 200px; }
  .enc-demo-stage .game-rail { max-height: 240px; overflow-y: auto; }
```

The demo sandbox already collapses to a column at ≤920px; these rules size board/rail inside the
modal instead of clipping at the pinned `--tr-rail-w:260px` (inert once the grid is a column).
TutorialScreen (full-screen lesson) inherits the ≤920px column + Phase 0 tap targets; `.tut-coach`
is already viewport-adaptive — walk lesson 1 at 390px and fix reactively in `tutorial.css`.

Commit: `fix(web): encyclopedia demo board + tutorial pass at phone widths`

## Phase 4 — Replay polish

`styles/replay.css` — append:

```css
@media (max-width: 700px) {
  .replay { gap: var(--tr-space-2); }
  /* Page scrolls on phones (≤900 stack); keep transport controls reachable. */
  .replay-controls { flex-wrap: wrap; position: sticky; bottom: 0; z-index: 10; }
  .replay-scrubber { flex: 1 1 100%; order: 9; }   /* scrubber gets its own full-width row */
  .replay-step { margin-left: auto; }
}
```

Replay's embedded GameStage is `sandbox` → stays in stacked-column mode (its rail lives outside
the stage). Phase 0's coarse-pointer rule covers the transport buttons.

Commit: `fix(web): phone-tier replay controls`

## Phase 5 — Map editor (lazy builder chunk)

1. `styles/builder.css` — extend the Phase 1 block:

```css
@media (max-width: 700px) {
  /* …phase 1 maps rules… */
  .editor-screen { height: auto; }                 /* page scrolls (≤920 shell) */
  .editor-body { flex-direction: column; }
  /* Stage rail becomes a horizontal station strip across the top. */
  .editor-stage-rail { flex-direction: row; width: 100%; overflow-x: auto; }
  .editor-stage-line { left: 20px; right: 20px; top: 18px; bottom: auto; width: auto; height: 2px; }
  .editor-stage-btn { flex: 1 0 auto; flex-direction: column; gap: 2px; padding: var(--tr-space-1); }
  .editor-stage-label { font-size: 0.72em; }
  .editor-main { overflow: visible; }
  .editor-stage-layout { flex-direction: column; height: auto; }
  .editor-canvas-wrap { flex: none; height: 55dvh; min-height: 280px; }
  .editor-inspector { width: 100%; overflow: visible; }   /* stacked below the canvas */
  .editor-name-group { flex: 1 1 100%; }
  .editor-name-input { min-width: 0; flex: 1 1 6em; }
}
```

2. `src/i18n/index.ts`: reword the existing crop-hint strings (no new keys) to cover touch —
   CropStage's pan is middle-click on desktop but two-finger drag on touch
   (`CropStage.tsx:164` `panning={{ allowLeftClickPan: false, allowMiddleClickPan: true }}`;
   one-finger drag draws the crop rect via pointer events — already touch-correct). e.g.
   en: `…(scroll or pinch to zoom, middle-drag or two-finger drag to pan)`.
3. `yarn workspace @trm/web build` — confirm the builder chunk size didn't move meaningfully and
   nothing leaked into the main bundle.

Commit: `fix(web): phone-tier map editor — horizontal stage strip, stacked inspector`

---

## Verification

Per phase: `yarn workspace @trm/web typecheck && yarn workspace @trm/web lint &&
yarn workspace @trm/web test`, then `graphify update .`, then commit (own files only).

Browser pass (Docker mongo + `yarn workspace @trm/server dev` + `yarn workspace @trm/web dev`,
drive with Playwright/Chrome MCP at **390×844** and **360×740**, plus desktop 1440×900 and a
921–1299px width to confirm zero drift):

- **Phase 1:** no horizontal scroll on Home/Room/History/Maps; header chip icon-only, all icon
  buttons tappable; Room map picker stacks (long zh map names fit); History rows wrap with the
  replay button reachable; Maps create row stacks.
- **Phase 2 (the big one):** start a bot game at 390px — board fills above the dock; pinch/pan
  work; tap route → PaymentModal (rows wrap) → claim; Draw tab market draws; initial TicketChooser
  takeover (board still pannable above, min-keep enforced); tunnel claim end-to-end; chat send in
  Log·Chat (soft keyboard doesn't permanently obscure the input); spectator banner rows correctly;
  ScoreBoard at game over scrolls; toasts clear the dock; landscape sanity check. Desktop 1300px+
  three-column and 921–1299px tabbed-rail pixel-identical.
- **Phase 3:** Encyclopedia at 390px — topics wrap on top, demo board ~34vh, scripted beats
  complete; tutorial lesson 1 start-to-finish.
- **Phase 4:** replay at 390px — sticky controls, full-width scrubber, seek/step/perspective.
- **Phase 5:** all 7 editor stages reachable via the strip; one-finger crop draw + two-finger
  pan/zoom; inspector below canvas; missions/rules tables scroll.
- **iOS Safari** (device/simulator if available): `100dvh` shell with collapsing URL bar,
  safe-area inset below the dock, fullscreen button absent, modals within 90dvh.

## Risks & gotchas

1. **game.css source order** — the ≤700 block must follow the ≤920 block (equal specificity).
2. **jsdom** — `useMediaQuery` → false keeps existing tests on the desktop DOM; dock tests must
   stub `matchMedia` including listener methods.
3. **AnimationLayer anchors in hidden dock tabs** — `rectOf()` returns `null` for missing anchors
   (`AnimationLayer.tsx:13-14`); confirm every flight/float path no-ops on null (e.g. hand
   unmounted while the Draw tab is open); add guards only if a path assumes non-null.
4. **Keyboard overlap on the chat input** — verify; if bad on iOS, let the dock panel grow
   (`max-height` instead of fixed height) while an input is focused — decide only if observed.
5. **`--inv-scale`/`data-zoom` label density** at 360px initial fit-zoom — verify the landing tier
   still reads well (ZoomTracker computes live values, so expected fine).
6. **Enc 681–920px band** is already quirky today; intentionally out of scope (≤680 only).
7. **Bundle guard** — all builder work stays in the lazy chunk; confirm via build output.
