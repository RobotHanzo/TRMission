# CLAUDE.md

`src/persistence/` (+ `src/db/` for the Mongo client/collection tokens) is the **event-sourced**
store. `MongoGameStore` (native driver, no ODM) is an append-only log:

- a **genesis snapshot**,
- one `gameEvents` doc per action carrying the resulting `stateDigest`,
- periodic full `gameSnapshots`,
- a `matchHistory` archive on completion.

The unique `(gameId, seq)` index is the durable double-apply guard. **Recovery = latest snapshot +
replay tail, digest-verified.** There are no multi-doc transactions — every write for a game is
serialized by its command queue (`src/game/command-queue.ts`).

Spectator userIds are `$addToSet`ed onto the game doc at ws bind and copied (minus seated players)
into `matchHistory` at completion.

**`StoredConfig` must carry every `GameConfig` key that shapes the genesis** (`teamCount`,
`wideSeed`, `shuffleTurnOrder`, `ruleParams`). A dropped one fails silently and late: genesis still
builds, then the recorded log is rejected at the first action, because the RNG stream diverged —
what issue #75 did to every team replay. `repairStoredConfig` backfills `teamCount` on the docs
written before it was stored (a snapshot's `state.teams` is the witness), on both the recovery and
the replay read paths.

`engine-compat.ts` holds the cross-version replay allowlist: persisted games are stamped with
`engineVersion` + `contentHash` + `schemaVersion`, and replay crosses engine versions only through an
explicit entry there (mobile offline resume stays exact-version pinned).

Who reads it back out: `src/history/CLAUDE.md` (member replay) and `src/dashboard/CLAUDE.md`
(maintainer view — it bypasses _membership_, never the `status: 'COMPLETED'` gate).
