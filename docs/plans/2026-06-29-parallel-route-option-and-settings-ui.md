# Plan: parallel-route option, new defaults, and switch-based settings UI

## Context

The per-game settings feature already exists end-to-end (lobby panel → REST → engine, plus a
display-only projection on the wire). This change does three things on top of it:

1. **Make the "2–3 player parallel routes are single-track only" rule a configurable option.**
   Today it is hard-wired to player count via `variantForPlayerCount(n)` in
   `packages/engine/src/config.ts`. We promote it to a `RuleParams` toggle so a host can turn it
   off (let 2–3 player games claim both parallel routes).
2. **Change two room defaults:** visibility → `INVITE_ONLY`, unlimited station borrow → enabled.
3. **Refactor the lobby settings UI** to reuse components extracted from the existing Settings
   modal: rule checkboxes → **toggle switches** (the modal's switch), and the public / invite-only
   two-button control → the **segmented selector** (the modal's theme/layout radio-group).

**Confirmed decisions:** new option (Change 1) defaults **ON** (current behavior preserved).
Visibility uses the **segmented selector** (not a switch), per the user — keeps the two
Public / Invite-only labels.

---

## Change 1 — New rule option: single-track parallel for 2–3 players

The new field flows the same path as the existing three rule variants. Proposed name:
**`doubleRouteSingleFor23`** (boolean).

**Engine (rule logic):**
- `packages/shared/src/constants.ts` — add `doubleRouteSingleFor23: boolean` to `RuleParams` and to
  `DEFAULT_RULE_PARAMS` (default **`true`** = vanilla behavior preserved).
- `packages/engine/src/config.ts` — change `variantForPlayerCount` to take the flag:
  `(n, singleFor23) => n <= 3 && singleFor23 ? 'SINGLE_ONLY' : 'BOTH'`. Update the doc comment.
- `packages/engine/src/reduce.ts` — the **only** caller is line ~356 in `applyClaimEffects`; pass
  `state.ruleParams.doubleRouteSingleFor23`. (The legal-move generator at ~672 already respects the
  lock via the ownership check — no change.)
- `packages/engine/src/types/state.ts` — bump `ENGINE_VERSION` `2 → 3` (adding a `ruleParams` key
  changes every game's `stateDigest`; the version pin must move so v2 saves aren't silently
  re-interpreted). Pre-release saves becoming un-replayable is already an accepted tradeoff
  (see `docs/superpowers/specs/2026-06-28-per-game-settings-design.md`).

**Display projection (keep the codec 1:1 with the other 3 variants):**
- `packages/engine/src/types/view.ts` — add the field to `RedactedView.settings`.
- `packages/engine/src/selectors.ts` (~254) — project `state.ruleParams.doubleRouteSingleFor23`.
- `packages/proto/proto/trmission/v1/common.proto` — add `bool double_route_single_for23 = 4;` to
  `message GameSettings`, then regenerate (`yarn workspace @trm/proto generate`).
- `apps/server/src/codec/snapshot.ts` (~133) — map the field into `gameSettings`.

**Lobby plumbing (host-editable setting):**
- `apps/server/src/lobby/room.repo.ts` — add to `RoomSettings` + `DEFAULT_ROOM_SETTINGS`.
- `apps/server/src/lobby/lobby.schemas.ts` — add `doubleRouteSingleFor23: z.boolean()` to
  `GameSettingsSchema`.
- `apps/server/src/lobby/lobby.service.ts` (~165) — include it in the `GameConfig.ruleParams` split
  at game start.
- `apps/web/src/net/rest.ts` — add to the web `RoomSettings` interface.

---

## Change 2 — New defaults

In `apps/server/src/lobby/room.repo.ts` `DEFAULT_ROOM_SETTINGS`:
- `visibility: 'PUBLIC'` → `'INVITE_ONLY'`
- `unlimitedStationBorrow: false` → `true`
- `doubleRouteSingleFor23: true` (new; ON by default — preserves current 2–3 player behavior)

> The engine baseline `DEFAULT_RULE_PARAMS` stays vanilla (`unlimitedStationBorrow: false`); the
> server always passes explicit values from `RoomSettings` at start, so only the **room** default
> changes for real games.

---

## Change 3 — Reuse settings-modal components (extract & share)

The Settings modal (`apps/web/src/components/SettingsModal.tsx`) already contains both patterns we
need, as inline markup styled by classes in `apps/web/src/styles/app.css`:
- a **switch** — `<button role="switch">` + `.switch-knob` (lines 163–172, 189–198; CSS `.switch` /
  `.switch.on` / `.switch-knob`).
- a **segmented selector** — `.segmented` `role="radiogroup"` of `<button role="radio">` for
  theme / language / layout (lines 104–156; CSS `.segmented` / `.segment` / `.segment.active`).

There is no shared UI-primitives folder yet, so we create one and extract both.

**Extract two reusable components (`apps/web/src/components/ui/`):**
- `Switch.tsx` — props `{ checked, onChange, label (aria), disabled? }`; renders the existing
  `<button role="switch">` + `.switch-knob` markup (reuse existing CSS, no new styles).
- `Segmented.tsx` — generic over a value `T`; props
  `{ options: { value: T; label: string; icon?: LucideIcon }[], value, onChange, ariaLabel }`;
  renders the existing `.segmented` radio-group markup (optional leading icon, matching layout/theme).

**Update `SettingsModal.tsx` to consume them** (no behavior change; keeps `role="switch"` /
`role="radio"` + aria-labels so `SettingsModal.test.tsx` stays green): theme / language / layout →
`<Segmented>`; colour-blind / sound → `<Switch>`.

**Lobby (`apps/web/src/screens/RoomScreen.tsx`):**
- Replace the three `RULE_TOGGLES` raw `<input type="checkbox">` (lines 241–255) and the
  `allowSpectating` checkbox (256–266) with `<Switch>`. Add the new `doubleRouteSingleFor23` entry
  to the `RULE_TOGGLES` table so it renders as a switch row automatically.
- Replace the public / invite-only two-button block (267–282) with `<Segmented>` over
  `['PUBLIC','INVITE_ONLY']`, keeping the existing `visibility_PUBLIC` / `visibility_INVITE_ONLY`
  labels and the `roomVisibility` row label.
- Everything stays inside the existing `<fieldset disabled={settingsLocked}>`, which natively
  disables descendant `<button>`s (so host-only gating is preserved without per-control `disabled`).

**i18n (`apps/web/src/i18n/index.ts`)** — add zh-Hant + en keys for the new option only
(`settingDoubleRouteSingleFor23` + `...Desc`). Visibility reuses existing keys.

---

## Tests to update / add

- `packages/engine/test/variants-determinism.spec.ts` — `ENGINE_VERSION` assertion `2 → 3`
  (line 23) + description. (Digest checks are self-consistent replay-vs-live, so no golden hex to
  rewrite.) Add a case exercising `doubleRouteSingleFor23: false` for a 3-player game (sibling NOT
  locked) alongside the existing default (sibling locked).
- `packages/engine/test/rules.spec.ts` — existing double-route lock test uses default params
  (still passes); add the "off" variant assertion.
- `apps/web/src/screens/RoomScreen.test.tsx` — change `getByRole('checkbox', …)` → `'switch'`
  (lines 174, 185); add coverage for the new toggle and the visibility segmented control
  (`role="radio"`, names `公開` / `僅限邀請`).
- `apps/web/src/components/SettingsModal.test.tsx` — should stay green (still `role="switch"` /
  `role="radio"` after extraction); verify.
- Server lobby/e2e specs referencing `RoomSettings` shape — add the new field where settings
  objects are constructed.

## Verification

1. `yarn workspace @trm/proto generate` (codegen for the new proto field).
2. `yarn typecheck` — catches every place the non-optional `RuleParams` / `RoomSettings` field must
   be added.
3. `yarn test` — engine determinism + web component tests + server lobby e2e.
4. Manual: `docker compose up -d mongo`, run server + web dev, create a room → confirm defaults
   (invite-only, station-borrow on), toggle all switches incl. the new parallel option, start a
   3-player (or 2-bot) game and confirm a parallel route is claimable/locked per the toggle.
