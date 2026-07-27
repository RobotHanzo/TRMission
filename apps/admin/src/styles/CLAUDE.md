# Design system (`apps/admin/src/styles/`)

App-wide context: `apps/admin/CLAUDE.md`.

`tokens.css` defines the "Operations Control Center" design tokens (`--oc-*` CSS variables, dark as
the primary theme) — a neutral graphite dispatcher console, deliberately unlike the game app's
cartography palette.

Status is always communicated via **signal aspects** (`clear`/`caution`/`stop`, railway semaphore
colours) through `SignalBadge`, **always paired with a text label, never colour alone**.

All component class names are `oc-`-prefixed; follow that convention for new UI rather than
introducing a new prefix or a CSS-in-JS approach. Theme is applied via `data-theme` on `<html>` from
`../store/ui.ts`.
