# Volume Slider Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unstyled native `<input type="range">` in `SettingsModal`'s sound row with a
themed `VolumeSlider` control (speaker icon + restyled track/thumb) matching the app's `--tr-*`
design tokens, per `docs/superpowers/specs/2026-07-10-volume-slider-redesign-design.md`.

**Architecture:** One new presentational component (`components/ui/VolumeSlider.tsx`, alongside
the existing `Switch`/`Segmented`), one CSS block in `styles/app.css`, and a one-line swap in
`SettingsModal.tsx`. No store, wire-protocol, or persistence changes — `soundVolume`/`soundEnabled`
already live in `store/ui.ts` and are consumed exactly as before, just through a different control.

**Tech Stack:** React + TypeScript (`apps/web`), `lucide-react` for icons (already a dependency,
already used elsewhere in `SettingsModal.tsx`), plain CSS (no new libraries), Vitest +
`@testing-library/react` for tests (existing pattern in `SettingsModal.test.tsx`).

## Global Constraints

- UI ships in Traditional Chinese (primary) + English — use existing i18n keys `t('sound')` /
  `t('volume')` (already defined in `src/i18n/index.ts`); do not add new keys.
- Follow the codebase's established test pattern: sound-control behavior is tested through
  `SettingsModal.test.tsx` (integration-style, via `render`/`screen`/`fireEvent`), matching the two
  existing tests in its "SettingsModal sound section" describe block — do not introduce a separate
  isolated `VolumeSlider.test.tsx`, since no sibling `components/ui/*` component (`Switch`,
  `Segmented`) has one.
- Only use existing design tokens from `src/styles/tokens.css` (`--tr-blue`, `--tr-surface-2`,
  `--tr-ink-soft`, `--tr-radius-sm`, `--tr-space-1`, `--tr-space-2`, `--tr-shadow`) — no new tokens,
  so light/dark theming stays automatic.
- CSS custom properties passed via inline `style` use the codebase's established
  `import { type CSSProperties } from 'react'` + `style={{ '--x': val } as CSSProperties}` pattern
  (see `components/MapBackdrop.tsx`, `components/TunnelModal.tsx`).

---

### Task 1: `VolumeSlider` component + `SettingsModal` wiring

**Files:**
- Create: `apps/web/src/components/ui/VolumeSlider.tsx`
- Modify: `apps/web/src/styles/app.css:648-650` (insert new rules right after the
  `.switch.on .switch-knob` block, before the `/* A one-shot attention pulse...` comment)
- Modify: `apps/web/src/components/SettingsModal.tsx:1-18` (imports),
  `apps/web/src/components/SettingsModal.tsx:150-165` (sound `<section>`)
