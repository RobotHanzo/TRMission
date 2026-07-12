# Store screenshot prep (consumed by P6)

## Required sets

| Store     | Set         | Size/device                         | Notes                               |
| --------- | ----------- | ----------------------------------- | ----------------------------------- |
| App Store | iPhone 6.9" | 1320×2868 (iPhone 17 Pro Max class) | portrait                            |
| App Store | iPad 13"    | 2064×2752                           | landscape + portrait                |
| Play      | Phone       | 1080×1920 min                       | portrait                            |
| Play      | 7" tablet   | per current Play console spec       | required for tablet listing quality |
| Play      | 10" tablet  | per current Play console spec       | required for tablet listing quality |

## Capture matrix (run before P6)

- Simulators/emulators: iPhone Pro Max class, iPad Pro 13", Pixel phone class, Pixel Tablet.
- Locales: capture EVERY shot in **zh-Hant first**, then en (store listings are bilingual).
- Scenes (same order in both locales): Home (offline banner visible in airplane mode variant),
  Room lobby with bots, mid-game board (three-pane on tablets, dock on phones), tunnel reveal
  moment, game-over scoreboard, map studio (WebView, feature-granted account).
- Tablet shots must show the ≥1000dp three-pane tier; verify by width, not device name.
- Stage Manager: capture one resized-window shot for internal QA (not for the store) to prove
  live-resize survival.

## Manual large-screen audit checklist (P5 exit criteria)

- [ ] iPad: drag between full screen / Split View / Stage Manager widths — tiers switch
      compact↔two-pane↔three-pane with no clipped dock, no stuck gesture state.
- [ ] iPad: rotation unlocked everywhere; no layout assumes portrait.
- [ ] Android tablet (or resizable emulator, 600dp+): freeform resize + split-screen — same.
- [ ] Android 16 emulator: orientation lock request is IGNORED by the OS on ≥600dp — app
      renders correctly anyway.
- [ ] Phones: portrait lock holds; landscape never renders half-initialized.
