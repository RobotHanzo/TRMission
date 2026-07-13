# Mission Generator Short-Range Max Score Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let map builder authors cap the score of auto-generated SHORT (short-range) mission tickets via a new field in the "Auto Generate" modal.

**Architecture:** Add an optional `shortMaxValue` to `@trm/map-data`'s `generateTickets()` that filters the SHORT candidate pool by computed score before sampling; wire a matching optional number field into the builder's `GenerateModal`, with a non-blocking shortfall message when the cap prevents reaching the requested count.

**Tech Stack:** TypeScript, Vitest (map-data tests), React (web UI), react-i18next (zh-Hant + en).

## Global Constraints

- `shortMaxValue` is `undefined` by default (unset) — unset must reproduce today's `generateTickets` output exactly for a fixed seed (verified by the existing, unmodified test suite staying green).
- The cap applies to the ticket's **final score** (`value`, i.e. `Math.max(2, distance + islandBonus)`), not the raw shortest-path distance.
- No `GameContent`/`hashContent` change — `GenerateTicketsOptions` is a builder-tool-only input; do not touch `hashContent`, `validate.ts`, or any archived content version.
- Follow the repo's spread-if-defined convention for optional fields under `exactOptionalPropertyTypes` — never assign an object-literal property to `undefined` explicitly; omit the key instead (`...(x !== undefined ? { key: x } : {})`).
- All new UI strings need both zh-Hant (primary) and English entries in `apps/web/src/i18n/index.ts`.
- Reference spec: `docs/superpowers/specs/2026-07-10-mission-generator-short-max-score-design.md`.

---

### Task 1: `@trm/map-data` — `shortMaxValue` option and candidate filter

**Files:**

- Modify: `packages/map-data/src/generate.ts`
- Test: `packages/map-data/test/generate.spec.ts`

**Interfaces:**

- Consumes: existing `generateTickets(cities, routes, opts)` and `GenerateTicketsOptions` (`seed`, `longCount?`, `shortCount?`, `shortMinDistance?`), the fixture helpers `ringCities(n)` / `ringRoutes(n)` from `./fixtures` (already imported in the test file).
- Produces: `GenerateTicketsOptions.shortMaxValue?: number` — an optional cap on a SHORT ticket's `value`. Consumed by Task 2 (`apps/web`'s `GenerateModal`), which passes it straight through to `generateTickets`.

- [ ] **Step 1: Write the two failing tests**

Add these two `it` blocks inside the existing `describe('generateTickets', ...)` block in `packages/map-data/test/generate.spec.ts`, right after the `'caps output at the available pair count instead of looping forever'` test (i.e. just before the closing `});` of the `describe` block):

```ts
it('shortMaxValue excludes SHORT tickets whose score is above the cap', () => {
  const uncapped = generateTickets(cities, routes, { seed: 6, longCount: 3, shortCount: 12 });
  const uncappedShortValues = uncapped.filter((t) => t.deck === 'SHORT').map((t) => t.value);
  const maxShortValue = Math.max(...uncappedShortValues);
  const cap = maxShortValue - 1;
  expect(cap).toBeGreaterThanOrEqual(2);

  const capped = generateTickets(cities, routes, {
    seed: 6,
    longCount: 3,
    shortCount: 12,
    shortMaxValue: cap,
  });
  for (const t of capped.filter((x) => x.deck === 'SHORT')) {
    expect(t.value).toBeLessThanOrEqual(cap);
  }
});

it('does not throw when shortMaxValue is tighter than the reachable SHORT band', () => {
  // shortMinDistance defaults to 4, so every SHORT candidate's value is ≥ 4 — a cap of 2
  // excludes every candidate, leaving an empty (not thrown) SHORT deck.
  const tickets = generateTickets(cities, routes, {
    seed: 8,
    longCount: 3,
    shortCount: 50,
    shortMaxValue: 2,
  });
  expect(tickets.filter((t) => t.deck === 'SHORT')).toHaveLength(0);
  expect(tickets.filter((t) => t.deck === 'LONG')).toHaveLength(3);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn workspace @trm/map-data test --run generate`

Expected: the two new tests FAIL —

