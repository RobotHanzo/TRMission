# Sound Effects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 10 event-driven in-game sound effects to `apps/web`, with a per-device Settings volume/mute control, using the audio already shipped in `apps/web/public/sounds/`.

**Architecture:** Sound mirrors the existing animation system. A pure `soundModel` maps an event batch + snapshot to cue names; a singleton Web-Audio `player` decodes each file once and plays it (throttled, volume-controlled, gesture-unlocked); a `useSoundDriver` hook (mounted once in `GameScreen`, beside `useAnimationDriver`) wires the two together and diffs the snapshot for game-over and mission-complete. `TunnelModal` emits its own reveal/result cues because it owns that timeline.

**Tech Stack:** React 18 + TypeScript, Vite ^5, Zustand, Vitest + @testing-library/react, Web Audio API. Audio cues are static MP3s under `apps/web/public/sounds/` (served at `/sounds/*.mp3`).

## Global Constraints

- **`apps/web` only.** No changes to `@trm/proto`, `@trm/engine`, server, or Mongo.
- **Per-device prefs.** Sound on/off + volume persist to `localStorage` only (keys `trm.soundEnabled`, `trm.soundVolume`); they are **not** added to `UserPreferences` / `applyPreferences` / `savePreferences`.
- **Vite pinned at ^5** — do not bump (vitest 2 compatibility).
- **Defaults:** `soundEnabled = true`, `soundVolume = 0.6`.
- **Test/jsdom safety:** the player must be a no-op when no `AudioContext` exists (jsdom), so existing suites keep passing. Never let importing or calling the player throw under jsdom.
- **Cues play for ALL players' actions** for `cardDraw`/`stationBuilt`/`railwayBuilt` (opponent plays at `OPPONENT_GAIN = 0.5`); `yourTurn`/`missionComplete`/`gameOverWin` are self-scoped per `soundModel`.
- Follow existing repo commit conventions (the harness appends the required trailers).

## File Structure

| File                                                      | Responsibility                                                                                              |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `apps/web/src/sound/cues.ts` (create)                     | Pure cue catalog: `Cue` union, `CUES` (src/gain/throttle), `OPPONENT_GAIN`, `ALL_CUES`.                     |
| `apps/web/src/sound/soundModel.ts` (create)               | Pure `cuesFromEvents` + `gameOverCue`.                                                                      |
| `apps/web/src/sound/soundModel.test.ts` (create)          | Unit tests for the model.                                                                                   |
| `apps/web/src/sound/player.ts` (create)                   | Web-Audio singleton: preload/unlock/play/setEnabled/setVolume, throttle, jsdom-safe.                        |
| `apps/web/src/sound/player.test.ts` (create)              | Player tests via injected mock `AudioContext`.                                                              |
| `apps/web/src/store/ui.ts` (modify)                       | Add `soundEnabled`/`soundVolume` state + setters + localStorage.                                            |
| `apps/web/src/store/ui.test.ts` (modify)                  | Persistence tests for the new prefs.                                                                        |
| `apps/web/src/hooks/useSoundDriver.ts` (create)           | Mount-once driver: events→cues, snapshot diffs (game-over, mission), preload + gesture unlock + store sync. |
| `apps/web/src/hooks/useSoundDriver.test.tsx` (create)     | Driver tests (mocked player).                                                                               |
| `apps/web/src/screens/GameScreen.tsx` (modify)            | Call `useSoundDriver()`.                                                                                    |
| `apps/web/src/components/SettingsModal.tsx` (modify)      | New "Sound" section: mute switch + volume slider.                                                           |
| `apps/web/src/components/SettingsModal.test.tsx` (modify) | Sound-section tests.                                                                                        |
| `apps/web/src/components/TunnelModal.tsx` (modify)        | Per-card `tunnelDraw` (×3) + `tunnelSuccess`/`tunnelPayment` at result.                                     |
| `apps/web/src/components/TunnelModal.test.tsx` (create)   | Tunnel cue tests (mocked player).                                                                           |
| `apps/web/src/i18n/index.ts` (modify)                     | `sound`, `volume` strings (zh-Hant + en).                                                                   |

Run a single web test file with: `yarn workspace @trm/web test --run <substring>`.

---

### Task 1: Cue catalog

**Files:**

- Create: `apps/web/src/sound/cues.ts`
- Test: `apps/web/src/sound/cues.test.ts`

**Interfaces:**

- Produces: `type Cue` (string union of the 10 cue keys); `interface CueDef { src: string; gain: number; throttleMs: number }`; `const CUES: Record<Cue, CueDef>`; `const OPPONENT_GAIN = 0.5`; `const ALL_CUES: Cue[]`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/sound/cues.test.ts
import { describe, it, expect } from 'vitest';
import { CUES, ALL_CUES, OPPONENT_GAIN, type Cue } from './cues';

