# CLAUDE.md

`src/history/` serves finished games back to the people who played them, and is the **one sanctioned
exception** to "hidden info never leaves the server" — so every gate here is load-bearing.

- `GET /history/:gameId[/replay]` is **membership-gated** (players + spectators, 404 otherwise). The
  `/replay` endpoint ships a **COMPLETED** game's full action log to that authorized viewer, hard-gated
  on `status: 'COMPLETED'` in `HistoryRepo.loadReplay` — that function is the only place the gate
  lives, so nothing may route around it.
- The member path additionally requires the viewer's **`replayReview` feature** (403
  `FEATURE_DISABLED` for a member without it). A `link`-visibility replay stays viewable by anyone
  holding the URL, anonymous included.
- `PATCH :gameId/visibility` checks **seatedness before the feature**, so outsiders keep the
  nondisclosing 404.
- A list entry's `isReplayable` batches its content-hash lookups (official registry ∪ one
  `mapContents` query for the unresolved hashes) rather than checking one game at a time. A custom
  map's draft being deleted never makes its past games disappear from history — only unreplayable
  would, and it never is, because `mapContents` is never garbage-collected (`src/maps/CLAUDE.md`).
- `admin-replay.*` / `admin-spectate.*` are the maintainer-ticket variants; their access rules live in
  `src/dashboard/CLAUDE.md`.

The underlying log and its digests: `src/persistence/CLAUDE.md`.
