# App shell (`apps/mobile/src/app/`)

App-wide context: `apps/mobile/CLAUDE.md`.

## Orientation & layout tiers (`useOrientationPolicy.ts`, `layoutTiers.ts`)

Phones (smallest window side < 600dp) lock PORTRAIT_UP; tablets stay unlocked — and Android 16+
ignores lock requests on ≥600dp anyway, so every screen must survive free rotation/resize.
`stageTier` (compact < 700dp ≤ two-pane < 1000dp ≤ three-pane) is measured from live window
width, never device type. The stage's use of those tiers: `../screens/CLAUDE.md`.
