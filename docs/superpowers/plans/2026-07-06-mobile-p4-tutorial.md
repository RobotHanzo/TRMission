# Mobile Tutorial Native Rebuild (P4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **REGROUND BEFORE EXECUTING:** this plan was written at spec time (2026-07-06). Before executing, re-verify library versions, file anchors, and the Consumes list against the then-current repo — prior phases will have moved things.

**Goal:** Rebuild the interactive tutorial natively in `apps/mobile` (spec §6): the pure curriculum/beat model and the local game simulation port from `apps/web` **byte-identically** (a parity test pins them), while the DOM spotlight becomes a ref-registered `TutorialTargetRegistry` measured with `measureInWindow`, the scrim becomes a Skia masked-dim overlay, the coachmark + Specimens visual glossary re-render as RN views, board framing rides P2's `frameTarget` camera, completion persists to AsyncStorage, and Home gets a fully offline-capable entry point.

**Architecture:** The web tutorial already splits cleanly into (a) pure data + logic — `types.ts` (Beat/Lesson/gateFlags/expectMatches), `curriculum.ts` (the authored lessons), `focus.ts` (selector mapping + coachmark geometry), `net/sandboxSocket.ts` (a server-less engine driver projecting through `redactFor`/`viewToSnapshot` into the same game store), `useScenarioPlayer.ts` (beat walker) — and (b) a DOM presentation layer (`useSpotlightRects` via `querySelector`/`getBoundingClientRect`, SVG scrim, HTML coachmark, SVG specimens). Group (a) ports as-is; only (b) is rebuilt. The web's CSS-selector strings (`'.market'`, `'[data-anim="draw-tickets"]'`, `'[data-city-id="…"]'`, …) become the **anchor-id namespace** of a React-context registry that P2's native components register measurable refs into — the same strings, so the curriculum stays shared content with zero divergence. City/route spotlights (which the web measures off SVG elements) are instead computed from board geometry projected through P2's camera transform — the same affine the web's `game/boardView.ts` documents.

**Tech Stack:** Expo SDK 56 / RN 0.85 / React 19.2 (`apps/mobile`, from P1), `@shopify/react-native-skia` 2.x (scrim; from P2), `@react-native-async-storage/async-storage` (new dep, completion persistence), react-i18next (P1 port), zustand game store (P1 port), `@trm/engine`/`@trm/shared`/`@trm/proto`/`@trm/codec`/`@trm/map-data` (workspace packages, used as-is). Tests: **vitest** for pure TS (`*.spec.ts`), **jest-expo + @testing-library/react-native** for RN components (`*.test.tsx?`).

## Global Constraints