describe('cue catalog', () => {
  it('defines all 10 cues with /sounds/*.mp3 sources and sane gains', () => {
    const expected: Cue[] = [
      'cardDraw',
      'yourTurn',
      'tunnelDraw',
      'tunnelSuccess',
      'tunnelPayment',
      'missionComplete',
      'gameOverWin',
      'gameOverNormal',
      'stationBuilt',
      'railwayBuilt',
    ];
    expect(ALL_CUES.sort()).toEqual([...expected].sort());
    for (const cue of expected) {
      expect(CUES[cue].src).toMatch(/^\/sounds\/.+\.mp3$/);
      expect(CUES[cue].gain).toBeGreaterThan(0);
      expect(CUES[cue].gain).toBeLessThanOrEqual(1);
      expect(CUES[cue].throttleMs).toBeGreaterThanOrEqual(0);
    }
  });
  it('attenuates opponent cues', () => {
    expect(OPPONENT_GAIN).toBeGreaterThan(0);
    expect(OPPONENT_GAIN).toBeLessThan(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/web test --run cues`
Expected: FAIL — cannot find module `./cues`.

- [ ] **Step 3: Write the catalog**

```ts
// apps/web/src/sound/cues.ts
export type Cue =
  | 'cardDraw'
  | 'yourTurn'
  | 'tunnelDraw'
  | 'tunnelSuccess'
  | 'tunnelPayment'
  | 'missionComplete'
  | 'gameOverWin'
  | 'gameOverNormal'
  | 'stationBuilt'
  | 'railwayBuilt';

export interface CueDef {
  /** Path under Vite's public/ root (served at this URL). */
  src: string;
  /** Base playback gain (0–1), multiplied by the master volume. */
  gain: number;
  /** Minimum ms between two plays of this cue; a play inside the window is dropped. */
  throttleMs: number;
}

export const CUES: Record<Cue, CueDef> = {
  cardDraw: { src: '/sounds/card-draw.mp3', gain: 0.8, throttleMs: 55 },
  yourTurn: { src: '/sounds/your-turn.mp3', gain: 0.9, throttleMs: 250 },
  tunnelDraw: { src: '/sounds/tunnel-draw.mp3', gain: 0.8, throttleMs: 0 },
  tunnelSuccess: { src: '/sounds/tunnel-success.mp3', gain: 0.9, throttleMs: 200 },
  tunnelPayment: { src: '/sounds/tunnel-payment.mp3', gain: 0.9, throttleMs: 200 },
  missionComplete: { src: '/sounds/mission-complete.mp3', gain: 1.0, throttleMs: 300 },
  gameOverWin: { src: '/sounds/game-over-win.mp3', gain: 1.0, throttleMs: 1000 },
  gameOverNormal: { src: '/sounds/game-over-normal.mp3', gain: 0.9, throttleMs: 1000 },
  stationBuilt: { src: '/sounds/station-built.mp3', gain: 0.9, throttleMs: 70 },
  railwayBuilt: { src: '/sounds/railway-built.mp3', gain: 0.9, throttleMs: 70 },
};

/** Gain multiplier for a cue triggered by an opponent's action (vs the local player's). */
export const OPPONENT_GAIN = 0.5;

export const ALL_CUES = Object.keys(CUES) as Cue[];
```

> Note: `tunnelDraw.throttleMs = 0` on purpose — `TunnelModal` fires it 3× ~500 ms apart and none must be dropped.

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @trm/web test --run cues`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/sound/cues.ts apps/web/src/sound/cues.test.ts
git commit -m "Web sound: cue catalog (paths, gains, throttle)"
```

---

### Task 2: Pure sound model

**Files:**

- Create: `apps/web/src/sound/soundModel.ts`
- Test: `apps/web/src/sound/soundModel.test.ts`

**Interfaces:**

- Consumes: `Cue` from `./cues`; `Phase`, `GameEvent`, `GameSnapshot` from `@trm/proto`.
- Produces: `interface CueHit { cue: Cue; isSelf: boolean }`; `cuesFromEvents(snapshot: GameSnapshot, events: GameEvent[]): CueHit[]`; `gameOverCue(snapshot: GameSnapshot): Cue | null`.

Background (verified in `apps/web/src/game/animationModel.ts`): a `GameEvent` is `{ event: { case, value } }`; relevant `case` values are `'cardDrawnBlind'`, `'cardTakenFaceup'`, `'turnStarted'`, `'stationBuilt'`, `'routeClaimed'`, each `value` carrying `playerId`. Winners (verified in `ScoreBoard.tsx`) are `snapshot.finalScores.ranking[0].playerIds`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/sound/soundModel.test.ts
import { describe, it, expect } from 'vitest';
import { Phase, type GameEvent, type GameSnapshot } from '@trm/proto';
import { cuesFromEvents, gameOverCue } from './soundModel';

const ev = (cs: string, value: Record<string, unknown>): GameEvent =>
  ({ event: { case: cs, value } }) as unknown as GameEvent;

const snap = (over: Partial<GameSnapshot>): GameSnapshot =>
  ({ you: { playerId: 'me' }, phase: Phase.AWAIT_ACTION, ...over }) as unknown as GameSnapshot;

describe('cuesFromEvents', () => {
  it('maps draws/turn/station/route with the self flag', () => {
    const s = snap({});
    const hits = cuesFromEvents(s, [
      ev('cardDrawnBlind', { playerId: 'me' }),
      ev('cardTakenFaceup', { playerId: 'p2' }),
      ev('turnStarted', { playerId: 'me' }),
      ev('turnStarted', { playerId: 'p2' }),
      ev('stationBuilt', { playerId: 'p2' }),
      ev('routeClaimed', { playerId: 'me' }),
    ]);
    expect(hits).toEqual([
      { cue: 'cardDraw', isSelf: true },
      { cue: 'cardDraw', isSelf: false },
      { cue: 'yourTurn', isSelf: true }, // opponent turnStarted yields nothing
      { cue: 'stationBuilt', isSelf: false },
      { cue: 'railwayBuilt', isSelf: true },
    ]);
  });
});

describe('gameOverCue', () => {
  it('returns null when not at GAME_OVER', () => {
    expect(gameOverCue(snap({ phase: Phase.AWAIT_ACTION }))).toBeNull();
  });
  it('returns win when the local player is a winner', () => {
    const s = snap({
      phase: Phase.GAME_OVER,
      finalScores: { ranking: [{ playerIds: ['me'] }] },
    } as Partial<GameSnapshot>);
    expect(gameOverCue(s)).toBe('gameOverWin');
  });
  it('returns normal when the local player did not win', () => {
    const s = snap({
      phase: Phase.GAME_OVER,
      finalScores: { ranking: [{ playerIds: ['p2'] }] },
    } as Partial<GameSnapshot>);
    expect(gameOverCue(s)).toBe('gameOverNormal');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/web test --run soundModel`
Expected: FAIL — cannot find module `./soundModel`.

- [ ] **Step 3: Write the model**

```ts
// apps/web/src/sound/soundModel.ts
import { Phase, type GameEvent, type GameSnapshot } from '@trm/proto';
import type { Cue } from './cues';

export interface CueHit {
  cue: Cue;
  /** True when the local player triggered the event (full gain); false → opponent (attenuated). */
  isSelf: boolean;
}

/** Translate a delivered event batch into sound cues (pure). */
export function cuesFromEvents(snapshot: GameSnapshot, events: GameEvent[]): CueHit[] {
  const me = snapshot.you?.playerId ?? null;
  const out: CueHit[] = [];
  for (const e of events) {
    const ev = e.event;
    switch (ev.case) {
      case 'cardDrawnBlind':
      case 'cardTakenFaceup':
        out.push({ cue: 'cardDraw', isSelf: ev.value.playerId === me });
        break;
      case 'turnStarted':
        if (ev.value.playerId === me) out.push({ cue: 'yourTurn', isSelf: true });
        break;
      case 'stationBuilt':
        out.push({ cue: 'stationBuilt', isSelf: ev.value.playerId === me });
        break;
      case 'routeClaimed':
        out.push({ cue: 'railwayBuilt', isSelf: ev.value.playerId === me });
        break;
      default:
        break;
    }
  }
  return out;
}

/** The game-over cue when the snapshot is at GAME_OVER, else null. Winners = ranking[0]. */
export function gameOverCue(snapshot: GameSnapshot): Cue | null {
  if (snapshot.phase !== Phase.GAME_OVER) return null;
  const me = snapshot.you?.playerId ?? null;
  const winners = snapshot.finalScores?.ranking[0]?.playerIds ?? [];
  return me !== null && winners.includes(me) ? 'gameOverWin' : 'gameOverNormal';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @trm/web test --run soundModel`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/sound/soundModel.ts apps/web/src/sound/soundModel.test.ts
git commit -m "Web sound: pure event/snapshot -> cue model"
```

---

### Task 3: UI store sound prefs

**Files:**

- Modify: `apps/web/src/store/ui.ts`
- Modify: `apps/web/src/store/ui.test.ts`

**Interfaces:**

- Produces (on `useUi`): state `soundEnabled: boolean`, `soundVolume: number`; actions `setSoundEnabled(on: boolean): void`, `setSoundVolume(v: number): void`. localStorage keys `trm.soundEnabled` (`'1'`/`'0'`) and `trm.soundVolume` (stringified 0–1).

- [ ] **Step 1: Write the failing test** (append to `apps/web/src/store/ui.test.ts`)

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useUi } from './ui';

describe('sound preferences', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to enabled at 0.6', () => {
    expect(useUi.getState().soundEnabled).toBe(true);
    expect(useUi.getState().soundVolume).toBeCloseTo(0.6);
  });

  it('persists enabled + volume to localStorage', () => {
    useUi.getState().setSoundEnabled(false);
    useUi.getState().setSoundVolume(0.25);
    expect(useUi.getState().soundEnabled).toBe(false);
    expect(useUi.getState().soundVolume).toBeCloseTo(0.25);
    expect(localStorage.getItem('trm.soundEnabled')).toBe('0');
    expect(localStorage.getItem('trm.soundVolume')).toBe('0.25');
  });

  it('clamps volume to 0..1', () => {
    useUi.getState().setSoundVolume(5);
    expect(useUi.getState().soundVolume).toBe(1);
    useUi.getState().setSoundVolume(-1);
    expect(useUi.getState().soundVolume).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/web test --run ui`
Expected: FAIL — `setSoundEnabled is not a function` / undefined state.

- [ ] **Step 3: Implement in `apps/web/src/store/ui.ts`**

3a. Add key constants beside the existing ones (after `const BOARD_LAYOUT_KEY = ...`):

```ts
const SOUND_ENABLED_KEY = 'trm.soundEnabled';
const SOUND_VOLUME_KEY = 'trm.soundVolume';
```

3b. Add readers beside `readBoardLayout`:

```ts
const readSoundEnabled = (): boolean => {
  try {
    const v = localStorage.getItem(SOUND_ENABLED_KEY);
    return v === null ? true : v === '1';
  } catch {
    return true;
  }
};
const readSoundVolume = (): number => {
  try {
    const v = Number(localStorage.getItem(SOUND_VOLUME_KEY));
    return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.6;
  } catch {
    return 0.6;
  }
};
```

3c. Add to the `UiState` interface (beside `boardLayout`/`setBoardLayout`):

```ts
  soundEnabled: boolean;
  soundVolume: number;
  setSoundEnabled(soundEnabled: boolean): void;
  setSoundVolume(soundVolume: number): void;
```

3d. Seed initial state (beside `boardLayout: readBoardLayout(),`):

```ts
  soundEnabled: readSoundEnabled(),
  soundVolume: readSoundVolume(),
```

3e. Add the setters (beside `setBoardLayout`):

```ts
  setSoundEnabled: (soundEnabled) => {
    writeLocal(SOUND_ENABLED_KEY, soundEnabled ? '1' : '0');
    set({ soundEnabled });
  },
  setSoundVolume: (soundVolume) => {
    const v = Math.max(0, Math.min(1, soundVolume));
    writeLocal(SOUND_VOLUME_KEY, String(v));
    set({ soundVolume: v });
  },
```

> Do NOT touch `applyPreferences` / `UserPreferences` — sound is per-device only.

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @trm/web test --run ui`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/store/ui.ts apps/web/src/store/ui.test.ts
git commit -m "Web sound: per-device soundEnabled/soundVolume in ui store"
```

---

### Task 4: Web-Audio player

**Files:**

- Create: `apps/web/src/sound/player.ts`
- Test: `apps/web/src/sound/player.test.ts`

**Interfaces:**

- Consumes: `CUES`, `ALL_CUES`, `Cue` from `./cues`.
- Produces: `interface SoundPlayer { preload(): Promise<void>; unlock(): void; play(cue: Cue, gainScale?: number): void; setEnabled(on: boolean): void; setVolume(v: number): void }`; `createSoundPlayer(opts?): SoundPlayer` (test seam); `const soundPlayer: SoundPlayer` (app singleton).

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/sound/player.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSoundPlayer } from './player';

function mockContext() {
  const starts: ReturnType<typeof vi.fn>[] = [];
  const ctx = {
    state: 'suspended' as AudioContextState,
    destination: {},
    resume: vi.fn(function (this: { state: string }) {
      this.state = 'running';
      return Promise.resolve();
    }),
    createGain: () => ({ gain: { value: 0 }, connect: (n: unknown) => n }),
    createBufferSource: () => {
      const start = vi.fn();
      starts.push(start);
      return { buffer: null as unknown, connect: (n: unknown) => n, start };
    },
    decodeAudioData: () => Promise.resolve({ duration: 1 } as unknown as AudioBuffer),
  };
  return { ctx, starts };
}

beforeEach(() => {
  // @ts-expect-error test shim
  global.fetch = vi
    .fn()
    .mockResolvedValue({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
});

describe('sound player', () => {
  it('no-ops when no AudioContext is available', async () => {
    const p = createSoundPlayer({ createContext: () => null });
    await p.preload();
    expect(() => p.play('cardDraw')).not.toThrow();
  });

  it('plays a preloaded cue once and throttles a rapid repeat', async () => {
    const { ctx, starts } = mockContext();
    let t = 0;
    const p = createSoundPlayer({
      createContext: () => ctx as unknown as AudioContext,
      now: () => t,
    });
    await p.preload();
    p.play('cardDraw'); // t=0 → plays
    t = 10;
    p.play('cardDraw'); // within 55ms throttle → dropped
    t = 100;
    p.play('cardDraw'); // → plays
    expect(starts.filter((s) => s.mock.calls.length > 0).length).toBe(2);
  });

  it('does not play when disabled', async () => {
    const { ctx, starts } = mockContext();
    const p = createSoundPlayer({
      createContext: () => ctx as unknown as AudioContext,
      now: () => 0,
    });
    await p.preload();
    p.setEnabled(false);
    p.play('cardDraw');
    expect(starts.every((s) => s.mock.calls.length === 0)).toBe(true);
  });

  it('unlock resumes a suspended context', () => {
    const { ctx } = mockContext();
    const p = createSoundPlayer({ createContext: () => ctx as unknown as AudioContext });
    p.unlock();
    expect(ctx.resume).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/web test --run player`
Expected: FAIL — cannot find module `./player`.

- [ ] **Step 3: Implement the player**

```ts
// apps/web/src/sound/player.ts
import { ALL_CUES, CUES, type Cue } from './cues';

export interface SoundPlayer {
  preload(): Promise<void>;
  unlock(): void;
  play(cue: Cue, gainScale?: number): void;
  setEnabled(on: boolean): void;
  setVolume(v: number): void;
}

interface Opts {
  /** Factory for the AudioContext (overridable in tests). Returns null when unavailable. */
  createContext?: () => AudioContext | null;
  /** Monotonic clock in ms (overridable in tests). */
  now?: () => number;
}

const defaultCreateContext = (): AudioContext | null => {
  const AC =
    (
      globalThis as unknown as {
        AudioContext?: typeof AudioContext;
        webkitAudioContext?: typeof AudioContext;
      }
    ).AudioContext ??
    (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  try {
    return AC ? new AC() : null;
  } catch {
    return null;
  }
};

export function createSoundPlayer(opts: Opts = {}): SoundPlayer {
  const createContext = opts.createContext ?? defaultCreateContext;
  const now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : 0));

  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let triedContext = false;
  let enabled = true;
  let volume = 0.6;
  const buffers = new Map<Cue, AudioBuffer>();
  const lastPlayed = new Map<Cue, number>();

  const ensureContext = (): AudioContext | null => {
    if (ctx || triedContext) return ctx;
    triedContext = true;
    ctx = createContext();
    if (ctx) {
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(ctx.destination);
    }
    return ctx;
  };

  return {
    async preload() {
      const c = ensureContext();
      if (!c) return;
      await Promise.all(
        ALL_CUES.map(async (cue) => {
          if (buffers.has(cue)) return;
          try {
            const res = await fetch(CUES[cue].src);
            const arr = await res.arrayBuffer();
            buffers.set(cue, await c.decodeAudioData(arr));
          } catch {
            /* leave undecoded — that cue simply won't play */
          }
        }),
      );
    },

    unlock() {
      const c = ensureContext();
      if (c && c.state === 'suspended') void c.resume();
    },

    play(cue, gainScale = 1) {
      if (!enabled) return;
      const c = ctx;
      if (!c || !master) return;
      const def = CUES[cue];
      const t = now();
      if (t - (lastPlayed.get(cue) ?? -Infinity) < def.throttleMs) return;
      const buf = buffers.get(cue);
      if (!buf) return;
      lastPlayed.set(cue, t);
      if (c.state === 'suspended') void c.resume();
      const src = c.createBufferSource();
      src.buffer = buf;
      const g = c.createGain();
      g.gain.value = def.gain * gainScale;
      src.connect(g).connect(master);
      src.start();
    },

    setEnabled(on) {
      enabled = on;
    },

    setVolume(v) {
      volume = Math.max(0, Math.min(1, v));
      if (master) master.gain.value = volume;
    },
  };
}

/** App-wide singleton. In jsdom (no AudioContext) every method is a safe no-op. */
export const soundPlayer = createSoundPlayer();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @trm/web test --run player`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/sound/player.ts apps/web/src/sound/player.test.ts
git commit -m "Web sound: Web-Audio player (preload, throttle, gesture unlock)"
```

---

### Task 5: Sound driver hook + GameScreen wiring

**Files:**

- Create: `apps/web/src/hooks/useSoundDriver.ts`
- Create: `apps/web/src/hooks/useSoundDriver.test.tsx`
- Modify: `apps/web/src/screens/GameScreen.tsx`

**Interfaces:**

- Consumes: `useGame` (`snapshot`, `lastBatch`) from `../store/game`; `useUi` (`soundEnabled`, `soundVolume`) from `../store/ui`; `soundPlayer` + `OPPONENT_GAIN`; `cuesFromEvents`, `gameOverCue`; `completedByPlayer` from `../game/tickets`.
- Produces: `useSoundDriver(): void`.

Background: `lastBatch` is `{ seq: number; events: GameEvent[] } | null` (verified in `store/game.ts`). `completedByPlayer(snapshot)` returns `Map<string, Set<string>>` from `snapshot.completedTickets`. The animation driver uses the same first-snapshot-seeds-without-firing guard.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/hooks/useSoundDriver.test.tsx
// Follows the repo convention (see useAnimationDriver.test.tsx): a <Harness/> component, real
// snapshots via create(GameSnapshotSchema), and useGame.getState().applySnapshot/applyEvents.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { create } from '@bufbuild/protobuf';
import { GameSnapshotSchema, Phase, type GameEvent, type GameSnapshot } from '@trm/proto';
import { useGame } from '../store/game';
import { useSoundDriver } from './useSoundDriver';

const play = vi.fn();
vi.mock('../sound/player', () => ({
  soundPlayer: {
    preload: vi.fn().mockResolvedValue(undefined),
    unlock: vi.fn(),
    play,
    setEnabled: vi.fn(),
    setVolume: vi.fn(),
  },
}));

function snap(
  version: number,
  opts: { phase?: Phase; completed?: { p: string; t: string }[]; winners?: string[] } = {},
): GameSnapshot {
  return create(GameSnapshotSchema, {
    stateVersion: version,
    players: [
      { id: 'p0', seat: 0 },
      { id: 'p1', seat: 1 },
    ],
    you: { playerId: 'p0' },
    ...(opts.phase === undefined ? {} : { phase: opts.phase }),
    completedTickets: (opts.completed ?? []).map((c) => ({ playerId: c.p, ticketId: c.t })),
    ...(opts.winners ? { finalScores: { ranking: [{ playerIds: opts.winners }] } } : {}),
  });
}

function Harness() {
  useSoundDriver();
  return null;
}

beforeEach(() => {
  play.mockClear();
  useGame.getState().reset();
});

describe('useSoundDriver', () => {
  it('does not fire game-over on the first snapshot (resume safety)', () => {
    render(<Harness />);
    act(() =>
      useGame.getState().applySnapshot(snap(1, { phase: Phase.GAME_OVER, winners: ['p0'] })),
    );
    expect(play).not.toHaveBeenCalledWith('gameOverWin');
  });

  it('fires gameOverWin on the transition into GAME_OVER', () => {
    render(<Harness />);
    act(() => useGame.getState().applySnapshot(snap(1, {})));
    act(() =>
      useGame.getState().applySnapshot(snap(2, { phase: Phase.GAME_OVER, winners: ['p0'] })),
    );
    expect(play).toHaveBeenCalledWith('gameOverWin');
  });

  it('plays card-draw cues from an event batch (opponent attenuated)', () => {
    render(<Harness />);
    act(() => useGame.getState().applySnapshot(snap(1, {})));
    const ev: GameEvent = {
      event: { case: 'cardDrawnBlind', value: { playerId: 'p1' } },
    } as GameEvent;
    act(() => useGame.getState().applyEvents(2, [ev]));
    expect(play).toHaveBeenCalledWith('cardDraw', 0.5);
  });

  it('plays missionComplete when a kept ticket newly completes for me', () => {
    render(<Harness />);
    act(() => useGame.getState().applySnapshot(snap(1, {})));
    act(() => useGame.getState().applySnapshot(snap(2, { completed: [{ p: 'p0', t: 't1' }] })));
    expect(play).toHaveBeenCalledWith('missionComplete');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/web test --run useSoundDriver`
Expected: FAIL — cannot find module `./useSoundDriver`.

- [ ] **Step 3: Implement the hook**

```ts
// apps/web/src/hooks/useSoundDriver.ts
import { useEffect, useRef } from 'react';
import { Phase } from '@trm/proto';
import { useGame } from '../store/game';
import { useUi } from '../store/ui';
import { soundPlayer } from '../sound/player';
import { OPPONENT_GAIN } from '../sound/cues';
import { cuesFromEvents, gameOverCue } from '../sound/soundModel';
import { completedByPlayer } from '../game/tickets';

const EMPTY: ReadonlySet<string> = new Set();

/**
 * Single sound driver, mounted once in GameScreen beside useAnimationDriver. Plays cues from the
 * event stream and from snapshot diffs (game-over once on transition; mission-complete on a new
 * own-track completion). The first snapshot only seeds refs, so reconnect/resume never replays a
 * stale win-horn or mission flourish.
 */
export function useSoundDriver(): void {
  const snapshot = useGame((s) => s.snapshot);
  const lastBatch = useGame((s) => s.lastBatch);

  const seenBatchSeq = useRef(0);
  const prevPhase = useRef<Phase | null>(null);
  const prevSelfCompleted = useRef<ReadonlySet<string> | null>(null);

  // Preload + first-gesture unlock + keep the player synced with the per-device sound prefs.
  useEffect(() => {
    void soundPlayer.preload();
    const { soundEnabled, soundVolume } = useUi.getState();
    soundPlayer.setEnabled(soundEnabled);
    soundPlayer.setVolume(soundVolume);
    const unsub = useUi.subscribe((s) => {
      soundPlayer.setEnabled(s.soundEnabled);
      soundPlayer.setVolume(s.soundVolume);
    });
    const unlock = () => soundPlayer.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      unsub();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  // Event-driven cues (draws, turn cue, station, route).
  useEffect(() => {
    if (!lastBatch || lastBatch.seq === seenBatchSeq.current) return;
    seenBatchSeq.current = lastBatch.seq;
    const snap = useGame.getState().snapshot;
    if (!snap) return;
    for (const { cue, isSelf } of cuesFromEvents(snap, lastBatch.events)) {
      soundPlayer.play(cue, isSelf ? 1 : OPPONENT_GAIN);
    }
  }, [lastBatch]);

  // Snapshot diffs: game-over (once) + self mission completion.
  useEffect(() => {
    if (!snapshot) {
      prevPhase.current = null;
      prevSelfCompleted.current = null;
      return;
    }
    const me = snapshot.you?.playerId ?? null;
    const selfCompleted = (me ? completedByPlayer(snapshot).get(me) : null) ?? EMPTY;

    if (prevSelfCompleted.current === null) {
      // First snapshot (or after reset): seed without firing.
      prevSelfCompleted.current = selfCompleted;
      prevPhase.current = snapshot.phase;
      return;
    }

    for (const id of selfCompleted) {
      if (!prevSelfCompleted.current.has(id)) {
        soundPlayer.play('missionComplete');
        break;
      }
    }
    prevSelfCompleted.current = selfCompleted;

    if (prevPhase.current !== Phase.GAME_OVER && snapshot.phase === Phase.GAME_OVER) {
      const cue = gameOverCue(snapshot);
      if (cue) soundPlayer.play(cue);
    }
    prevPhase.current = snapshot.phase;
  }, [snapshot]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @trm/web test --run useSoundDriver`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire into GameScreen**

In `apps/web/src/screens/GameScreen.tsx`, add the import beside the animation-driver import:

```ts
import { useSoundDriver } from '../hooks/useSoundDriver';
```

and call it immediately after `useAnimationDriver();` (around line 58):

```ts
// Translate events + snapshot diffs into animations (claim glow, draws, fanfare, …).
useAnimationDriver();
// Translate the same streams into sound effects.
useSoundDriver();
```

- [ ] **Step 6: Verify the app still type-checks and tests pass**

Run: `yarn workspace @trm/web test --run GameScreen` (if present) and `yarn typecheck`
Expected: PASS / no type errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/hooks/useSoundDriver.ts apps/web/src/hooks/useSoundDriver.test.tsx apps/web/src/screens/GameScreen.tsx
git commit -m "Web sound: useSoundDriver hook, mounted in GameScreen"
```

---

### Task 6: Settings sound section

**Files:**

- Modify: `apps/web/src/components/SettingsModal.tsx`
- Modify: `apps/web/src/i18n/index.ts`
- Modify: `apps/web/src/components/SettingsModal.test.tsx`

**Interfaces:**

- Consumes: `useUi` (`soundEnabled`, `soundVolume`, `setSoundEnabled`, `setSoundVolume`); i18n keys `sound`, `volume`.
- Produces: a "Sound" `<section>` in the settings modal — a `role="switch"` mute toggle and a `type="range"` volume slider (disabled when muted). Persists via the ui setters (localStorage); NOT via `savePreferences`.

- [ ] **Step 1: Write the failing test** (append to `apps/web/src/components/SettingsModal.test.tsx`)

Append a new `describe` block to the existing file (it already `vi.mock`s `../net/connection` and imports `../i18n`, both of which this block relies on):

```tsx
import { useSession } from '../store/session';

describe('SettingsModal sound section', () => {
  beforeEach(() => {
    localStorage.clear();
    useSession.setState({ savePreferences: vi.fn() });
    useUi.setState({
      theme: 'system',
      colorBlind: false,
      locale: 'zh-Hant',
      boardLayout: 'rail',
      soundEnabled: true,
      soundVolume: 0.6,
    });
  });

  it('toggles mute and writes through to the store', () => {
    render(<SettingsModal onClose={() => undefined} />);
    const sw = screen.getByRole('switch', { name: /sound|音效/i });
    expect(sw).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(sw);
    expect(useUi.getState().soundEnabled).toBe(false);
  });

  it('changes volume via the slider', () => {
    render(<SettingsModal onClose={() => undefined} />);
    const slider = screen.getByRole('slider', { name: /volume|音量/i });
    fireEvent.change(slider, { target: { value: '0.3' } });
    expect(useUi.getState().soundVolume).toBeCloseTo(0.3);
  });
});
```

(`describe`, `it`, `expect`, `beforeEach`, `vi`, `render`, `screen`, `fireEvent`, `SettingsModal`, and `useUi` are already imported at the top of the existing test file; add only the `useSession` import.)

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/web test --run SettingsModal`
Expected: FAIL — no switch named "sound" / no slider.

- [ ] **Step 3: Add i18n strings** in `apps/web/src/i18n/index.ts`

Find the zh-Hant resource block and add (beside `colorBlind`):

```ts
      sound: '音效',
      volume: '音量',
```

Find the en resource block and add the same keys:

```ts
      sound: 'Sound',
      volume: 'Volume',
```

- [ ] **Step 4: Add the section** in `apps/web/src/components/SettingsModal.tsx`

4a. Extend the store selectors near the top of the component (beside `boardLayout`/`setBoardLayout`):

```ts
const soundEnabled = useUi((s) => s.soundEnabled);
const soundVolume = useUi((s) => s.soundVolume);
const setSoundEnabled = useUi((s) => s.setSoundEnabled);
const setSoundVolume = useUi((s) => s.setSoundVolume);
```

4b. Add this section just before the closing `</div>` of the modal body (after the colour-blind `<section>`):

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
  <button
    type="button"
    role="switch"
    aria-checked={soundEnabled}
    aria-label={t('sound')}
    className={soundEnabled ? 'switch on' : 'switch'}
    onClick={() => setSoundEnabled(!soundEnabled)}
  >
    <span className="switch-knob" />
  </button>
</section>
```

> Reuses the existing `switch`/`switch-knob`/`setting-row` classes from the colour-blind toggle, so no new CSS is required. The slider uses the browser default `accent-color` from the theme.

- [ ] **Step 5: Run test to verify it passes**

Run: `yarn workspace @trm/web test --run SettingsModal`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/SettingsModal.tsx apps/web/src/components/SettingsModal.test.tsx apps/web/src/i18n/index.ts
git commit -m "Web sound: Settings mute switch + volume slider (per-device)"
```

---

### Task 7: TunnelModal cues

**Files:**

- Modify: `apps/web/src/components/TunnelModal.tsx`
- Create: `apps/web/src/components/TunnelModal.test.tsx`

**Interfaces:**

- Consumes: `soundPlayer` from `../sound/player`; existing `REVEAL_STAGGER_MS`, `reduced`, `showResult`, props `revealed`, `extraRequired`.
- Behaviour: on reveal, play `tunnelDraw` once per revealed card (staggered by `REVEAL_STAGGER_MS`; immediately once under reduced motion). When the result appears, play `tunnelSuccess` if `extraRequired === 0` else `tunnelPayment` (exactly once per mount).

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/components/TunnelModal.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { CardColor } from '@trm/proto';
import { TunnelModal } from './TunnelModal';

const play = vi.fn();
vi.mock('../sound/player', () => ({
  soundPlayer: { play, preload: vi.fn(), unlock: vi.fn(), setEnabled: vi.fn(), setVolume: vi.fn() },
}));
// Force the immediate (reduced-motion) path so the result cue fires synchronously.
vi.mock('../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));

const revealed = [CardColor.RED, CardColor.BLUE, CardColor.RED];

beforeEach(() => play.mockClear());

describe('TunnelModal cues', () => {
  it('plays tunnelSuccess when no surcharge is required', () => {
    render(
      <TunnelModal
        revealed={revealed}
        extraRequired={0}
        options={[]}
        onCommit={() => {}}
        onAbort={() => {}}
      />,
    );
    expect(play).toHaveBeenCalledWith('tunnelDraw');
    expect(play).toHaveBeenCalledWith('tunnelSuccess');
    expect(play).not.toHaveBeenCalledWith('tunnelPayment');
  });

  it('plays tunnelPayment when a surcharge is required', () => {
    render(
      <TunnelModal
        revealed={revealed}
        extraRequired={2}
        options={[]}
        onCommit={() => {}}
        onAbort={() => {}}
      />,
    );
    expect(play).toHaveBeenCalledWith('tunnelPayment');
    expect(play).not.toHaveBeenCalledWith('tunnelSuccess');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/web test --run TunnelModal`
Expected: FAIL — `play` not called (no sound wired yet).

- [ ] **Step 3: Implement in `apps/web/src/components/TunnelModal.tsx`**

3a. Add the import (beside the `TrainCarCard` import):

```ts
import { soundPlayer } from '../sound/player';
```

3b. Add a ref beside the `showResult` state:

```ts
// Fire the success/payment cue exactly once per opened tunnel.
const resultCuePlayed = useRef(false);
```

(ensure `useRef` is in the existing `react` import: `import { useEffect, useRef, useState, type CSSProperties } from 'react';`)

3c. Add a reveal-sound effect right after the existing reveal-timer `useEffect`:

```ts
// Card-placement tick per revealed tunnel card, synced to the flip stagger.
useEffect(() => {
  if (reduced) {
    soundPlayer.play('tunnelDraw');
    return;
  }
  const timers = revealed.map((_, i) =>
    window.setTimeout(() => soundPlayer.play('tunnelDraw'), i * REVEAL_STAGGER_MS),
  );
  return () => timers.forEach((id) => clearTimeout(id));
}, [revealed, reduced]);

// Result cue once the surcharge outcome is shown.
useEffect(() => {
  if (showResult && !resultCuePlayed.current) {
    resultCuePlayed.current = true;
    soundPlayer.play(extraRequired === 0 ? 'tunnelSuccess' : 'tunnelPayment');
  }
}, [showResult, extraRequired]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @trm/web test --run TunnelModal`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/TunnelModal.tsx apps/web/src/components/TunnelModal.test.tsx
git commit -m "Web sound: tunnel reveal (x3) + success/payment cues"
```

---

### Task 8: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Lint, typecheck, and the full web test suite**

Run:

```bash
yarn workspace @trm/web test --run
yarn typecheck
yarn workspace @trm/web lint
```

Expected: all green. (The new audio code is `apps/web`-only; no proto/engine drift.)

- [ ] **Step 2: Manual smoke test against a bots game**

```bash
docker compose up -d mongo
yarn workspace @trm/server dev    # one terminal
yarn workspace @trm/web dev       # another; open http://localhost:5173
```

Start a game with bots and confirm:

- card draw / station / railway cues fire for **all** players (opponents quieter);
- the "your turn" chime fires only on your turn;
- claiming a tunnel: 3 card ticks during the reveal, then the success **or** payment cue;
- completing one of your tickets plays the mission cue;
- the game-over screen plays the win horn (when you win) or the violin ending (when you don't);
- Settings → Sound: muting silences everything; the volume slider scales live; both survive a reload (localStorage).

- [ ] **Step 3: Final commit (if any manual-fix tweaks were needed)**

```bash
git add -A
git commit -m "Web sound: verification tweaks"
```

---

## Self-Review

**Spec coverage** (against `2026-06-28-sound-effects-design.md` + Revision 1):

- 10 cues, correct files → Task 1 (catalog) + Revision 1 mapping. ✅
- Events→cues, game-over win/normal → Task 2. ✅
- Per-device localStorage prefs (not `UserPreferences`) → Task 3. ✅
- Web-Audio player: decode-once, master gain, gesture unlock, throttle, jsdom-safe → Task 4. ✅
- Driver: event cues, first-snapshot seed, game-over once, self mission diff, store sync → Task 5. ✅
- Settings mute + volume → Task 6. ✅
- Tunnel per-card ×3 + success/payment owned by `TunnelModal` → Task 7. ✅
- "All players" scope with opponent attenuation → Task 1 (`OPPONENT_GAIN`) + Task 5. ✅
- Tests (model, player, ui, driver, settings, tunnel) → Tasks 2–7; full verify → Task 8. ✅
- Out of scope (account sync, music, per-cue custom) — not implemented. ✅

**Placeholder scan:** No TBD/TODO; every code step shows full code; commands have expected outcomes. ✅

**Type consistency:** `Cue`, `CueDef`, `CUES`, `ALL_CUES`, `OPPONENT_GAIN` (Task 1) are used with identical names in Tasks 2/4/5. `SoundPlayer` method names (`preload`/`unlock`/`play`/`setEnabled`/`setVolume`) match between Task 4, the Task 5 mock, and the Task 7 mock. `cuesFromEvents`/`gameOverCue`/`CueHit` (Task 2) match their Task 5 usage. `setSoundEnabled`/`setSoundVolume`/`soundEnabled`/`soundVolume` (Task 3) match Tasks 5 and 6. ✅
