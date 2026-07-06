# CLAUDE.md

`@trm/bots` is the pure bot brain, shared by the server's bot driver
(`apps/server/src/ws/hub.ts`) and the mobile app's offline `LocalGameSession`.
`chooseBotAction(board, state, botId, difficulty)` ranks the engine's own
`legalActions` (a bot can never emit an illegal move) with difficulty-tuned
heuristics; the pick is a **deterministic function of state + botId** (its RNG is
seeded from `state.actionSeq` + the bot id — see `rngFor`). It uses only fair
information (own hand/tickets + public board state). No I/O, no wall-clock, no
unseeded randomness — ESLint enforces the last two (`eslint.config.mjs`).
Commands: `yarn workspace @trm/bots test` / `… typecheck` / `… lint`.