- **Anchor-id parity is load-bearing:** every tutorial anchor id is byte-for-byte the string the web uses as a CSS selector. `apps/mobile/src/features/tutorial/{types.ts,curriculum.ts,focus.ts}` and `apps/mobile/src/i18n/tutorial.ts` are **verbatim copies** of their `apps/web` counterparts, enforced by `parity.spec.ts` (Task 2). Never "improve" these files on the mobile side — a shared change lands in `apps/web` first, then re-copies.
- **No server changes.** The tutorial is fully offline (`SandboxSocket` over the local engine); P0's mobile server surface is untouched and no new endpoints exist in this plan.
- **Test lanes** (assumed from P1; Task 1 verifies and, if the names differ, substitute uniformly through this plan): `yarn workspace @trm/mobile test:pure --run <substring>` = vitest over `src/**/*.spec.ts` (node env, pure TS); `yarn workspace @trm/mobile test <pattern>` = jest-expo over `**/*.test.@(ts|tsx)`. The two globs must stay disjoint (jest must NOT match `*.spec.ts`).
- Monorepo pins that bind here: Yarn 4 with `nodeLinker: node-modules`; server stays swc-not-tsx; `apps/web` keeps Vite ^5 (this plan only READS web sources — the web suite must pass untouched); the 6th card colour is **PURPLE, never PINK**; engine purity rules (no `Date`/`Math.random` in `@trm/engine` — the tutorial's determinism comes from each lesson's fixed `seed`); UI ships zh-Hant primary + en (all new strings ride the ported `i18n/tutorial.ts` module or P1's existing tables).
- Never `git add -A` / `git add .` — stage only files this plan touches (other agents share the worktree).
- New RN code follows P2's component conventions (StyleSheet objects, `useWindowDimensions` — never static device classes, `testID` on interactive elements).
- Registered anchor Views must carry `collapsable={false}` (the `useTutorialAnchor` hook returns it) — Android view flattening otherwise removes the node `measureInWindow` needs.
- Where this plan touches a P1/P2 file whose exact shape is owned by that phase (HomeScreen, navigation, GameStage), the step gives the contract + a verification command; apply the edit in that file's local idiom rather than pasting blindly.

---

### Task 1: Reground — verify the prior-phase contracts

No commit. Every later task assumes the artifacts below; confirm them (and record any renames) before writing code.

**Files:** none created.

**Interfaces:**

- Consumes (P1): workspace `@trm/mobile` at `apps/mobile`; `src/store/game.ts` exporting `useGame` with `applySnapshot`/`applyEvents`/`setRejection`/`reset` (web-identical store API); `src/i18n/index.ts` (side-effect i18next init, zh-Hant + en); React Navigation 7 native-stack with `RootStackParamList` (`src/navigation/types.ts`) and `src/screens/HomeScreen.tsx`; the two test lanes from Global Constraints.
- Consumes (P2): `src/screens/GameStage.tsx` with the web-mirrored props `snapshot, commands, onLeave, overlay, spotlightCities, frameTarget, actionGate, sandbox`; `src/game/content.ts` (`cityById`, `routeById`, `ticketById`, `cityName`); `src/game/boardView.ts` (`BoardFrameTarget`, `BoardTransform`, `BoardProjection`); `src/game/catalog.ts` (`resetToDefaultContent`); `src/net/commands.ts` (`GameCommands`); `src/net/socket.ts` (`PaymentInit`, `CameraViewInit` types); native `TrainCarCard` + `TicketCard` components; a reusable route-track painter (the board necessarily factors per-route painting — same "specimens cannot drift" rationale as web); a live-camera read seam (see Task 6); jest-expo config with the Skia mock in `setupFiles` (P2's own board tests need it).
- Consumes (P3): the local-simulation seam is proven (`LocalGameSession` feeding the store via `redactFor` → `viewToSnapshot`); P3 may or may not have ported `src/net/sandboxSocket.ts` — Task 3 reuses it if present.

- [ ] **Step 1: Run the audit commands and record the results**

```bash
cd "d:/Web Projects/TRMission"
node -e "const p=require('./apps/mobile/package.json'); console.log(p.name, JSON.stringify(p.scripts, null, 2))"
grep -n "BoardFrameTarget\|BoardTransform\|BoardProjection" apps/mobile/src/game/boardView.ts
grep -n "spotlightCities\|frameTarget\|actionGate\|overlay\|sandbox" apps/mobile/src/screens/GameStage.tsx
grep -n "applySnapshot\|applyEvents\|setRejection\|reset" apps/mobile/src/store/game.ts | head -8
grep -rln "sandboxSocket" apps/mobile/src || echo "sandboxSocket not ported yet -> Task 3 creates it"
grep -rn "export function TrainCarCard\|export function TicketCard" apps/mobile/src/components
grep -rn "skia" apps/mobile/jest.config.* apps/mobile/package.json 2>/dev/null
grep -rn "RootStackParamList" apps/mobile/src/navigation
```

Expected: every grep hits (paths may differ — note the real ones and substitute in later tasks). If `apps/mobile/src/game/boardView.ts` does not exist or `BoardFrameTarget` lives elsewhere, create a re-export shim at that exact path (it keeps Task 2's byte-parity possible):

```ts
// apps/mobile/src/game/boardView.ts — path shim so tutorial sources stay byte-identical to web.
export type { BoardFrameTarget, BoardTransform, BoardProjection } from '<P2 actual location>';
```

- [ ] **Step 2: Verify the vitest/jest lanes are disjoint**

```bash
node -e "const p=require('./apps/mobile/package.json'); console.log(p.jest ? JSON.stringify(p.jest.testMatch) : 'jest config file'); "
cat apps/mobile/vitest.config.ts 2>/dev/null || echo "no vitest lane"
```

If there is no vitest lane, add one now (this is P4 infrastructure, allowed):

```ts
// apps/mobile/vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['src/**/*.spec.ts'], environment: 'node' },
});
```

plus `"test:pure": "vitest run"` in `apps/mobile/package.json` scripts, and restrict jest to `"testMatch": ["**/*.test.ts", "**/*.test.tsx"]` so the lanes never overlap. If you had to add these, include them in Task 2's commit.

---

### Task 2: Port the pure tutorial core verbatim (parity-gated)

**Files:**

- Create: `apps/mobile/src/features/tutorial/types.ts` (copy of `apps/web/src/features/tutorial/types.ts`)
- Create: `apps/mobile/src/features/tutorial/curriculum.ts` (copy of `apps/web/src/features/tutorial/curriculum.ts`)
- Create: `apps/mobile/src/features/tutorial/focus.ts` (copy of `apps/web/src/features/tutorial/focus.ts`)
- Create: `apps/mobile/src/i18n/tutorial.ts` (copy of `apps/web/src/i18n/tutorial.ts`)
- Modify: `apps/mobile/src/i18n/index.ts` (register the tutorial namespaces)
- Create: `apps/mobile/src/features/tutorial/parity.spec.ts`
- Create: `apps/mobile/src/features/tutorial/gate.spec.ts` (content of web `gate.test.ts`)
- Create: `apps/mobile/src/features/tutorial/focus.spec.ts` (content of web `focus.test.ts`)

**Interfaces:**

- Consumes: `apps/mobile/src/game/boardView.ts` → `BoardFrameTarget` (Task 1), `@trm/engine`, `@trm/shared`.
- Produces: `Lesson`/`Beat`/`Spotlight`/`SpecimenSpec`/`ExpectSpec`/`ActionGate`/`gateFlags`/`expectMatches` (types.ts); `LESSONS`/`lessonsForScope`/`encyclopediaEntries` (curriculum.ts); `HUD_SPOTLIGHT_SELECTORS`/`isAllowedHudSelector`/`selectorsForSpotlight`/`FlatRect`/`CoachPos`/`coachPosition`/`spotlightCentre`/`spotlightBounds` (focus.ts); `tutorialZh`/`tutorialEn` (i18n). All byte-identical to web — later phases and the web itself can treat these as one artifact.

- [ ] **Step 1: Write the failing parity test**

Create `apps/mobile/src/features/tutorial/parity.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The curriculum is SHARED CONTENT: the anchor-id strings inside it are the web's CSS selectors
// and the mobile registry's anchor ids at once. Any drift pins a permanent maintenance tax, so
// the ported core must stay byte-identical (modulo line endings) to apps/web. A legitimate
// change lands in apps/web first, then re-copies here.
const here = dirname(fileURLToPath(import.meta.url));
const webTutorial = join(here, '..', '..', '..', '..', 'web', 'src', 'features', 'tutorial');
const norm = (s: string): string => s.replace(/\r\n/g, '\n').trimEnd();
const read = (p: string): string => norm(readFileSync(p, 'utf8'));

describe('tutorial core is byte-identical to apps/web', () => {
  for (const f of ['types.ts', 'curriculum.ts', 'focus.ts'] as const) {
    it(`features/tutorial/${f}`, () => {
      expect(read(join(here, f))).toBe(read(join(webTutorial, f)));
    });
  }
  it('i18n/tutorial.ts', () => {
    expect(read(join(here, '..', '..', 'i18n', 'tutorial.ts'))).toBe(
      read(join(webTutorial, '..', '..', 'i18n', 'tutorial.ts')),
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn workspace @trm/mobile test:pure --run parity`
Expected: FAIL — `ENOENT` on the mobile copies (they don't exist yet).

- [ ] **Step 3: Copy the four modules verbatim + register i18n**

```bash
cd "d:/Web Projects/TRMission"
cp apps/web/src/features/tutorial/types.ts       apps/mobile/src/features/tutorial/types.ts
cp apps/web/src/features/tutorial/curriculum.ts  apps/mobile/src/features/tutorial/curriculum.ts
cp apps/web/src/features/tutorial/focus.ts       apps/mobile/src/features/tutorial/focus.ts
cp apps/web/src/i18n/tutorial.ts                 apps/mobile/src/i18n/tutorial.ts
```

In `apps/mobile/src/i18n/index.ts`, mirror the web's registration (`apps/web/src/i18n/index.ts` lines 3, 10, 519): import `{ tutorialZh, tutorialEn }` from `./tutorial` and nest them as the `tutorial` key inside the zh-Hant and en resource objects respectively. Apply in P1's local idiom.

- [ ] **Step 4: Port the two pure test suites**

```bash
cp apps/web/src/features/tutorial/gate.test.ts  apps/mobile/src/features/tutorial/gate.spec.ts
cp apps/web/src/features/tutorial/focus.test.ts apps/mobile/src/features/tutorial/focus.spec.ts
```

(Content unchanged — only the extension moves them into the vitest lane.)

- [ ] **Step 5: Run to verify everything passes**

Run: `yarn workspace @trm/mobile test:pure --run tutorial`
Expected: PASS — parity (4 files), gate (all lessons), focus (selectors + coach positions).
Run: `yarn workspace @trm/mobile test:pure` and `yarn typecheck`
Expected: PASS / clean (if `types.ts` fails to resolve `../../game/boardView`, revisit Task 1's shim).

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/features/tutorial/types.ts apps/mobile/src/features/tutorial/curriculum.ts apps/mobile/src/features/tutorial/focus.ts apps/mobile/src/i18n/tutorial.ts apps/mobile/src/i18n/index.ts apps/mobile/src/features/tutorial/parity.spec.ts apps/mobile/src/features/tutorial/gate.spec.ts apps/mobile/src/features/tutorial/focus.spec.ts
git commit -m "feat(mobile): port the tutorial beat model + curriculum, web-parity gated"
```

(If Task 1 Step 2 created `vitest.config.ts`/script/jest-glob changes, `git add apps/mobile/vitest.config.ts apps/mobile/package.json` too.)

---

### Task 3: Local simulation — SandboxSocket + scenario player + engine walkthrough

**Files:**

- Create: `apps/mobile/src/net/sandboxSocket.ts` (copy of `apps/web/src/net/sandboxSocket.ts`) — **skip if P3 already ported it** (Task 1 grep); then only verify its path matches the imports below.
- Create: `apps/mobile/src/features/tutorial/useScenarioPlayer.ts` (copy of `apps/web/src/features/tutorial/useScenarioPlayer.ts`)
- Create: `apps/mobile/src/features/tutorial/scenarios.spec.ts` (content of web `scenarios.test.ts`)
- Create: `apps/mobile/src/net/sandboxSocket.spec.ts`

**Interfaces:**

- Consumes: `@trm/engine` (`initGame`/`reduce`/`redactFor`/`taiwanBoard`/`CONTENT_HASH`/`enumerateClaimPayments`), `@trm/codec` (`viewToSnapshot`/`eventToProto`/`commandToAction`), `@trm/proto`, `apps/mobile/src/net/commands.ts` (`GameCommands`), `apps/mobile/src/net/socket.ts` (`PaymentInit`, `CameraViewInit`), `apps/mobile/src/store/game.ts` (`useGame`, `RejectionInfo`), `apps/mobile/src/game/content.ts` (`cityById`/`routeById`/`ticketById`).
- Produces: `SandboxSocket` (mobile) — the tutorial's offline engine driver; `useScenarioPlayer(lesson, store, autoplay?)` → `ScenarioPlayer { beat, index, total, done, commands, next(), restart(), seek() }`; the full-curriculum engine walkthrough as a CI gate.

- [ ] **Step 1: Write the failing tests**

Port the walkthrough verbatim (it is the "every lesson replays through the real engine" gate — the pure half of the scripted end-to-end walkthrough):

```bash
cp apps/web/src/features/tutorial/scenarios.test.ts apps/mobile/src/features/tutorial/scenarios.spec.ts
```

Create `apps/mobile/src/net/sandboxSocket.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { taiwanBoard, CONTENT_HASH } from '@trm/engine';
import { asPlayerId, type SeatIndex } from '@trm/shared';
import type { GameSnapshot } from '@trm/proto';
import { SandboxSocket } from './sandboxSocket';

describe('SandboxSocket (mobile port)', () => {
  it('projects a redacted snapshot for the viewer and reports learner actions', () => {
    const snapshots: GameSnapshot[] = [];
    let actions = 0;
    const sandbox = new SandboxSocket(
      taiwanBoard(),
      {
        seed: 'tut-welcome',
        players: [
          { id: asPlayerId('you'), seat: 0 as SeatIndex },
          { id: asPlayerId('bot:rival'), seat: 1 as SeatIndex },
        ],
        contentHash: CONTENT_HASH,
      },
      asPlayerId('you'),
      {
        applySnapshot: (s) => snapshots.push(s),
        applyEvents: () => {},
        onAction: () => {
          actions += 1;
        },
      },
    );
    const offer = [...(sandbox.getState().players['you']?.pendingTicketOffer ?? [])];
    expect(offer.length).toBeGreaterThan(0);
    sandbox.keepInitialTickets(offer as string[]);
    expect(actions).toBe(1);
    const last = snapshots.at(-1)!;
    // Hidden-information posture holds offline too: the snapshot's private block is the viewer's.
    expect(last.you?.playerId).toBe('you');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `yarn workspace @trm/mobile test:pure --run sandboxSocket`
Expected: FAIL — cannot resolve `./sandboxSocket` (unless P3 ported it, in which case this passes and only `scenarios` below matters).
Run: `yarn workspace @trm/mobile test:pure --run scenarios`
Expected: FAIL only if `game/content` exports are missing (that is a P2 contract break — fix the import path per Task 1's findings, never fork the test logic).

- [ ] **Step 3: Copy the two modules**

```bash
cp apps/web/src/net/sandboxSocket.ts apps/mobile/src/net/sandboxSocket.ts
cp apps/web/src/features/tutorial/useScenarioPlayer.ts apps/mobile/src/features/tutorial/useScenarioPlayer.ts
```

Both should compile unmodified because the mobile tree mirrors the web's layout (`net/socket`, `net/commands`, `store/game`). If P1/P2 renamed a type (e.g. `RejectionInfo`), adjust the **import line only** — the class/hook bodies stay verbatim. These two files are not parity-gated (their import environment may legitimately diverge), but keep them as close to the web source as compiles.

- [ ] **Step 4: Run to verify they pass**

Run: `yarn workspace @trm/mobile test:pure --run sandboxSocket` → PASS
Run: `yarn workspace @trm/mobile test:pure --run scenarios` → PASS (every lesson replays; every spotlight/frame/specimen reference resolves against real content)
Run: `yarn typecheck` → clean

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/net/sandboxSocket.ts apps/mobile/src/net/sandboxSocket.spec.ts apps/mobile/src/features/tutorial/useScenarioPlayer.ts apps/mobile/src/features/tutorial/scenarios.spec.ts
git commit -m "feat(mobile): port the tutorial sandbox driver + scenario player with engine walkthrough gate"
```

---

### Task 4: TutorialTargetRegistry + anchor instrumentation of P2's components

**Files:**

- Create: `apps/mobile/src/features/tutorial/targets.tsx`
- Create: `apps/mobile/src/features/tutorial/targets.spec.ts` (pure registry, vitest)
- Create: `apps/mobile/src/features/tutorial/__tests__/targets.test.tsx` (hook + provider, jest)
- Modify: the P2 components that render the HUD anchors (exact files per Task 1 grep; expected candidates under `apps/mobile/src/components/` and `apps/mobile/src/screens/`)

**Interfaces:**

- Consumes: `FlatRect` from `./focus`; P2's HUD components (market, trackers, ticket chooser, board viewport container, draw-tickets button, hand, deck, market slots).
- Produces: `TUTORIAL_ANCHORS` (semantic name → web selector string), `MeasurableNode`, `TutorialTargets { register, measure }`, `createTutorialTargets()`, `TutorialTargetsProvider`, `useTutorialTargets()`, `useTutorialAnchor(anchorId)` → `{ ref, collapsable: false }`. Outside a provider everything is a no-op, so instrumented components behave identically in live games.

- [ ] **Step 1: Write the failing tests**

Create `apps/mobile/src/features/tutorial/targets.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createTutorialTargets, TUTORIAL_ANCHORS, type MeasurableNode } from './targets';
import { HUD_SPOTLIGHT_SELECTORS } from './focus';

const node = (x: number, y: number, w: number, h: number): MeasurableNode => ({
  measureInWindow: (cb) => cb(x, y, w, h),
});

describe('TUTORIAL_ANCHORS', () => {
  it('is exactly the web HUD selector allow-list (shared anchor-id namespace)', () => {
    expect(new Set(Object.values(TUTORIAL_ANCHORS))).toEqual(new Set(HUD_SPOTLIGHT_SELECTORS));
  });
});

describe('createTutorialTargets', () => {
  it('measures every node registered under an anchor and drops 0-sized ones', async () => {
    const t = createTutorialTargets();
    t.register(TUTORIAL_ANCHORS.market, node(10, 20, 300, 80));
    t.register(TUTORIAL_ANCHORS.market, node(0, 0, 0, 0)); // not laid out yet
    expect(await t.measure(TUTORIAL_ANCHORS.market)).toEqual([{ x: 10, y: 20, w: 300, h: 80 }]);
  });

  it('unregister removes the node; unknown anchors measure empty', async () => {
    const t = createTutorialTargets();
    const un = t.register(TUTORIAL_ANCHORS.deck, node(1, 2, 3, 4));
    un();
    expect(await t.measure(TUTORIAL_ANCHORS.deck)).toEqual([]);
    expect(await t.measure('.never-registered')).toEqual([]);
  });

  it('survives a node whose measureInWindow throws', async () => {
    const t = createTutorialTargets();
    t.register(TUTORIAL_ANCHORS.hand, {
      measureInWindow: () => {
        throw new Error('detached');
      },
    });
    expect(await t.measure(TUTORIAL_ANCHORS.hand)).toEqual([]);
  });
});
```

Create `apps/mobile/src/features/tutorial/__tests__/targets.test.tsx`:

```tsx
import { View } from 'react-native';
import { render } from '@testing-library/react-native';
import {
  TutorialTargetsProvider,
  useTutorialAnchor,
  useTutorialTargets,
  TUTORIAL_ANCHORS,
  type TutorialTargets,
} from '../targets';

function Probe({ onTargets }: { onTargets: (t: TutorialTargets) => void }) {
  onTargets(useTutorialTargets());
  const anchor = useTutorialAnchor(TUTORIAL_ANCHORS.market);
  return <View {...anchor} testID="probe" />;
}

describe('useTutorialAnchor', () => {
  it('registers into the provider and sets collapsable={false}', async () => {
    let targets: TutorialTargets | null = null;
    const r = render(
      <TutorialTargetsProvider>
        <Probe onTargets={(t) => (targets = t)} />
      </TutorialTargetsProvider>,
    );
    expect(r.getByTestId('probe').props.collapsable).toBe(false);
    // jsdom-less RN test env: measureInWindow yields nothing → 0-sized → dropped, but the
    // registration path itself must not throw and must resolve to an array.
    await expect(targets!.measure(TUTORIAL_ANCHORS.market)).resolves.toBeInstanceOf(Array);
    r.unmount(); // unmount must unregister without throwing
  });

  it('is a safe no-op outside the provider (live game)', () => {
    const r = render(<Probe onTargets={() => {}} />);
    expect(r.getByTestId('probe')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `yarn workspace @trm/mobile test:pure --run targets` → FAIL (module missing)
Run: `yarn workspace @trm/mobile test targets` → FAIL (module missing)

- [ ] **Step 3: Implement `apps/mobile/src/features/tutorial/targets.tsx`**

```tsx
// The native replacement for the web's querySelector spotlight measurement: components register
// a measurable node under the SAME anchor-id strings the web curriculum uses as CSS selectors
// (focus.ts emits them), and the tutorial measures with measureInWindow. Outside a provider every
// call is a no-op, so instrumented components behave identically in live games.
import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from 'react';
import type { FlatRect } from './focus';

/** Semantic names for the shared anchor-id namespace. The VALUES are the web's HUD selector
 *  allow-list verbatim (focus.ts HUD_SPOTLIGHT_SELECTORS) — asserted equal in targets.spec.ts. */
export const TUTORIAL_ANCHORS = {
  market: '.market',
  trackers: '.trackers',
  board: '.board-viewport',
  ticketChooser: '.ticket-chooser',
  deck: '[data-anim="deck"]',
  marketSlot: '[data-anim="market-slot"]',
  hand: '[data-anim="hand"]',
  tickets: '[data-anim="tickets"]',
  drawTickets: '[data-anim="draw-tickets"]',
} as const;

/** The measurable surface of an RN host node (a View/Pressable ref). Structural on purpose so
 *  tests can pass fakes. */
export interface MeasurableNode {
  measureInWindow(cb: (x: number, y: number, width: number, height: number) => void): void;
}

export interface TutorialTargets {
  /** Register a node under an anchor id; returns the unregister function. */
  register(anchorId: string, node: MeasurableNode): () => void;
  /** Window-space rects of every node registered under `anchorId` (0-sized ones dropped). */
  measure(anchorId: string): Promise<FlatRect[]>;
}

export function createTutorialTargets(): TutorialTargets {
  const nodes = new Map<string, Set<MeasurableNode>>();
  return {
    register(anchorId, node) {
      let set = nodes.get(anchorId);
      if (!set) {
        set = new Set();
        nodes.set(anchorId, set);
      }
      set.add(node);
      return () => {
        set.delete(node);
        if (set.size === 0) nodes.delete(anchorId);
      };
    },
    async measure(anchorId) {
      const set = nodes.get(anchorId);
      if (!set || set.size === 0) return [];
      const rects = await Promise.all(
        [...set].map(
          (node) =>
            new Promise<FlatRect | null>((resolve) => {
              try {
                node.measureInWindow((x, y, w, h) =>
                  resolve(w > 0 && h > 0 ? { x, y, w, h } : null),
                );
              } catch {
                resolve(null); // a detached node measures as absent, never crashes the overlay
              }
            }),
        ),
      );
      return rects.filter((r): r is FlatRect => r !== null);
    },
  };
}

const NOOP_TARGETS: TutorialTargets = {
  register: () => () => {},
  measure: () => Promise.resolve([]),
};

const TutorialTargetsContext = createContext<TutorialTargets>(NOOP_TARGETS);

export function TutorialTargetsProvider({ children }: { children: ReactNode }) {
  const targets = useMemo(createTutorialTargets, []);
  return (
    <TutorialTargetsContext.Provider value={targets}>{children}</TutorialTargetsContext.Provider>
  );
}

export function useTutorialTargets(): TutorialTargets {
  return useContext(TutorialTargetsContext);
}

/** Attach to the View that IS this anchor — spread the result: `<View {...useTutorialAnchor(id)}>`.
 *  `collapsable: false` stops Android view flattening from removing the node we must measure. */
export function useTutorialAnchor(anchorId: string): {
  ref: (node: MeasurableNode | null) => void;
  collapsable: false;
} {
  const targets = useTutorialTargets();
  const cleanup = useRef<(() => void) | null>(null);
  const ref = useCallback(
    (node: MeasurableNode | null) => {
      cleanup.current?.();
      cleanup.current = node ? targets.register(anchorId, node) : null;
    },
    [anchorId, targets],
  );
  return { ref, collapsable: false };
}
```

- [ ] **Step 4: Run the new tests**

Run: `yarn workspace @trm/mobile test:pure --run targets` → PASS
Run: `yarn workspace @trm/mobile test targets` → PASS

- [ ] **Step 5: Instrument P2's components**

For each anchor, find the component root View that corresponds to the web element and spread the hook onto it. The pattern (shown for the market; repeat per anchor):

```tsx
import { useTutorialAnchor, TUTORIAL_ANCHORS } from '../features/tutorial/targets';
// inside the component:
const anchor = useTutorialAnchor(TUTORIAL_ANCHORS.market);
// on the root View of the market UI:
<View {...anchor} style={styles.market}>
```

Required coverage — the five anchors the shipped curriculum actually spotlights: `board` (the board viewport container — also load-bearing for Task 6's board-anchor projection), `market`, `trackers`, `ticketChooser`, `drawTickets`. Instrument the remaining four (`deck`, `marketSlot`, `hand`, `tickets`) wherever the corresponding component exists — they are on the web allow-list and future curriculum beats may use them; skip any with no mobile counterpart yet and note it in the commit message.

Verify coverage:

```bash
cd "d:/Web Projects/TRMission"
for a in board market trackers ticketChooser drawTickets; do
  hits=$(grep -rl "TUTORIAL_ANCHORS\.$a" apps/mobile/src --include=*.tsx | grep -v "features/tutorial" | wc -l)
  [ "$hits" -ge 1 ] || echo "MISSING instrumentation: $a"
done
```

Expected: no output.

- [ ] **Step 6: Run P2's existing component suites (no regression)**

Run: `yarn workspace @trm/mobile test`
Expected: PASS — the hook is a no-op outside a provider, so P2's snapshots/behavior are unchanged (except `collapsable={false}` appearing on instrumented roots; update snapshots if P2 uses them).

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/features/tutorial/targets.tsx apps/mobile/src/features/tutorial/targets.spec.ts apps/mobile/src/features/tutorial/__tests__/targets.test.tsx
git add <each P2 component file instrumented in Step 5>
git commit -m "feat(mobile): tutorial target registry with web-parity anchor ids; instrument HUD anchors"
```

---

### Task 5: Board-anchor rect math (pure)

The Skia board has no per-element nodes to measure, so city/route spotlights are computed: board-space bbox (the same endpoint-bbox the web's `SpotlightFramer` uses, `apps/web/src/components/Board.tsx:382-409`) projected through the camera affine (the same formula as web `boardView.ts` `visibleFraction`: `screen = viewportOrigin + position + (k·board + e|f) · scale`).

**Files:**

- Create: `apps/mobile/src/features/tutorial/boardRects.ts`
- Create: `apps/mobile/src/features/tutorial/boardRects.spec.ts`

**Interfaces:**

- Consumes: `BoardTransform`, `BoardProjection` from `../../game/boardView` (P2); `Spotlight`, `FlatRect` from the ported core.
- Produces: `BoardCameraSample { transform, proj }`; `boardSpaceRect(spotlight, cityById, routeById)`; `projectBoardRect(rect, cam, viewport)`; `boardAnchorRects(spotlight, cityById, routeById, cam, viewport): FlatRect[]`.

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/src/features/tutorial/boardRects.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { boardSpaceRect, projectBoardRect, boardAnchorRects } from './boardRects';
import type { BoardCameraSample } from './boardRects';

const cities = new Map([
  ['hsinchu', { x: 30, y: 20 }],
  ['zhunan', { x: 34, y: 26 }],
  ['taipei', { x: 46, y: 8 }],
]);
const routes = new Map([['R16', { a: 'hsinchu', b: 'zhunan' }]]);

// Identity projection (k=1,e=0,f=0) at 2x zoom panned by (10, 20), board viewport at (100, 50).
const cam: BoardCameraSample = {
  transform: { positionX: 10, positionY: 20, scale: 2 },
  proj: { k: 1, e: 0, f: 0 },
};
const viewport = { x: 100, y: 50, w: 800, h: 600 };

describe('boardSpaceRect', () => {
  it('routes use their endpoint cities with padding', () => {
    const r = boardSpaceRect({ kind: 'route', ids: ['R16'] }, cities, routes)!;
    expect(r).toEqual({ x: 28, y: 18, w: 8, h: 10 }); // bbox(30..34, 20..26) padded by 2
  });
  it('unknown ids resolve to null, never throw', () => {
    expect(boardSpaceRect({ kind: 'route', ids: ['R999'] }, cities, routes)).toBeNull();
    expect(boardSpaceRect({ kind: 'cities', ids: ['atlantis'] }, cities, routes)).toBeNull();
  });
});

describe('projectBoardRect', () => {
  it('applies viewportOrigin + position + (k*board+e)*scale', () => {
    const r = projectBoardRect({ x: 30, y: 20, w: 4, h: 6 }, cam, viewport);
    // x: 100 + 10 + 30*2 = 170; y: 50 + 20 + 20*2 = 110; w: 4*2 = 8; h: 6*2 = 12
    expect(r).toEqual({ x: 170, y: 110, w: 8, h: 12 });
  });
});

describe('boardAnchorRects', () => {
  it('cities produce one rect per city (two holes for a ticket pair)', () => {
    const rects = boardAnchorRects(
      { kind: 'cities', ids: ['hsinchu', 'zhunan'] },
      cities,
      routes,
      cam,
      viewport,
    );
    expect(rects).toHaveLength(2);
    // hsinchu at board (30,20) padded ±3 → board rect (27,17,6,6) → screen (164,104,12,12)
    expect(rects[0]).toEqual({ x: 164, y: 104, w: 12, h: 12 });
  });
  it('a route produces a single union rect; unresolved ids produce none', () => {
    expect(
      boardAnchorRects({ kind: 'route', ids: ['R16'] }, cities, routes, cam, viewport),
    ).toHaveLength(1);
    expect(
      boardAnchorRects({ kind: 'route', ids: ['R999'] }, cities, routes, cam, viewport),
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn workspace @trm/mobile test:pure --run boardRects`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `apps/mobile/src/features/tutorial/boardRects.ts`**

```ts
// Screen rects for city/route spotlight targets. The web measures SVG elements; the Skia board
// has no per-element nodes, so we compute: board-space bbox (the same endpoint-bbox the web's
// SpotlightFramer frames) → screen via the camera affine documented in game/boardView.ts
// (screen = viewportOrigin + position + (k·board + e|f)·scale). Pure — testable without a device.
import type { Spotlight } from './types';
import type { FlatRect } from './focus';
import type { BoardTransform, BoardProjection } from '../../game/boardView';

export interface BoardCameraSample {
  transform: BoardTransform;
  proj: BoardProjection;
}

type BoardSpotlight = Extract<Spotlight, { kind: 'cities' | 'route' }>;
type CityPoint = { x: number; y: number };
type RouteEnds = { a: string; b: string };

/** Board units of breathing room so the hole reads as a spotlight, not a bounding box. */
const CITY_PAD_BU = 3;
const ROUTE_PAD_BU = 2;

/** Board-space (0–100) bbox for a cities/route spotlight; null when nothing resolves. */
export function boardSpaceRect(
  spotlight: BoardSpotlight,
  cityById: ReadonlyMap<string, CityPoint>,
  routeById: ReadonlyMap<string, RouteEnds>,
): { x: number; y: number; w: number; h: number } | null {
  const cityIds =
    spotlight.kind === 'route'
      ? spotlight.ids.flatMap((rid) => {
          const r = routeById.get(rid);
          return r ? [r.a, r.b] : [];
        })
      : spotlight.ids;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const cid of cityIds) {
    const c = cityById.get(cid);
    if (!c) continue;
    minX = Math.min(minX, c.x);
    maxX = Math.max(maxX, c.x);
    minY = Math.min(minY, c.y);
    maxY = Math.max(maxY, c.y);
  }
  if (!Number.isFinite(minX)) return null;
  const pad = spotlight.kind === 'route' ? ROUTE_PAD_BU : CITY_PAD_BU;
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
}

/** Project a board-space rect into window space through the camera + the board viewport origin. */
export function projectBoardRect(
  rect: { x: number; y: number; w: number; h: number },
  cam: BoardCameraSample,
  viewport: FlatRect,
): FlatRect {
  const t: BoardTransform = cam.transform;
  const p: BoardProjection = cam.proj;
  const s = t.scale || 1;
  return {
    x: viewport.x + t.positionX + (p.k * rect.x + p.e) * s,
    y: viewport.y + t.positionY + (p.k * rect.y + p.f) * s,
    w: rect.w * p.k * s,
    h: rect.h * p.k * s,
  };
}

/** The spotlight-hole rects for a board-anchored beat: one hole per city (a ticket's two
 *  endpoints get two holes, matching the web), or a single union hole for a route set. */
export function boardAnchorRects(
  spotlight: BoardSpotlight,
  cityById: ReadonlyMap<string, CityPoint>,
  routeById: ReadonlyMap<string, RouteEnds>,
  cam: BoardCameraSample,
  viewport: FlatRect,
): FlatRect[] {
  if (spotlight.kind === 'cities') {
    return spotlight.ids.flatMap((id) => {
      const c = cityById.get(id);
      if (!c) return [];
      const bu = {
        x: c.x - CITY_PAD_BU,
        y: c.y - CITY_PAD_BU,
        w: CITY_PAD_BU * 2,
        h: CITY_PAD_BU * 2,
      };
      return [projectBoardRect(bu, cam, viewport)];
    });
  }
  const bb = boardSpaceRect(spotlight, cityById, routeById);
  return bb ? [projectBoardRect(bb, cam, viewport)] : [];
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `yarn workspace @trm/mobile test:pure --run boardRects` → PASS

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/features/tutorial/boardRects.ts apps/mobile/src/features/tutorial/boardRects.spec.ts
git commit -m "feat(mobile): pure board-anchor spotlight rect math (camera-projected)"
```

---

### Task 6: Camera bridge + the mobile `useSpotlightRects`

**Files:**

- Create: `apps/mobile/src/features/tutorial/cameraBridge.ts`
- Create: `apps/mobile/src/features/tutorial/useSpotlightRects.ts`
- Create: `apps/mobile/src/features/tutorial/__tests__/useSpotlightRects.test.tsx`

**Interfaces:**

- Consumes: **P2 camera contract** — the board exposes its live pan/zoom readable on the JS thread as `BoardTransform` (`positionX`/`positionY` px, `scale`) plus the static board→content-pixel `BoardProjection` `{k,e,f}` (the shapes `game/boardView.ts` defines). Verify the export site: `grep -rn "positionX\|BoardProjection" apps/mobile/src/game apps/mobile/src/components | grep -v test`. Whether P2 mirrors the transform into zustand or reads Reanimated shared values via `.value`, **`cameraBridge.ts` is the only file allowed to touch it.**
- Consumes: `createTutorialTargets` registry (Task 4), `boardAnchorRects` (Task 5), `cityById`/`routeById` from `../../game/content` (P2).
- Produces: `ReadBoardCamera = () => BoardCameraSample | null`; `useBoardCameraReader(): ReadBoardCamera`; `useSpotlightRects(spotlight, readCamera?): FlatRect[]` — same semantics as web: empty until resolved, re-measures for ~700 ms after a beat change (tracks the auto-pan glide) and on window-dimension changes.

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/src/features/tutorial/__tests__/useSpotlightRects.test.tsx` (fake registry + fake camera — no P2 runtime needed):

```tsx
import { Text, View } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import {
  TutorialTargetsProvider,
  useTutorialAnchor,
  TUTORIAL_ANCHORS,
  type MeasurableNode,
} from '../targets';
import { useSpotlightRects } from '../useSpotlightRects';
import type { ReadBoardCamera } from '../cameraBridge';
import type { Spotlight } from '../types';
import type { FlatRect } from '../focus';

// A registered anchor whose node fakes measureInWindow (the RN test env never lays out).
function FakeAnchor({ anchorId, rect }: { anchorId: string; rect: FlatRect }) {
  const anchor = useTutorialAnchor(anchorId);
  const node: MeasurableNode = {
    measureInWindow: (cb) => cb(rect.x, rect.y, rect.w, rect.h),
  };
  // Register the fake node directly through the callback ref.
  return <View ref={() => anchor.ref(node)} collapsable={false} />;
}

function Probe({ spotlight, readCamera }: { spotlight: Spotlight; readCamera: ReadBoardCamera }) {
  const rects = useSpotlightRects(spotlight, readCamera);
  return <Text testID="rects">{JSON.stringify(rects)}</Text>;
}

const identityCam: ReadBoardCamera = () => ({
  transform: { positionX: 0, positionY: 0, scale: 1 },
  proj: { k: 1, e: 0, f: 0 },
});

describe('useSpotlightRects (native)', () => {
  it('resolves a hud anchor through the registry', async () => {
    const r = render(
      <TutorialTargetsProvider>
        <FakeAnchor anchorId={TUTORIAL_ANCHORS.market} rect={{ x: 5, y: 600, w: 400, h: 90 }} />
        <Probe spotlight={{ kind: 'hud', selector: '.market' }} readCamera={identityCam} />
      </TutorialTargetsProvider>,
    );
    await waitFor(() =>
      expect(JSON.parse(r.getByTestId('rects').props.children as string)).toEqual([
        { x: 5, y: 600, w: 400, h: 90 },
      ]),
    );
  });

  it('projects a cities spotlight through the camera + board viewport anchor', async () => {
    const r = render(
      <TutorialTargetsProvider>
        <FakeAnchor anchorId={TUTORIAL_ANCHORS.board} rect={{ x: 0, y: 100, w: 800, h: 500 }} />
        <Probe spotlight={{ kind: 'cities', ids: ['hsinchu'] }} readCamera={identityCam} />
      </TutorialTargetsProvider>,
    );
    await waitFor(() => {
      const rects = JSON.parse(r.getByTestId('rects').props.children as string) as FlatRect[];
      expect(rects).toHaveLength(1);
      expect(rects[0]!.y).toBeGreaterThan(100); // sits inside the board viewport, camera-projected
    });
  });

  it('a named target that cannot resolve yields NO rects (never a bogus dim)', async () => {
    const r = render(
      <TutorialTargetsProvider>
        <Probe spotlight={{ kind: 'hud', selector: '.ticket-chooser' }} readCamera={identityCam} />
      </TutorialTargetsProvider>,
    );
    await act(async () => {});
    expect(JSON.parse(r.getByTestId('rects').props.children as string)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn workspace @trm/mobile test useSpotlightRects`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement `cameraBridge.ts`**

```ts
// The ONLY file that reads P2's camera internals. Everything else consumes ReadBoardCamera, so
// a P2 refactor touches exactly one tutorial file. CONTRACT (verify per Task 6 Interfaces): the
// board exposes its live transform {positionX, positionY, scale} + projection {k, e, f}
// synchronously on the JS thread.
import type { BoardCameraSample } from './boardRects';

export type { BoardCameraSample };

/** Read the current camera; null when no board is mounted (spotlight then resolves no rects). */
export type ReadBoardCamera = () => BoardCameraSample | null;

/** Default reader wired to P2's camera. Implement against the verified export site — e.g. a
 *  zustand camera mirror (`useBoardCameraStore.getState()`) or Reanimated shared values read via
 *  `.value`. Keep the hook shape stable; only this body may change. */
export function useBoardCameraReader(): ReadBoardCamera {
  // <implement against the P2 export verified in Task 6 Interfaces; must not subscribe —
  //  useSpotlightRects polls during its tracking window, so a plain getState()-style read is right>
  throw new Error('wire useBoardCameraReader to the P2 camera export before shipping Task 6');
}
```

(The thrown placeholder is removed in this same task — the test suite for the hook injects a fake, but Task 11's screen uses the default reader, so wire it now against the verified export and delete the throw. If P2 exposes only Reanimated shared values, the body is `const { tx, ty, scale, proj } = useBoardCameraShared(); return () => ({ transform: { positionX: tx.value, positionY: ty.value, scale: scale.value }, proj });`.)

- [ ] **Step 4: Implement `useSpotlightRects.ts`**

```ts
// Native spotlight measurement: hud anchors resolve through the TutorialTargetRegistry
// (measureInWindow); cities/routes are computed from board geometry projected through the live
// camera. Mirrors the web hook's semantics: re-measure for a short window after each beat change
// so the holes track the board's auto-pan glide; a named-but-unresolved target yields NO rects.
import { useEffect, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import type { Spotlight } from './types';
import { selectorsForSpotlight, type FlatRect } from './focus';
import { TUTORIAL_ANCHORS, useTutorialTargets } from './targets';
import { boardAnchorRects } from './boardRects';
import { useBoardCameraReader, type ReadBoardCamera } from './cameraBridge';
import { cityById, routeById } from '../../game/content';

/** How long after a beat change to keep re-measuring (web: rAF window of the same length). */
const TRACK_MS = 700;
const TRACK_INTERVAL_MS = 80;

export function useSpotlightRects(
  spotlight: Spotlight | undefined,
  readCamera?: ReadBoardCamera,
): FlatRect[] {
  const targets = useTutorialTargets();
  const defaultReader = useBoardCameraReader();
  const read = readCamera ?? defaultReader;
  const { width, height } = useWindowDimensions();
  const [rects, setRects] = useState<FlatRect[]>([]);
  // Stable key: refire on the beat's spotlight, not on every parent render (same as web).
  const key = spotlight ? JSON.stringify(spotlight) : '';

  useEffect(() => {
    // `board` + undefined intentionally resolve to no selectors (whole-stage dim is the caller's
    // dimAll decision) — identical to the web's selectorsForSpotlight contract.
    if (!spotlight || selectorsForSpotlight(spotlight).length === 0) {
      setRects([]);
      return;
    }
    let alive = true;
    const started = Date.now();

    const measure = async (): Promise<void> => {
      let next: FlatRect[] = [];
      if (spotlight.kind === 'hud') {
        next = await targets.measure(spotlight.selector);
      } else if (spotlight.kind === 'cities' || spotlight.kind === 'route') {
        const [board] = await targets.measure(TUTORIAL_ANCHORS.board);
        const cam = read();
        if (board && cam) next = boardAnchorRects(spotlight, cityById, routeById, cam, board);
      }
      if (alive) setRects(next);
    };

    void measure();
    const id = setInterval(() => {
      if (Date.now() - started > TRACK_MS) {
        clearInterval(id);
        return;
      }
      void measure();
    }, TRACK_INTERVAL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
    // width/height in deps: an orientation change / split-screen resize re-measures (web: resize listener).
  }, [key, targets, read, width, height]); // eslint-disable-line react-hooks/exhaustive-deps -- key stands in for spotlight
  return rects;
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `yarn workspace @trm/mobile test useSpotlightRects` → PASS
Run: `yarn typecheck` → clean (confirms the camera bridge is actually wired, not the placeholder)

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/features/tutorial/cameraBridge.ts apps/mobile/src/features/tutorial/useSpotlightRects.ts apps/mobile/src/features/tutorial/__tests__/useSpotlightRects.test.tsx
git commit -m "feat(mobile): native spotlight measurement via target registry + camera projection"
```

---

### Task 7: Skia spotlight scrim + reduced-motion hook

**Files:**

- Create: `apps/mobile/src/features/tutorial/scrim.ts` (pure path builder)
- Create: `apps/mobile/src/features/tutorial/scrim.spec.ts`
- Create: `apps/mobile/src/hooks/useReducedMotion.ts` (**skip if P1/P2 already ported one** — `grep -rn "useReducedMotion" apps/mobile/src`; then import theirs)
- Create: `apps/mobile/src/features/tutorial/TutorialSpotlight.tsx`
- Create: `apps/mobile/src/features/tutorial/__tests__/TutorialSpotlight.test.tsx`

**Interfaces:**

- Consumes: `@shopify/react-native-skia` (`Canvas`, `Path`, `RoundedRect`) + P2's jest Skia mock; `FlatRect`.
- Produces: `scrimPath(w, h, holes)` (SVG path string, even-odd fill punches the holes), `SPOT_PAD = 10`, `SPOT_RADIUS = 14` (web values); `<TutorialSpotlight rects reducedMotion dimAll?>` with the web's exact semantics: no holes + no `dimAll` → renders nothing (never dim the taught element while its rect resolves); `pointerEvents="none"` always (non-blocking focus); `useReducedMotion(): boolean`.

- [ ] **Step 1: Write the failing pure test**

Create `apps/mobile/src/features/tutorial/scrim.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { scrimPath, SPOT_PAD } from './scrim';

describe('scrimPath', () => {
  it('with no holes is just the full-screen rect', () => {
    expect(scrimPath(100, 50, [])).toBe('M0 0 H100 V50 H0 Z');
  });
  it('appends one rounded-rect subpath per hole, padded by SPOT_PAD', () => {
    const p = scrimPath(800, 600, [{ x: 100, y: 200, w: 50, h: 40 }]);
    expect(p.startsWith('M0 0 H800 V600 H0 Z ')).toBe(true);
    expect(p).toContain(`H${100 + 50 + SPOT_PAD}`); // right edge = x + w + pad
    expect((p.match(/Z/g) ?? []).length).toBe(2); // outer rect + one hole
  });
  it('clamps the corner radius on tiny holes (no self-intersecting arcs)', () => {
    expect(() => scrimPath(800, 600, [{ x: 10, y: 10, w: 2, h: 2 }])).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn workspace @trm/mobile test:pure --run scrim` → FAIL (module missing)

- [ ] **Step 3: Implement `scrim.ts`, `useReducedMotion.ts`, `TutorialSpotlight.tsx`**

`apps/mobile/src/features/tutorial/scrim.ts`:

```ts
// Pure geometry for the spotlight scrim: one SVG path = full-screen rect + a rounded-rect
// subpath per target; drawn with even-odd fill so the targets become holes of light. The PAD
// and RADIUS match the web's TutorialSpotlight so both platforms frame targets identically.
import type { FlatRect } from './focus';

export const SPOT_PAD = 10;
export const SPOT_RADIUS = 14;

function holeSubpath(r: FlatRect): string {
  const x = r.x - SPOT_PAD;
  const y = r.y - SPOT_PAD;
  const w = r.w + SPOT_PAD * 2;
  const h = r.h + SPOT_PAD * 2;
  const rad = Math.min(SPOT_RADIUS, w / 2, h / 2);
  return [
    `M${x + rad} ${y}`,
    `H${x + w - rad}`,
    `A${rad} ${rad} 0 0 1 ${x + w} ${y + rad}`,
    `V${y + h - rad}`,
    `A${rad} ${rad} 0 0 1 ${x + w - rad} ${y + h}`,
    `H${x + rad}`,
    `A${rad} ${rad} 0 0 1 ${x} ${y + h - rad}`,
    `V${y + rad}`,
    `A${rad} ${rad} 0 0 1 ${x + rad} ${y}`,
    'Z',
  ].join(' ');
}

export function scrimPath(w: number, h: number, holes: FlatRect[]): string {
  return [`M0 0 H${w} V${h} H0 Z`, ...holes.map(holeSubpath)].join(' ');
}
```

`apps/mobile/src/hooks/useReducedMotion.ts` (if not already ported):

```ts
import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/** OS-level reduce-motion preference (the RN analogue of prefers-reduced-motion). */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (alive) setReduced(v);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduced;
}
```

`apps/mobile/src/features/tutorial/TutorialSpotlight.tsx`:

```tsx
// Non-blocking focus scrim: dims the stage and punches a lit, ringed hole around each target.
// pointerEvents="none" so the learner can still tap the highlighted element (web parity). The
// ring pulse uses core RN Animated (no extra deps) and goes static under reduced motion.
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Canvas, Path, RoundedRect } from '@shopify/react-native-skia';
import { scrimPath, SPOT_PAD, SPOT_RADIUS } from './scrim';
import type { FlatRect } from './focus';

const DIM_COLOR = 'rgba(10, 14, 22, 0.55)';
const RING_COLOR = 'rgba(126, 190, 255, 0.9)';

export function TutorialSpotlight({
  rects,
  reducedMotion,
  dimAll = false,
}: {
  rects: FlatRect[];
  reducedMotion: boolean;
  /** Dim the whole stage when there are no cutouts. TRUE only when the beat intends no specific
   *  target; a named-but-unresolved target renders NOTHING (never hide the taught element). */
  dimAll?: boolean;
}) {
  const { width, height } = useWindowDimensions();
  const pulse = useRef(new Animated.Value(1)).current;
  const hasHoles = rects.length > 0;

  useEffect(() => {
    if (reducedMotion || !hasHoles) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.45, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reducedMotion, hasHoles, pulse]);

  if (!hasHoles && !dimAll) return null;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="tut-spotlight">
      <Canvas style={{ width, height }}>
        <Path path={scrimPath(width, height, rects)} color={DIM_COLOR} fillType="evenOdd" />
      </Canvas>
      {hasHoles && (
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: reducedMotion ? 1 : pulse }]}>
          <Canvas style={{ width, height }}>
            {rects.map((r, i) => (
              <RoundedRect
                key={i}
                x={r.x - SPOT_PAD}
                y={r.y - SPOT_PAD}
                width={r.w + SPOT_PAD * 2}
                height={r.h + SPOT_PAD * 2}
                r={SPOT_RADIUS}
                color={RING_COLOR}
                style="stroke"
                strokeWidth={2}
              />
            ))}
          </Canvas>
        </Animated.View>
      )}
    </View>
  );
}
```

- [ ] **Step 4: Write + run the jest smoke test**

Create `apps/mobile/src/features/tutorial/__tests__/TutorialSpotlight.test.tsx`:

```tsx
import { render } from '@testing-library/react-native';
import { TutorialSpotlight } from '../TutorialSpotlight';

describe('TutorialSpotlight', () => {
  it('renders nothing when a named target has not resolved (no holes, no dimAll)', () => {
    const r = render(<TutorialSpotlight rects={[]} reducedMotion={false} />);
    expect(r.toJSON()).toBeNull();
  });
  it('renders the global dim when the beat intends the whole stage', () => {
    const r = render(<TutorialSpotlight rects={[]} reducedMotion dimAll />);
    expect(r.getByTestId('tut-spotlight')).toBeTruthy();
  });
  it('renders the scrim + rings and never blocks touches', () => {
    const r = render(
      <TutorialSpotlight rects={[{ x: 10, y: 10, w: 100, h: 40 }]} reducedMotion={false} />,
    );
    expect(r.getByTestId('tut-spotlight').props.pointerEvents).toBe('none');
  });
});
```

Run: `yarn workspace @trm/mobile test:pure --run scrim` → PASS
Run: `yarn workspace @trm/mobile test TutorialSpotlight` → PASS (requires P2's Skia jest mock; if it errors on Skia imports, fix the jest `setupFiles` per the Skia "Testing with Jest" guide for the pinned 2.x version — that config belongs to P2, extend it, don't fork it)

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/features/tutorial/scrim.ts apps/mobile/src/features/tutorial/scrim.spec.ts apps/mobile/src/hooks/useReducedMotion.ts apps/mobile/src/features/tutorial/TutorialSpotlight.tsx apps/mobile/src/features/tutorial/__tests__/TutorialSpotlight.test.tsx
git commit -m "feat(mobile): Skia tutorial spotlight scrim with masked dimming + pulse rings"
```

---

### Task 8: Specimens — the visual glossary as RN views

**Files:**

- Create: `apps/mobile/src/features/tutorial/Specimens.tsx`
- Create: `apps/mobile/src/features/tutorial/__tests__/Specimens.test.tsx`

**Interfaces:**

- Consumes: `SpecimenSpec` (ported types); `SCORING_TABLE`, `TRAIN_COLORS`, `CardColor` from `@trm/shared`; `straightRouteGeometry`, `STRAIGHT_PITCH` from `@trm/map-data` (pure, direct import); P2's native `TrainCarCard` (`{color, size, showGlyph?, count?, showCount?}` — web-mirrored signature, verify: `grep -n "TrainCarCardProps\|function TrainCarCard" apps/mobile/src/components/TrainCarCard.tsx`), `TicketCard` (`{ticketId}`), and P2's **route-track painter** — the reusable per-route Skia renderer the board factors out (verify: `grep -rn "RouteTrack\|paintRoute\|RouteShape" apps/mobile/src/components`; adapt the exact import/props to what P2 shipped — the specimen must reuse the board's painter so it cannot visually drift, same rule as web); `cityName` from `../../game/content`; `useReducedMotion` (Task 7); `SEAT_COLORS`, `CARD_COLOR_TOKENS`, `GRAY_TOKEN` from P2's theme port (verify: `grep -rn "SEAT_COLORS" apps/mobile/src/theme`).
- Produces: `Specimen({spec})` dispatcher + `RouteSpecimen`, `RouteCompareSpecimen`, `CardRowSpecimen`, `LocoCardSpecimen`, `StationSpecimen`, `StationCostSpecimen`, `ScoreTableSpecimen`, `ClaimCostSpecimen`, `TicketSpecimen` — one per `SpecimenSpec.kind`, mirroring `apps/web/src/features/tutorial/Specimens.tsx` (read it side-by-side while porting; the web file is the behavioural reference for palettes, counts, and cycling logic).

- [ ] **Step 1: Write the failing smoke tests**

Create `apps/mobile/src/features/tutorial/__tests__/Specimens.test.tsx` (the exhaustive-dispatch test is the load-bearing one — a new `SpecimenSpec.kind` added on web fails here after the parity re-copy until the RN glossary catches up):

```tsx
import { render } from '@testing-library/react-native';
import { Specimen } from '../Specimens';
import type { SpecimenSpec } from '../types';

const ALL: SpecimenSpec[] = [
  { kind: 'routes-compare' },
  { kind: 'route', variant: 'rail' },
  { kind: 'route', variant: 'ferry' },
  { kind: 'route', variant: 'tunnel' },
  { kind: 'route', variant: 'double' },
  { kind: 'card-row' },
  { kind: 'loco-card' },
  { kind: 'station' },
  { kind: 'station-cost' },
  { kind: 'score-table' },
  { kind: 'ticket', id: 'S1' },
  { kind: 'claim-cost' },
];

describe('Specimen', () => {
  for (const spec of ALL) {
    it(`renders ${JSON.stringify(spec)}`, () => {
      const r = render(<Specimen spec={spec} />);
      expect(r.getByTestId('tut-specimen')).toBeTruthy();
    });
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn workspace @trm/mobile test Specimens` → FAIL (module missing)

- [ ] **Step 3: Implement `Specimens.tsx`**

Port `apps/web/src/features/tutorial/Specimens.tsx` component-by-component. The structure below is binding; the route-painter import is the one P2-dependent seam:

```tsx
// The visual glossary: standalone renders of real game components for the coachmark. Each reuses
// P2's live components/painters so it looks identical to the board and can never drift (the same
// invariant the web version holds with shared CSS classes).
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { TRAIN_COLORS, SCORING_TABLE, type CardColor } from '@trm/shared';
import { straightRouteGeometry, STRAIGHT_PITCH } from '@trm/map-data';
import { TrainCarCard } from '../../components/TrainCarCard';
import { TicketCard } from '../../components/TicketCard';
import { cityName } from '../../game/content';
import { SEAT_COLORS, CARD_COLOR_TOKENS, GRAY_TOKEN } from '../../theme/colors';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import type { SpecimenSpec } from './types';
// P2 seam — the board's reusable route painter (exact name/props per Task 8 Interfaces grep):
// import { RouteTrack } from '../../components/board/RouteTrack';

const CARD_W = 56;
const STATION_PALETTE = [...TRAIN_COLORS, 'LOCOMOTIVE'] as CardColor[];
const CYCLE_MS = 1500; // palette cross-cycle cadence (web parity)
```

Binding per-variant requirements (mirror the web file exactly on data and palette; layout adapts to RN):

- `RouteSpecimen({variant})` — a small Skia `<Canvas>` painting ONE straight track via P2's painter over `straightRouteGeometry(count, isTunnel, cx, cy)` with `count = variant === 'tunnel' ? 4 : 3`; `double` = two parallel tracks in ORANGE + BLUE (never one faded); `ferry` pips on the neutral `GRAY_TOKEN` bed. Scale the board-unit geometry into the canvas with a Skia `Group transform={[{ scale }]}`.
- `RouteCompareSpecimen` — rail/ferry/tunnel rows labelled with `t('tutorial.glossary.rail'|'ferry'|'tunnel')` (keys already ported in Task 2).
- `CardRowSpecimen` — the 8 liveries + locomotive via `TrainCarCard` (`showGlyph`), `LocoCardSpecimen` — one size-96 locomotive. **PURPLE, never PINK.**
- `StationSpecimen` — three city chips (`taipei` built with `SEAT_COLORS[0]` dot + `t('tutorial.stations.specimenBuilt')`, `hsinchu`/`zhunan` empty), names via `cityName(id, locale)` where `const locale = useTranslation().i18n.language.startsWith('en') ? 'en' : 'zh-Hant'`.
- `StationCostSpecimen` — rows of 1/2/3 `TrainCarCard`s cycling through `STATION_PALETTE` together on a shared `setInterval(CYCLE_MS)` index, static under `useReducedMotion()`.
- `ScoreTableSpecimen` — rows from the live `SCORING_TABLE` (sorted numerically): `len` little car-squares + the points value. Pure RN Views.
- `ClaimCostSpecimen` — the web's three rows (RED×2, BLUE×4, gray×3): a mini track (painter, width `len * STRAIGHT_PITCH`) → arrow → one card (matching colour, or the cycling card for gray) → `×len` label.
- `TicketSpecimen({id})` — `<TicketCard ticketId={id} />`.
- Root of every specimen carries `testID="tut-specimen"`.
- `Specimen({spec})` — the exhaustive `switch` over `spec.kind` (no `default`: the TS exhaustiveness check is the drift alarm).

- [ ] **Step 4: Run to verify it passes**

Run: `yarn workspace @trm/mobile test Specimens` → PASS (all 12 variants)
Run: `yarn typecheck` → clean

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/features/tutorial/Specimens.tsx apps/mobile/src/features/tutorial/__tests__/Specimens.test.tsx
git commit -m "feat(mobile): tutorial visual glossary specimens as RN views"
```

---

### Task 9: The coachmark — TutorialOverlay (RN)

**Files:**

- Create: `apps/mobile/src/features/tutorial/TutorialOverlay.tsx`
- Create: `apps/mobile/src/features/tutorial/__tests__/TutorialOverlay.test.tsx`

**Interfaces:**

- Consumes: ported `focus.ts` (`coachPosition`, `spotlightBounds`, `spotlightCentre`), `Specimen` (Task 8), i18n `tutorial.*` keys, `useWindowDimensions`.
- Produces: `TutorialOverlay(props: TutorialOverlayProps)` with the **web-identical props contract** (`beat, done, index, total, lessonTitleKey, lessonNo, lessonCount, isLastLesson, specimen?, spotRects?, onAdvance, onReplay, onPrevLesson, onNextLesson, onExit, onCreateGame?`) — Task 11's runner threads them 1:1. testIDs: `tut-coach`, `tut-next`, `tut-next-lesson`, `tut-prev-lesson`, `tut-replay`, `tut-exit`, `tut-yourturn`, `tut-watching`, `tut-finale-cta`.

- [ ] **Step 1: Write the failing tests**

Create `apps/mobile/src/features/tutorial/__tests__/TutorialOverlay.test.tsx`:

```tsx
import { fireEvent, render } from '@testing-library/react-native';
import '../../../i18n'; // side-effect i18next init (zh-Hant default)
import { TutorialOverlay, type TutorialOverlayProps } from '../TutorialOverlay';
import type { Beat } from '../types';

const infoBeat: Beat = { id: 'goal', text: 'tutorial.welcome.goal', mode: 'info' };
const awaitBeat: Beat = {
  id: 'draft',
  text: 'tutorial.welcome.draft',
  mode: 'await',
  expect: { t: 'KEEP_INITIAL_TICKETS' },
};

const base: TutorialOverlayProps = {
  beat: infoBeat,
  done: false,
  index: 0,
  total: 5,
  lessonTitleKey: 'tutorial.welcome.title',
  lessonNo: 1,
  lessonCount: 5,
  isLastLesson: false,
  onAdvance: jest.fn(),
  onReplay: jest.fn(),
  onPrevLesson: jest.fn(),
  onNextLesson: jest.fn(),
  onExit: jest.fn(),
};

describe('TutorialOverlay', () => {
  it('info beat: Next advances', () => {
    const onAdvance = jest.fn();
    const r = render(<TutorialOverlay {...base} onAdvance={onAdvance} />);
    fireEvent.press(r.getByTestId('tut-next'));
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it('await beat: shows the your-turn cue, no Next button', () => {
    const r = render(<TutorialOverlay {...base} beat={awaitBeat} />);
    expect(r.getByTestId('tut-yourturn')).toBeTruthy();
    expect(r.queryByTestId('tut-next')).toBeNull();
  });

  it('last beat of a non-final lesson hands off to the next lesson', () => {
    const onNextLesson = jest.fn();
    const r = render(<TutorialOverlay {...base} index={4} total={5} onNextLesson={onNextLesson} />);
    fireEvent.press(r.getByTestId('tut-next-lesson'));
    expect(onNextLesson).toHaveBeenCalledTimes(1);
  });

  it('whole-tutorial finale: celebratory CTA fires onCreateGame', () => {
    const onCreateGame = jest.fn();
    const r = render(
      <TutorialOverlay {...base} beat={null} done isLastLesson onCreateGame={onCreateGame} />,
    );
    fireEvent.press(r.getByTestId('tut-finale-cta'));
    expect(onCreateGame).toHaveBeenCalledTimes(1);
  });

  it('exit is always reachable', () => {
    const onExit = jest.fn();
    const r = render(<TutorialOverlay {...base} onExit={onExit} />);
    fireEvent.press(r.getByTestId('tut-exit'));
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn workspace @trm/mobile test TutorialOverlay` → FAIL (module missing)

- [ ] **Step 3: Implement `TutorialOverlay.tsx`**

Port `apps/web/src/features/tutorial/TutorialOverlay.tsx` to RN. Binding behaviour (read the web file side-by-side; its logic transfers line-for-line, only the render targets change):

- **Props type**: identical to web (`TutorialOverlayProps`), exported.
- **Body selection** (web lines 39-52): `finished = done && isLastLesson`; body = `t('tutorial.finalBody')` when finished, else `t(beat.text)`; `isLastBeat = total > 0 && index === total - 1`; `progress = round(((index+1)/total)*100)`.
- **Placement**: `pos = coachPosition(props.spotRects ?? [], width, height)` from `useWindowDimensions()`; absolute-positioned card — `bottom`: pinned above the safe-area bottom; `top`: below the safe-area top; `left`/`right`: side-docked ADJACENT to `spotlightBounds(spotRects)` with a 16px gap, clamped on-screen, width `min(22*16, width-24)` (web's dockStyle math ports arithmetically).
- **Caret**: a 12×12 rotated-45° View riding the edge facing the spotlight; offset from `spotlightCentre(spotRects)` clamped `24..(edge-24)`, computed from the coach frame captured via `ref.measureInWindow` inside `onLayout`; hidden when no centre or no layout yet.
- **Content order**: header row (lesson title via `t(lessonTitleKey)`, `lessonNo/lessonCount`, exit ✕ `testID="tut-exit"`), finale badge (🎉 + `t('tutorial.finalTitle')`) when finished, specimen zone (`<Specimen spec={specimen}/>` keyed by `beat?.id`, only when `!done && specimen`), narration body, progress bar (a 4px track View + fill View at `progress%`), actions row.
- **Actions row** (exact web branch structure, lines 158-189): replay link (`tut-replay`), prev-lesson when `lessonNo > 1` (`tut-prev-lesson`), then: finished → accent CTA `t('tutorial.createGame')` (`tut-finale-cta`, `onCreateGame ?? onExit`); done non-final → `t('tutorial.nextLesson')` (`tut-next-lesson`); info beat → `tut-next` (or `tut-next-lesson` when `isLastBeat && !isLastLesson`); await beat → `t('tutorial.yourTurn')` cue (`tut-yourturn`); auto beat → `t('tutorial.watching')` (`tut-watching`).
- All buttons are `Pressable` with `accessibilityRole="button"`; the card has `accessibilityViewIsModal={false}` (the board must stay usable) and generous hit-slop on the ✕.
- Styling: StyleSheet card — dark elevated surface, 16px radius, max width 22rem-equivalent (352), the accent colour P1's theme uses for primary CTAs. No web CSS is ported; keep it simple and native.

- [ ] **Step 4: Run to verify it passes**

Run: `yarn workspace @trm/mobile test TutorialOverlay` → PASS

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/features/tutorial/TutorialOverlay.tsx apps/mobile/src/features/tutorial/__tests__/TutorialOverlay.test.tsx
git commit -m "feat(mobile): native tutorial coachmark with dodge, caret, progress and beat controls"
```

---

### Task 10: Completion persistence (AsyncStorage)

**Files:**

- Modify: `apps/mobile/package.json` (+ lockfile) — add `@react-native-async-storage/async-storage`
- Create: `apps/mobile/src/features/tutorial/progress.ts`
- Create: `apps/mobile/src/features/tutorial/__tests__/progress.test.ts`

**Interfaces:**

- Produces: storage key `trm.tutorial.completed.v1`; `TutorialCompletion { scope: Scope; completedAt: string }`; `getTutorialCompletion(): Promise<TutorialCompletion | null>`; `markTutorialCompleted(scope: Scope): Promise<void>`. Both swallow storage failures (completion is a convenience — never block or crash the tutorial; same posture as the spec's offline storage-full handling).

- [ ] **Step 1: Add the dependency**

```bash
yarn workspace @trm/mobile exec expo install @react-native-async-storage/async-storage
```

(`expo install` picks the version pinned for the installed SDK; if it balks in CI, `yarn workspace @trm/mobile add @react-native-async-storage/async-storage` then `yarn workspace @trm/mobile exec expo install --check` must report it compatible.)

- [ ] **Step 2: Write the failing tests**

Create `apps/mobile/src/features/tutorial/__tests__/progress.test.ts`:

```ts
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getTutorialCompletion, markTutorialCompleted } from '../progress';

beforeEach(() => AsyncStorage.clear());

describe('tutorial completion persistence', () => {
  it('is null before any completion', async () => {
    expect(await getTutorialCompletion()).toBeNull();
  });

  it('round-trips a completion', async () => {
    await markTutorialCompleted('core');
    const c = await getTutorialCompletion();
    expect(c?.scope).toBe('core');
    expect(typeof c?.completedAt).toBe('string');
  });

  it('treats corrupt or foreign payloads as absent', async () => {
    await AsyncStorage.setItem('trm.tutorial.completed.v1', '{not json');
    expect(await getTutorialCompletion()).toBeNull();
    await AsyncStorage.setItem('trm.tutorial.completed.v1', JSON.stringify({ scope: 'huge' }));
    expect(await getTutorialCompletion()).toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `yarn workspace @trm/mobile test progress` → FAIL (module missing)

- [ ] **Step 4: Implement `progress.ts`**

```ts
// Tutorial completion, persisted on-device (AsyncStorage). Fully offline; storage failures are
// swallowed — a completion badge is a convenience and must never block or crash the tutorial.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Scope } from './types';

const KEY = 'trm.tutorial.completed.v1';

export interface TutorialCompletion {
  scope: Scope;
  completedAt: string; // ISO-8601
}

export async function getTutorialCompletion(): Promise<TutorialCompletion | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TutorialCompletion>;
    return (parsed.scope === 'core' || parsed.scope === 'full') &&
      typeof parsed.completedAt === 'string'
      ? { scope: parsed.scope, completedAt: parsed.completedAt }
      : null;
  } catch {
    return null;
  }
}

export async function markTutorialCompleted(scope: Scope): Promise<void> {
  try {
    await AsyncStorage.setItem(
      KEY,
      JSON.stringify({ scope, completedAt: new Date().toISOString() } satisfies TutorialCompletion),
    );
  } catch {
    /* storage unavailable/full — keep the finale on screen regardless */
  }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `yarn workspace @trm/mobile test progress` → PASS

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/package.json yarn.lock apps/mobile/src/features/tutorial/progress.ts apps/mobile/src/features/tutorial/__tests__/progress.test.ts
git commit -m "feat(mobile): tutorial completion persistence in AsyncStorage"
```

---

### Task 11: TutorialScreen, navigation route, Home entry, gate threading

**Files:**

- Create: `apps/mobile/src/features/tutorial/TutorialScreen.tsx`
- Modify: `apps/mobile/src/navigation/types.ts` (+ the stack registration file P1 owns)
- Modify: `apps/mobile/src/screens/HomeScreen.tsx`
- Verify/Modify: `apps/mobile/src/screens/GameStage.tsx` (gate + overlay threading)

**Interfaces:**

- Consumes: everything from Tasks 2–10; P2 `GameStage` props (`snapshot, commands, onLeave, overlay, spotlightCities, frameTarget, actionGate, sandbox`); P1 navigation + HomeScreen; `resetToDefaultContent` from `../../game/catalog`.
- Produces: route `Tutorial: undefined` in `RootStackParamList`; a Home entry (`testID="home-tutorial"`) with a completion badge (`testID="home-tutorial-done"`), reachable **without auth and without network** (spec §4 airplane-mode posture: Home offers Tutorial offline).

- [ ] **Step 1: Verify (or add) the GameStage tutorial props**

```bash
grep -n "spotlightCities\|frameTarget\|actionGate\|overlay\|sandbox" apps/mobile/src/screens/GameStage.tsx
```

Contract: the native GameStage (i) renders `overlay` above the board + HUD, (ii) passes `frameTarget` to the board (P2's auto-pan camera), (iii) passes `spotlightCities` into the board's city-glow layer, (iv) derives `const allow = gateFlags(actionGate)` (import from `../features/tutorial/types`) and disables each dock affordance accordingly — web reference: `apps/web/src/screens/GameStage.tsx:30,79,128-138,172` and the per-affordance `allow.draw/tickets/claim/station/keep/tunnel` wiring below it, plus the phone-tier effect that auto-switches the dock tab to the awaited affordance. If any leg is missing, add it by porting the web wiring into P2's local idiom, and add a gate test beside P2's existing GameStage tests mirroring `apps/web/src/screens/GameStage.gate.test.tsx` (locked ⇒ every affordance disabled; `{t:'DRAW_ANY'}` ⇒ only draw enabled).

- [ ] **Step 2: Implement `TutorialScreen.tsx`**

```tsx
// The full-screen tutorial route: scope launcher, then each lesson runs a local SandboxSocket
// game through the GLOBAL game store, rendered by the real GameStage with the coachmark +
// spotlight overlay. Fully offline; reachable without an account. Mirrors the web
// TutorialScreen beat-for-beat (gate derivation, dimAll rule, lesson hand-off).
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useGame } from '../../store/game';
import { resetToDefaultContent } from '../../game/catalog';
import { GameStage } from '../../screens/GameStage';
import { lessonsForScope } from './curriculum';
import { useScenarioPlayer } from './useScenarioPlayer';
import { TutorialOverlay } from './TutorialOverlay';
import { TutorialSpotlight } from './TutorialSpotlight';
import { useSpotlightRects } from './useSpotlightRects';
import { TutorialTargetsProvider } from './targets';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { markTutorialCompleted } from './progress';
import type { ActionGate, Lesson, Scope } from './types';
import type { RootStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

function TutorialLauncher({ onPick, onExit }: { onPick(scope: Scope): void; onExit(): void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.launcher}>
      <View style={styles.launcherCard}>
        <Text style={styles.title}>{t('tutorial.title')}</Text>
        <Text style={styles.muted}>{t('tutorial.intro')}</Text>
        <Pressable
          accessibilityRole="button"
          testID="tut-scope-full"
          style={[styles.btn, styles.btnAccent]}
          onPress={() => onPick('full')}
        >
          <Text style={styles.btnAccentText}>{t('tutorial.full')}</Text>
        </Pressable>
        <Text style={styles.mutedSmall}>{t('tutorial.fullDesc')}</Text>
        <Pressable
          accessibilityRole="button"
          testID="tut-scope-core"
          style={styles.btn}
          onPress={() => onPick('core')}
        >
          <Text style={styles.btnText}>{t('tutorial.quickstart')}</Text>
        </Pressable>
        <Text style={styles.mutedSmall}>{t('tutorial.quickstartDesc')}</Text>
        <Pressable accessibilityRole="button" testID="tut-launcher-exit" onPress={onExit}>
          <Text style={styles.link}>{t('tutorial.exit')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function TutorialRunner({
  lesson,
  scope,
  lessonNo,
  lessonCount,
  isLast,
  onPrevLesson,
  onNextLesson,
  onExit,
  onCreateGame,
}: {
  lesson: Lesson;
  scope: Scope;
  lessonNo: number;
  lessonCount: number;
  isLast: boolean;
  onPrevLesson(): void;
  onNextLesson(): void;
  onExit(): void;
  onCreateGame(): void;
}) {
  const { t } = useTranslation();
  const player = useScenarioPlayer(lesson, useGame);
  const snapshot = useGame((s) => s.snapshot);
  const reduced = useReducedMotion();
  const beat = player.beat;
  const spotlight = beat?.spotlight;
  const rects = useSpotlightRects(spotlight);
  const spotlightCities = spotlight?.kind === 'cities' ? spotlight.ids : undefined;
  const frameTarget = beat?.frame ?? null;
  // Web-identical gate: an await beat exposes exactly its affordance; anything else locks the HUD.
  const actionGate: ActionGate = beat && beat.mode === 'await' ? beat.expect : 'locked';
  // Only a whole-board overview (or no spotlight at all) dims the entire stage; a named target
  // must never dim everything while its rect resolves.
  const dimAll = !spotlight || spotlight.kind === 'board';

  // Whole-tutorial completion → persist (offline, fire-and-forget).
  useEffect(() => {
    if (player.done && isLast) void markTutorialCompleted(scope);
  }, [player.done, isLast, scope]);

  if (!snapshot) {
    return (
      <View style={styles.launcher}>
        <Text style={styles.muted}>{t('connecting')}</Text>
      </View>
    );
  }

  return (
    <GameStage
      snapshot={snapshot}
      commands={player.commands}
      onLeave={onExit}
      sandbox
      spotlightCities={spotlightCities}
      frameTarget={frameTarget}
      actionGate={actionGate}
      overlay={
        <>
          <TutorialSpotlight rects={rects} reducedMotion={reduced} dimAll={dimAll} />
          <TutorialOverlay
            beat={beat}
            done={player.done}
            index={player.index}
            total={player.total}
            lessonTitleKey={lesson.titleKey}
            lessonNo={lessonNo}
            lessonCount={lessonCount}
            isLastLesson={isLast}
            specimen={beat?.specimen}
            spotRects={rects}
            onAdvance={player.next}
            onReplay={player.restart}
            onPrevLesson={onPrevLesson}
            onNextLesson={onNextLesson}
            onExit={onExit}
            onCreateGame={onCreateGame}
          />
        </>
      }
    />
  );
}

export default function TutorialScreen() {
  const navigation = useNavigation<Nav>();
  const [scope, setScope] = useState<Scope | null>(null);
  const [lessonIdx, setLessonIdx] = useState(0);
  const lessons = useMemo(() => (scope ? lessonsForScope(scope) : []), [scope]);
  const exit = () => navigation.navigate('Home');

  // The tutorial always teaches on the bundled Taiwan map — defensive against a previous
  // screen (a custom-map game) having left another catalog active. Same as web.
  useEffect(() => {
    resetToDefaultContent();
  }, []);

  if (!scope) {
    return (
      <TutorialLauncher
        onPick={(s) => {
          setScope(s);
          setLessonIdx(0);
        }}
        onExit={exit}
      />
    );
  }
  const lesson = lessons[lessonIdx];
  if (!lesson) return null;

  return (
    <TutorialTargetsProvider>
      <TutorialRunner
        key={lesson.id}
        lesson={lesson}
        scope={scope}
        lessonNo={lessonIdx + 1}
        lessonCount={lessons.length}
        isLast={lessonIdx === lessons.length - 1}
        onPrevLesson={() => setLessonIdx((i) => Math.max(0, i - 1))}
        onNextLesson={() => setLessonIdx((i) => Math.min(lessons.length - 1, i + 1))}
        onExit={exit}
        onCreateGame={exit} // Home is the create-game surface on mobile; land the learner there
      />
    </TutorialTargetsProvider>
  );
}

const styles = StyleSheet.create({
  launcher: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  launcherCard: { width: '100%', maxWidth: 360, borderRadius: 16, padding: 20, gap: 10 },
  title: { fontSize: 22, fontWeight: '700' },
  muted: { opacity: 0.75 },
  mutedSmall: { opacity: 0.6, fontSize: 12 },
  btn: { borderRadius: 12, paddingVertical: 12, alignItems: 'center', borderWidth: 1 },
  btnAccent: { borderWidth: 0 },
  btnText: { fontWeight: '600' },
  btnAccentText: { fontWeight: '700' },
  link: { textDecorationLine: 'underline', textAlign: 'center', marginTop: 6 },
});
```

(Colour values intentionally omitted from the StyleSheet above — pull surface/accent tokens from P1's theme module the way HomeScreen does, so the launcher matches the app.)

- [ ] **Step 3: Register the route + the Home entry**

In `apps/mobile/src/navigation/types.ts`: add `Tutorial: undefined;` to `RootStackParamList`. In the stack registration file: `<Stack.Screen name="Tutorial" component={TutorialScreen} options={{ headerShown: false }} />`. **The Tutorial route must sit outside any auth gate** — if P1 splits authed/unauthed stacks, register it in both (the web pins the same rule: "reachable without an account", `apps/web/src/store/ui.ts:331-334`).

In `apps/mobile/src/screens/HomeScreen.tsx` (apply in P1's local idiom):

```tsx
import { getTutorialCompletion } from '../features/tutorial/progress';
// state + load-on-focus:
const [tutorialDone, setTutorialDone] = useState(false);
useFocusEffect(
  useCallback(() => {
    let alive = true;
    void getTutorialCompletion().then((c) => alive && setTutorialDone(c !== null));
    return () => {
      alive = false;
    };
  }, []),
);
// entry (alongside the existing play cards; strings already exist in P1's ported i18n —
// web keys home.play.tutorialTitle / home.play.tutorialDesc):
<Pressable
  accessibilityRole="button"
  testID="home-tutorial"
  onPress={() => navigation.navigate('Tutorial')}
>
  <Text>{t('home.play.tutorialTitle')}</Text>
  <Text>{t('home.play.tutorialDesc')}</Text>
  {tutorialDone && <Text testID="home-tutorial-done">✓</Text>}
</Pressable>;
```

Verify the i18n keys exist in the mobile port: `grep -n "tutorialTitle" apps/mobile/src/i18n/index.ts` — if P1 trimmed them, add `tutorialTitle`/`tutorialDesc` under the `home.play` group in both languages, copying the web strings verbatim (`apps/web/src/i18n/index.ts:42-43,551-552`).

- [ ] **Step 4: Run the app-level checks**

Run: `yarn workspace @trm/mobile test` → PASS (Home/navigation suites absorb the new entry; update snapshots if P1 uses them)
Run: `yarn typecheck` → clean

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/features/tutorial/TutorialScreen.tsx apps/mobile/src/navigation/types.ts apps/mobile/src/screens/HomeScreen.tsx
git add <stack registration file> <GameStage.tsx + its gate test, if Step 1 modified them>
git commit -m "feat(mobile): tutorial screen, route and offline Home entry with completion badge"
```

---

### Task 12: Scripted end-to-end walkthrough + full validation + docs

**Files:**

- Create: `apps/mobile/src/features/tutorial/__tests__/TutorialScreen.walkthrough.test.tsx`
- Modify: `apps/mobile/CLAUDE.md` (tutorial architecture note; create the section if P1's file lacks one)

**Interfaces:**

- Consumes: everything above. The walkthrough drives the REAL curriculum + REAL SandboxSocket (the P3-proven local-simulation seam: engine `reduce` → `redactFor` → `viewToSnapshot` → the standard store) with only the Skia-heavy `GameStage` stubbed — jest cannot host the board, and the board is P2's own test surface.
- Produces: a CI gate that a learner can travel the entire Quickstart curriculum beat-by-beat to the finale and that completion persists.

- [ ] **Step 1: Write the failing walkthrough test**

Create `apps/mobile/src/features/tutorial/__tests__/TutorialScreen.walkthrough.test.tsx`:

```tsx
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import '../../../i18n';
import type { SandboxSocket } from '../../../net/sandboxSocket';
import type { Beat } from '../types';
import { lessonsForScope } from '../curriculum';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
import AsyncStorage from '@react-native-async-storage/async-storage';

// The Skia game stage is P2's test surface; here it is a pass-through that surfaces the overlay
// and captures `commands` so the test can play the learner's moves through the REAL sandbox.
let mockStageProps: Record<string, unknown> | null = null;
jest.mock('../../../screens/GameStage', () => {
  const React = require('react');
  return {
    GameStage: (props: Record<string, unknown>) => {
      mockStageProps = props;
      return React.createElement(React.Fragment, null, props.overlay);
    },
  };
});

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate }),
}));

import TutorialScreen from '../TutorialScreen';

/** Perform an await beat's expected move through the live sandbox (mirrors scenarios.spec.ts). */
function performAwait(sandbox: SandboxSocket, beat: Extract<Beat, { mode: 'await' }>): void {
  const s = sandbox.getState();
  const offer = [...(s.players['you']?.pendingTicketOffer ?? [])] as string[];
  switch (beat.expect.t) {
    case 'KEEP_INITIAL_TICKETS':
      sandbox.keepInitialTickets(offer);
      break;
    case 'KEEP_TICKETS':
      sandbox.keepTickets(offer.slice(0, 1));
      break;
    case 'DRAW_ANY':
    case 'DRAW_BLIND':
      sandbox.drawBlind();
      break;
    case 'DRAW_TICKETS':
      sandbox.drawTickets();
      break;
    case 'PASS':
      sandbox.pass();
      break;
    default:
      throw new Error(`walkthrough cannot synthesize await ${beat.expect.t}`);
  }
}

describe('scripted end-to-end Quickstart walkthrough', () => {
  it('travels every core lesson to the finale and persists completion', async () => {
    jest.useFakeTimers();
    const r = render(<TutorialScreen />);
    fireEvent.press(r.getByTestId('tut-scope-core'));

    const lessons = lessonsForScope('core');
    for (let li = 0; li < lessons.length; li++) {
      const lesson = lessons[li]!;
      const isLastLesson = li === lessons.length - 1;
      for (let bi = 0; bi < lesson.beats.length; bi++) {
        const beat = lesson.beats[bi]!;
        const isLastBeat = bi === lesson.beats.length - 1;
        if (beat.mode === 'info') {
          // The last info beat of a non-final lesson hands off via "next lesson".
          const btn =
            isLastBeat && !isLastLesson
              ? r.getByTestId('tut-next-lesson')
              : r.getByTestId('tut-next');
          fireEvent.press(btn);
        } else if (beat.mode === 'await') {
          const sandbox = mockStageProps!.commands as SandboxSocket;
          act(() => performAwait(sandbox, beat));
        } else {
          // auto beat: the player fires its scripted action on a timer.
          act(() => {
            jest.advanceTimersByTime((beat.delayMs ?? 900) + 50);
          });
        }
        await act(async () => {}); // flush projections/re-renders
        // A done lesson (last beat consumed) rolls into the next one via the done-state button.
        if (isLastBeat && beat.mode !== 'info' && !isLastLesson) {
          fireEvent.press(r.getByTestId('tut-next-lesson'));
          await act(async () => {});
        }
      }
    }

    // Whole-tutorial finale: celebratory CTA on screen, completion persisted.
    await waitFor(() => expect(r.getByTestId('tut-finale-cta')).toBeTruthy());
    await waitFor(async () =>
      expect(await AsyncStorage.getItem('trm.tutorial.completed.v1')).toContain('"core"'),
    );
    jest.useRealTimers();
  });
});
```

Note: the exact press sequence at lesson boundaries depends on which beat mode ends each lesson (the web hands off with `tut-next-lesson` both from a final info beat and from the done state). If the loop above double-presses or under-presses at a boundary, fix the DRIVER (this test), never the runner — the web's behaviour (TutorialOverlay.tsx branch order) is the reference.

- [ ] **Step 2: Run to verify it fails, then make it pass**

Run: `yarn workspace @trm/mobile test walkthrough`
Expected first run: FAIL (typically at a lesson hand-off press). Iterate on the driver until the full Quickstart traversal passes. Any failure INSIDE the runner (a beat that never advances, a rejected sandbox action) is a real P4 bug — debug it, don't paper over it.

- [ ] **Step 3: Full validation gates**

```bash
yarn workspace @trm/mobile test:pure     # parity, gate, focus, scenarios, targets, boardRects, scrim, sandboxSocket
yarn workspace @trm/mobile test          # registry hook, spotlight rects, spotlight, specimens, overlay, progress, walkthrough
yarn workspace @trm/web test             # web untouched — must pass unchanged
yarn typecheck
yarn lint
yarn build
```

Expected: all PASS/clean.

- [ ] **Step 4: Document + refresh the graph**

Append to `apps/mobile/CLAUDE.md`:

```markdown
## Tutorial (`src/features/tutorial/`)

The interactive tutorial is fully offline: lessons are scripted scenarios over a REAL local
`@trm/engine` game (`net/sandboxSocket.ts` → engine `reduce` → `redactFor` → `viewToSnapshot`
→ the standard game store → GameStage). `types.ts`, `curriculum.ts`, `focus.ts`, and
`i18n/tutorial.ts` are **byte-identical copies of `apps/web`** (enforced by `parity.spec.ts`)
— the anchor-id strings inside them are simultaneously the web's CSS selectors and this app's
`TutorialTargetRegistry` anchor ids (`targets.tsx`); change them on web first, then re-copy.
HUD spotlights measure ref-registered Views via `measureInWindow` (`useTutorialAnchor`, keep
`collapsable={false}`); city/route spotlights are computed from board geometry projected
through the camera (`boardRects.ts`; `cameraBridge.ts` is the only file that may touch camera
internals). The scrim is a Skia even-odd path (`scrim.ts` + `TutorialSpotlight`). Completion
persists to AsyncStorage (`progress.ts`, key `trm.tutorial.completed.v1`); the Home entry and
the whole flow work with no account and no network. Pure logic tests are vitest `*.spec.ts`;
RN components are jest-expo `*.test.tsx` — keep the globs disjoint.
```

Then run `graphify update .` (AST-only refresh).

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/features/tutorial/__tests__/TutorialScreen.walkthrough.test.tsx apps/mobile/CLAUDE.md
git commit -m "test(mobile): scripted end-to-end tutorial walkthrough; document the tutorial architecture"
```

---

## Out of scope (do not build here)

- **In-game encyclopedia on mobile** (web `EncyclopediaModal`): the ported `curriculum.ts` keeps `encyclopediaEntries()` (parity), but no mobile encyclopedia UI ships in P4 — it composes from these same pieces later if wanted.
- Confetti/haptics on the finale — haptics land in P5 (`expo-haptics` behind the settings toggle); the finale exposes a single hook point (`finished` in TutorialOverlay) for P5 to decorate.
- Replay viewer, pass-and-play, custom-map tutorials — deferred per `docs/TODO.md`; do not plan or stub them.
