# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`apps/server` is the **authoritative** NestJS backend: a WebSocket gateway for realtime play, a REST
control plane (auth/lobby/history), Mongo event-sourced persistence, dynamic OpenAPI, and the bot
driver. It is the sole source of truth and never trusts the client.

```bash
yarn workspace @trm/server dev          # node --watch via @swc-node/register (NOT tsx)
yarn workspace @trm/server test         # vitest (mongodb-memory-server, no real Mongo needed)
yarn workspace @trm/server test --run bots.e2e   # one spec by file substring
```

## swc, not tsx (the #1 gotcha)

`dev`/`start` run through `@swc-node/register/esm-register` and tests through `unplugin-swc`. NestJS
DI resolves constructor dependencies from emitted **decorator metadata**, which esbuild/tsx does not
produce — switch the runtime to tsx/esbuild and DI silently fails at boot. Keep swc.

## The realtime loop (the critical path)

`src/ws/hub.ts` (`GameHub`) is the dispatcher and the most important file. It operates on **bytes + a
Sink**, so the whole loop is drivable over real protobuf without a socket (that is how the e2e specs
work). Per inbound game command:

1. decode `ClientEnvelope`; route hello/ping/resync/chat vs. game commands.
2. serialize through the **per-game command queue** (`game/command-queue.ts`) — single writer.
3. idempotency: drop if `client_seq <= lastClientSeq` (monotonic per socket).
4. `commandToAction` (codec) → `session.prepare(action)` (pure; computes next state without committing).
5. **write-ahead persist** (`store.appendAction`) — durable before visible. On failure the seq is
   **not** advanced, so the client can safely retry.
6. `session.commit` → broadcast a **per-recipient redacted snapshot** + cosmetic events.

`src/game/game-session.ts` wraps the engine: `prepare` (pure) / `commit` (apply) so the hub can
persist between them; `apply` = prepare+commit; `restore` rebuilds from a snapshot + action tail,
**verifying each digest** (recovery aborts on divergence). `project(viewer)` = the engine's `redactFor`.

`GameHubOptions.boardResolver(contentHash)` is `Board | Promise<Board>` — recovery `await`s it.
`game.module.ts`'s factory checks the static official-map registry first (sync, no I/O), then falls
back to `MapContentRepo.find(hash)` → `buildBoard` for custom maps. An unresolvable hash **throws**;
recovery never silently falls back to Taiwan.

### The codec seam

`src/codec/` is the only place engine types ⇄ proto types: `enums`, `snapshot` (`viewToSnapshot`),
`events`, `commands` (`commandToAction`), `frames`. When you add an engine action/event or a rule
violation code, you touch the codec here **and** the `.proto` (regenerate it) **and**
`@trm/shared/errors` — all four stay 1:1.

## Hidden-information egress guard

`hub.sendProjected` builds the per-viewer snapshot via `redactFor` and asserts a snapshot's private
`you` block belongs to the recipient before sending; a mismatch increments
`trm_security_leak_blocked_total` and drops the frame. Never send raw `GameState`; all egress is the
projection. The wire-level leak test (`test/wire-game.e2e.spec.ts`) decodes every frame to non-owners
and asserts no secrets appear — keep it passing.

## Persistence & recovery (event sourcing)

`src/persistence/` + `src/db/`. `MongoGameStore` (native driver) is an append-only log: a genesis
snapshot, one `gameEvents` doc per action carrying the resulting `stateDigest`, periodic full
`gameSnapshots`, and a `matchHistory` archive on completion. The unique `(gameId, seq)` index is the
durable double-apply guard. Recovery = latest snapshot + replay tail, digest-verified. No multi-doc
transactions — every write for a game is serialized by its command queue. Spectator userIds are
`$addToSet` onto the game doc at ws bind and copied (minus seated players) into `matchHistory` at
completion. `GET /history/:gameId[/replay]` is membership-gated (players + spectators, 404
otherwise); the `/replay` endpoint ships a **COMPLETED** game's full action log to that authorized
viewer — the one sanctioned exception to "hidden info never leaves the server", hard-gated on
`status: 'COMPLETED'` in `HistoryRepo.loadReplay`. The member path additionally requires the
viewer's **`replayReview` feature** (403 `FEATURE_DISABLED` for a member without it; a `link`
visibility replay stays viewable by anyone holding the URL, anonymous included), and
`PATCH :gameId/visibility` checks seatedness _before_ the feature so outsiders keep the
nondisclosing 404. A list entry's `isReplayable` batches its
content-hash lookups (official registry ∪ one `mapContents` query for the unresolved hashes) rather
than checking one game at a time — a custom map's draft being deleted never makes its past games
disappear from history, only unreplayable would, and it never is (see `src/maps/` below).

