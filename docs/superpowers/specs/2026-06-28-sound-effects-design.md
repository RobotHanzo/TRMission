# Sound effects — design

**Date:** 2026-06-28
**Scope:** `apps/web` only (no proto / engine / server changes required).
**Depends on:** the in-game animation system (`2026-06-28-ingame-animations-design.md`) — sound
reuses the same event/snapshot-diff plumbing.

## Goal

Add audio feedback to the in-game experience. Ten cues, sourced from royalty-free / CC0 audio and
credited in-repo. The palette is **railway foley blended with clean UI sound** — thematic 台鐵
railway foley where it fits naturally, soft/unobtrusive UI cues for frequent actions.

## Decisions (load-bearing)

- **No backend change.** Like the animation layer, every cue is driven from events the protocol
  already emits (`CardDrawnBlind`/`CardTakenFaceup`, `TurnStarted`, `RouteClaimed`, `StationBuilt`,
  `TunnelRevealed`) plus snapshot diffs (`phase`, `completedTickets`). Sound is structurally the
  sibling of the animation system.
- **Sound is per-device, not account-synced.** Volume is a property of the device/speakers, so the
  on/off + volume preference lives in `localStorage` (mirroring `theme`/`colorBlind` in `store/ui.ts`),
  **not** in `UserPreferences`. No server/Mongo change.
- **Cues play for ALL players' actions** (card draw, station built, railway built), mirroring how the
  board glow already fires for everyone. Opponents' cues are attenuated (~0.5 gain) and throttled so
  fast bot turns never machine-gun a clip. The celebratory/self cues (your turn, mission completed,
  game-over) are scoped per the table below.
- **Web Audio API, not `<audio>` elements.** One `AudioContext`, each file decoded once into an
  `AudioBuffer`, played through a master `GainNode`. Web Audio overlaps cleanly and has low latency —
  `HTMLAudioElement` cannot overlap the same element and adds latency. The context is `resume()`d on
  the first user gesture (autoplay policy) and is fully guarded so jsdom/test environments (no real
  `AudioContext`) treat the player as a no-op.
- **First snapshot seeds without firing.** The driver initialises its `prev` refs on the first
  snapshot (or first after reconnect/reset) so resuming a game never replays a stale win-horn or
  mission flourish — identical to the animation driver's guard.
- **Tunnel result cues are emitted by `TunnelModal`.** The modal owns the reveal→result timeline
  (cards flip in over ~1.5–2.5s, then the surcharge result appears). Cues #4/#5 fire from the modal
  at the moment `showResult` flips; the rest flow through `useSoundDriver`.
- **All audio is CC0 / royalty-free and credited** in `apps/web/public/sounds/CREDITS.md`.

## The cue palette

| # | Cue | Sound | Trigger | Plays for |
|---|-----|-------|---------|-----------|
| 1 | Card draw | Soft, short card flick/slide (clean UI) | `CardDrawnBlind` / `CardTakenFaceup` | All (self crisp, opponents softer) |
| 2 | Your turn | Taiwan platform "ding-dong" departure chime | `TurnStarted` where `playerId === me` | You only |
| 3 | Tunnel draw | Low suspense swell / card riffle as the 3 cards flip | `TunnelModal` reveal start | Claimant |
| 4 | Tunnel success | Bright relief chime (no surcharge) | `TunnelModal` result, `extraRequired === 0` | Claimant |
| 5 | Tunnel needs payment | Cautionary descending "uh-oh" / soft thud | `TunnelModal` result, `extraRequired > 0` | Claimant |
| 6 | Mission completed | Triumphant station-announcement flourish + sparkle | `completedTickets` diff, self completion (the fanfare) | You only |
| 7 | Game over — win | Triumphant train-horn victory fanfare | `phase → GAME_OVER`, you ∈ winners | You (if won) |
| 8 | Game over — normal | Gentler single horn / "end of the line" chime | `phase → GAME_OVER`, not a winner / spectator | Everyone else |
| 9 | Station built | Construction stamp/thunk + tiny bell | `StationBuilt` | All (opponents softer) |
| 10 | Railway built | Satisfying track "clack/clunk" (laying rails) | `RouteClaimed` | All (opponents softer) |

Notes:
- **Win vs normal** is decided exactly as `ScoreBoard` does: winners = `finalScores.ranking[0].playerIds`.
  Local player ∈ winners → cue #7; otherwise (incl. spectators with no `you`) → cue #8. Exactly one of
  #7/#8 fires, once, on the `phase → GAME_OVER` transition.
- **Mission completed (#6)** fires on a self own-track completion — the same transition that opens the
  full-screen fanfare. Opponents' completions get no celebratory sound (their fanfare is a subtle
  visual cue only).

## Architecture (`apps/web` only)

```
public/sounds/*.{mp3}            ← audio files + CREDITS.md (Vite serves at /sounds/…)
src/sound/cues.ts                ← pure catalog (cue → file, gain, throttle, self/opp split)
src/sound/soundModel.ts          ← pure (snapshot, events) → Cue[]  + snapshot-diff derivations
src/sound/player.ts              ← Web Audio manager (decode, volume, gesture-unlock, throttle)
src/hooks/useSoundDriver.ts      ← mounted once in GameScreen; lastBatch + snapshot → player.play
store/ui.ts                      ← soundEnabled + soundVolume (localStorage), setters
components/SettingsModal.tsx     ← new "Sound" section (mute switch + volume slider)
i18n/index.ts                    ← sound/mute/volume strings (zh-Hant + en)
```

