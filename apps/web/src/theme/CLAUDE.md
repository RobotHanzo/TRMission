# Theme (`apps/web/src/theme/`)

App-wide context: `apps/web/CLAUDE.md`.

`colors.ts` holds the 8 card colours (each with a colour-blind glyph) and `SEAT_COLORS` (abstract
seat indices coloured here, distinct from card colours). The hexes are canonical in `@trm/map-data`'s
render tokens (shared with the server's OG card); `tokens-parity.test.ts` gates `tokens.css`'s
`--tr-*` cartography palette against the same module — so a palette change starts in `@trm/map-data`,
not here. Respect the colour-blind setting (`store/ui.ts`) wherever colour carries meaning.