## Auth, lobby, bots

- `src/auth/` — guests are real `users` docs (`isGuest`, TTL); HS256 access tokens + rotating refresh
  tokens with **family reuse-detection** (single-doc CAS, no transactions). `token.service` also mints
  the short-lived ws-game ticket the gateway verifies on `ClientHello`. Which entry methods are on is
  an injectable `AuthConfig` (derived from env; tests override it via `new AuthConfig(overrides)`);
  the controller enforces the flags (`/auth/config` is only a UI hint). **OAuth** (`oauth.service` +
  `oauth.http`, hand-rolled with global `fetch`, no passport): authorization-code + PKCE; the profile
  comes from the provider's userinfo endpoint (no id*token signature work) for that redirect flow.
  Google also has a second entry point, `POST /auth/oauth/google/credential`, for a Google Identity
  Services (One Tap / rendered button) ID-token credential — the one place that \_does* verify a JWT
  signature, via `google-auth-library` (`google-id-token.verifier.ts`, injected behind
  `GOOGLE_ID_TOKEN_VERIFIER` the same way `OAUTH_HTTP` is). Both entry points converge on the same
  `resolveAccount` logic. Bound by **verified
  email** → upgrade a live guest in place, else auto-link the same-email account, else create a
  passwordless user. The only network seam is `OAUTH_HTTP` (faked in e2e). Cookie rules that bite:
  the OAuth nonce cookie `trm_oauth` is **`SameSite=Lax`** (the provider callback is a cross-site
  top-level navigation — a Strict cookie would be withheld, breaking every callback), while
  `trm_refresh` stays **Strict** (set in the callback, read by the same-origin `/auth/refresh`). That
  requires the **web app and API to be the same registrable domain** — keep `OAUTH_REDIRECT_BASE` on
  the SPA's origin. A logged-in guest's id is read from the refresh cookie at `/oauth/:p/start`
  (`SessionRepo.peekUserId`, no rotation) and carried in the signed `state`, because the callback
  arrives cross-site without the cookie.
  **Mobile transport** (no SameSite cookie can reach a native app): `x-trm-client: mobile`
  on any issuance route returns the refresh token in the body; `/auth/refresh` + `/auth/logout`
  take `{refreshToken}` in the body (body-in → body-out, never a cookie). The OAuth redirect
  flow with `?client=mobile` ends at `/m/callback?code=<single-use exchange code>` (minted in
  `mobile-code.repo.ts`, redeemed by `POST /auth/mobile/exchange` for a fresh token pair);
  a signed-in guest is carried via `POST /auth/mobile/carry` → `?carry=` (the cookie-free
  analogue of the refresh-cookie peek). Google ID tokens verify against
  `AuthConfig.googleAudiences()` (web + `GOOGLE_MOBILE_CLIENT_IDS`).
  The builder WebView's session handoff is `GET /api/v1/auth/mobile-web-handoff?code=` —
  it redeems the same single-use carry code (`POST /auth/mobile/carry` over Bearer), mints a
  NEW web session family, sets the normal Strict refresh cookie, and 302s to `/maps`
  (errors 302 to `/login/callback?error=…`, never a 500 on a top-level navigation). It is
  the one sanctioned way a native session becomes a web cookie session.
  **Sign in with Apple** is credential-only: `POST /auth/oauth/apple/credential`
  (`{identityToken, fullName?, refreshToken?}`) verifies against Apple's JWKS
  (`apple-id-token.verifier.ts`, audiences = `APPLE_CLIENT_IDS`) and converges on
  `resolveAccount` under the `'apple'` identity — Hide My Email relay addresses are
  treated as verified emails and simply don't cross-link with other providers. There is
  no `/oauth/apple/start`; Apple never enters the redirect flow.
  **Account deletion**: `DELETE /auth/me` (Bearer; optional `{appleAuthorizationCode}` from a
  fresh SIWA re-auth for token revocation, best-effort). Cascade in `src/account/`: deletes
  users/authSessions/customMaps drafts, leaves LOBBY rooms via `RoomRepo.leave`, `$pull`s
  matchHistory spectators; the event-sourced game log, `mapContents`, and `dashboardAudit`
  stay (dangling opaque ids = the same posture as guest TTL expiry). Maintainers get 409
  until dashboard access is revoked.
  **Push** (`src/push/`): `POST/DELETE /me/devices` registers native device tokens
  (`userDevices`, token = `_id`, re-registering moves it to the new account); `PushService`
  speaks FCM HTTP v1 and APNs HTTP/2 token-auth directly (no relay; empty credentials =
  disabled no-op), localizes zh-Hant/en from account preferences, and prunes dead tokens
  (FCM 404, APNs 410). The hub's `push?: PushSink` option (metrics-hooks idiom) drives
  **your-turn** (debounced `PUSH_YOUR_TURN_DELAY_MS`, only when the current player has no
  live socket, re-checked at fire time) and **game-over** (absent humans only) off the same
  `broadcast` fan-out bots share; **game-started** fires from `LobbyService.start`. Metrics:
  `trm_push_sent_total`/`trm_push_failed_total` by kind.
