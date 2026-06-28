# Ticket chooser in the sidebar + map preview

**Date:** 2026-06-28
**Area:** `apps/web` (client view only — no engine/server/proto changes)

## Problem

When a player must choose which destination tickets to keep (initial `SETUP_TICKETS` or
mid-game `TICKET_SELECTION`), the client shows `KeepTicketsModal` as a full-screen
`.modal-backdrop` overlay. That backdrop **covers the board**, so the player cannot study the
map to judge which tickets are achievable before committing. The board is already fully
pan/zoomable (`react-zoom-pan-pinch`), but the modal hides it.

## Goal

While ticket selection is active:

1. The ticket chooser **replaces the right sidebar** (`.game-rail`) instead of covering the
   whole screen, leaving the board visible and interactive (pan/zoom) so players can preview
   the available railways.
2. The chooser offers **peek buttons** to view the two things the sidebar normally shows but
   are now hidden: the player's **train-card hand** and their **already-kept tickets**.
3. The offered tickets' **endpoint cities glow subtly** on the map ("glow but not too much")
   so players can trace the routes they'd need.

## Design

### Sidebar swap (`GameScreen.tsx`)

`needKeep` already gates ticket selection. When true, render a `TicketChooser` panel **in the
sidebar slot** in place of the normal rail panels (trackers / market / hand / tickets). The
`boardPanel` renders unchanged in its grid cell. Both `rail` and `tray` layouts render the same
during selection (board + chooser); the `tray` bottom hand-strip is suppressed because the hand
is now a peek button. Remove the old full-screen `KeepTicketsModal` render.

### `TicketChooser` panel (new `components/TicketChooser.tsx`, replaces `KeepTicketsModal.tsx`)

A sidebar panel (not a backdrop modal) containing:

- Title (`chooseTickets`) + `keepAtLeast` hint.
- The selectable offered ticket cards — same selection logic, default keep-all, minimum-keep
  enforcement, and long-ticket lock during initial selection.
- Two collapsible **peek sections**, collapsed by default:
  - `cards` (手牌) → `PlayerHand` for `you.hand`.
  - `tickets` (任務卡) → `TicketPanel` for `you.keptTicketIds` (+ completed set).
- A `keep (n)` confirm button calling the same `onConfirm(ids)`.

The previous fly-to-tray confirm animation is dropped: it measured `[data-anim="tickets"]`,
which is not on screen during selection. Confirm commits directly.

### Map endpoint glow (`Board.tsx`)

`Board` accepts `highlightCities?: ReadonlySet<string>`. `GameScreen` derives it from
`you.pendingOfferTicketIds` (each ticket's `a`/`b` endpoints via `ticketById`) and passes it
only during selection. Cities in the set render a soft halo (low opacity, slow gentle pulse,
no animation under `prefers-reduced-motion`).

### Strings (`i18n/index.ts`)

Reuse `cards` / `tickets` for the peek toggle labels. Add a short hint string for the chooser
(e.g. "Pan the map to preview routes") in zh-Hant + en.

## Out of scope

- No engine / server / proto / wire changes — selection still flows through the existing
  `keepInitialTickets` / `keepTickets` socket calls.
- No change to the selection rules themselves.

## Implementation note

Implemented on branch `feat/ticket-chooser-sidebar` in an isolated git worktree, because the
main working tree was being actively modified by a concurrent process (an unrelated "Web sound"
feature stream advancing `main` and rewriting shared files). The branch is based on the
then-current `main` HEAD so it merges back cleanly.
