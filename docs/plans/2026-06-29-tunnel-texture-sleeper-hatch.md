# Redesign the tunnel texture → "sleeper hatch"

## Context

Tunnel routes on the board currently get a single thin dashed line (`.tunnel-track`) drawn
*under* the train cars; the cars are shortened (`SLOT_FILL_TUNNEL = 0.62`) so the dashes peek
through the gaps. The user reports this cue is hard to see — and it is, for three reasons:

1. **Too thin** — `stroke-width: 0.55px * --inv-scale`.
2. **Mostly hidden** — only the tiny `1 1` dashes that land *between* cars are visible; the rest
   sits behind the cars.
3. **No relation to the cars** — the fixed `1 1` board-unit rhythm reads as faint speckles, not a
   deliberate texture.

Note the color (`#5c5346`) is *not* the problem: the roadbed (`.bed`) is light in **both** light
and dark themes (`#fffdf8` / `#ddd8cc`), so a fixed dark stroke is correct for both — no theme
override needed.

**Chosen direction (user-approved): "sleeper hatch."** Turn the cue into bold dark railroad
sleeper ties that cross the whole roadbed — visible in every gap and poking just past the top/bottom
edges of the cars. It's the most unmistakably "railway," the most legible at any zoom, theme-correct,
and (crucially) it stays *within* the roadbed width so it never collides with double-track siblings.

```
   ‖    ‖    ‖    ‖    ‖
  ▓▓▓  ▓▓▓  ▓▓▓  ▓▓▓  ▓▓▓     ▓ = car   ‖ = sleeper tie (full-bed-width dark bar)
   ‖    ‖    ‖    ‖    ‖
```

## Approach

This is achievable as essentially a **CSS-only** change — no new SVG markup, no geometry change.
The trick: stroke the existing `.tunnel-track` path with a width that spans the **full roadbed**
(across-track) and a **short** dash-on length (along-track) with **butt** caps. Each "on" dash then
renders as a thin, tall rectangle across the track — a sleeper tie in plan view. Because the cars
(height `1.44px`) are thinner than the bed (`2.8px`), the ties poke above and below each car, and
the shortened cars let whole ties show in the gaps. The render layering already puts this path
between `.bed` and the cars (Board.tsx:645–647), which is exactly what we want.

### Primary edit — `apps/web/src/styles/game.css` (`.tunnel-track`, lines 233–240)

Replace the current rule with the sleeper-hatch version. Starting values (tune by eye in dev):

```css
/* Tunnel: dark sleeper ties cross the full roadbed, poking past the cars and filling every gap. */
.tunnel-track {
  fill: none;
  stroke: #3d352b; /* dark sleeper timber — fixed; the roadbed is light in both themes */
  stroke-width: calc(2.6px * var(--inv-scale)); /* spans the bed → ties poke above/below the cars */
  stroke-linecap: butt; /* crisp rectangular sleepers (current `round` rounds them into lozenges) */
  stroke-dasharray: 0.42 0.95; /* short bars (board units) → a regular row of ties */
  opacity: 0.9;
}
```

Key changes vs. today: `0.55px → ~2.6px` width (full bed), `round → butt` caps, darker/stronger
stroke, and a dash rhythm tuned so each "on" segment is a narrow tie rather than a faint speck. The
dash lengths stay in **board units** (consistent with the existing dash convention — they scale with
the cars), while the width counter-scales in px to a constant on-screen weight.

### Optional tweak — `apps/web/src/game/routeGeometry.ts` (`SLOT_FILL_TUNNEL`, line 84)

Currently `0.62`. The hatch already pokes past the cars regardless of car length, so this can stay.
If the in-app result wants more visible gap-ties, nudge it down slightly (e.g. `0.58`). Decide by
eye during verification; default is to leave it unchanged.

### No change needed elsewhere

- **`apps/web/src/components/Board.tsx`** (645–647) — still renders one `<path className="tunnel-track">`.
- **`apps/web/src/components/MapBackdrop.tsx`** (line 50) — renders the same class, so it inherits the
  new look automatically. Just confirm it still reads well as the blurred login backdrop.

The hatch coexists cleanly with existing states: when a route is owned, `.bed` takes the seat-color
wash and cars take the seat color, but the dark ties still contrast on top of the wash; claimable
hover only touches `.bed`/`.slot`/`.ferry-pip`, not `.tunnel-track`.

## Verification

1. `yarn workspace @trm/web dev` and open the board (set `TRM_DEV_GAME=1` on the server, or use the
   demo game) so real tunnel routes render.
2. Inspect representative tunnels — e.g. **R18** (Taipei–Yilan, forced straight) and a double-track
   tunnel — and confirm the hatch is clearly legible:
   - **Both themes** (toggle light/dark): ties stay visibly dark on the light roadbed.
   - **Zoomed in and out**: ties hold a constant on-screen weight (counter-scaled) and the rhythm
     stays sane.
   - **Unclaimed vs. claimed**: ties remain readable over the seat-color wash; cars still pop.
   - **Double-track tunnels**: ties stay within the roadbed and don't bleed into the twin track.
3. Tune `stroke-dasharray` / `stroke-width` (and optionally `SLOT_FILL_TUNNEL`) until the ladder
   reads as deliberate sleepers, not a dashed line or a solid bar. Capture a before/after screenshot
   in both themes (Chrome MCP `computer`/screenshot or the project run skill).
4. `yarn workspace @trm/web build` (and `yarn format`) to confirm no regressions. No TS/test changes
   are expected unless `SLOT_FILL_TUNNEL` is touched.
