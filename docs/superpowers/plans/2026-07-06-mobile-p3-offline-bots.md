# Mobile P3 — Offline vs Bots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **REGROUND BEFORE EXECUTING:** this plan was written at spec time (2026-07-06). Before executing, re-verify library versions, file anchors, and the Consumes list against the then-current repo — prior phases will have moved things.

**Goal:** Ship fully-offline play against 1–4 bots in the mobile app: extract the pure bot brain into a new `packages/bots` workspace (`@trm/bots`) shared by the server driver and the app; build a `LocalGameSession` in `apps/mobile` that mirrors the server's prepare→persist→commit loop on the real `@trm/engine`; persist every game as an event-sourced config + action log in expo-sqlite with digest-verified resume and corrupt-tail discard; and surface it all through a Home "Play vs Bots" entry, an in-progress resume list, and an offline banner over online features (the Apple 4.2 reviewer path: the app is demonstrably useful in airplane mode).

**Architecture:** Two halves. (1) A **pure-move refactor**: `apps/server/src/bots/{policy,types}.ts` become `packages/bots/src/` unchanged (the policy imports only `@trm/engine` + `@trm/shared`, so it is already runtime-agnostic); the server's seven source imports and five test imports swap to `@trm/bots`, gated by the full server suite. (2) A **serverless game loop** in `apps/mobile/src/offline/`: `LocalGameSession` owns a `GameState` exactly like the server's `GameSession` (`apps/server/src/game/game-session.ts`), applies the human's actions and `chooseBotAction` picks through the same write-ahead order the hub uses (append to the log **before** committing to memory — `apps/server/src/ws/hub.ts` step 5), and the UI only ever sees `redactFor(human)` → `viewToSnapshot` fed into the SAME isolated game/log stores and `GameStage` that P2 built — the pattern the web replay feature (`apps/web/src/features/replay/useReplayPlayer.ts`) and tutorial sandbox (`apps/web/src/net/sandboxSocket.ts`) already prove. Randomness (game seed, game id) comes from `expo-crypto` **outside** the engine, exactly as `randomUUID()` seeds games in `LobbyService.start`. Persistence mirrors `MongoGameStore` semantics on sqlite: `(game_id, seq)` primary key as the double-apply guard, per-action `stateDigest`, digest-verified replay on resume — but where server recovery **aborts** on divergence, offline resume **truncates** the corrupt tail and continues from the last good state (spec: never crash into a corrupt game).

**Tech Stack:** `@trm/bots` (new, TS-source workspace package, vitest); `apps/mobile` (Expo SDK 56 / RN / React 19, jest-expo from P1); `expo-sqlite` (async API), `expo-crypto` (seed/id randomness), `@react-native-community/netinfo` (offline posture); shared packages `@trm/engine`, `@trm/map-data`, `@trm/codec`, `@trm/proto`, `@trm/shared` used as-is.

## Global Constraints

- **Yarn 4 (Corepack), `nodeLinker: node-modules`** — required by Metro; never change the linker.
- **swc, never tsx/esbuild** for the server (`yarn workspace @trm/server dev` runs `@swc-node/register`; tests via `unplugin-swc`). This plan's server change is import-path-only — do not touch the toolchain.
- **Engine purity is structural**: nothing in `packages/engine` (or anything this plan adds) may introduce wall-clock or unseeded randomness into game logic. The offline seed comes from `expo-crypto` and enters the engine only as `GameConfig.seed` — the same boundary the server uses.
- **Hidden info is structural**: the offline UI consumes only `redactFor(human)` → `viewToSnapshot`. Never hand `GameState` (which holds bot hands in cleartext) to a component. On-device cleartext bot hands are accepted (offline anti-cheat is a non-goal, below).
- **PURPLE never PINK**; seat colours stay abstract indices 0–4.
- **Vite ^5 pin** in `apps/web` (untouched here — do not bump while editing web docs/files).
- **zh-Hant primary + en** for every new user-facing string.
- **Never `git add -A` / `git add .`** — stage only files this plan touches (other agents may share the worktree). Run `yarn prettier --write <files-you-touched>` before each commit (`yarn format:check` is the CI gate; never repo-wide `yarn format` in a shared tree).
- Mobile workspace/test contract (from P1): workspace name **`@trm/mobile`**, jest-expo runner via `yarn workspace @trm/mobile test [pattern]`, jest-expo transpiles the TS-source `@trm/*` packages (transformIgnorePatterns allowlist). Verify before Task 2: `node -p "require('./apps/mobile/package.json').name"` and `yarn workspace @trm/mobile test --listTests`. If P1 configured `injectGlobals: false`, add `import { describe, expect, it } from '@jest/globals'` to the new test files.
- Turbo needs **no config change** for the new package: `turbo.json` tasks are generic (`typecheck`/`lint`/`test` run whatever scripts each workspace declares; `@trm/bots` has no `build`, like every TS-source package).

## Non-goals (explicit, from the spec)

- **Offline anti-cheat** — the local `GameState` holds bot hands in cleartext; casual play, no rankings.
- **Custom-map offline play** — v1 offline uses **bundled official maps only** (`OFFICIAL_MAPS`); the content-hash cache for downloaded custom maps is tracked in `docs/TODO.md`.
- **Pass-and-play** — hidden-information handoff UX needs its own design (`docs/TODO.md`).
- Also unchanged: replay viewer (v1.1), spectating, turn timers/AFK.

## Consumes (exact names assumed from prior phases — re-verify each)

| Artifact | From | Verify with |
| --- | --- | --- |
| `apps/mobile` workspace `@trm/mobile`, jest-expo, shims, React Navigation 7 native-stack | P1 | `node -p "require('./apps/mobile/package.json').name"` |
| `apps/mobile/src/navigation/types.ts` exporting `RootStackParamList`; `apps/mobile/src/screens/HomeScreen.tsx` | P1 | `Grep RootStackParamList apps/mobile/src` |
| `apps/mobile/src/i18n/index.ts` (zh-Hant + en resource tables, web idiom) | P1 | open the file |
| `apps/mobile/src/store/game.ts`: `createGameStore`, `GameStoreApi`, `GameStoreProvider`, `useGameStoreApi`, actions `applySnapshot/applyEvents/setRejection/reset` (web parity with `apps/web/src/store/game.ts`) | P2 | `Grep createGameStore apps/mobile/src/store` |
| `apps/mobile/src/store/log.ts`: `createLogStore`, `LogStoreApi`, `LogStoreProvider`, `useLogStoreApi`, actions `ingestHistory/ingestLive/reset` | P2 | `Grep createLogStore apps/mobile/src/store` |
| `apps/mobile/src/store/sandboxProvider.tsx` (port of `apps/web/src/store/sandboxProvider.tsx`) — **if P2 did not port it, Task 5 creates it** | P2 | `Glob apps/mobile/src/store/sandboxProvider.tsx` |
| `apps/mobile/src/net/commands.ts` exporting `GameCommands` (verbatim port of `apps/web/src/net/commands.ts`); `apps/mobile/src/net/socket.ts` exporting `PaymentInit`, `CameraViewInit` | P2 | `Grep "interface GameCommands" apps/mobile/src/net` |
| `apps/mobile/src/screens/GameStage.tsx` accepting `commands: GameCommands`, `sandbox?: boolean`, rendering the final ScoreBoard on `Phase.GAME_OVER` (web parity: `apps/web/src/screens/GameStage.tsx:513`) — this IS the "victory UI" P3 reuses | P2 | `Grep "sandbox" apps/mobile/src/screens/GameStage.tsx` |
| Server P0 mobile surface (auth/push/version) — **not used by offline play**; no new server endpoints in this plan | P0 | — |

If a Consumes name moved, adapt the **call site** in this plan's files; never fork a P2 component.

---

### Task 1: Extract `@trm/bots` from `apps/server` (server import swap included)

The policy and types move verbatim (git mv — history preserved). The package gets its own determinism spec (there were no pure policy unit tests to move — the five bot e2e specs test the *driver* and stay in `apps/server/test`, with their type imports swapped to the package). ESLint gains a determinism guard for the package; turbo needs nothing.

**Files:**

- Create: `packages/bots/package.json`, `packages/bots/tsconfig.json`, `packages/bots/src/index.ts`, `packages/bots/test/policy.spec.ts`, `packages/bots/CLAUDE.md`
- Move (git mv): `apps/server/src/bots/policy.ts` → `packages/bots/src/policy.ts`; `apps/server/src/bots/types.ts` → `packages/bots/src/types.ts`
- Modify: `eslint.config.mjs` (determinism block for `packages/bots/src`)
- Modify (import swap only): `apps/server/src/ws/hub.ts:32-33`, `apps/server/src/push/push.service.ts:2`, `apps/server/src/persistence/types.ts:9`, `apps/server/src/persistence/game-store.ts:9`, `apps/server/src/history/history.repo.ts:14`, `apps/server/src/lobby/lobby.service.ts:28`, `apps/server/src/lobby/room.repo.ts:6`, `apps/server/test/push-hub.e2e.spec.ts:7`, `apps/server/test/bots.e2e.spec.ts:14`, `apps/server/test/bots-events.e2e.spec.ts:13`, `apps/server/test/bots-5p.e2e.spec.ts:13`, `apps/server/test/bot-driver-resilience.e2e.spec.ts:7`
- Modify: `apps/server/package.json` (add dependency)

**Interfaces:**

