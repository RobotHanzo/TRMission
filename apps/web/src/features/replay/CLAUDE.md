# Replay (`apps/web/src/features/replay/`)

App-wide context: `apps/web/CLAUDE.md`. Server gating: `apps/server/src/history/CLAUDE.md`.

Client-side replay of finished games (`features/replay/` + `screens/ReplayScreen.tsx`). Browsing your
own replays needs the **`replayReview`** feature (HistoryScreen hides the watch button without it; a
member's 403 renders `history.replayDisabled`), but `/replay/:gameId` stays reachable —
`link`-visibility replays load for anyone holding the URL.

Fetches `/history/:id/replay` (config + action log), runs the real engine locally and projects
through `redactFor(viewer)`/`viewToSnapshot` into isolated sandbox stores (`SandboxProvider`, which
also isolates the log store), rendered by the standard `GameStage sandbox`. Perspective switching
re-projects the same step for another seat; seeks rebuild silently (no animations), forward steps
animate.

## The transport (`ReplayTransport.tsx`)

The scrubber is a route strip: `@trm/client-core`'s `buildReplayTimeline` groups the action log
into turns (a maximal run of consecutive actions by one player) and moments (claim / station /
tunnel / repair), and the strip draws them as a liveried line with station glyphs. Nothing there
replays the engine — it is pure derivation off `Action[]`, so it is available before step 1.

Two rules hold it together:

- **The painted strip is decoration; the range input over it is the control.** Everything in
  `.strip-plot` is `aria-hidden`, and the one `<input type="range">` owns dragging, arrow keys and
  the a11y tree. Don't attach click handlers to glyphs — per-moment seeking would need N focusable
  targets in the tab order to stay accessible, and the rail's log already names the current step.
  Turn-at-a-time seeking is the keyboard path, via `turnBoundaries`.
- **Marker shape carries the meaning, colour only says whose seat**, so the strip survives the
  colour-blind setting; marker size carries how notable the moment is.

Autoplay rate lives on the shared player (`speed`/`setSpeed`, `REPLAY_SPEEDS`), not here.

The rail (perspective / log / share) is ONE card, hairline-divided — `.replay-rail` carries the
card chrome and its children are sections, so `PerspectiveSwitcher`/`ReplayShare` must not add
`.card` back.

`apps/mobile`'s `screens/ReplayScreen.tsx` still renders the older plain progress-bar transport; it
shares the timeline model and speed control but not this presentation.
