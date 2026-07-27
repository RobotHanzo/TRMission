# Stores (`apps/web/src/store/`)

App-wide context: `apps/web/CLAUDE.md`. Zustand stores. The game/chat/log/animation stores
themselves live in **`@trm/client-core`** (shared with mobile); the files here bind them to the web
transport or are re-export shims.

## Snapshot is authoritative

The server sends a fully-projected `GameSnapshot` (already redacted for this viewer); the client
mirrors it and ignores any snapshot with an older `stateVersion`. There is no client-side game logic
that can disagree with the server.

- `game.ts` — the authoritative mirror (`snapshot`, recent events, socket status, rejection).
- `session.ts` — auth: `playAsGuest` / `login` / `register` / `upgrade` /
  `loginWithGoogleCredential` / `logout`, plus `restore()` which the app calls on mount to resume a
  session from the httpOnly refresh cookie (works for guests and registered users alike). The
  in-memory access token is restored via the 401→refresh path; `booting` gates first render. Also
  exposes `useHasFeature` for per-account `UserFeature` gates.
- `ui.ts` — view routing (`home`/`room`/`game`/`login`/`loginCallback`/`history`/`replay` ⇄ `/`,
  `/room/:code`, `/login`, `/login/callback`, `/history`, `/replay/:gameId`), locale, colour-blind
  toggle. Login is its own route: `syncFromUrl` gates unauthenticated visitors to
  `/login?redirect=<original>` and `navigateAfterAuth()` resumes that target on success (replaces
  the old implicit "keep the URL + resume" effect). OAuth lands on `/login/callback`, where the
  refresh cookie set by the server callback drives the normal `restore()` path (no token ever in
  the URL).

## Moderation (`moderation.ts`, Apple 1.2 / Play UGC)

The account's block list mirrored locally — the store itself is `@trm/client-core`'s
`createModerationStore` (shared with mobile), bound here to the web REST client. Hydrated on
sign-in/restore and `reset()` on sign-out (`session.ts`); optimistic block/unblock with rollback via
`PUT/DELETE /me/blocks/:userId`.

**Blocking is display-only.** `ChatPanel` filters a blocked author's messages (text AND presets),
and `usePlayerName`/`usePlayerAvatar` mask their display name back to `P{seat+1}` and suppress their
picture — both are UGC, so masking one without the other leaks the identity back. Game state,
seating, and matchmaking are never touched: a blocked opponent stays at the table. The report/block
surface is `../components/PlayerActionDialog.tsx` (`../components/CLAUDE.md`).
