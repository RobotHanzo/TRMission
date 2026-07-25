# CLAUDE.md

`src/moderation/` is the UGC compliance surface (Apple 1.2 / Play UGC).

- `GET/PUT/DELETE /me/blocks[/:userId]` maintains a capped **client-side mute list** on
  `UserDoc.blockedUserIds` — **display filtering only**; it never touches seating or game state.
- `POST /reports/player` and `POST /reports/map` (by share code, deliberately **OUTSIDE** the
  `mapBuilder` gate — the code is the capability) append to the `reports` collection with
  **denormalized names**: guests TTL-expire, so the record has to stay self-contained.

Moderators work the queue at `GET /dashboard/reports` / `POST /dashboard/reports/:id/resolve`
(`reports.read` / `reports.resolve`, moderator+); resolution is a one-way open→resolved CAS, audited
as `report.resolve` (`src/dashboard/CLAUDE.md`).
