# Net layer (`apps/mobile/src/net/`) — the shared core + mobile transport

App-wide context: `apps/mobile/CLAUDE.md`.

The REST client, `GameSocket`, and `SandboxSocket` live in `@trm/client-core`; the app-side
`rest.ts`/`socket.ts` are the mobile TRANSPORT + re-export shims:

- `rest.ts` — builds the shared client with the mobile `RestTransport`: an **absolute** base
  (`SERVER_ORIGIN`, no same-origin cookie jar), the `x-trm-client: mobile` header, and
  **token-in-body refresh**. The access token lives in memory inside the shared core; the refresh
  token lives in the OS keystore (`secureStore.ts`, `expo-secure-store`). A 401 rotates via
  `POST /auth/refresh {refreshToken}` under the core's single-flight guard; issuance and rotation
  persist tokens through the transport hooks.
- `connection.ts` — constructs the shared `GameSocket` with `WS_URL` and a `TicketRefresh`
  (the room code from `useGameConnection`) so every in-socket reconnect re-mints a fresh
  short-TTL ws ticket instead of replaying the expired seed one.
- `../store/session.ts` — port with a keystore-aware `restore()` (fast-paths when no refresh token
  exists), `loginWithApple`/`DiscordExchange`, `signInMethod` tracking, and push register/unregister.
- Auth screens drive all five P0 methods: guest, email/password, Google (native SDK → ID token),
  Apple (iOS, `expo-apple-authentication`), Discord (system browser → `/m/callback` exchange code).

Strings are `x-trm-client: mobile`, deep-link scheme `trmission://`, OAuth return path `/m/callback`
— all matching the landed P0 server.

Web harness split: `secureStore.web.ts` keeps the refresh token in localStorage.