- Consumes: `legalActions`, engine types (`Action`, `Board`, `GameState`) from `@trm/engine`; `TRAIN_COLORS`, id types from `@trm/shared`.
- Produces (the package's entire public API — the exact names the server uses today and `LocalGameSession` will use in Task 2):
  - `chooseBotAction(board: Board, state: GameState, botId: PlayerId, difficulty: BotDifficulty): Action | null`
  - `type BotDifficulty = 'EASY' | 'MEDIUM' | 'HARD'`; `BOT_DIFFICULTIES: readonly BotDifficulty[]`
  - `interface BotProfile { readonly playerId: string; readonly difficulty: BotDifficulty }`
  - `BOT_ID_PREFIX = 'bot:'`; `isBotId(id: string): boolean`

- [ ] **Step 1: Scaffold the package + write the failing test**

`packages/bots/package.json` (TS-source exports map — identical idiom to `packages/engine`):

```json
{
  "name": "@trm/bots",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "sideEffects": false,
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./src/index.ts"
    }
  },
  "dependencies": {
    "@trm/engine": "workspace:*",
    "@trm/shared": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.7.3",
    "vitest": "^2.1.8"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src test"
  }
}
```

`packages/bots/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": ".",
    "noEmit": true
  },
  "include": ["src", "test"]
}
```

`packages/bots/test/policy.spec.ts` (imports `../src` like `packages/codec/test/codec.spec.ts` does):

```ts
import { describe, it, expect } from 'vitest';
import { initGame, legalActions, reduce, taiwanBoard, CONTENT_HASH } from '@trm/engine';
import type { Board, GameConfig, GameState } from '@trm/engine';
import { asPlayerId } from '@trm/shared';
import { chooseBotAction, isBotId, BOT_ID_PREFIX, BOT_DIFFICULTIES } from '../src';

const A = asPlayerId('bot:a');
const B = asPlayerId('bot:b');

function driveToCompletion(seed: string): GameState {
  const board: Board = taiwanBoard();
  const config: GameConfig = {
    seed,
    players: [
      { id: A, seat: 0 },
      { id: B, seat: 1 },
    ],
    contentHash: CONTENT_HASH,
  };
  let state = initGame(board, config);
  for (let steps = 0; steps < 2000; steps++) {
    if (state.turn.phase === 'GAME_OVER') return state;
    // Whoever holds a decision right now (setup offers can be concurrent).
    const actor = [A, B].find((p) => legalActions(board, state, p).length > 0);
    expect(actor).toBeDefined();
    const action = chooseBotAction(board, state, actor!, 'MEDIUM');
    expect(action).not.toBeNull();
    // Deterministic function of state + botId: a second call picks the identical move.
    expect(chooseBotAction(board, state, actor!, 'MEDIUM')).toEqual(action);
    const r = reduce(board, state, action!);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    state = r.value.state;
  }
  throw new Error('2-bot game did not finish within 2000 actions');
}

describe('@trm/bots', () => {
  it('drives a full 2-bot game to completion with only legal, deterministic picks', () => {
    const state = driveToCompletion('bots-package-spec');
    expect(state.finalScores).not.toBeNull();
  });

  it('exposes the id helpers and the difficulty roster', () => {
    expect(isBotId(`${BOT_ID_PREFIX}x`)).toBe(true);
    expect(isBotId('user-1')).toBe(false);
    expect(BOT_DIFFICULTIES).toEqual(['EASY', 'MEDIUM', 'HARD']);
  });
});
```

`packages/bots/CLAUDE.md`:

```markdown
# CLAUDE.md

`@trm/bots` is the pure bot brain, shared by the server's bot driver
(`apps/server/src/ws/hub.ts`) and the mobile app's offline `LocalGameSession`.
`chooseBotAction(board, state, botId, difficulty)` ranks the engine's own
`legalActions` (a bot can never emit an illegal move) with difficulty-tuned
heuristics; the pick is a **deterministic function of state + botId** (its RNG is
seeded from `state.actionSeq` + the bot id — see `rngFor`). It uses only fair
information (own hand/tickets + public board state). No I/O, no wall-clock, no
unseeded randomness — ESLint enforces the last two (`eslint.config.mjs`).
Commands: `yarn workspace @trm/bots test` / `… typecheck` / `… lint`.
```

- [ ] **Step 2: Register the workspace and verify the test fails**

Run: `yarn install`
Run: `yarn workspace @trm/bots test --run policy`
Expected: FAIL — `Cannot find module '../src'` (only the scaffold + test exist; no source yet).

- [ ] **Step 3: Move the source (git mv) and add the barrel**

```bash
mkdir -p packages/bots/src
git mv apps/server/src/bots/policy.ts packages/bots/src/policy.ts
git mv apps/server/src/bots/types.ts packages/bots/src/types.ts
```

(`policy.ts` imports `./types` relatively — the move keeps it working; **no edits to either file**.)

Create `packages/bots/src/index.ts`:

```ts
// Public API of the bot policy package: a pure, deterministic move chooser usable by
// the authoritative server driver AND the mobile offline LocalGameSession.
export { chooseBotAction } from './policy';
export { BOT_DIFFICULTIES, BOT_ID_PREFIX, isBotId } from './types';
export type { BotDifficulty, BotProfile } from './types';
```

- [ ] **Step 4: Run the package test to verify it passes**

Run: `yarn workspace @trm/bots test --run policy`
Expected: PASS (2 tests; the full-game drive takes a few seconds — `legalActions` re-reduces every candidate).

- [ ] **Step 5: Swap the server onto the package**

`apps/server/package.json` — add to `dependencies` (alphabetical, before `@trm/codec`):

```json
    "@trm/bots": "workspace:*",
```

Exact import swaps (server src — NestJS files keep value-import style; the server eslint block already disables `consistent-type-imports`):

| File | Old | New |
| --- | --- | --- |
| `apps/server/src/ws/hub.ts` | `import { chooseBotAction } from '../bots/policy';`<br>`import { isBotId, type BotProfile } from '../bots/types';` | `import { chooseBotAction, isBotId, type BotProfile } from '@trm/bots';` |
| `apps/server/src/push/push.service.ts` | `import { isBotId } from '../bots/types';` | `import { isBotId } from '@trm/bots';` |
| `apps/server/src/persistence/types.ts` | `import type { BotProfile } from '../bots/types';` | `import type { BotProfile } from '@trm/bots';` |
| `apps/server/src/persistence/game-store.ts` | `import type { BotProfile } from '../bots/types';` | `import type { BotProfile } from '@trm/bots';` |
| `apps/server/src/history/history.repo.ts` | `import type { BotProfile } from '../bots/types';` | `import type { BotProfile } from '@trm/bots';` |
| `apps/server/src/lobby/lobby.service.ts` | `import { BOT_ID_PREFIX, type BotDifficulty, type BotProfile } from '../bots/types';` | `import { BOT_ID_PREFIX, type BotDifficulty, type BotProfile } from '@trm/bots';` |
| `apps/server/src/lobby/room.repo.ts` | `import type { BotDifficulty } from '../bots/types';` | `import type { BotDifficulty } from '@trm/bots';` |

Test files — replace `from '../src/bots/types'` with `from '@trm/bots'` in: `apps/server/test/bots.e2e.spec.ts`, `bots-events.e2e.spec.ts`, `bots-5p.e2e.spec.ts`, `bot-driver-resilience.e2e.spec.ts`, `push-hub.e2e.spec.ts`.

Then: `yarn install` (links the new server dependency).

- [ ] **Step 6: ESLint determinism guard for the package**

In `eslint.config.mjs`, after the engine-purity block, add:

```js
  // Bot policy determinism: a pick must be a pure function of state + botId (the server
  // logs the chosen action, so replay/recovery must reproduce it byte-identically).
  {
    files: ['packages/bots/src/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Bot picks must be deterministic — seed from state.actionSeq (see rngFor).',
        },
        {
          object: 'Date',
          property: 'now',
          message: 'Bot picks must be deterministic — no wall-clock.',
        },
      ],
    },
  },
```

- [ ] **Step 7: Full gates (the server suite is THE gate for this refactor)**

Run: `yarn workspace @trm/server test`
Expected: all specs PASS (in particular `bots.e2e`, `bots-events.e2e`, `bots-5p.e2e`, `bot-driver-resilience.e2e`, `push-hub.e2e` — behavior-identical, imports only).
Run: `yarn workspace @trm/bots test && yarn typecheck && yarn lint`
Expected: PASS / clean / clean (`typecheck` catches any missed `../bots/*` import; `apps/server/src/bots/` no longer exists).

- [ ] **Step 8: Commit**

```bash
git add packages/bots apps/server/src/ws/hub.ts apps/server/src/push/push.service.ts apps/server/src/persistence/types.ts apps/server/src/persistence/game-store.ts apps/server/src/history/history.repo.ts apps/server/src/lobby/lobby.service.ts apps/server/src/lobby/room.repo.ts apps/server/test/bots.e2e.spec.ts apps/server/test/bots-events.e2e.spec.ts apps/server/test/bots-5p.e2e.spec.ts apps/server/test/bot-driver-resilience.e2e.spec.ts apps/server/test/push-hub.e2e.spec.ts apps/server/package.json eslint.config.mjs yarn.lock
git commit -m "refactor: extract @trm/bots package from apps/server"
```

---

### Task 2: Offline domain core — `LocalGameSession` (pure, store-agnostic)

Everything in this task is pure TS (no React Native imports), so it runs under jest off-device. The session mirrors `GameSession` + the hub's bot driver; persistence goes through a port with an in-memory double for tests.

**Files:**

- Create: `apps/mobile/src/offline/types.ts`
- Create: `apps/mobile/src/offline/newGame.ts`
- Create: `apps/mobile/src/offline/inMemoryStore.ts`
- Create: `apps/mobile/src/offline/localGameSession.ts`
- Create: `apps/mobile/src/offline/localGameSession.test.ts`

**Interfaces:**

- Consumes: `@trm/bots` (`chooseBotAction`, `isBotId`, `BOT_ID_PREFIX`, `BotProfile`, `BotDifficulty`); `@trm/engine` (`initGame`, `reduce`, `redactFor`, `stateDigest`, `currentPlayerId`, `ENGINE_VERSION`, types); `@trm/codec` (`viewToSnapshot`, `eventToProto`); `@trm/map-data` (`officialMapById`); `@trm/proto` (`GameSnapshot`, `GameEvent`).
- Produces (used by Tasks 3–6):
  - `LOCAL_HUMAN_ID = 'local:human'`
  - `interface OfflineGameSetup { gameId; config: GameConfig; bots: readonly BotProfile[]; mapId: string; engineVersion: string }`
  - `interface StoredActionRow { seq: number; action: Action; stateDigest: string }`
  - `interface OfflineGameListEntry { gameId; mapId; botCount; status: 'LIVE' | 'COMPLETED'; currentSeq; updatedAt }`
  - `interface LocalGameStorePort { createGame; appendAction; markCompleted; discardTail; loadGame; listGames; deleteGame }`
  - `newOfflineSetup(opts: NewOfflineGameOptions): OfflineGameSetup`
  - `class LocalGameSession` — `static create(setup, board, store)`, `static resume(setup, board, store, actions) → { session, report: { discardedFromSeq }, history: PbGameEvent[] }`, `apply(action) → { ok: true; events } | { ok: false; violation }`, `botStep() → { kind: 'moved'; profile; events } | { kind: 'idle' } | { kind: 'gameOver' }`, `nextActableBot()`, `projectHuman(): GameSnapshot`, `redactEvents(events): PbGameEvent[]`, `humanId`, `phase`, `stateVersion`, `isGameOver`, `raw()`, `persistenceBroken`
  - `class InMemoryLocalGameStore implements LocalGameStorePort` (+ `failAppends` injection)

- [ ] **Step 1: Write the failing tests**

Create `apps/mobile/src/offline/localGameSession.test.ts`:

```ts
import { legalActions, stateDigest, taiwanBoard } from '@trm/engine';
import { LocalGameSession } from './localGameSession';
import { InMemoryLocalGameStore } from './inMemoryStore';
import { newOfflineSetup } from './newGame';
import { LOCAL_HUMAN_ID } from './types';

const board = taiwanBoard();
const makeSetup = (gameId = 'local:test-1') =>
  newOfflineSetup({
    mapId: 'taiwan',
    botCount: 2,
    difficulty: 'MEDIUM',
    gameId,
    seed: 'offline-spec-seed',
  });

/** Bots move via botStep; when it's the human's turn, play the first legal action. */
async function playSteps(session: LocalGameSession, n: number): Promise<void> {
  let applied = 0;
  for (let guard = 0; guard < 8000 && applied < n; guard++) {
    if (session.isGameOver) return;
    const bot = await session.botStep();
    if (bot.kind === 'moved') {
      applied++;
      continue;
    }
    if (bot.kind === 'gameOver') return;
    const legal = legalActions(session.board, session.raw(), session.humanId);
    expect(legal.length).toBeGreaterThan(0);
    const r = await session.apply(legal[0]!);
    expect(r.ok).toBe(true);
    applied++;
  }
}

async function playToGameOver(session: LocalGameSession): Promise<void> {
  for (let guard = 0; guard < 8000; guard++) {
    if (session.isGameOver) return;
    await playSteps(session, 1);
  }
  throw new Error('offline game did not finish');
}

describe('LocalGameSession', () => {
  it('plays a full game through the write-ahead log and completes it', async () => {
    const store = new InMemoryLocalGameStore();
    const session = await LocalGameSession.create(makeSetup(), board, store);
    await playToGameOver(session);

    expect(session.isGameOver).toBe(true);
    // Event-sourced mirror of the server: contiguous seqs 1..N, one digest per action.
    const rows = store.rows.get('local:test-1')!;
    expect(rows.length).toBe(session.stateVersion);
    rows.forEach((row, i) => expect(row.seq).toBe(i + 1));
    expect(store.games.get('local:test-1')!.status).toBe('COMPLETED');

    // The UI-facing projection is the standard redacted snapshot with a final scoreboard.
    const snap = session.projectHuman();
    expect(snap.you?.playerId).toBe(LOCAL_HUMAN_ID);
    expect(snap.finalScores).toBeDefined();
  });

  it('resume replays the stored log to the exact same digest', async () => {
    const store = new InMemoryLocalGameStore();
    const setup = makeSetup('local:test-2');
    const live = await LocalGameSession.create(setup, board, store);
    await playSteps(live, 40);
    const liveDigest = stateDigest(live.raw());

    const loaded = await store.loadGame('local:test-2');
    const { session, report } = await LocalGameSession.resume(
      loaded!.setup,
      board,
      store,
      loaded!.actions,
    );
    expect(report.discardedFromSeq).toBeNull();
    expect(stateDigest(session.raw())).toBe(liveDigest);
    expect(session.stateVersion).toBe(live.stateVersion);
  });

  it('discards a corrupt tail instead of failing resume', async () => {
    const store = new InMemoryLocalGameStore();
    const setup = makeSetup('local:test-3');
    const live = await LocalGameSession.create(setup, board, store);
    await playSteps(live, 30);

    const rows = store.rows.get('local:test-3')!;
    const badSeq = rows[rows.length - 2]!.seq;
    // Tamper the second-to-last digest: everything from that seq on is untrusted.
    rows[rows.length - 2] = { ...rows[rows.length - 2]!, stateDigest: 'corrupt' };

    const loaded = await store.loadGame('local:test-3');
    const { session, report } = await LocalGameSession.resume(
      loaded!.setup,
      board,
      store,
      loaded!.actions,
    );
    expect(report.discardedFromSeq).toBe(badSeq);
    expect(session.stateVersion).toBe(badSeq - 1);
    // The tail was deleted from the store, so the NEXT resume is clean.
    expect(store.rows.get('local:test-3')!.every((r) => r.seq < badSeq)).toBe(true);
    expect(session.isGameOver).toBe(false);
  });

  it('keeps the in-memory game alive when persistence fails (storage full)', async () => {
    const store = new InMemoryLocalGameStore();
    const session = await LocalGameSession.create(makeSetup('local:test-4'), board, store);
    await playSteps(session, 5);
    const savedCount = store.rows.get('local:test-4')!.length;

    store.failAppends = true;
    await playSteps(session, 3);
    expect(session.persistenceBroken).toBe(true);
    // No partial/gapped log: once broken, nothing more is appended.
    expect(store.rows.get('local:test-4')!.length).toBe(savedCount);
    // …but the in-memory game kept going.
    expect(session.stateVersion).toBeGreaterThanOrEqual(savedCount + 3);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn workspace @trm/mobile test localGameSession`
Expected: FAIL — cannot resolve `./localGameSession` / `./inMemoryStore` / `./newGame` / `./types` (none exist yet).

- [ ] **Step 3: Implement the types + setup builder + in-memory store**

`apps/mobile/src/offline/types.ts`:

```ts
// Offline (vs bots) domain types. Everything in this module tree except seed.ts and
// sqliteStore.ts is pure TS — no React Native imports — so the core is testable off-device.
import type { BotProfile } from '@trm/bots';
import type { Action, GameConfig } from '@trm/engine';

/** The local human's engine PlayerId. Never a bot: no 'bot:' prefix (UI bot badges key off it). */
export const LOCAL_HUMAN_ID = 'local:human';

/** Identity + rules of one offline game (serialized whole into the store's setup column). */
export interface OfflineGameSetup {
  readonly gameId: string;
  /** seed + players + ruleParams + contentHash — the same GameConfig shape the server persists. */
  readonly config: GameConfig;
  readonly bots: readonly BotProfile[];
  /** Official map id (v1 offline is bundled-official-maps only). */
  readonly mapId: string;
  /** Version pin (mirror of the server's stamped engineVersion): resume refuses a mismatch. */
  readonly engineVersion: string;
}

/** One persisted action row — the sqlite mirror of the server's gameEvents doc. */
export interface StoredActionRow {
  readonly seq: number;
  readonly action: Action;
  readonly stateDigest: string;
}

/** Home-screen resume list entry. */
export interface OfflineGameListEntry {
  readonly gameId: string;
  readonly mapId: string;
  readonly botCount: number;
  readonly status: 'LIVE' | 'COMPLETED';
  readonly currentSeq: number;
  readonly updatedAt: number; // epoch ms
}

/**
 * Persistence port. `SqliteLocalGameStore` implements it on-device;
 * `InMemoryLocalGameStore` in tests. Contract notes:
 *  - appendAction MUST reject a duplicate (gameId, seq) — the double-apply guard.
 *  - discardTail deletes every row with seq >= fromSeq (corrupt-tail recovery).
 *  - loadGame returns actions ordered by seq ascending.
 */
export interface LocalGameStorePort {
  createGame(setup: OfflineGameSetup, genesisDigest: string): Promise<void>;
  appendAction(gameId: string, row: StoredActionRow): Promise<void>;
  markCompleted(gameId: string): Promise<void>;
  discardTail(gameId: string, fromSeq: number): Promise<void>;
  loadGame(
    gameId: string,
  ): Promise<{ setup: OfflineGameSetup; actions: StoredActionRow[] } | null>;
  listGames(): Promise<OfflineGameListEntry[]>;
  deleteGame(gameId: string): Promise<void>;
}
```

`apps/mobile/src/offline/newGame.ts`:

```ts
// Builds the GameConfig for a new offline game — the serverless mirror of
// LobbyService.start (apps/server/src/lobby/lobby.service.ts): human on seat 0,
// bots on seats 1..n, the map's curated rules + the room-default variant flags.
// Randomness (gameId, seed) is INJECTED — expo-crypto on device, fixed strings in tests —
// so this module stays pure and the engine's determinism boundary is preserved.
import { BOT_ID_PREFIX } from '@trm/bots';
import type { BotDifficulty, BotProfile } from '@trm/bots';
import { ENGINE_VERSION } from '@trm/engine';
import type { GameConfig, PlayerSeed } from '@trm/engine';
import { officialMapById } from '@trm/map-data';
import { asPlayerId } from '@trm/shared';
import type { SeatIndex } from '@trm/shared';
import { LOCAL_HUMAN_ID, type OfflineGameSetup } from './types';

export interface NewOfflineGameOptions {
  readonly mapId: string;
  readonly botCount: 1 | 2 | 3 | 4;
  readonly difficulty: BotDifficulty;
  /** Injected randomness (see seed.ts). */
  readonly gameId: string;
  readonly seed: string;
}

/** Mirror of the server's DEFAULT_ROOM_SETTINGS rule-variant flags (room.repo.ts). */
const DEFAULT_VARIANT_FLAGS = {
  unlimitedStationBorrow: true,
  secondDrawAfterBlindRainbow: false,
  noUnfinishedTicketPenalty: false,
  doubleRouteSingleFor23: true,
  eventsMode: 'off',
} as const;

export function newOfflineSetup(opts: NewOfflineGameOptions): OfflineGameSetup {
  const map = officialMapById(opts.mapId);
  if (!map) throw new Error(`unknown official map: ${opts.mapId}`);
  const bots: BotProfile[] = Array.from({ length: opts.botCount }, (_, i) => ({
    playerId: `${BOT_ID_PREFIX}local-${i + 1}`,
    difficulty: opts.difficulty,
  }));
  const players: PlayerSeed[] = [
    { id: asPlayerId(LOCAL_HUMAN_ID), seat: 0 as SeatIndex },
    ...bots.map((b, i) => ({ id: asPlayerId(b.playerId), seat: (i + 1) as SeatIndex })),
  ];
  const config: GameConfig = {
    seed: opts.seed,
    players,
    contentHash: map.hash,
    ruleParams: { ...(map.content.rules ?? {}), ...DEFAULT_VARIANT_FLAGS },
  };
  return {
    gameId: opts.gameId,
    config,
    bots,
    mapId: opts.mapId,
    engineVersion: ENGINE_VERSION,
  };
}
```

(`eventsMode: 'off'` must typecheck against `RuleParams` — it is the same literal the lobby passes. If `RuleParams` narrowed since spec time, mirror whatever `LobbyService.start` passes for a feature-less host.)

`apps/mobile/src/offline/inMemoryStore.ts`:

```ts
// Test/dev double for SqliteLocalGameStore — same port contract, plus failure injection.
import type {
  LocalGameStorePort,
  OfflineGameListEntry,
  OfflineGameSetup,
  StoredActionRow,
} from './types';

interface GameRec {
  setup: OfflineGameSetup;
  genesisDigest: string;
  status: 'LIVE' | 'COMPLETED';
  updatedAt: number;
}

export class InMemoryLocalGameStore implements LocalGameStorePort {
  readonly games = new Map<string, GameRec>();
  readonly rows = new Map<string, StoredActionRow[]>();
  /** Set true to simulate storage-full: appendAction throws, nothing is written. */
  failAppends = false;

  async createGame(setup: OfflineGameSetup, genesisDigest: string): Promise<void> {
    this.games.set(setup.gameId, { setup, genesisDigest, status: 'LIVE', updatedAt: Date.now() });
    this.rows.set(setup.gameId, []);
  }

  async appendAction(gameId: string, row: StoredActionRow): Promise<void> {
    if (this.failAppends) throw new Error('append failed (injected)');
    const rows = this.rows.get(gameId);
    if (!rows) throw new Error(`no such offline game: ${gameId}`);
    if (rows.some((r) => r.seq === row.seq)) throw new Error(`duplicate seq ${row.seq}`);
    rows.push(row);
    const g = this.games.get(gameId);
    if (g) g.updatedAt = Date.now();
  }

  async markCompleted(gameId: string): Promise<void> {
    const g = this.games.get(gameId);
    if (g) g.status = 'COMPLETED';
  }

  async discardTail(gameId: string, fromSeq: number): Promise<void> {
    const rows = this.rows.get(gameId) ?? [];
    this.rows.set(
      gameId,
      rows.filter((r) => r.seq < fromSeq),
    );
  }

  async loadGame(
    gameId: string,
  ): Promise<{ setup: OfflineGameSetup; actions: StoredActionRow[] } | null> {
    const g = this.games.get(gameId);
    if (!g) return null;
    const actions = [...(this.rows.get(gameId) ?? [])].sort((a, b) => a.seq - b.seq);
    return { setup: g.setup, actions };
  }

  async listGames(): Promise<OfflineGameListEntry[]> {
    return [...this.games.entries()]
      .map(([gameId, g]) => ({
        gameId,
        mapId: g.setup.mapId,
        botCount: g.setup.bots.length,
        status: g.status,
        currentSeq: this.rows.get(gameId)?.length ?? 0,
        updatedAt: g.updatedAt,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async deleteGame(gameId: string): Promise<void> {
    this.games.delete(gameId);
    this.rows.delete(gameId);
  }
}
```

- [ ] **Step 4: Implement `LocalGameSession`**

`apps/mobile/src/offline/localGameSession.ts`:

```ts
// The offline mirror of the server's authoritative loop (apps/server/src/game/game-session.ts
// + the bot driver in apps/server/src/ws/hub.ts): the REAL engine runs locally, every
// accepted action is appended to the event-sourced local log BEFORE being committed to
// memory (the hub's write-ahead order), and the UI only ever sees the SAME projection the
// wire uses — redactFor(human) → viewToSnapshot. Bots are ordinary seated players chosen
// by @trm/bots, identical to the server driver, and their moves are logged like any other.
//
// Divergence from server semantics, both deliberate (spec §4):
//  - resume() TRUNCATES a corrupt tail and continues (server recovery aborts) — an offline
//    game must never crash into a corrupt save.
//  - a failed append flips persistenceBroken and STOPS persisting (no gaps in the log),
//    but the in-memory game keeps going — the UI shows a "can't save" banner.
import { chooseBotAction, isBotId } from '@trm/bots';
import type { BotProfile } from '@trm/bots';
import { currentPlayerId, initGame, reduce, redactFor, stateDigest } from '@trm/engine';
import type { Action, Board, GameEvent, GameState, Phase } from '@trm/engine';
import { asPlayerId } from '@trm/shared';
import type { PlayerId, RuleViolation } from '@trm/shared';
import { eventToProto, viewToSnapshot } from '@trm/codec';
import type { GameSnapshot, GameEvent as PbGameEvent } from '@trm/proto';
import type { LocalGameStorePort, OfflineGameSetup, StoredActionRow } from './types';

export type LocalApplyResult =
  | { readonly ok: true; readonly events: GameEvent[] }
  | { readonly ok: false; readonly violation: RuleViolation };

export type BotStepResult =
  | { readonly kind: 'moved'; readonly profile: BotProfile; readonly events: GameEvent[] }
  | { readonly kind: 'idle' } // waiting on the human
  | { readonly kind: 'gameOver' };

export interface ResumeReport {
  /** First seq of the discarded corrupt tail, or null when the whole log verified. */
  readonly discardedFromSeq: number | null;
}

function humanOf(setup: OfflineGameSetup): PlayerId {
  const human = setup.config.players.find((p) => !isBotId(p.id as string));
  if (!human) throw new Error('offline setup has no human seat');
  return human.id;
}

export class LocalGameSession {
  private state: GameState;
  /** True once an append failed; we keep playing in memory but stop persisting entirely. */
  persistenceBroken = false;

  private constructor(
    readonly setup: OfflineGameSetup,
    readonly board: Board,
    private readonly store: LocalGameStorePort,
    readonly humanId: PlayerId,
  ) {
    this.state = initGame(board, setup.config);
  }

  /** Create + persist a brand-new offline game (genesis row before the first move). */
  static async create(
    setup: OfflineGameSetup,
    board: Board,
    store: LocalGameStorePort,
  ): Promise<LocalGameSession> {
    const s = new LocalGameSession(setup, board, store, humanOf(setup));
    await store.createGame(setup, stateDigest(s.state));
    return s;
  }

  /**
   * Rebuild from the stored log, digest-verifying every step (GameSession.restore idiom).
   * On the first rejected action, digest mismatch, or seq gap, the tail is DISCARDED
   * (store.discardTail) and play resumes from the last good state. Also returns the
   * re-derived redacted event history for log backfill (GameSession.history idiom —
   * events are deterministic, so nothing extra is ever persisted).
   */
  static async resume(
    setup: OfflineGameSetup,
    board: Board,
    store: LocalGameStorePort,
    actions: readonly StoredActionRow[],
  ): Promise<{ session: LocalGameSession; report: ResumeReport; history: PbGameEvent[] }> {
    const s = new LocalGameSession(setup, board, store, humanOf(setup));
    const history: PbGameEvent[] = [];
    let discardedFromSeq: number | null = null;
    for (const row of actions) {
      const r = reduce(board, s.state, row.action);
      if (
        !r.ok ||
        r.value.state.actionSeq !== row.seq ||
        stateDigest(r.value.state) !== row.stateDigest
      ) {
        discardedFromSeq = row.seq;
        break;
      }
      s.state = r.value.state;
      history.push(...s.redactEvents(r.value.events));
    }
    if (discardedFromSeq !== null) await store.discardTail(setup.gameId, discardedFromSeq);
    return { session: s, report: { discardedFromSeq }, history };
  }

  get phase(): Phase {
    return this.state.turn.phase;
  }
  get stateVersion(): number {
    return this.state.actionSeq;
  }
  get isGameOver(): boolean {
    return this.phase === 'GAME_OVER';
  }
  get currentPlayer(): PlayerId | null {
    return this.isGameOver ? null : currentPlayerId(this.state);
  }

  /** Full engine state — bot driving + tests ONLY. Never hand this to the UI. */
  raw(): GameState {
    return this.state;
  }

  /** Reduce → append (write-ahead) → commit. Same order as the hub; see class doc for the
   *  persistence-failure divergence. */
  async apply(action: Action): Promise<LocalApplyResult> {
    const r = reduce(this.board, this.state, action);
    if (!r.ok) return { ok: false, violation: r.error };
    const next = r.value.state;
    if (!this.persistenceBroken) {
      try {
        await this.store.appendAction(this.setup.gameId, {
          seq: next.actionSeq,
          action,
          stateDigest: stateDigest(next),
        });
      } catch {
        this.persistenceBroken = true;
      }
    }
    this.state = next;
    if (this.isGameOver && !this.persistenceBroken) {
      try {
        await this.store.markCompleted(this.setup.gameId);
      } catch {
        this.persistenceBroken = true;
      }
    }
    return { ok: true, events: [...r.value.events] };
  }

  /** Port of the hub's nextActableBot: the first bot with a decision available right now. */
  nextActableBot(): BotProfile | null {
    const phase = this.phase;
    const current = this.currentPlayer;
    const tunnelPlayer = this.state.pendingTunnel?.playerId ?? null;
    for (const profile of this.setup.bots) {
      const pid = asPlayerId(profile.playerId);
      const pendingOffer = this.state.players[profile.playerId]?.pendingTicketOffer != null;
      if (phase === 'SETUP_TICKETS') {
        if (pendingOffer) return profile;
      } else if (phase === 'TICKET_SELECTION') {
        if (current === pid && pendingOffer) return profile;
      } else if (phase === 'TUNNEL_PENDING') {
        if (tunnelPlayer === pid) return profile;
      } else if (current === pid) {
        return profile; // AWAIT_ACTION / DRAWING_CARDS
      }
    }
    return null;
  }

  /** One bot move through the same apply() path as the human (logged identically). */
  async botStep(): Promise<BotStepResult> {
    if (this.isGameOver) return { kind: 'gameOver' };
    const profile = this.nextActableBot();
    if (!profile) return { kind: 'idle' };
    const botId = asPlayerId(profile.playerId);
    const chosen = chooseBotAction(this.board, this.state, botId, profile.difficulty);
    // legalActions guarantees PASS whenever nothing else is legal — mirror the hub's fallback.
    const action: Action = chosen ?? { t: 'PASS', player: botId };
    const res = await this.apply(action);
    if (!res.ok) {
      const pass = await this.apply({ t: 'PASS', player: botId });
      return pass.ok ? { kind: 'moved', profile, events: pass.events } : { kind: 'idle' };
    }
    return { kind: 'moved', profile, events: res.events };
  }

  /** The human's redacted snapshot — the ONLY projection the UI ever sees. */
  projectHuman(): GameSnapshot {
    const view = redactFor(this.board, this.state, this.humanId);
    return viewToSnapshot(view, this.state.actionSeq, this.humanId);
  }

  /** Redacted proto events for the human viewer (animations + action log). */
  redactEvents(events: readonly GameEvent[]): PbGameEvent[] {
    return events
      .map((e) => eventToProto(e, this.humanId))
      .filter((e): e is PbGameEvent => e !== null);
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `yarn workspace @trm/mobile test localGameSession`
Expected: PASS (4 tests; the full-game test takes a few seconds).
If the snapshot field assertion `snap.finalScores` fails on the exact proto field name, check `packages/codec/src/snapshot.ts` (the field is built at its line ~82 as `finalScores`) and fix the **test**, not the codec.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/offline/types.ts apps/mobile/src/offline/newGame.ts apps/mobile/src/offline/inMemoryStore.ts apps/mobile/src/offline/localGameSession.ts apps/mobile/src/offline/localGameSession.test.ts
git commit -m "feat(mobile): offline LocalGameSession mirroring the server prepare→commit loop"
```

---

### Task 3: expo-sqlite event-sourced store + version-pinned game loading

The sqlite adapter implements the Task 2 port with the server's schema idioms (`(game_id, seq)` primary key = the durable double-apply guard). `loadOfflineGame` adds the version pins (`engineVersion` + registered `contentHash`) — the offline analogue of "replay refuses to cross versions". The adapter itself is thin SQL; its logic-bearing parts (row (de)serialization, resume policy) are pure and tested; the adapter is exercised on-device in Task 7's manual gate.

**Files:**

- Create: `apps/mobile/src/offline/seed.ts`
- Create: `apps/mobile/src/offline/sqliteStore.ts`
- Create: `apps/mobile/src/offline/loadGame.ts`
- Create: `apps/mobile/src/offline/loadGame.test.ts`
- Modify: `apps/mobile/package.json` (via expo install)

**Interfaces:**

- Consumes: `LocalGameStorePort`, `OfflineGameSetup`, `StoredActionRow`, `LocalGameSession.resume` (Task 2); `boardForContentHash`, `ENGINE_VERSION` from `@trm/engine`; `expo-sqlite`, `expo-crypto`.
- Produces:
  - `randomSeed(): string`, `randomGameId(): string` (expo-crypto; the only offline randomness source)
  - `SqliteLocalGameStore.open(name = 'trm-offline.db'): Promise<SqliteLocalGameStore>` (implements `LocalGameStorePort`)
  - `loadOfflineGame(store, gameId) → { ok: true; session; report; history } | { ok: false; reason: 'not_found' | 'engine_version' | 'unknown_content' }`

- [ ] **Step 1: Add the native dependencies**

Run: `yarn workspace @trm/mobile exec expo install expo-sqlite expo-crypto @react-native-community/netinfo`
(If `exec` misbehaves under Yarn 4, run `npx expo install expo-sqlite expo-crypto @react-native-community/netinfo` from `apps/mobile/`. `expo install` pins the SDK-56-compatible versions — do not hand-pick versions. `expo-crypto` may already be present from P1's shims; netinfo is used in Task 6.)
Verify: `node -p "require('./apps/mobile/package.json').dependencies['expo-sqlite']"` prints a version.

- [ ] **Step 2: Write the failing tests (version pins + happy path over the in-memory store)**

Create `apps/mobile/src/offline/loadGame.test.ts`:

```ts
import { taiwanBoard } from '@trm/engine';
import { InMemoryLocalGameStore } from './inMemoryStore';
import { LocalGameSession } from './localGameSession';
import { loadOfflineGame } from './loadGame';
import { newOfflineSetup } from './newGame';

const board = taiwanBoard();
const setupFor = (gameId: string) =>
  newOfflineSetup({ mapId: 'taiwan', botCount: 1, difficulty: 'EASY', gameId, seed: 's1' });

describe('loadOfflineGame', () => {
  it('loads and resumes a stored game', async () => {
    const store = new InMemoryLocalGameStore();
    await LocalGameSession.create(setupFor('local:lg-1'), board, store);
    const res = await loadOfflineGame(store, 'local:lg-1');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.session.stateVersion).toBe(0);
  });

  it('404s an unknown id', async () => {
    const res = await loadOfflineGame(new InMemoryLocalGameStore(), 'local:nope');
    expect(res).toEqual({ ok: false, reason: 'not_found' });
  });

  it('refuses a save from a different engine version', async () => {
    const store = new InMemoryLocalGameStore();
    const setup = { ...setupFor('local:lg-2'), engineVersion: 'someone-elses-engine' };
    await LocalGameSession.create(setup, board, store);
    const res = await loadOfflineGame(store, 'local:lg-2');
    expect(res).toEqual({ ok: false, reason: 'engine_version' });
  });

  it('refuses an unregistered content hash', async () => {
    const store = new InMemoryLocalGameStore();
    const s0 = setupFor('local:lg-3');
    const setup = { ...s0, config: { ...s0.config, contentHash: 'not-a-registered-hash' } };
    await LocalGameSession.create(setup, board, store);
    const res = await loadOfflineGame(store, 'local:lg-3');
    expect(res).toEqual({ ok: false, reason: 'unknown_content' });
  });
});
```

Run: `yarn workspace @trm/mobile test loadGame`
Expected: FAIL — cannot resolve `./loadGame`.

- [ ] **Step 3: Implement seed, sqlite adapter, and the loader**

`apps/mobile/src/offline/seed.ts`:

```ts
// The ONLY offline randomness source. Randomness stays OUTSIDE the engine (ADR A4):
// it enters a game exactly once, as GameConfig.seed — the same boundary as the server's
// randomUUID() seed in LobbyService.start.
import * as Crypto from 'expo-crypto';

export function randomSeed(): string {
  const bytes = new Uint8Array(16);
  Crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomGameId(): string {
  return `local:${Crypto.randomUUID()}`;
}
```

`apps/mobile/src/offline/sqliteStore.ts`:

```ts
// Event-sourced offline persistence on expo-sqlite — the on-device mirror of
// MongoGameStore (apps/server/src/persistence/game-store.ts): a setup row (genesis) plus
// one action row per accepted action carrying its stateDigest. The (game_id, seq) PRIMARY
// KEY is the durable double-apply guard (same role as the server's unique index). No
// snapshot table: offline logs are short and the engine replays them in well under a second.
import * as SQLite from 'expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { Action } from '@trm/engine';
import type {
  LocalGameStorePort,
  OfflineGameListEntry,
  OfflineGameSetup,
  StoredActionRow,
} from './types';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS offline_games (
  game_id TEXT PRIMARY KEY NOT NULL,
  map_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'LIVE',
  setup_json TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  genesis_digest TEXT NOT NULL,
  current_seq INTEGER NOT NULL DEFAULT 0,
  bot_count INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS offline_actions (
  game_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  action_json TEXT NOT NULL,
  state_digest TEXT NOT NULL,
  PRIMARY KEY (game_id, seq)
);
`;

interface GameRow {
  setup_json: string;
  status: string;
}
interface ActionRow {
  seq: number;
  action_json: string;
  state_digest: string;
}
interface ListRow {
  game_id: string;
  map_id: string;
  status: string;
  current_seq: number;
  bot_count: number;
  updated_at: number;
}

export class SqliteLocalGameStore implements LocalGameStorePort {
  private constructor(private readonly db: SQLiteDatabase) {}

  static async open(name = 'trm-offline.db'): Promise<SqliteLocalGameStore> {
    const db = await SQLite.openDatabaseAsync(name);
    await db.execAsync('PRAGMA journal_mode = WAL;');
    await db.execAsync(SCHEMA);
    return new SqliteLocalGameStore(db);
  }

  async createGame(setup: OfflineGameSetup, genesisDigest: string): Promise<void> {
    const now = Date.now();
    await this.db.runAsync(
      `INSERT INTO offline_games
         (game_id, map_id, status, setup_json, engine_version, content_hash,
          genesis_digest, current_seq, bot_count, created_at, updated_at)
       VALUES (?, ?, 'LIVE', ?, ?, ?, ?, 0, ?, ?, ?)`,
      setup.gameId,
      setup.mapId,
      JSON.stringify(setup),
      setup.engineVersion,
      setup.config.contentHash,
      genesisDigest,
      setup.bots.length,
      now,
      now,
    );
  }

  async appendAction(gameId: string, row: StoredActionRow): Promise<void> {
    // Both writes or neither: the log row and the list metadata move together.
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(
        `INSERT INTO offline_actions (game_id, seq, action_json, state_digest)
         VALUES (?, ?, ?, ?)`,
        gameId,
        row.seq,
        JSON.stringify(row.action),
        row.stateDigest,
      );
      await this.db.runAsync(
        `UPDATE offline_games SET current_seq = ?, updated_at = ? WHERE game_id = ?`,
        row.seq,
        Date.now(),
        gameId,
      );
    });
  }

  async markCompleted(gameId: string): Promise<void> {
    await this.db.runAsync(
      `UPDATE offline_games SET status = 'COMPLETED', updated_at = ? WHERE game_id = ?`,
      Date.now(),
      gameId,
    );
  }

  async discardTail(gameId: string, fromSeq: number): Promise<void> {
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(
        `DELETE FROM offline_actions WHERE game_id = ? AND seq >= ?`,
        gameId,
        fromSeq,
      );
      await this.db.runAsync(
        `UPDATE offline_games SET current_seq = ?, updated_at = ? WHERE game_id = ?`,
        fromSeq - 1,
        Date.now(),
        gameId,
      );
    });
  }

  async loadGame(
    gameId: string,
  ): Promise<{ setup: OfflineGameSetup; actions: StoredActionRow[] } | null> {
    const game = await this.db.getFirstAsync<GameRow>(
      `SELECT setup_json, status FROM offline_games WHERE game_id = ?`,
      gameId,
    );
    if (!game) return null;
    const rows = await this.db.getAllAsync<ActionRow>(
      `SELECT seq, action_json, state_digest FROM offline_actions
       WHERE game_id = ? ORDER BY seq ASC`,
      gameId,
    );
    return {
      setup: JSON.parse(game.setup_json) as OfflineGameSetup,
      actions: rows.map((r) => ({
        seq: r.seq,
        action: JSON.parse(r.action_json) as Action,
        stateDigest: r.state_digest,
      })),
    };
  }

  async listGames(): Promise<OfflineGameListEntry[]> {
    const rows = await this.db.getAllAsync<ListRow>(
      `SELECT game_id, map_id, status, current_seq, bot_count, updated_at
       FROM offline_games ORDER BY updated_at DESC`,
    );
    return rows.map((r) => ({
      gameId: r.game_id,
      mapId: r.map_id,
      status: r.status === 'COMPLETED' ? 'COMPLETED' : 'LIVE',
      currentSeq: r.current_seq,
      botCount: r.bot_count,
      updatedAt: r.updated_at,
    }));
  }

  async deleteGame(gameId: string): Promise<void> {
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(`DELETE FROM offline_actions WHERE game_id = ?`, gameId);
      await this.db.runAsync(`DELETE FROM offline_games WHERE game_id = ?`, gameId);
    });
  }
}
```

(**API contract check** — expo-sqlite's async API (`openDatabaseAsync`/`runAsync`/`getAllAsync`/`getFirstAsync`/`withTransactionAsync`) is stable since SDK 51. Verify against the installed version's docs: `node -p "require('./apps/mobile/node_modules/expo-sqlite/package.json').version"`. If `withTransactionAsync` was renamed/removed in the installed major, use the equivalent transaction wrapper from that version — the required semantics are exactly "both statements or neither".)

`apps/mobile/src/offline/loadGame.ts`:

```ts
// Load + resume one stored offline game, enforcing the version pins the server stamps on
// persisted games (engineVersion + registered contentHash): a save from an incompatible
// binary is refused — never replayed against the wrong rules or the wrong board.
import { ENGINE_VERSION, boardForContentHash } from '@trm/engine';
import type { Board } from '@trm/engine';
import type { GameEvent as PbGameEvent } from '@trm/proto';
import { LocalGameSession } from './localGameSession';
import type { ResumeReport } from './localGameSession';
import type { LocalGameStorePort } from './types';