- `src/lobby/` — rooms lifecycle with atomic seat CAS; `RoomSettings.map` selects
  `{source:'official', mapId}` or `{source:'custom', customMapId}` (default: official Taiwan).
  `start` resolves the selector via `MapsService.resolveForStart` (validates a custom draft, hashes
  it, and publishes to `mapContents` before the game exists), builds the `GameConfig` — including
  `ruleParams: {...mapRules, ...roomVariantFlags}`, a disjoint merge since the map's curated
  `RULE_BOUNDS` keys never overlap the variant-flag booleans — calls `hub.createMatch`, and hands back
  a ws-ticket. Bot add/remove are host-only. Selecting a `{source:'custom'}` map (settings PATCH)
  and resolving it at `start` both require the **host** to hold the `mapBuilder` feature — the
  start-time check is authoritative, so a revoke between select and start still blocks.
- `src/maps/` — CRUD + sharing for user-authored maps, gated on the per-account **`mapBuilder`
  feature** (`FeatureGuard` → 403 `FEATURE_DISABLED`; the strict gate covers list/author/share/
  peek/clone, and `RegisteredUserGuard` still excludes guests from mutations). Features live on
  `UserDoc.features` (taxonomy in `@trm/shared/features`), granted from the dashboard, and are
  read per request — never token claims. `customMaps` is a mutable per-owner draft (may be
  invalid mid-edit); `mapContents` is an **immutable, append-only** `{contentHash → GameContent}`
  store, insert-if-absent, written only at game start and **never garbage-collected** — a draft can
  be edited or deleted after a game starts, but that game (and its replay) keeps resolving against
  the exact content it was published with. Share/clone go through an 8-char share code
  (`mintShareCode`/`peekByCode`/`cloneByCode`); peek/clone responses are shaped to never leak
  `ownerId` or another user's map list. `GET /content/:hash` lives on `MapsContentController`
  OUTSIDE the feature gate — a plain `AccessTokenGuard` route (any authenticated viewer, including
  guests, may fetch content by its hash — the hash itself is the unguessable capability); gating it
  would break live custom-map games and replays for other players.
