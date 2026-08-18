# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`apps/web` is the React + Vite + TypeScript client: an interactive SVG Taiwan board, a protobuf
WebSocket client, REST auth/lobby, and i18n (zh-Hant primary + en). It renders the server's
authoritative snapshot and never computes game truth itself.

```bash
yarn workspace @trm/web dev       # vite on :5173 (proxies /api + /ws → :3001)
yarn workspace @trm/web build     # vite build
yarn workspace @trm/web test      # vitest + @testing-library/react
```

**Pin:** Vite **^8** + vitest **^4** + `@vitejs/plugin-react` **^6** move as one unit — vitest 4 needs
vite ≥6 and plugin-react 6 needs vite 8, so none of the three can be bumped alone. Vite 8 bundles
with **Rolldown**: `manualChunks` in `vite.config.ts` still works, but it is what keeps the Sentry
Replay recorder off the landing critical path, so re-check the emitted chunks after editing it.

## Where the per-area docs live

Read the one for the area you're touching (Claude Code loads them on demand).

| Area                                                      | Doc                                 |
| --------------------------------------------------------- | ----------------------------------- |
| Snapshot mirror, session/auth, routing, moderation        | `src/store/CLAUDE.md`               |
| REST client, `GameSocket`, connection bridge, Google GSI  | `src/net/CLAUDE.md`                 |
| `MapScene`/`Board`/geography, seat avatars, report dialog | `src/components/CLAUDE.md`          |
| Content catalog, view-only helpers, player identity       | `src/game/CLAUDE.md`                |
| Card + seat colours, tokens parity                        | `src/theme/CLAUDE.md`               |
| UI strings vs content names                               | `src/i18n/CLAUDE.md`                |
| Sentry façade, `SECRET_CLASS` replay blocking             | `src/observability/CLAUDE.md`       |
| Stale-chunk recovery across a redeploy                    | `src/lib/CLAUDE.md`                 |
| Silent auto-reload onto a new deploy                      | `docs/release/server-ota.md`        |
| Custom map builder (lazy route)                           | `src/features/builder/CLAUDE.md`    |
| Client-side replay                                        | `src/features/replay/CLAUDE.md`     |
| AdMob `app-ads.txt` served off this origin                | `docs/release/admob-app-ads-txt.md` |
| Shared headless core (net, stores, view logic, tutorial)  | `packages/client-core/CLAUDE.md`    |

## The two rules that hold everywhere here

**The snapshot is authoritative.** The server sends a fully-projected `GameSnapshot` (already
redacted for this viewer); the client mirrors it and ignores any snapshot with an older
`stateVersion`. The `game/` helpers preview outcomes for the UI — they never decide one, and no
client-side game logic that could disagree with the server may be added.

**Client logic lives in `@trm/client-core`, not here.** The REST client, sockets, stores, game view
logic, tutorial core and colour tokens are shared with `apps/mobile`; the app-side files under
`net/`, `store/` and `game/` are the web transport plus re-export shims. Never fork logic here that
mobile also needs — extract it to the core instead. Presentation (DOM/SVG) stays web-only, and
landing a UI change here means checking whether mobile needs the equivalent.
