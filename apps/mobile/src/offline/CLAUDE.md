# Offline vs bots (`apps/mobile/src/offline/`)

App-wide context: `apps/mobile/CLAUDE.md`.

Serverless mirror of the server's authoritative loop. `localGameSession.ts` runs the real
`@trm/engine` with `@trm/bots` driving bot seats, appends every accepted action to an
event-sourced expo-sqlite log **before** committing (write-ahead, `(game_id, seq)` PK =
double-apply guard), and the UI only ever sees `redactFor(human)` → `viewToSnapshot` into
the sandbox stores — `GameStage` cannot tell online from offline. Resume digest-verifies
the log and **truncates** a corrupt tail (server recovery aborts instead; offline must
never crash into a corrupt save). Version pins: `engineVersion` + registered `contentHash`
refuse cross-version resume. Randomness (seed/gameId) comes from `expo-crypto` in
`seed.ts` ONLY — never inside game logic. Bundled official maps only (custom-map offline
is deferred — docs/TODO.md). Pure core (no RN imports) → jest-testable off-device;
`inMemoryStore.ts` is the port double.

Web harness split: `localStore.web.ts` is in-memory (a reload loses offline games).