export type LoadOfflineResult =
  | {
      ok: true;
      session: LocalGameSession;
      report: ResumeReport;
      history: PbGameEvent[];
    }
  | { ok: false; reason: 'not_found' | 'engine_version' | 'unknown_content' };

export async function loadOfflineGame(
  store: LocalGameStorePort,
  gameId: string,
): Promise<LoadOfflineResult> {
  const loaded = await store.loadGame(gameId);
  if (!loaded) return { ok: false, reason: 'not_found' };
  if (loaded.setup.engineVersion !== ENGINE_VERSION)
    return { ok: false, reason: 'engine_version' };
  let board: Board;
  try {
    // The official-content registry (archived versions included). Throws on unknown hash —
    // same posture as server recovery: fail loudly, never fall back to the wrong board.
    board = boardForContentHash(loaded.setup.config.contentHash);
  } catch {
    return { ok: false, reason: 'unknown_content' };
  }
  const { session, report, history } = await LocalGameSession.resume(
    loaded.setup,
    board,
    store,
    loaded.actions,
  );
  if (session.isGameOver) await store.markCompleted(gameId); // idempotent catch-up
  return { ok: true, session, report, history };
}
```

- [ ] **Step 4: Run the tests**

Run: `yarn workspace @trm/mobile test loadGame`
Expected: PASS (4 tests).
Run: `yarn workspace @trm/mobile test offline`
Expected: PASS (Task 2 suite still green).

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/offline/seed.ts apps/mobile/src/offline/sqliteStore.ts apps/mobile/src/offline/loadGame.ts apps/mobile/src/offline/loadGame.test.ts apps/mobile/package.json yarn.lock
git commit -m "feat(mobile): event-sourced offline persistence on expo-sqlite"
```

