# Volume slider redesign — design

## Goal

`SettingsModal`'s sound row renders a completely unstyled native `<input type="range">` — the
only control in the modal that still looks like a raw OS widget instead of the app's "paper
timetable" design language (`Switch`, `Segmented` already use `--tr-*` tokens). Redesign it to
match, and add a speaker icon that both reflects the current volume/mute state and acts as a
quick-mute shortcut alongside the existing `Switch`.

## Component

**`VolumeSlider`** (new, `apps/web/src/components/ui/VolumeSlider.tsx`), styled next to the
existing `Switch`/`Segmented` in the same folder:

```ts
interface Props {
  value: number; // 0..1, mirrors soundVolume
  enabled: boolean; // mirrors soundEnabled
  onChangeValue(next: number): void;
  onToggleEnabled(next: boolean): void;
  label: string; // aria-label for the range input (t('volume'))
}
```

- **Icon** (left of the track): `VolumeX` when `!enabled || value === 0`, `Volume1` at `<= 0.5`,
  `Volume2` above that (lucide-react, already the icon set used throughout `SettingsModal`).
  Rendered as a `type="button"` with `aria-pressed={enabled}` and an accessible name reusing
  `t('sound')`; `onClick` calls `onToggleEnabled(!enabled)` — the same store write the existing
  `Switch` performs, so the two controls just read/write the same `soundEnabled` value and can
  never disagree.
- **Track**: the native `<input type="range">` (keeps built-in keyboard support and
  `role="slider"`), fully restyled — `-webkit-appearance: none`, 4px rounded track. The filled
  portion up to the current value is a `linear-gradient` driven by a CSS custom property
  (`style={{ '--tr-range-fill': `${value \* 100}%` }}`) so no JS-computed gradient string is
  needed; Firefox uses `::-moz-range-track` + `::-moz-range-progress` for the same effect.
- **Thumb**: small circle, `--tr-blue` fill, `--tr-shadow`-style drop shadow matching the
  `Switch` knob, slight scale on hover, visible `:focus-visible` ring.
- **Disabled state** (`enabled === false`): input gets `disabled`, track/thumb dim toward
  `--tr-ink-soft` at reduced opacity, cursor `not-allowed` — same visual language as the
  disabled `Switch`.
- Only existing tokens are used (`--tr-blue`, `--tr-surface-2`, `--tr-ink-soft`, `--tr-radius*`,
  `--tr-space*`, `--tr-shadow`), so light/dark themes are automatic — no new token needed.

## Wiring

`SettingsModal.tsx`'s sound row:

```tsx
<VolumeSlider
  value={soundVolume}
  enabled={soundEnabled}
  onChangeValue={setSoundVolume}
  onToggleEnabled={setSoundEnabled}
  label={t('volume')}
/>
```

replaces the bare `<input type="range" .../>` inside the existing label wrapper div. The
sibling `<Switch checked={soundEnabled} onChange={setSoundEnabled} .../>` on the right of the
row is untouched — both it and the new icon call the same `setSoundEnabled` setter, so they
always show the same state. Sound settings are device-local today (no `persist()` call, unlike
theme/locale/colorBlind/layout) — that stays as-is; this is a presentational change only.

## Implementation surface

All in `apps/web`:

1. `src/components/ui/VolumeSlider.tsx` (new).
2. `src/styles/app.css` — new rules near the existing `.switch`/`.switch-knob` block: `.volume-slider`,
   `.volume-icon`, `.volume-range` (+ `::-webkit-slider-thumb`, `::-moz-range-track`,
   `::-moz-range-progress`, `::-moz-range-thumb`, `:disabled`, `:focus-visible`).
3. `src/components/SettingsModal.tsx` — swap the raw `<input>` for `<VolumeSlider>`.
4. `src/components/ui/VolumeSlider.test.tsx` (new) — icon reflects muted/low/high state; icon
   click calls `onToggleEnabled`; dragging the range calls `onChangeValue`.
5. `src/components/SettingsModal.test.tsx` — existing "toggles mute" and "changes volume via the
   slider" tests must keep passing unchanged (same roles/labels); add a case for the icon shortcut
   toggling `soundEnabled` from the settings modal.

## Out of scope

- No numeric percentage readout.
- No change to `soundEnabled`/`soundVolume` persistence behavior (still local-only, not synced
  via `savePreferences`).
- No change to `useSoundDriver`/`sound/player.ts` playback logic — this only touches the control
  that edits the existing store values.

## Success criteria

- The sound row's icon changes between muted/low/high as volume changes and matches the
  `Switch`'s on/off state; clicking the icon toggles sound the same way the `Switch` does.
- The track and thumb are restyled with `--tr-*` tokens (blue fill, circular thumb, dimmed
  disabled state) instead of the raw OS slider, correctly themed in both light and dark mode.
- `yarn workspace @trm/web test`, `yarn lint`, and `yarn typecheck` pass.
