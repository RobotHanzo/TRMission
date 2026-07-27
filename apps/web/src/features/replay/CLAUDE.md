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
