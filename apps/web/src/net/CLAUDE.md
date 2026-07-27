# Net layer (`apps/web/src/net/`)

App-wide context: `apps/web/CLAUDE.md`.

The REST client, `GameSocket`, `SandboxSocket`, and the game/chat/log/animations stores live in
**`@trm/client-core`** (shared with mobile); the app-side files are the web transport + re-export
shims:

- `rest.ts` — builds the shared client with the web `RestTransport`: same-origin base, access token
  in memory (inside the core), refresh token as an httpOnly cookie sent with
  `credentials: 'include'`. A 401 triggers **one** silent `/auth/refresh` + retry (single-flight).
- `socket.ts` — re-exports the shared protobuf WS client (`GameSocket`: heartbeat, backoff
  reconnect + per-attempt ticket re-mint, `ClientHello` handshake) plus web's `defaultWsUrl()`.
- `connection.ts` — bridges the socket to the game store.
- `google.ts` — loads Google Identity Services (GSI) once per page; `LoginScreen` uses it to render
  Google's own sign-in button + fire One Tap, falling back to the legacy redirect button if the
  script fails to load.

The game flow: lobby `start`/`ticket` (REST) → `connectGame(ticket)` → socket sends `ClientHello` →
server replies with a snapshot. Reconnect re-fetches a ticket and resyncs on a fresh snapshot.
