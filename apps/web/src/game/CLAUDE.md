# Game view logic (`apps/web/src/game/`)

App-wide context: `apps/web/CLAUDE.md`. View-only helpers (payment enumeration via the engine's
`previewScore`/selectors, tunnel, cards, seat mapping). These mirror the server for optimistic
preview but **the server is authority** — nothing here decides an outcome. Most of the logic is
`@trm/client-core`'s; the files here are shims or web-specific glue.

## Content catalog — the client is not hardcoded to Taiwan

`catalog.ts` builds a `ContentCatalog` (content + id maps + geometry + display names) from whatever
`GameContent` the active game/replay/editor is using, and `contentCache.ts` resolves a `contentHash`
to one — bundled official maps resolve synchronously, anything else (a custom map) fetches
`GET /api/v1/maps/content/:hash` and caches by hash (never a single "current content" singleton, so
a stale in-flight fetch for a hash you've since navigated away from can't clobber the active
catalog). `useActiveContent(hash)` is the hook screens gate rendering on; `GameScreen`/`ReplayScreen`
show a loading veil until it's `'ready'`.

## Player identity

Snapshots carry player ids only (no display names). **Bots are detected by the `bot:` id prefix**
(`id.startsWith('bot:')`) to show a bot glyph in trackers/scoreboard; human players render as
`P{seat+1}` / "you". Room member display names, pictures (`avatarUrl`), and bot difficulty labels
come from the lobby REST view, not the in-game snapshot. `playerName.ts` owns both resolvers
(`usePlayerName` / `usePlayerAvatar`), including the blocked-player masking described in
`../store/CLAUDE.md`; `../components/SeatAvatar.tsx` renders the result.
