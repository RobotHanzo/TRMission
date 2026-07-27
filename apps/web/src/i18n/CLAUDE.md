# i18n (`apps/web/src/i18n/`)

App-wide context: `apps/web/CLAUDE.md`.

`index.ts` — react-i18next, zh-Hant primary + en fallback. UI strings live here; **city/ticket names
are content** and resolve from the active catalog by id (`../game/CLAUDE.md`), not from these tables.
Tutorial strings come from `@trm/client-core`'s tutorial i18n, shared with mobile.
