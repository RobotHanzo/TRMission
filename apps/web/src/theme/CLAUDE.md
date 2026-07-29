# Theme (`apps/web/src/theme/`)

App-wide context: `apps/web/CLAUDE.md`.

`colors.ts` holds the 8 card colours (each with a colour-blind glyph) and `SEAT_COLORS` (abstract
seat indices coloured here, distinct from card colours). The hexes are canonical in `@trm/map-data`'s
render tokens (shared with the server's OG card); `tokens-parity.test.ts` gates `tokens.css`'s
`--tr-*` cartography palette against the same module — so a palette change starts in `@trm/map-data`,
not here. Respect the colour-blind setting (`store/ui.ts`) wherever colour carries meaning.

**Board marks are team-coloured in a team game; chrome is not.** Everything on the map that says
"someone owns this" — rail cars, the roadbed wash, stations, claim glows, ticket/trail sweeps —
paints through `ownerColor(seat, teamBySeat)`, which resolves a seat to `TEAM_COLORS[team]` in a
team game and to its own `SEAT_COLORS` entry otherwise, so a side's network reads as ONE colour.
The surrounding chrome (player cards, avatars, chat, log, replay transport) keeps per-seat colours —
that is what still tells two partners apart. Both boards share the one resolver, so pass
`teamBySeat` (client-core `game/teams`) into any new map surface that renders ownership.