---

### Task 4: `LocalSocket` (GameCommands adapter) + client-side bot driver

The stage drives a `GameCommands` implementation and cannot tell online from offline — the web's `SandboxSocket` contract (`apps/web/src/net/sandboxSocket.ts`), with commands mapped through the shared codec's `commandToAction` so they travel the identical command→action path as the wire. Bot pacing is a port of the server's `botStepDelayMs` (`apps/server/src/ws/bot-pacing.ts`) so tunnel reveals aren't yanked shut.

**Files:**

- Create: `apps/mobile/src/offline/pacing.ts`
- Create: `apps/mobile/src/offline/localSocket.ts`
- Create: `apps/mobile/src/offline/botDriver.ts`
- Create: `apps/mobile/src/offline/useLocalGame.ts`
- Create: `apps/mobile/src/offline/botDriver.test.ts`
- Create: `apps/mobile/src/offline/localSocket.test.ts`

**Interfaces:**

- Consumes: Task 2/3 modules; **P2 artifacts** `apps/mobile/src/net/commands.ts` (`GameCommands`), `apps/mobile/src/net/socket.ts` (`PaymentInit`, `CameraViewInit` types), `apps/mobile/src/store/game.ts` (`GameStoreApi`, `createGameStore`), `apps/mobile/src/store/log.ts` (`LogStoreApi`, `createLogStore`); `@trm/codec` (`commandToAction`), `@trm/proto` (`ClientEnvelopeSchema`), `@bufbuild/protobuf` (`create`).
- Produces:
  - `BOT_STEP_MS = 900`; `botPauseMs(phase: Phase, revealedCount: number): number`
  - `class LocalSocket implements GameCommands` — `new LocalSocket(humanId: PlayerId, onAction: (action: Action) => void)`
  - `runBotBurst(session: LocalGameSession, ports: { onBotMove(events: GameEvent[]): void; delay(ms: number): Promise<void>; isCancelled(): boolean }): Promise<void>`
  - `useLocalGame(input: LocalGameInput, stores: { game: GameStoreApi; log: LogStoreApi }, deps?: { store?: LocalGameStorePort }): LocalGameHandle` where `LocalGameInput = { mode: 'new'; mapId; botCount; difficulty } | { mode: 'resume'; gameId }` and `LocalGameHandle = { ready; error: 'load_failed' | 'engine_version' | 'unknown_content' | null; socket: GameCommands | null; gameId: string | null; saveBroken: boolean; resumeTruncated: boolean }`