- `'shortMaxValue excludes SHORT tickets...'` fails a `toBeLessThanOrEqual(cap)` assertion (today's code ignores `shortMaxValue` entirely, since the extra option is never read).
- `'does not throw when shortMaxValue is tighter...'` fails the `toHaveLength(0)` assertion (today's SHORT deck is populated regardless of `shortMaxValue`).

All other tests in the file still PASS.

- [ ] **Step 3: Add `shortMaxValue` to the type and destructuring**

In `packages/map-data/src/generate.ts`, replace the `GenerateTicketsOptions` interface (current lines 5-11):

```ts
export interface GenerateTicketsOptions {
  /** Same seed + same map ⇒ identical output; exposed to the builder UI for reroll. */
  readonly seed: number;
  readonly longCount?: number;
  readonly shortCount?: number;
  readonly shortMinDistance?: number;
}
```

with:

```ts
export interface GenerateTicketsOptions {
  /** Same seed + same map ⇒ identical output; exposed to the builder UI for reroll. */
  readonly seed: number;
  readonly longCount?: number;
  readonly shortCount?: number;
  readonly shortMinDistance?: number;
  /** Caps a SHORT ticket's final score (value); undefined ⇒ unbounded (today's behavior). */
  readonly shortMaxValue?: number;
}
```

Then replace the options destructuring line (current line 33):

```ts
const { seed, longCount = 6, shortCount = 36, shortMinDistance = 4 } = opts;
```

with:

```ts
const { seed, longCount = 6, shortCount = 36, shortMinDistance = 4, shortMaxValue } = opts;
```

- [ ] **Step 4: Filter the SHORT candidate pool by score**

Replace the `remaining` candidate filter (current lines 86-89):

```ts
const minLongDistance = longPicks.length > 0 ? Math.min(...longPicks.map((p) => p.d)) : Infinity;
const remaining = candidates.filter(
  (c) => !usedPairs.has(pairKey(c.a, c.b)) && c.d >= shortMinDistance && c.d < minLongDistance,
);
```

with:

```ts
const minLongDistance = longPicks.length > 0 ? Math.min(...longPicks.map((p) => p.d)) : Infinity;
const remaining = candidates.filter(
  (c) =>
    !usedPairs.has(pairKey(c.a, c.b)) &&
    c.d >= shortMinDistance &&
    c.d < minLongDistance &&
    (shortMaxValue === undefined || valueOf(c.d, c.a, c.b) <= shortMaxValue),
);
```

This reuses the same `valueOf` already computed above (`generate.ts:44-45`) for the final ticket score — no new scoring logic. Every other part of the function (LONG selection, weighted sampling, ticket construction) is untouched.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `yarn workspace @trm/map-data test --run generate`

Expected: PASS — all tests in `generate.spec.ts` green, including the two new ones and every pre-existing test (proving unset `shortMaxValue` reproduces prior behavior exactly, since none of those tests pass the new field).

- [ ] **Step 6: Typecheck and lint**

Run: `yarn workspace @trm/map-data typecheck && yarn workspace @trm/map-data lint`

Expected: both PASS with no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/map-data/src/generate.ts packages/map-data/test/generate.spec.ts
git commit -m "feat(map-data): add shortMaxValue cap to generateTickets"
```

---

### Task 2: `apps/web` — Auto Generate modal field, shortfall message, i18n

**Files:**

- Modify: `apps/web/src/features/builder/editor/stages/MissionsStage.tsx`
- Modify: `apps/web/src/i18n/index.ts`

**Interfaces:**

- Consumes: `GenerateTicketsOptions.shortMaxValue?: number` from Task 1 (imported transitively via `generateTickets` from `@trm/map-data`, already imported in `MissionsStage.tsx:4`); existing `GenerateModal` local state (`seed`, `longCount`, `shortCount`, `preview`, `error`) and its `run(nextSeed: number)` closure.
- Produces: nothing consumed by a later task — this is the final integration point.

- [ ] **Step 1: Add the `shortMaxValue` input state**

In `apps/web/src/features/builder/editor/stages/MissionsStage.tsx`, inside `GenerateModal`, add a new state hook right after the existing `shortCount` state (current line 288, `const [shortCount, setShortCount] = useState(24);`):

```tsx
const [shortMaxValue, setShortMaxValue] = useState('');
```

Blank string means "no cap" — matches the "unset = unbounded" default from Task 1.

- [ ] **Step 2: Parse the field and derive the shortfall flag**

Still inside `GenerateModal`, right after the `cityName` helper (current lines 292, before `const run = ...`), add:

```tsx
const parsedMaxValue = (() => {
  const trimmed = shortMaxValue.trim();
  if (trimmed === '') return undefined;
  const n = Math.round(Number(trimmed));
  return Number.isFinite(n) ? Math.max(2, n) : undefined;
})();

const shortGenerated = preview ? preview.filter((tk) => tk.deck === 'SHORT').length : null;
const showShortfallWarning =
  parsedMaxValue !== undefined && shortGenerated !== null && shortGenerated < shortCount;
```

`parsedMaxValue` is recomputed on every render from the current field text (no extra effect needed); `showShortfallWarning` is derived the same way, matching the design's "no extra state" approach.

- [ ] **Step 3: Pass the cap into `generateTickets`**

Replace the `generateTickets` call inside `run()` (current lines 300-304):

```tsx
const tickets = generateTickets(content.cities, content.routes, {
  seed: nextSeed,
  longCount,
  shortCount,
});
```

with:

```tsx
const tickets = generateTickets(content.cities, content.routes, {
  seed: nextSeed,
  longCount,
  shortCount,
  ...(parsedMaxValue !== undefined ? { shortMaxValue: parsedMaxValue } : {}),
});
```

The spread-if-defined form is required — `GenerateTicketsOptions.shortMaxValue` is an optional `number` under `exactOptionalPropertyTypes`, so assigning it `undefined` explicitly is a type error.

- [ ] **Step 4: Add the input field to the modal JSX**

In the JSX, right after the `shortCount` `<label>` block (current lines 330-338, ending `</label>`) and before the seed/reroll `<div className="row">` (current line 339), add:

```tsx
<label>
  {t('builder.shortMaxValue')}
  <input
    type="number"
    min={2}
    placeholder={t('builder.noLimit')}
    value={shortMaxValue}
    onChange={(e) => setShortMaxValue(e.target.value)}
  />
</label>
```

- [ ] **Step 5: Add the shortfall message to the JSX**

Right after the existing error paragraph (current line 346, `{error && <p className="error">{error}</p>}`), add:

```tsx
{
  showShortfallWarning && (
    <p className="error">
      {t('builder.shortMaxValueShortfall', { n: shortGenerated ?? 0, count: shortCount })}
    </p>
  );
}
```

`shortGenerated ?? 0` is defensive only — `showShortfallWarning` already guarantees `shortGenerated` is non-null whenever this renders, but TypeScript doesn't narrow one derived variable through a boolean held in another, so the fallback keeps this a clean `number` without needing a type assertion.

This reuses the existing `.error` paragraph style (`apps/web/src/styles/app.css:143`, `color: var(--tr-danger)`) already used for the connectivity-failure message in this same modal. It never disables "Apply" — generation still succeeded, just with fewer SHORT tickets than requested.

- [ ] **Step 6: Add i18n strings — zh-Hant**

In `apps/web/src/i18n/index.ts`, find this exact two-line sequence in the zh-Hant `builder` block (current lines 508-509):

```ts
        shortCount: '短途任務數量',
        seed: '種子：{{seed}}',
```

Replace with:

```ts
        shortCount: '短途任務數量',
        shortMaxValue: '短途任務上限分數',
        noLimit: '無上限',
        shortMaxValueShortfall: '短途任務上限分數限制了產生數量，僅產生 {{n}} 張（需求 {{count}} 張）。',
        seed: '種子：{{seed}}',
```

- [ ] **Step 7: Add i18n strings — English**

In the same file, find this exact two-line sequence in the English `builder` block (current lines 1101-1102):

```ts
        shortCount: 'Short ticket count',
        seed: 'Seed: {{seed}}',
```

Replace with:

```ts
        shortCount: 'Short ticket count',
        shortMaxValue: 'Short ticket max score',
        noLimit: 'No limit',
        shortMaxValueShortfall:
          'The short ticket max score limited generation to {{n}} tickets (requested {{count}}).',
        seed: 'Seed: {{seed}}',
```

- [ ] **Step 8: Typecheck, lint, and build the web app**

Run: `yarn workspace @trm/web typecheck && yarn workspace @trm/web lint && yarn workspace @trm/web build`

Expected: all three PASS. The build step also confirms the change doesn't affect the lazy-loaded builder chunk in a way that breaks bundling (`apps/web/CLAUDE.md` — "must never inflate the main bundle"; this change adds a few lines to an already-lazy-loaded chunk, so no separate chunk-size check is needed).

- [ ] **Step 9: Manual verification (best-effort)**

If you have a local dev environment with a `mapBuilder`-featured account and Docker available:

```bash
docker compose up -d mongo
yarn workspace @trm/server dev &
yarn workspace @trm/web dev
```

Open `/maps`, create or edit a custom map, reach the Missions stage, click "Auto Generate", enter a low value (e.g. `4`) in the new "Short ticket max score" field, click "Preview", and confirm: every previewed SHORT ticket's score is ≤ the cap, and if fewer SHORT tickets were generated than requested, the shortfall message appears below the preview. This step is best-effort — if the environment isn't available, the typecheck/lint/build gate in Step 8 plus Task 1's unit tests covering the underlying logic are the required bar.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/features/builder/editor/stages/MissionsStage.tsx apps/web/src/i18n/index.ts
git commit -m "feat(web/builder): expose short-ticket max score in Auto Generate modal"
```

---

### Task 3: Full monorepo validation

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Run the full validation suite from the repo root**

Run: `yarn typecheck && yarn lint && yarn test && yarn format:check`

Expected: all four PASS. `yarn test` re-runs `packages/map-data`'s suite (including Task 1's new tests) alongside every other workspace's tests via Turborepo; nothing else in the repo depends on `GenerateTicketsOptions`'s shape changing in a breaking way, since the new field is optional.

- [ ] **Step 2: Fix formatting if `format:check` fails**

If `yarn format:check` reports issues, run `yarn format`, review the diff is confined to the files touched in Tasks 1-2, and commit:

```bash
git add packages/map-data/src/generate.ts packages/map-data/test/generate.spec.ts apps/web/src/features/builder/editor/stages/MissionsStage.tsx apps/web/src/i18n/index.ts
git commit -m "style: format short-max-score changes"
```

If `format:check` already passes, skip this step — there is nothing new to commit.