- Test: `apps/web/src/components/SettingsModal.test.tsx` (extend the existing "SettingsModal sound
  section" describe block)

**Interfaces:**
- Produces: `VolumeSlider` — `apps/web/src/components/ui/VolumeSlider.tsx`, default export none,
  named export `VolumeSlider(props: { value: number; enabled: boolean; onChangeValue(next:
  number): void; onToggleEnabled(next: boolean): void; rangeLabel: string; muteLabel: string })`.
  Renders a `<div className="volume-slider">` containing a `<button type="button"
  className="volume-icon-btn" aria-pressed={enabled} aria-label={muteLabel}>` (speaker icon,
  `onClick` calls `onToggleEnabled(!enabled)`) and an `<input type="range" className="volume-range"
  aria-label={rangeLabel}>` (unchanged `min`/`max`/`step`/`disabled`/`onChange` semantics of the
  control it replaces).

- [ ] **Step 1: Write the failing test**

  Open `apps/web/src/components/SettingsModal.test.tsx` and add a new `it` inside the existing
  `describe('SettingsModal sound section', ...)` block (after the `'changes volume via the
  slider'` test, before the closing `});` of that describe):

  ```tsx
  it('mutes via the volume icon shortcut', () => {
    render(<SettingsModal onClose={() => undefined} />);
    const muteBtn = screen.getByRole('button', { name: /sound|音效/i });
    expect(muteBtn).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(muteBtn);

    expect(useUi.getState().soundEnabled).toBe(false);
    expect(muteBtn).toHaveAttribute('aria-pressed', 'false');
  });
  ```

- [ ] **Step 2: Run the test to verify it fails**

  Run: `yarn workspace @trm/web test --run SettingsModal`
  Expected: FAIL — `TestingLibraryElementError: Unable to find an accessible element with the role
  "button" and name ...` (no such control exists yet; the modal's only other button is the "close"
  icon button, whose accessible name is `t('close')`, not `t('sound')`).

- [ ] **Step 3: Create the `VolumeSlider` component**

  Create `apps/web/src/components/ui/VolumeSlider.tsx`:

  ```tsx
  import { type CSSProperties } from 'react';
  import { Volume1, Volume2, VolumeX } from 'lucide-react';

  interface Props {
    value: number;
    enabled: boolean;
    onChangeValue(next: number): void;
    onToggleEnabled(next: boolean): void;
    rangeLabel: string;
    muteLabel: string;
  }

  export function VolumeSlider({
    value,
    enabled,
    onChangeValue,
    onToggleEnabled,
    rangeLabel,
    muteLabel,
  }: Props) {
    const Icon = !enabled || value === 0 ? VolumeX : value <= 0.5 ? Volume1 : Volume2;
    return (
      <div className="volume-slider">
        <button
          type="button"
          className="volume-icon-btn"
          aria-pressed={enabled}
          aria-label={muteLabel}
          onClick={() => onToggleEnabled(!enabled)}
        >
          <Icon size={18} aria-hidden />
        </button>
        <input
          type="range"
          className="volume-range"
          min={0}
          max={1}
          step={0.05}
          value={value}
          disabled={!enabled}
          aria-label={rangeLabel}
          style={{ '--tr-range-fill': `${value * 100}%` } as CSSProperties}
          onChange={(e) => onChangeValue(Number(e.target.value))}
        />
      </div>
    );
  }
  ```

- [ ] **Step 4: Wire `VolumeSlider` into `SettingsModal`**

  In `apps/web/src/components/SettingsModal.tsx`, add the import alongside the existing `./ui/*`
  imports (after `import { Segmented } from './ui/Segmented';`):

  ```tsx
  import { VolumeSlider } from './ui/VolumeSlider';
  ```

  Then replace the sound `<section>` block:

  ```tsx
        <section className="setting setting-row">
          <div>
            <div className="setting-label">{t('sound')}</div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={soundVolume}
              disabled={!soundEnabled}
              aria-label={t('volume')}
              onChange={(e) => setSoundVolume(Number(e.target.value))}
            />
          </div>
          <Switch checked={soundEnabled} onChange={setSoundEnabled} label={t('sound')} />
        </section>
  ```

  with:

  ```tsx
        <section className="setting setting-row">
          <div>
            <div className="setting-label">{t('sound')}</div>
            <VolumeSlider
              value={soundVolume}
              enabled={soundEnabled}
              onChangeValue={setSoundVolume}
              onToggleEnabled={setSoundEnabled}
              rangeLabel={t('volume')}
              muteLabel={t('sound')}
            />
          </div>
          <Switch checked={soundEnabled} onChange={setSoundEnabled} label={t('sound')} />
        </section>
  ```

- [ ] **Step 5: Run the test to verify it passes**

  Run: `yarn workspace @trm/web test --run SettingsModal`
  Expected: PASS — all tests in both `describe` blocks (account sync + sound section, including the
  new one) succeed.

- [ ] **Step 6: Add the CSS**

  In `apps/web/src/styles/app.css`, insert the following block immediately after the
  `.switch.on .switch-knob { transform: translateX(18px); }` rule (i.e. right before the
  `/* A one-shot attention pulse... */` comment):

  ```css

  /* Volume slider (settings modal) — icon + restyled native <input type="range"> */
  .volume-slider {
    display: flex;
    align-items: center;
    gap: var(--tr-space-2);
    margin-top: var(--tr-space-1);
  }
  .volume-icon-btn {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: none;
    border-radius: var(--tr-radius-sm);
    background: transparent;
    color: var(--tr-ink-soft);
    cursor: pointer;
  }
  .volume-icon-btn:hover {
    color: var(--tr-ink);
    background: var(--tr-surface-2);
  }
  .volume-icon-btn:focus-visible {
    outline: 2px solid var(--tr-blue);
    outline-offset: 2px;
  }
  .volume-range {
    -webkit-appearance: none;
    appearance: none;
    flex: 1;
    min-width: 100px;
    max-width: 160px;
    height: 4px;
    border-radius: 999px;
    background: linear-gradient(
      to right,
      var(--tr-blue) var(--tr-range-fill, 0%),
      var(--tr-surface-2) var(--tr-range-fill, 0%)
    );
    outline: none;
    cursor: pointer;
  }
  .volume-range::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--tr-blue);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
    cursor: pointer;
    transition: transform 0.15s ease;
  }
  .volume-range::-webkit-slider-thumb:hover {
    transform: scale(1.15);
  }
  .volume-range::-moz-range-track {
    height: 4px;
    border-radius: 999px;
    background: var(--tr-surface-2);
  }
  .volume-range::-moz-range-progress {
    height: 4px;
    border-radius: 999px;
    background: var(--tr-blue);
  }
  .volume-range::-moz-range-thumb {
    width: 16px;
    height: 16px;
    border: none;
    border-radius: 50%;
    background: var(--tr-blue);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
    cursor: pointer;
  }
  .volume-range:focus-visible {
    outline: 2px solid var(--tr-blue);
    outline-offset: 2px;
  }
  .volume-range:disabled {
    cursor: not-allowed;
    background: var(--tr-surface-2);
  }
  .volume-range:disabled::-webkit-slider-thumb,
  .volume-range:disabled::-moz-range-thumb {
    background: var(--tr-ink-soft);
  }
  ```

- [ ] **Step 7: Lint and typecheck**

  Run: `yarn workspace @trm/web test --run SettingsModal && yarn lint && yarn typecheck`
  Expected: all three pass with no errors.

- [ ] **Step 8: Manually verify in the running app**

  Run: `docker compose up -d mongo` (if not already running), then
  `yarn workspace @trm/server dev` and `yarn workspace @trm/web dev` in separate terminals. Open
  the app, open Settings, and confirm: the speaker icon changes between muted/low/high as the
  slider moves, clicking the icon mutes/unmutes in sync with the `Switch`, the track shows a blue
  fill up to the thumb, the disabled (muted) state visually dims the track/thumb, and it looks
  correct in both light and dark theme (toggle via the theme segmented control in the same modal).

- [ ] **Step 9: Commit**

  ```bash
  git add apps/web/src/components/ui/VolumeSlider.tsx apps/web/src/components/SettingsModal.tsx apps/web/src/components/SettingsModal.test.tsx apps/web/src/styles/app.css
  git commit -m "feat(web): redesign the settings volume slider"
  ```

## Self-Review

**Spec coverage:** Icon reflects mute/low/high state — Step 3 (`Icon` selection). Icon
click-to-mute shortcut — Step 3 (`onClick`) + Step 1/5 tests. Restyled track/thumb with `--tr-*`
tokens, disabled dimming, focus ring — Step 6 CSS. Wiring replaces the raw `<input>`, `Switch`
untouched — Step 4. No persistence/store changes — none introduced. Existing "changes volume via
the slider" test keeps passing unchanged since `rangeLabel` still resolves to `t('volume')` and the
`role="slider"` stays on the native `<input>`. All spec sections are covered by Task 1; no gaps.

**Placeholder scan:** No TBD/TODO; every step has literal, complete code.

**Type consistency:** `VolumeSlider` props (`value`, `enabled`, `onChangeValue`, `onToggleEnabled`,
`rangeLabel`, `muteLabel`) are identical between the Step 3 definition and the Step 4 call site.