- [ ] **Step 1: Write the failing tests**

Create `apps/mobile/src/offline/botDriver.test.ts`:

```ts
import { taiwanBoard } from '@trm/engine';
import type { GameEvent } from '@trm/engine';
import { LocalGameSession } from './localGameSession';
import { InMemoryLocalGameStore } from './inMemoryStore';
import { newOfflineSetup } from './newGame';
import { runBotBurst } from './botDriver';
import { BOT_STEP_MS, botPauseMs } from './pacing';

describe('runBotBurst', () => {
  it('drives every actable bot, pacing before each move, then yields to the human', async () => {
    const store = new InMemoryLocalGameStore();
    const session = await LocalGameSession.create(
      newOfflineSetup({
        mapId: 'taiwan',
        botCount: 2,
        difficulty: 'MEDIUM',
        gameId: 'local:bd-1',
        seed: 'driver-spec',
      }),
      taiwanBoard(),
      store,
    );

    const delays: number[] = [];
    const batches: GameEvent[][] = [];
    await runBotBurst(session, {
      onBotMove: (events) => batches.push(events),
      delay: async (ms) => {
        delays.push(ms);
      },
      isCancelled: () => false,
    });

    // Setup phase: both bots keep their initial tickets; then the burst stops (human pending).
    expect(batches.length).toBe(2);
    expect(delays.length).toBe(2);
    expect(delays.every((d) => d >= BOT_STEP_MS)).toBe(true);
    expect(session.nextActableBot()).toBeNull();
    expect(session.isGameOver).toBe(false);
  });

  it('cancellation stops the loop before the next move', async () => {
    const store = new InMemoryLocalGameStore();
    const session = await LocalGameSession.create(
      newOfflineSetup({
        mapId: 'taiwan',
        botCount: 2,
        difficulty: 'EASY',
        gameId: 'local:bd-2',
        seed: 'driver-spec-2',
      }),
      taiwanBoard(),
      store,
    );
    let moves = 0;
    await runBotBurst(session, {
      onBotMove: () => {
        moves++;
      },
      delay: async () => {},
      isCancelled: () => moves >= 1, // cancel after the first applied move
    });
    expect(moves).toBe(1);
  });
});

describe('botPauseMs', () => {
  it('is the base pace outside tunnels and stretches for tunnel reveals', () => {
    expect(botPauseMs('AWAIT_ACTION', 0)).toBe(BOT_STEP_MS);
    expect(botPauseMs('TUNNEL_PENDING', 3)).toBeGreaterThan(BOT_STEP_MS);
  });
});
```

