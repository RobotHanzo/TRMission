# CLAUDE.md

`src/ws/` is the realtime plane: the WebSocket server (`ws-server.ts`), socket/ticket binding
(`connection.ts`, `ticket.ts`, `jwt-ticket.ts`), the turn timer, and **`hub.ts` (`GameHub`)** — the
dispatcher and the most important file in the server. The hub operates on **bytes + a Sink**, so the
whole loop is drivable over real protobuf without a socket (that is how the e2e specs work).

## The loop (per inbound game command)

1. decode `ClientEnvelope`; route hello/ping/resync/chat vs. game commands.
2. serialize through the **per-game command queue** (`game/command-queue.ts`) — single writer.
3. idempotency: drop if `client_seq <= lastClientSeq` (monotonic per socket).
4. `commandToAction` (codec) → `session.prepare(action)` (pure; computes next state without committing).
5. **write-ahead persist** (`store.appendAction`) — durable before visible. On failure the seq is
   **not** advanced, so the client can safely retry.
6. `session.commit` → broadcast a **per-recipient redacted snapshot** + cosmetic events.

The session wrapper (`prepare`/`commit`/`restore`/`project`), the command queue, and the board
resolver live next door in `src/game/` — see its `CLAUDE.md`.

### The codec seam

Engine types ⇄ proto types is `@trm/codec` (`packages/codec/`, shared with `apps/web`'s tutorial
sandbox — see its `CLAUDE.md`), not this app. When you add an engine action/event or a rule-violation
code, you touch the codec **and** the `.proto` (regenerate it) **and** `@trm/shared/errors` **and**
this command surface — all four stay 1:1. `test/codec.spec.ts` here is the wire byte round-trip.

## Hidden-information egress guard

`hub.sendProjected` builds the per-viewer snapshot via `redactFor` and asserts a snapshot's private
`you` block belongs to the recipient before sending; a mismatch increments
`trm_security_leak_blocked_total` and drops the frame. Never send raw `GameState`; all egress is the
projection. The wire-level leak test (`test/wire-game.e2e.spec.ts`) decodes every frame to non-owners
and asserts no secrets appear — keep it passing.

## Bots

A bot is an **ordinary seated player driven server-side** (the engine never knows). The brain lives
in `packages/bots` (`@trm/bots`): `chooseBotAction` ranks moves from the engine's own `legalActions`
(a bot can never make an illegal move) and is a deterministic function of `state + botId`. The hub's
bot driver runs each bot through the **same** prepare→persist→commit→fan-out path as a human, and bot
moves are logged actions, so replay/recovery are unaffected. The roster is persisted on the game doc
and resumes after recovery.

## Push hooks

`GameHubOptions.push?: PushSink` (the metrics-hooks idiom) drives **your-turn** and **game-over**
notifications plus **iOS Live Activity** updates off the same `broadcast` fan-out bots share. What
gets sent, when, and to whom: `src/push/CLAUDE.md`.

## Env vars

- `TRM_BOT_DELAY_MS` — pause between bot moves (`0` in tests).
- `TRM_TURN_TIMEOUT_MS` — per-turn budget before the server auto-plays a default action; `0` disables.
- `TRM_AUTOPLAY_PAUSE_AFTER` — consecutive timed-out human turns before a game is marked inactive and
  auto-play pauses until a human seat (re)binds or acts; a lapse that finds no human socket connected
  at all pauses immediately. Default 5, `<=0` disables the streak pause. Clients get a `GamePaused`
  frame + absent humans a come-back push, and the purge sweep ENDS games that stay paused past
  `GAME_PAUSED_PURGE_HOURS` via the normal scored `END_GAME` path (`src/dashboard/purge.service.ts`).
- `TRM_BOT_TAKEOVER_AFTER` — consecutive timed-out turns for ONE player before — with other humans
  still connected — their seat is handed to a MEDIUM takeover bot, announced via `SeatControlChanged`
  and recorded on the game doc's `seatControlLog`; the player's next action or rebind reclaims it.
  Default 3, `<=0` disables. Solo rooms can instead disable the timer entirely via the
  `soloWaitForHost` room setting, stamped as `matchOptions.turnTimerDisabled` on the game.
