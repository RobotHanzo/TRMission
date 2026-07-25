# CLAUDE.md

`src/game/` is the engine's server-side wrapper: the session object the hub drives, the single-writer
command queue, the live-game registry, and the board-resolver wiring.

- **`game-session.ts`** wraps the engine: `prepare` (pure — computes the next state without
  committing) / `commit` (apply), so the hub can persist between them; `apply` = prepare+commit;
  `restore` rebuilds from a snapshot + action tail, **verifying each digest** (recovery aborts on
  divergence). `project(viewer)` = the engine's `redactFor`.
- **`command-queue.ts`** — the per-game queue that serializes decode→validate→apply→persist→fan-out.
  Single writer per game: this is why there are no multi-doc Mongo transactions, and why the unique
  `(gameId, seq)` index is enough as the durable double-apply guard.
- **`game.module.ts`** builds `GameHubOptions.boardResolver(contentHash)`, which returns
  `Board | Promise<Board>` — recovery `await`s it. The factory checks the static official-map registry
  first (sync, no I/O), then falls back to `MapContentRepo.find(hash)` → `buildBoard` for custom maps.
  An unresolvable hash **throws**; recovery never silently falls back to Taiwan.

The loop that drives all of this is `src/ws/CLAUDE.md`; what it persists is
`src/persistence/CLAUDE.md`.
