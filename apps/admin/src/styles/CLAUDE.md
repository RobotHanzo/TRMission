# Design system (`apps/admin/src/styles/`)

App-wide context: `apps/admin/CLAUDE.md`.

`tokens.css` defines the "Operations Control Center" (行控中心) tokens (`--oc-*`, dark primary) — a
lit dispatcher panel, deliberately unlike the game app's cartography palette. Dark is a cold
blue-steel ground; light is the same panel in daylight (cool drafting-print ground, white panels).

**Saturation is rationed.** The only saturated colours anywhere are `--oc-accent` and the three
signal aspects, so a lit colour always means _status_, never _style_. Don't introduce a new hue for
decoration — reach for a hairline, a surface step, or `--oc-ink-dim` instead.

Status is always communicated via **signal aspects** (`clear`/`caution`/`stop`, railway semaphore
colours) through `SignalBadge`, **always paired with a text label, never colour alone**. Badges are
squared indicator plates (`--oc-radius-plate`) with a lit dot; the glow is token-gated
(`--oc-lamp-glow`) so it only fires on dark.

## The three devices that carry the look

Keep new UI inside these rather than inventing a fourth.

1. **The rail is the line.** Each `.oc-nav-item` draws its own segment of a running line plus a
   station node (`::before`/`::after` at `--oc-line-x`); the active view is the lit node with an
   energised segment. No pill, no fill — position is the state. The line is dropped entirely in the
   collapsed/narrow rail, which falls back to an accent wash.
2. **Stencil labels cut by a hairline.** `.oc-eyebrow`, `th`, and every `h3` in `.oc-tile` /
   `.oc-drawer-body section` are small, 600-weight, `--oc-track-label`-tracked uppercase; the tile
   and drawer heads trail a hairline to the panel edge (`h3::after`).
3. **The instrument voice.** Every figure is mono, `slashed-zero tabular-nums`, right-aligned in
   tables (`td.num`) and in `.oc-kv .v`. `.oc-board` is the only place figures go large.

## Conventions

- All component class names are `oc-`-prefixed; follow that rather than a new prefix or CSS-in-JS.
- Theme is applied via `data-theme` on `<html>` from `../store/ui.ts`; `index.html` resolves it
  before first paint and carries matching `theme-color` metas.
- Two hairline weights: `--oc-line` for structure (panel edges, header underlines), `--oc-line-soft`
  for interior dividers (`.oc-kv`, table rows).
- `AdminErrorBoundary` inlines literal copies of the dark tokens — it has to render with no
  stylesheet. Retune those literals by hand when the dark palette moves.