### `sound/cues.ts` (pure data)
A `Cue` string union (`'cardDraw' | 'yourTurn' | 'tunnelDraw' | 'tunnelSuccess' | 'tunnelPayment' |
'missionComplete' | 'gameOverWin' | 'gameOverNormal' | 'stationBuilt' | 'railwayBuilt'`) and a
`CUES: Record<Cue, { src: string; gain: number; throttleMs: number }>` catalog. `throttleMs` is the
minimum interval between two plays of the same cue (drops duplicates inside the window).

### `sound/soundModel.ts` (pure, unit-tested)
Mirrors `animationModel.ts`:
- `cuesFromEvents(snapshot, events): { cue: Cue; isSelf: boolean }[]` — maps `CardDrawnBlind`/
  `CardTakenFaceup` → `cardDraw`, `TurnStarted`(self) → `yourTurn`, `StationBuilt` → `stationBuilt`,
  `RouteClaimed` → `railwayBuilt`. `isSelf` (= `playerId === me`) selects the self/opponent gain.
- `gameOverCue(snapshot): Cue | null` — `gameOverWin` if `you ∈ ranking[0]`, else `gameOverNormal`;
  `null` if not at `GAME_OVER`. The driver calls this only on the phase transition into `GAME_OVER`.
- Mission completion is derived by the driver from a `completedTickets` self diff (same source the
  animation driver/fanfare uses), firing `missionComplete` on a new own completion.

### `sound/player.ts` (Web Audio manager)
- Lazily creates a single `AudioContext` + master `GainNode`; `master.gain` follows `soundVolume`
  (and is 0 when `soundEnabled` is false).
- `preload()` fetches + `decodeAudioData` for every cue once (idempotent).
- `play(cue, { gainScale }?)` — no-op if muted / no context / decode missing; enforces the per-cue
  `throttleMs`; spawns an `AudioBufferSourceNode` through a per-play gain (cue gain × optional
  opponent scale) → master → destination.
- `unlock()` — `resume()`s a suspended context; wired to the first pointer/key gesture.
- **Test/SSR guard:** if `window.AudioContext` (and `webkitAudioContext`) is undefined, every method
  is a safe no-op so existing vitest/jsdom suites are unaffected. Unit tests inject a mock context.

### `hooks/useSoundDriver.ts`
Mounted once in `GameScreen` (next to `useAnimationDriver`). Reactions:
- new `lastBatch` → `cuesFromEvents` → `player.play` each (opponent cues at the reduced scale).
- snapshot `phase` transition into `GAME_OVER` → `player.play(gameOverCue(snapshot))` once.
- snapshot `completedTickets` self diff → `player.play('missionComplete')` per new own completion.
- first snapshot only seeds refs (no firing). Also calls `player.preload()` on mount and registers
  the one-time gesture `unlock()`.

### `store/ui.ts`
Add `soundEnabled: boolean` (default `true`) and `soundVolume: number` (0–1, default `0.6`) seeded
from `localStorage` (`trm.soundEnabled`, `trm.soundVolume`) with `setSoundEnabled`/`setSoundVolume`
setters that write through — the exact pattern already used for `theme`/`colorBlind`/`boardLayout`.
The `player` subscribes to these (or reads them on each `play`) so changes apply live. **Not** added
to `applyPreferences`/`UserPreferences` (per-device only).

### `components/SettingsModal.tsx`
A new "音效 / Sound" section above or below colour-blind: a mute `switch` (role="switch", bound to
`soundEnabled`) and a volume `slider` (`<input type="range">`, bound to `soundVolume`, disabled when
muted). Persists via the ui-store setters (localStorage); **not** routed through `savePreferences`.
New i18n keys: `sound`, `soundMute`/reuse a switch label, `volume`.

## Sourcing & credits
CC0 / royalty-free only, preferring CC0. Candidate sources: **Kenney** (CC0 UI/impact packs),
**Pixabay** (royalty-free, no attribution required), **Mixkit** (free SFX). Each shipped file is
logged in `apps/web/public/sounds/CREDITS.md` with: cue, filename, source, author, license, and URL.
CC0 needs no legal attribution but is credited anyway; any CC-BY file gets the required attribution.
If a particular high-quality clip cannot be fetched in this environment, the gap is documented in
CREDITS.md rather than silently shipping a wrong/placeholder sound.

## Testing & verification
- **Unit (vitest, TDD):**
  - `sound/soundModel.ts` — events→cues incl. self/opponent flag; `gameOverCue` win vs normal vs
    null; (mission completion diff is covered at the driver level).
  - `sound/player.ts` — with an injected mock `AudioContext`: respects mute/volume, enforces
    `throttleMs` (second immediate play of the same cue is dropped), `unlock()` resumes, and every
    method is a no-op when no `AudioContext` exists.
- **Component (Testing-Library):**
  - `SettingsModal` renders the sound section, toggling mute and moving the slider update store +
    localStorage, slider disabled when muted.
  - `TunnelModal` plays `tunnelSuccess` when `extraRequired === 0` and `tunnelPayment` when `> 0` at
    result reveal (player mocked).
- **Manual:** `yarn workspace @trm/web dev` against a bots game — confirm card/station/railway cues
  for all players, the your-turn chime, the tunnel draw/success/payment sequence, a mission-complete
  flourish, and both game-over endings. Verify the Settings mute/volume apply live.

## Out of scope
- Account-synced sound preferences.
- Background music / ambient loops.
- Per-cue user customization or a separate SFX/music volume split.