Create `apps/mobile/src/offline/localSocket.test.ts`:

```ts
import type { Action } from '@trm/engine';
import { asPlayerId } from '@trm/shared';
import { LocalSocket } from './localSocket';

describe('LocalSocket', () => {
  it('maps stage commands through the shared codec to engine actions for the human', () => {
    const seen: Action[] = [];
    const human = asPlayerId('local:human');
    const socket = new LocalSocket(human, (a) => seen.push(a));

    socket.keepInitialTickets(['t1', 't2']);
    socket.drawBlind();
    socket.pass();
    socket.cameraUpdate({ cx: 1, cy: 2, span: 3 }); // cosmetic → no action

    expect(seen.map((a) => a.t)).toEqual(['KEEP_INITIAL_TICKETS', 'DRAW_BLIND', 'PASS']);
    expect(seen.every((a) => a.player === human)).toBe(true);
  });
});
```

Run: `yarn workspace @trm/mobile test "offline/(botDriver|localSocket)"`
Expected: FAIL — modules do not exist.

- [ ] **Step 2: Implement pacing + driver + socket**

`apps/mobile/src/offline/pacing.ts`:

```ts
// Client-side bot pacing — port of apps/server/src/ws/bot-pacing.ts (same constants), so a
// bot resolving a tunnel holds long enough for the reveal animation to play out on screen.
import type { Phase } from '@trm/engine';

const TUNNEL_REVEAL_STAGGER_MS = 500;
const TUNNEL_REVEAL_FLIP_MS = 600;
const TUNNEL_REVEAL_RESULT_PAD_MS = 120;
const TUNNEL_RESULT_READ_MS = 1000;

/** Base pause before each bot move — a calm, human-ish cadence. */
export const BOT_STEP_MS = 900;

export function botPauseMs(phase: Phase, revealedCount: number): number {
  if (phase !== 'TUNNEL_PENDING') return BOT_STEP_MS;
  const revealMs =
    Math.max(0, revealedCount - 1) * TUNNEL_REVEAL_STAGGER_MS +
    TUNNEL_REVEAL_FLIP_MS +
    TUNNEL_REVEAL_RESULT_PAD_MS;
  return Math.max(BOT_STEP_MS, revealMs + TUNNEL_RESULT_READ_MS);
}
```

`apps/mobile/src/offline/botDriver.ts`:

```ts
// Consecutive bot decisions until it's the human's turn or the game ends — the client-side
// port of GameHub.driveBots (apps/server/src/ws/hub.ts), minus persistence retries (the
// session already downgrades persistence failures to persistenceBroken).
import type { GameEvent } from '@trm/engine';
import type { LocalGameSession } from './localGameSession';
import { botPauseMs } from './pacing';

export interface BotBurstPorts {
  onBotMove(events: GameEvent[]): void;
  delay(ms: number): Promise<void>;
  isCancelled(): boolean;
}

export async function runBotBurst(
  session: LocalGameSession,
  ports: BotBurstPorts,
): Promise<void> {
  for (let guard = 0; guard < 10_000; guard++) {
    if (ports.isCancelled() || session.isGameOver) return;
    if (!session.nextActableBot()) return; // waiting on the human
    const revealed = session.raw().pendingTunnel?.revealed.length ?? 0;
    await ports.delay(botPauseMs(session.phase, revealed));
    if (ports.isCancelled()) return;
    const r = await session.botStep();
    if (r.kind !== 'moved') return;
    ports.onBotMove(r.events);
  }
}
```

`apps/mobile/src/offline/localSocket.ts`:

```ts
// GameCommands over the LOCAL engine — the mobile analogue of the web's SandboxSocket
// (apps/web/src/net/sandboxSocket.ts): stage commands go through the shared codec's
// commandToAction, so they travel the identical command→action mapping as the wire, then
// land in the offline session via the callback (which owns apply + projection + bots).
import { create, type MessageInitShape } from '@bufbuild/protobuf';
import { ClientEnvelopeSchema } from '@trm/proto';
import { commandToAction } from '@trm/codec';
import type { Action } from '@trm/engine';
import type { PlayerId } from '@trm/shared';
import type { GameCommands } from '../net/commands';
import type { PaymentInit, CameraViewInit } from '../net/socket';

type CommandInit = NonNullable<MessageInitShape<typeof ClientEnvelopeSchema>['command']>;

export class LocalSocket implements GameCommands {
  constructor(
    private readonly humanId: PlayerId,
    private readonly onAction: (action: Action) => void,
  ) {}

  private send(command: CommandInit): void {
    const env = create(ClientEnvelopeSchema, { command });
    const action = commandToAction(env.command, this.humanId);
    if (action) this.onAction(action);
  }

  keepInitialTickets(ticketIds: string[]): void {
    this.send({ case: 'keepInitialTickets', value: { ticketIds } });
  }
  keepTickets(ticketIds: string[]): void {
    this.send({ case: 'keepTickets', value: { ticketIds } });
  }
  drawBlind(): void {
    this.send({ case: 'drawBlind', value: {} });
  }
  drawFaceUp(slot: number): void {
    this.send({ case: 'drawFaceup', value: { slot } });
  }
  drawTickets(): void {
    this.send({ case: 'drawTickets', value: {} });
  }
  claimRoute(routeId: string, payment: PaymentInit): void {
    this.send({ case: 'claimRoute', value: { routeId, payment } });
  }
  buildStation(cityId: string, payment: PaymentInit): void {
    this.send({ case: 'buildStation', value: { cityId, payment } });
  }
  resolveTunnel(commit: boolean, extra?: PaymentInit): void {
    this.send({ case: 'resolveTunnel', value: commit ? { commit, extra } : { commit } });
  }
  pass(): void {
    this.send({ case: 'pass', value: {} });
  }
  cameraUpdate(_view: CameraViewInit): void {
    /* no-op offline: nobody to relay framing to */
  }
}
```

`apps/mobile/src/offline/useLocalGame.ts`:

```ts
// Owns one offline game for a mounted screen: create/resume the session, feed the SAME
// isolated game/log stores the live client uses (snapshot-authoritative, so GameStage
// cannot tell online from offline), and pace bot turns. Mirrors the web replay driver's
// store discipline (apps/web/src/features/replay/useReplayPlayer.ts).
import { useEffect, useRef, useState } from 'react';
import type { Action, GameEvent } from '@trm/engine';
import type { BotDifficulty } from '@trm/bots';
import type { GameStoreApi } from '../store/game';
import type { LogStoreApi } from '../store/log';
import type { GameCommands } from '../net/commands';
import { LocalGameSession } from './localGameSession';
import { LocalSocket } from './localSocket';
import { runBotBurst } from './botDriver';
import { loadOfflineGame } from './loadGame';
import { newOfflineSetup } from './newGame';
import { SqliteLocalGameStore } from './sqliteStore';
import { randomGameId, randomSeed } from './seed';
import { boardForContentHash } from '@trm/engine';
import type { LocalGameStorePort } from './types';

export type LocalGameInput =
  | { mode: 'new'; mapId: string; botCount: 1 | 2 | 3 | 4; difficulty: BotDifficulty }
  | { mode: 'resume'; gameId: string };

export interface LocalGameHandle {
  ready: boolean;
  error: 'load_failed' | 'engine_version' | 'unknown_content' | null;
  socket: GameCommands | null;
  gameId: string | null;
  /** Persistence failed: game continues in memory only (banner). */
  saveBroken: boolean;
  /** Resume truncated a corrupt tail (toast). */
  resumeTruncated: boolean;
}

export function useLocalGame(
  input: LocalGameInput,
  stores: { game: GameStoreApi; log: LogStoreApi },
  deps?: { store?: LocalGameStorePort },
): LocalGameHandle {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<LocalGameHandle['error']>(null);
  const [socket, setSocket] = useState<GameCommands | null>(null);
  const [gameId, setGameId] = useState<string | null>(null);
  const [saveBroken, setSaveBroken] = useState(false);
  const [resumeTruncated, setResumeTruncated] = useState(false);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    let session: LocalGameSession | null = null;

    const project = () => {
      if (session) stores.game.getState().applySnapshot(session.projectHuman());
    };
    const afterMove = (events: GameEvent[]) => {
      if (!session) return;
      project();
      const pb = session.redactEvents(events);
      if (pb.length > 0) {
        stores.game.getState().applyEvents(session.stateVersion, pb);
        stores.log.getState().ingestLive(pb);
      }
      if (session.persistenceBroken) setSaveBroken(true);
    };
    const burst = () => {
      if (!session) return;
      void runBotBurst(session, {
        onBotMove: afterMove,
        delay: (ms) => new Promise((r) => setTimeout(r, ms)),
        isCancelled: () => cancelled.current,
      });
    };

    void (async () => {
      try {
        const store = deps?.store ?? (await SqliteLocalGameStore.open());
        if (input.mode === 'new') {
          const setup = newOfflineSetup({
            mapId: input.mapId,
            botCount: input.botCount,
            difficulty: input.difficulty,
            gameId: randomGameId(),
            seed: randomSeed(),
          });
          const board = boardForContentHash(setup.config.contentHash);
          session = await LocalGameSession.create(setup, board, store);
        } else {
          const res = await loadOfflineGame(store, input.gameId);
          if (!res.ok) {
            setError(res.reason === 'not_found' ? 'load_failed' : res.reason);
            return;
          }
          session = res.session;
          if (res.report.discardedFromSeq !== null) setResumeTruncated(true);
          stores.log.getState().ingestHistory(res.history);
        }
        if (cancelled.current) return;
        setGameId(session.setup.gameId);
        project();
        const active = session;
        setSocket(
          new LocalSocket(active.humanId, (action: Action) => {
            void (async () => {
              const r = await active.apply(action);
              if (!r.ok) {
                stores.game.getState().setRejection({ code: 0, messageKey: 'actionRejected' });
                return;
              }
              afterMove(r.events);
              burst();
            })();
          }),
        );
        setReady(true);
        burst(); // bots may hold the very first decisions (setup keeps / first turn)
      } catch {
        setError('load_failed');
      }
    })();

    return () => {
      cancelled.current = true;
      stores.game.getState().reset();
      stores.log.getState().reset();
    };
    // Mount-only by design: input/stores are stable for the screen mount's lifetime
    // (same discipline as useReplayPlayer).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { ready, error, socket, gameId, saveBroken, resumeTruncated };
}
```

(`setRejection({ code: 0, messageKey: 'actionRejected' })` is the web sandbox's exact rejection shape — verify P2's store port kept it; if P2 renamed the message key, use theirs.)

- [ ] **Step 3: Run the tests**

