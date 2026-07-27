# i18n (`apps/admin/src/i18n/`)

App-wide context: `apps/admin/CLAUDE.md`.

`index.ts` hardcodes both locale tables inline (no external JSON) — zh-Hant primary, en fallback,
**same key tree in both**; adding a string means adding it to both objects. Locale selection is
persisted by `../store/ui.ts`.

The `*ConfirmBody` strings are not decoration: they document the exact consequence of each
irreversible action, and the confirm flows are written around them (`../views/CLAUDE.md`).
