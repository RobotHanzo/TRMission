# Net layer (`apps/admin/src/net/`)

App-wide context: `apps/admin/CLAUDE.md`.

`rest.ts` is a trimmed copy of the game web app's REST client: in-memory access token +
single-flight 401→`/auth/refresh`→retry. **Concurrent 401s must share one rotation**, or the
server's refresh-reuse detection burns the whole session family — see the comment in `tryRefresh`
before touching it.

Same-origin only: the app is deployed under `/admin/` on the game server's origin because the Strict
refresh cookie requires it. Never point this at a different origin.