Run: `yarn workspace @trm/mobile test "offline/(botDriver|localSocket)"`
Expected: PASS (4 tests). `useLocalGame` is exercised via the screen (Task 5) and the on-device gate (Task 7); its logic-bearing parts (session, driver, loader) are already unit-covered.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/offline/pacing.ts apps/mobile/src/offline/botDriver.ts apps/mobile/src/offline/localSocket.ts apps/mobile/src/offline/useLocalGame.ts apps/mobile/src/offline/botDriver.test.ts apps/mobile/src/offline/localSocket.test.ts
git commit -m "feat(mobile): local socket + client-side bot driver for offline games"
```

---### Task 5: Offline screens — setup, play, game over

Two screens plus navigation entries. The game screen wraps P2's `GameStage` in the sandbox providers (isolated stores) — the GAME_OVER victory scoreboard is P2's, rendered from the snapshot exactly as online; this screen only adds the play-again/home CTAs and the save/resume banners.

**Files:**

- Create: `apps/mobile/src/screens/OfflineSetupScreen.tsx`
- Create: `apps/mobile/src/screens/OfflineGameScreen.tsx`
- Create (only if P2 did not port it — check first): `apps/mobile/src/store/sandboxProvider.tsx`
- Modify: `apps/mobile/src/navigation/types.ts` (+ the navigator registration file P1 created — locate with `Grep createNativeStackNavigator apps/mobile/src`)
- Modify: `apps/mobile/src/i18n/index.ts` (keys below, Task 6 lists them all)

**Interfaces:**

- Consumes: `useLocalGame` (Task 4); P2 `GameStage` (`sandbox`, `commands`), `sandboxProvider` / `GameStoreProvider` + `LogStoreProvider`, `useGameStoreApi`/`useLogStoreApi`; P1 `RootStackParamList`; `OFFICIAL_MAPS` from `@trm/map-data`; `Phase` from `@trm/proto`.
- Produces: routes `OfflineSetup: undefined` and `OfflineGame: LocalGameInput` in `RootStackParamList`; screens `OfflineSetupScreen`, `OfflineGameScreen`.

- [ ] **Step 1: Navigation params + (conditional) sandbox provider**

Add to `RootStackParamList` in `apps/mobile/src/navigation/types.ts`:

```ts
  OfflineSetup: undefined;
  OfflineGame:
    | { mode: 'new'; mapId: string; botCount: 1 | 2 | 3 | 4; difficulty: BotDifficulty }
    | { mode: 'resume'; gameId: string };
```

(import `type { BotDifficulty } from '@trm/bots'`.) Register both screens in the native-stack navigator beside the existing Game screen (`headerShown: false` if that is the P1 idiom — match neighbors).

If `apps/mobile/src/store/sandboxProvider.tsx` does not exist, port it from `apps/web/src/store/sandboxProvider.tsx` verbatim minus any store P2 hasn't ported (the animations store line drops if there is no `store/animations`):

```tsx
import { useState, type ReactNode } from 'react';
import { createGameStore, GameStoreProvider } from './game';
import { createLogStore, LogStoreProvider } from './log';

/** Wraps its subtree in FRESH, isolated game + log stores (web sandboxProvider port):
 *  the offline game writes only here — the live singletons are never touched. */
export function SandboxProvider({ children }: { children: ReactNode }) {
  const [gameStore] = useState(() => createGameStore());
  const [logStore] = useState(() => createLogStore());
  return (
    <GameStoreProvider value={gameStore}>
      <LogStoreProvider value={logStore}>{children}</LogStoreProvider>
    </GameStoreProvider>
  );
}
```

- [ ] **Step 2: Implement the setup screen**

`apps/mobile/src/screens/OfflineSetupScreen.tsx`:

```tsx
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { OFFICIAL_MAPS } from '@trm/map-data';
import { BOT_DIFFICULTIES, type BotDifficulty } from '@trm/bots';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'OfflineSetup'>;

const BOT_COUNTS = [1, 2, 3, 4] as const;

function Choice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.choice, selected && styles.choiceSelected]}
    >
      <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{label}</Text>
    </Pressable>
  );
}

export function OfflineSetupScreen({ navigation }: Props) {
  const { t, i18n } = useTranslation();
  const zh = i18n.language.startsWith('zh');
  const [mapId, setMapId] = useState(OFFICIAL_MAPS[0]!.mapId);
  const [botCount, setBotCount] = useState<(typeof BOT_COUNTS)[number]>(2);
  const [difficulty, setDifficulty] = useState<BotDifficulty>('MEDIUM');

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Text style={styles.title}>{t('offline.newGame')}</Text>

      <Text style={styles.label}>{t('offline.map')}</Text>
      <View style={styles.row}>
        {OFFICIAL_MAPS.map((m) => (
          <Choice
            key={m.mapId}
            label={zh ? m.content.meta.nameZh : m.content.meta.nameEn}
            selected={mapId === m.mapId}
            onPress={() => setMapId(m.mapId)}
          />
        ))}
      </View>

      <Text style={styles.label}>{t('offline.botCount')}</Text>
      <View style={styles.row}>
        {BOT_COUNTS.map((n) => (
          <Choice key={n} label={String(n)} selected={botCount === n} onPress={() => setBotCount(n)} />
        ))}
      </View>

      <Text style={styles.label}>{t('offline.difficulty')}</Text>
      <View style={styles.row}>
        {BOT_DIFFICULTIES.map((d) => (
          <Choice
            key={d}
            label={t(`offline.difficulty${d}`)}
            selected={difficulty === d}
            onPress={() => setDifficulty(d)}
          />
        ))}
      </View>

      <Pressable
        accessibilityRole="button"
        style={styles.start}
        onPress={() => navigation.replace('OfflineGame', { mode: 'new', mapId, botCount, difficulty })}
      >
        <Text style={styles.startText}>{t('offline.start')}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { padding: 20, gap: 8 },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 8 },
  label: { fontSize: 14, opacity: 0.7, marginTop: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  choice: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: '#8884' },
  choiceSelected: { borderColor: '#4a7', backgroundColor: '#4a72' },
  choiceText: { fontSize: 15 },
  choiceTextSelected: { fontWeight: '700' },
  start: { marginTop: 24, padding: 14, borderRadius: 10, alignItems: 'center', backgroundColor: '#4a7' },
  startText: { fontSize: 16, fontWeight: '700', color: '#fff' },
});
```

(Restyle with P2's theme tokens if `apps/mobile/src/theme/` exposes them — match neighboring screens rather than shipping these placeholder hexes if a theme exists.)

- [ ] **Step 3: Implement the game screen**

`apps/mobile/src/screens/OfflineGameScreen.tsx`:

```tsx
// Offline play: LocalGameSession → isolated sandbox stores → the SAME GameStage as online.
// GAME_OVER scoring is P2's victory UI, driven by the snapshot exactly as a live game;
// this screen only adds offline banners + post-game CTAs.
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useStore } from 'zustand';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Phase } from '@trm/proto';
import type { RootStackParamList } from '../navigation/types';
import { SandboxProvider } from '../store/sandboxProvider';
import { useGameStoreApi } from '../store/game';
import { useLogStoreApi } from '../store/log';
import { useLocalGame } from '../offline/useLocalGame';
import { GameStage } from './GameStage';

type Props = NativeStackScreenProps<RootStackParamList, 'OfflineGame'>;