- **Bots** — a bot is an **ordinary seated player driven server-side** (the engine never
  knows). The brain lives in `packages/bots` (`@trm/bots`): `chooseBotAction` ranks moves
  from the engine's own `legalActions` (a bot can never make an illegal move) and is a
  deterministic function of `state + botId`. The hub's bot driver (`ws/hub.ts`) runs each
  bot through the **same** prepare→persist→commit→fan-out path as a human, and bot moves
  are logged actions, so replay/recovery are unaffected. The roster is persisted on the
  game doc and resumes after recovery. `TRM_BOT_DELAY_MS` paces moves (0 in tests).
- `src/moderation/` — the UGC compliance surface (Apple 1.2 / Play UGC): `GET/PUT/DELETE
/me/blocks[/:userId]` maintains a capped **client-side mute list** on `UserDoc.blockedUserIds`
  (display filtering only — never touches seating or game state), and `POST /reports/player` +
  `POST /reports/map` (by share code, deliberately OUTSIDE the mapBuilder gate — the code is the
  capability) append to the `reports` collection with denormalized names (guests TTL-expire; the
  record stays self-contained). Moderators work the queue at `GET /dashboard/reports` /
  `POST /dashboard/reports/:id/resolve` (`reports.read`/`reports.resolve`, moderator+), resolution
  is a one-way open→resolved CAS audited as `report.resolve`.

## Maintainer dashboard (`src/dashboard/`)

REST for `apps/admin` under `api/v1/dashboard`. Access control is a **separate collection**,
`dashboardAccounts` (`_id = users._id`, role + `extraPermissions`/`deniedPermissions`), never a
flag on `UserDoc`; the role→permission taxonomy lives in `@trm/shared` (`effectivePermissions`)
so server guard and admin UI can't drift. `DashboardGuard` runs after `AccessTokenGuard` and reads
the collection **per request** (revocation is instant; nothing is embedded in tokens): guest or
no record → 404 (nondisclosing), missing `@RequirePermission(...)` permission → 403.
`DASHBOARD_OWNER_EMAILS` seeds owners at boot (idempotent, self-healing, audited). Every mutation
appends to `dashboardAudit` via `AuditService` — that repo exposes only `append`/`list` (append-only
by surface; a spec pins it).

Rules that bite here:

- **Hidden info**: a LIVE game's detail redacts `seed` (seed + contentHash = deck order = every
  hand) and never exposes state or the action log; log/replay endpoints stay hard-gated on
  `status: 'COMPLETED'` (the gate lives only in `HistoryRepo.loadReplay` — the dashboard bypasses
  _membership_, never the gate).
- **Ban** (`users.ban`): sets `disabledAt` + revokes all refresh families; enforcement chokepoints
  are `AuthService.issue()`/`refresh()` and the lobby's three ws-ticket paths. `AccessTokenGuard`
  is deliberately untouched — already-issued access tokens keep read-only REST for ≤15min
  (documented on the endpoint).
- **Feature grants** (`users.features`, admin+): `PUT /dashboard/users/:id/features` replaces a
  registered account's `UserDoc.features` set (guests → 400) and `GET /dashboard/users/features`
  lists granted accounts; audited as `user.features` with before/after. Grants/revokes apply on
  the target's very next request (per-request reads, like the ban posture).
- **Terminate** (`games.terminate`): DB CAS `LIVE→TERMINATED` **first**, then `hub.evictMatch`
  (drains the match queue, notifies sockets with `errors:gameTerminated`, clears registries), then
  the room closes. `loadForRecovery` refuses TERMINATED (reconnects can't resurrect) and
  `recordCompletion` CASes on LIVE (a racing bot game-over can't overwrite). Terminated games are
  never archived or replayable.
- **Lockout protections**: self-modification of your own maintainer record is always 403; the last
  owner can't be demoted/revoked (409); maintainers can't be banned until their access is revoked.

`src/main.ts` wires helmet (CSP off so Scalar's CDN loads — tighten in prod), cookie-parser, CORS
allowlist, attaches the ws server, and builds the OpenAPI doc from the live app (Scalar at `/docs`,
JSON at `/api/openapi.json`). Validation + OpenAPI schemas come from **one zod source** via
`nestjs-zod` (ADR A3). Metrics at `/metrics` (prom-client).