function OfflineGameView({ route, navigation }: Props) {
  const { t } = useTranslation();
  const game = useGameStoreApi();
  const log = useLogStoreApi();
  const handle = useLocalGame(route.params, { game, log });
  const phase = useStore(game, (s) => s.snapshot?.phase);

  if (handle.error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>
          {handle.error === 'engine_version' || handle.error === 'unknown_content'
            ? t('offline.incompatible')
            : t('offline.loadFailed')}
        </Text>
        <Pressable accessibilityRole="button" style={styles.cta} onPress={() => navigation.popToTop()}>
          <Text style={styles.ctaText}>{t('offline.backHome')}</Text>
        </Pressable>
      </View>
    );
  }
  if (!handle.ready || !handle.socket) {
    return <View style={styles.center} />;
  }

  return (
    <View style={styles.root}>
      {handle.saveBroken && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{t('offline.cantSave')}</Text>
        </View>
      )}
      {handle.resumeTruncated && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{t('offline.resumeTruncated')}</Text>
        </View>
      )}
      <GameStage sandbox commands={handle.socket} />
      {phase === Phase.GAME_OVER && (
        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            style={styles.cta}
            onPress={() => navigation.replace('OfflineSetup')}
          >
            <Text style={styles.ctaText}>{t('offline.playAgain')}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" style={styles.cta} onPress={() => navigation.popToTop()}>
            <Text style={styles.ctaText}>{t('offline.backHome')}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

export function OfflineGameScreen(props: Props) {
  return (
    <SandboxProvider>
      <OfflineGameView {...props} />
    </SandboxProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  errorText: { fontSize: 15, textAlign: 'center' },
  banner: { backgroundColor: '#b5852a', paddingVertical: 6, paddingHorizontal: 12 },
  bannerText: { color: '#fff', fontSize: 13 },
  footer: { flexDirection: 'row', gap: 12, justifyContent: 'center', padding: 12 },
  cta: { paddingVertical: 10, paddingHorizontal: 18, borderRadius: 10, backgroundColor: '#4a7' },
  ctaText: { color: '#fff', fontWeight: '700' },
});
```

(**P2 contract at the call site:** `GameStage` must take `sandbox` + `commands: GameCommands`. If P2's GameStage receives commands via context/prop under another name, adapt THIS file — never change GameStage for offline. Verify: `Grep "commands" apps/mobile/src/screens/GameStage.tsx`.)

- [ ] **Step 4: Typecheck + run the mobile suite**

Run: `yarn workspace @trm/mobile typecheck && yarn workspace @trm/mobile test offline`
Expected: clean / PASS. (Screens have no dedicated jest specs — their logic lives in the tested hook/session; rendering is covered by the Task 7 device gate.)

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/screens/OfflineSetupScreen.tsx apps/mobile/src/screens/OfflineGameScreen.tsx apps/mobile/src/navigation/types.ts
# plus the navigator registration file you edited, and store/sandboxProvider.tsx if created:
git commit -m "feat(mobile): offline game screens (setup, play, game over)"
```

---

### Task 6: Home entry, resume list, offline banner posture, i18n

The Apple 4.2 reviewer path: in airplane mode, Home shows a branded offline banner, online entries are visibly disabled, and Play-vs-Bots (+ resume list) stays fully live.

**Files:**

- Create: `apps/mobile/src/hooks/useOnline.ts`
- Create: `apps/mobile/src/components/OfflineBanner.tsx`
- Create: `apps/mobile/src/offline/OfflineHomeSection.tsx`
- Create: `apps/mobile/src/offline/OfflineHomeSection.test.tsx`
- Modify: `apps/mobile/src/screens/HomeScreen.tsx` (P1 file — embed the section + gate online entries)
- Modify: `apps/mobile/src/i18n/index.ts`

**Interfaces:**

- Consumes: `SqliteLocalGameStore` / `LocalGameStorePort` / `OfflineGameListEntry` (Task 2/3); `officialMapById` (map display names); `@react-native-community/netinfo`; P1 Home + i18n.
- Produces: `useOnline(): boolean`; `<OfflineBanner />`; `<OfflineHomeSection onNewGame={() => void} onResume={(gameId) => void} store?: LocalGameStorePort />`.

- [ ] **Step 1: Write the failing component test**

Create `apps/mobile/src/offline/OfflineHomeSection.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { taiwanBoard } from '@trm/engine';
import { InMemoryLocalGameStore } from './inMemoryStore';
import { LocalGameSession } from './localGameSession';
import { newOfflineSetup } from './newGame';
import { OfflineHomeSection } from './OfflineHomeSection';

describe('OfflineHomeSection', () => {
  it('offers Play vs Bots and lists resumable games', async () => {
    const store = new InMemoryLocalGameStore();
    await LocalGameSession.create(
      newOfflineSetup({
        mapId: 'taiwan',
        botCount: 3,
        difficulty: 'HARD',
        gameId: 'local:home-1',
        seed: 's',
      }),
      taiwanBoard(),
      store,
    );

    const onNewGame = jest.fn();
    const onResume = jest.fn();
    render(<OfflineHomeSection onNewGame={onNewGame} onResume={onResume} store={store} />);

    fireEvent.press(screen.getByTestId('offline-play-bots'));
    expect(onNewGame).toHaveBeenCalled();

    const entry = await waitFor(() => screen.getByTestId('offline-resume-local:home-1'));
    fireEvent.press(entry);
    expect(onResume).toHaveBeenCalledWith('local:home-1');
  });
});
```

Run: `yarn workspace @trm/mobile test OfflineHomeSection`
Expected: FAIL — module does not exist. (If `@testing-library/react-native` is missing from P1's devDeps: `yarn workspace @trm/mobile add -D @testing-library/react-native` and note it in the commit.)

- [ ] **Step 2: Implement hook, banner, section**

`apps/mobile/src/hooks/useOnline.ts`:

```ts
// NetInfo-driven online/offline posture (spec §8). Online features render disabled behind
// the OfflineBanner when this is false; offline entries (Play vs Bots, Tutorial) never gate.
import { useEffect, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';

export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(
    () =>
      NetInfo.addEventListener((s) => {
        setOnline(!!s.isConnected && s.isInternetReachable !== false);
      }),
    [],
  );
  return online;
}
```

`apps/mobile/src/components/OfflineBanner.tsx`:

```tsx
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

export function OfflineBanner() {
  const { t } = useTranslation();
  return (
    <View style={styles.banner} accessibilityRole="alert">
      <Text style={styles.text}>{t('offline.banner')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { backgroundColor: '#555', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8 },
  text: { color: '#fff', fontSize: 13 },
});
```

`apps/mobile/src/offline/OfflineHomeSection.tsx`:

```tsx
// Home's offline block: the Play-vs-Bots entry + the in-progress resume list. Injectable
// store for tests; defaults to the on-device sqlite store. Reloads whenever the screen
// regains focus (a finished/abandoned game must drop off the list).
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { officialMapById } from '@trm/map-data';
import { SqliteLocalGameStore } from './sqliteStore';
import type { LocalGameStorePort, OfflineGameListEntry } from './types';

export interface OfflineHomeSectionProps {
  onNewGame(): void;
  onResume(gameId: string): void;
  /** Test seam; on-device callers omit it. */
  store?: LocalGameStorePort;
}

export function OfflineHomeSection({ onNewGame, onResume, store }: OfflineHomeSectionProps) {
  const { t, i18n } = useTranslation();
  const zh = i18n.language.startsWith('zh');
  const [entries, setEntries] = useState<OfflineGameListEntry[]>([]);

  const reload = useCallback(async () => {
    const s = store ?? (await SqliteLocalGameStore.open());
    const all = await s.listGames();
    setEntries(all.filter((e) => e.status === 'LIVE'));
  }, [store]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const mapName = (mapId: string): string => {
    const m = officialMapById(mapId);
    return m ? (zh ? m.content.meta.nameZh : m.content.meta.nameEn) : mapId;
  };

  const remove = async (gameId: string) => {
    const s = store ?? (await SqliteLocalGameStore.open());
    await s.deleteGame(gameId);
    await reload();
  };

  return (
    <View style={styles.section}>
      <Pressable
        testID="offline-play-bots"
        accessibilityRole="button"
        style={styles.play}
        onPress={onNewGame}
      >
        <Text style={styles.playText}>{t('home.playBots')}</Text>
      </Pressable>

      {entries.length > 0 && (
        <View style={styles.list}>
          <Text style={styles.listTitle}>{t('home.resumeOffline')}</Text>
          {entries.map((e) => (
            <View key={e.gameId} style={styles.rowWrap}>
              <Pressable
                testID={`offline-resume-${e.gameId}`}
                accessibilityRole="button"
                style={styles.row}
                onPress={() => onResume(e.gameId)}
              >
                <Text style={styles.rowTitle}>
                  {mapName(e.mapId)} · {t('offline.botsN', { count: e.botCount })}
                </Text>
                <Text style={styles.rowSub}>
                  {t('offline.inProgress')} · {new Date(e.updatedAt).toLocaleString()}
                </Text>
              </Pressable>
              <Pressable
                testID={`offline-delete-${e.gameId}`}
                accessibilityRole="button"
                accessibilityLabel={t('offline.delete')}
                onPress={() => void remove(e.gameId)}
                style={styles.delete}
              >
                <Text style={styles.deleteText}>×</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 12 },
  play: { padding: 16, borderRadius: 12, backgroundColor: '#4a7', alignItems: 'center' },
  playText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  list: { gap: 8 },
  listTitle: { fontSize: 14, opacity: 0.7 },
  rowWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  row: { flex: 1, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#8884' },
  rowTitle: { fontSize: 15, fontWeight: '600' },
  rowSub: { fontSize: 12, opacity: 0.6, marginTop: 2 },
  delete: { padding: 10 },
  deleteText: { fontSize: 18, opacity: 0.6 },
});
```

- [ ] **Step 3: i18n keys (zh-Hant primary + en)**

In `apps/mobile/src/i18n/index.ts`, add to BOTH locale tables using the file's existing shape (P1 ported the web idiom — nested objects keyed without dots):

| key | zh-Hant | en |
| --- | --- | --- |
| `home.playBots` | `離線對戰電腦` | `Play vs Bots` |
| `home.resumeOffline` | `繼續離線對局` | `Resume offline games` |
| `offline.newGame` | `新離線對局` | `New offline game` |
| `offline.map` | `地圖` | `Map` |
| `offline.botCount` | `電腦玩家數` | `Bots` |
| `offline.difficulty` | `難度` | `Difficulty` |
| `offline.difficultyEASY` | `簡單` | `Easy` |
| `offline.difficultyMEDIUM` | `普通` | `Medium` |
| `offline.difficultyHARD` | `困難` | `Hard` |
| `offline.start` | `開始對局` | `Start game` |
| `offline.botsN` | `{{count}} 名電腦玩家` | `{{count}} bot(s)` |
| `offline.inProgress` | `進行中` | `In progress` |
| `offline.delete` | `刪除` | `Delete` |
| `offline.playAgain` | `再來一局` | `Play again` |
| `offline.backHome` | `回到首頁` | `Back to home` |
| `offline.cantSave` | `無法儲存進度——對局仍可繼續,但關閉 App 後將遺失。` | `Progress can't be saved — you can keep playing, but this game will be lost when the app closes.` |
| `offline.resumeTruncated` | `偵測到損毀的存檔,已回復到最後一個完好的回合。` | `Corrupted save detected — restored to the last intact turn.` |
| `offline.incompatible` | `此存檔由不相容的版本建立,無法繼續。` | `This save was created by an incompatible app version and can't be resumed.` |
| `offline.loadFailed` | `無法載入離線對局。` | `Couldn't load this offline game.` |
| `offline.banner` | `目前離線——線上功能已暫停;離線對戰與教學仍可使用。` | `You're offline — online features are paused; offline play and the tutorial still work.` |

- [ ] **Step 4: Wire into HomeScreen (P1 file — minimal, surgical diff)**

In `apps/mobile/src/screens/HomeScreen.tsx`:

1. `const online = useOnline();` — render `<OfflineBanner />` at the top when `!online`.
2. Render `<OfflineHomeSection onNewGame={() => navigation.navigate('OfflineSetup')} onResume={(gameId) => navigation.navigate('OfflineGame', { mode: 'resume', gameId })} />` **above** the online sections (rooms/history/etc.).
3. Disable (visually + `disabled`) every online entry point when `!online`. Do NOT disable the offline section or the Tutorial entry (P4).

The exact JSX depends on P1's Home layout — keep the section self-contained so the Home diff is a hook call + two elements + `disabled={!online}` flags. Verify afterward: `Grep OfflineHomeSection apps/mobile/src/screens/HomeScreen.tsx`.

- [ ] **Step 5: Run the tests**

Run: `yarn workspace @trm/mobile test OfflineHomeSection`
Expected: PASS.
Run: `yarn workspace @trm/mobile test && yarn workspace @trm/mobile typecheck`
Expected: full mobile suite PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/hooks/useOnline.ts apps/mobile/src/components/OfflineBanner.tsx apps/mobile/src/offline/OfflineHomeSection.tsx apps/mobile/src/offline/OfflineHomeSection.test.tsx apps/mobile/src/screens/HomeScreen.tsx apps/mobile/src/i18n/index.ts
git commit -m "feat(mobile): Home offline entry, resume list, and offline banner"
```

---

### Task 7: Docs + full-repo gates + device smoke

**Files:**

- Modify: `CLAUDE.md` (root — monorepo layout section)
- Modify: `apps/server/CLAUDE.md` (`src/bots/` bullet)
- Modify: `apps/mobile/CLAUDE.md` (append offline section; create a minimal file if P1/P2 didn't)

- [ ] **Step 1: Root `CLAUDE.md`**

In "Monorepo layout & build order", update the build-order line to include bots:

```
packages/proto  → shared → map-data → engine → bots/codec → apps/{server,web,admin,mobile}
```

and add a bullet after the `@trm/engine` one:

```markdown
- `@trm/bots` — the pure bot policy (`chooseBotAction`: ranks the engine's own `legalActions`
  with difficulty heuristics; deterministic per state+botId). Shared by the server's bot
  driver and the mobile app's offline games.
```

- [ ] **Step 2: `apps/server/CLAUDE.md`**

Rewrite the `src/bots/` bullet in "Auth, lobby, bots" to:

```markdown
- **Bots** — a bot is an **ordinary seated player driven server-side** (the engine never
  knows). The brain lives in `packages/bots` (`@trm/bots`): `chooseBotAction` ranks moves
  from the engine's own `legalActions` (a bot can never make an illegal move) and is a
  deterministic function of `state + botId`. The hub's bot driver (`ws/hub.ts`) runs each
  bot through the **same** prepare→persist→commit→fan-out path as a human, and bot moves
  are logged actions, so replay/recovery are unaffected. The roster is persisted on the
  game doc and resumes after recovery. `TRM_BOT_DELAY_MS` paces moves (0 in tests).
```

- [ ] **Step 3: `apps/mobile/CLAUDE.md`** — append:

```markdown
## Offline vs bots (`src/offline/`)

Serverless mirror of the server's authoritative loop. `localGameSession.ts` runs the real
`@trm/engine` with `@trm/bots` driving bot seats, appends every accepted action to an
event-sourced expo-sqlite log **before** committing (write-ahead, `(game_id, seq)` PK =
double-apply guard), and the UI only ever sees `redactFor(human)` → `viewToSnapshot` into
the sandbox stores — `GameStage` cannot tell online from offline. Resume digest-verifies
the log and **truncates** a corrupt tail (server recovery aborts instead; offline must
never crash into a corrupt save). Version pins: `engineVersion` + registered `contentHash`
refuse cross-version resume. Randomness (seed/gameId) comes from `expo-crypto` in
`seed.ts` ONLY — never inside game logic. Bundled official maps only (custom-map offline
is deferred — docs/TODO.md). Pure core (no RN imports) → jest-testable off-device;
`inMemoryStore.ts` is the port double.
```

- [ ] **Step 4: Full gates**

Run: `yarn typecheck && yarn lint && yarn test`
Expected: clean across all workspaces (turbo runs proto codegen first; the server suite re-validates the Task 1 swap; mobile jest runs the offline suites).
Run: `yarn format:check`
Expected: clean (fix with targeted `yarn prettier --write <file>` if not).

- [ ] **Step 5: Device smoke (the only non-automatable gate — expo-sqlite/NetInfo are native)**

Run: `yarn workspace @trm/mobile android` (or `expo run:android` from `apps/mobile/` — the P1 dev-loop command). On the emulator:

1. Enable airplane mode → Home shows the offline banner; online entries disabled; Play vs Bots active.
2. Start a 2-bot MEDIUM game → bots visibly pace their moves; claim a route; force-kill the app.
3. Relaunch (still offline) → the game appears in the resume list → resumes at the same position (digest-verified path).
4. Finish a quick 1-bot game (or play until GAME_OVER) → P2's victory scoreboard renders; Play again / Back to home CTAs work; the finished game leaves the resume list.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md apps/server/CLAUDE.md apps/mobile/CLAUDE.md
git commit -m "docs: document @trm/bots and the mobile offline architecture"
```
