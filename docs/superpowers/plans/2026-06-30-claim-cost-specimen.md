# Claim-cost Specimen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `claim-cost` coachmark specimen to the `claim.intro` tutorial beat — three varying-length railways each pointing to the single card + count that pays for them.

**Architecture:** One more `SpecimenSpec` variant rendered by the existing `Specimen` switch. A new `ClaimCostSpecimen` reuses the live `TrainCarCard` (with a `×N` count chip, payment-modal style) and a `ClaimTrack` helper that mirrors `RouteSpecimen`'s proven board-class geometry. Colored rows use a static matching-colour card; the gray row reuses the station chapter's colour-cycling card to mean "any single colour."

**Tech Stack:** React + TypeScript + Vite (`apps/web`); vitest + @testing-library/react.

## Global Constraints

- `apps/web` pins **Vite ^5** — do not bump.
- Self-developed graphics only; reuse live board/card classes — **no copied artwork**.
- The 6th card colour is **PURPLE** (never PINK); card colours come from `@trm/shared` `CARD_COLORS`.
- Honour `prefers-reduced-motion` for any animation (reuse the existing `useReducedMotion` hook).
- All specimen roots carry `data-testid="tut-specimen"`.
- Run from the worktree root: `D:\Web Projects\TRMission\.claude\worktrees\tutorial`.

---

### Task 1: The `claim-cost` specimen

**Files:**

- Modify: `apps/web/src/features/tutorial/types.ts` (add the union member)
- Modify: `apps/web/src/features/tutorial/Specimens.tsx` (imports, `CyclingCard` count, `ClaimTrack`, `ClaimCostSpecimen`, switch case)
- Modify: `apps/web/src/styles/tutorial.css` (the `tut-claim-cost*` classes)
- Test: `apps/web/src/features/tutorial/Specimens.test.tsx`

**Interfaces:**

- Consumes: `TrainCarCard` (`apps/web/src/components/TrainCarCard.tsx` — props `{ color: CardColor; count?: number; showGlyph?: boolean; size?: number }`), `CARD_COLOR_TOKENS` (`apps/web/src/theme/colors.ts` — `CARD_COLOR_TOKENS[color].hex`), `useReducedMotion` (`apps/web/src/hooks/useReducedMotion.ts`), the existing `STATION_PALETTE` const and `.route`/`.bed`/`.slot` board classes.
- Produces: `SpecimenSpec` gains `{ kind: 'claim-cost' }`; `<Specimen spec={{ kind: 'claim-cost' }} />` renders a `.tut-claim-cost` root with three `.tut-claim-cost-row` rows.

- [ ] **Step 1: Write the failing test**

Add `{ kind: 'claim-cost' }` to the `specs` array in `apps/web/src/features/tutorial/Specimens.test.tsx` (after the `{ kind: 'score-table' }` line), and add this test inside the `describe('Specimen', …)` block:

```tsx
it('the claim-cost specimen shows three rows costing ×2, ×4, ×3', () => {
  const { container } = render(<Specimen spec={{ kind: 'claim-cost' }} />);
  expect(container.querySelectorAll('.tut-claim-cost-row').length).toBe(3);
  const text = container.textContent ?? '';
  expect(text).toContain('×2');
  expect(text).toContain('×4');
  expect(text).toContain('×3');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/web test --run Specimens`
Expected: FAIL — the generic loop case and the new test fail because `'claim-cost'` is not assignable to `SpecimenSpec` (type error) / no `.tut-claim-cost-row` is rendered.

- [ ] **Step 3: Add the union member**

In `apps/web/src/features/tutorial/types.ts`, extend the `SpecimenSpec` union (add the last member):

```ts
export type SpecimenSpec =
  | { kind: 'routes-compare' }
  | { kind: 'route'; variant: 'rail' | 'ferry' | 'tunnel' | 'double' }
  | { kind: 'card-row' }
  | { kind: 'loco-card' }
  | { kind: 'station' }
  | { kind: 'station-cost' }
  | { kind: 'score-table' }
  | { kind: 'ticket'; id: string }
  | { kind: 'claim-cost' };
```

- [ ] **Step 4: Make `CyclingCard` count-aware**

In `apps/web/src/features/tutorial/Specimens.tsx`, change `CyclingCard` to accept an optional `count` and pass it to **both** stacked layers (so the `×N` chip cross-fades with the colour and the footprint stays stable):

```tsx
function CyclingCard({ idx, size, count }: { idx: number; size: number; count?: number }) {
  const len = STATION_PALETTE.length;
  const cur = STATION_PALETTE[((idx % len) + len) % len]!;
  const prev = STATION_PALETTE[(((idx - 1) % len) + len) % len]!;
  return (
    <span className="tut-cost-card">
      <span className="tut-cost-card-layer is-prev" key={`p${idx}`}>
        <TrainCarCard color={prev} size={size} showGlyph={false} count={count} />
      </span>
      <span className="tut-cost-card-layer is-cur" key={`c${idx}`}>
        <TrainCarCard color={cur} size={size} showGlyph={false} count={count} />
      </span>
    </span>
  );
}
```

(Existing `StationCostSpecimen` calls `CyclingCard` without `count`, so `count` is `undefined` there and no chip renders — unchanged behaviour.)

- [ ] **Step 5: Add the `CARD_COLOR_TOKENS` import**

In `apps/web/src/features/tutorial/Specimens.tsx`, update the theme import line to also bring in the colour tokens:

```tsx
import { SEAT_COLORS, CARD_COLOR_TOKENS } from '../../theme/colors';
```

- [ ] **Step 6: Add `ClaimTrack` and `ClaimCostSpecimen`**

In `apps/web/src/features/tutorial/Specimens.tsx`, add these just above the `Specimen` switch function (after `ScoreTableSpecimen`):

```tsx
/** A mini straight railway of `len` car-slots in `fill`, drawn with the live board classes —
 *  the same slot/bed geometry as RouteSpecimen so it can never drift from the board's look. */
function ClaimTrack({ len, fill }: { len: number; fill: string }) {
  const slotW = 18;
  const gap = 4;
  const totalW = len * slotW + (len - 1) * gap;
  const pad = 10;
  const w = totalW + pad * 2;
  const h = 28;
  const y = h / 2;
  const x0 = pad;
  const slots = Array.from({ length: len }, (_, i) => x0 + i * (slotW + gap) + slotW / 2);
  const path = `M ${x0 - 6} ${y} L ${x0 + totalW + 6} ${y}`;
  const scale = 22 / h;
  return (
    <svg
      className="tut-claim-track"
      viewBox={`0 0 ${w} ${h}`}
      width={w * scale}
      height={h * scale}
      style={{ ['--inv-scale' as string]: '1' }}
      role="img"
      aria-hidden
    >
      <g className="route">
        <path className="bed" d={path} />
        {slots.map((cx, i) => (
          <rect
            key={i}
            className="slot"
            x={-slotW / 2}
            width={slotW}
            fill={fill}
            transform={`translate(${cx} ${y})`}
          />
        ))}
      </g>
    </svg>
  );
}

/** Each row of this discriminated list is one railway → its payment. */
type ClaimRow = { kind: 'color'; color: CardColor; len: number } | { kind: 'gray'; len: number };
const CLAIM_ROWS: ClaimRow[] = [
  { kind: 'color', color: 'RED', len: 2 },
  { kind: 'color', color: 'BLUE', len: 4 },
  { kind: 'gray', len: 3 },
];
const CLAIM_CARD_W = 44;
/** Neutral grey for a GRAY (any-colour) route's track. */
const GRAY_TRACK = '#9aa0a6';

/** The claim-cost reference: varying-length railways each pointing to the single card + count that
 *  pays for them. Colored routes → a static matching-colour card ("same colour as the route"); the
 *  gray route → the colour-cycling card (reused from the station chapter) meaning "any colour". */
export function ClaimCostSpecimen() {
  const reduced = useReducedMotion();
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const id = setInterval(() => setIdx((i) => i + 1), 1500);
    return () => clearInterval(id);
  }, [reduced]);
  return (
    <div className="tut-claim-cost" data-testid="tut-specimen">
      {CLAIM_ROWS.map((row, i) => (
        <div className="tut-claim-cost-row" key={i}>
          <ClaimTrack
            len={row.len}
            fill={row.kind === 'gray' ? GRAY_TRACK : CARD_COLOR_TOKENS[row.color].hex}
          />
          <span className="tut-claim-cost-arrow" aria-hidden>
            →
          </span>
          {row.kind === 'gray' ? (
            <CyclingCard idx={idx} size={CLAIM_CARD_W} count={row.len} />
          ) : (
            <TrainCarCard color={row.color} count={row.len} size={CLAIM_CARD_W} showGlyph={false} />
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 7: Add the switch case**

In the `Specimen` function in `apps/web/src/features/tutorial/Specimens.tsx`, add the case before `case 'ticket':`:

```tsx
    case 'claim-cost':
      return <ClaimCostSpecimen />;
```

- [ ] **Step 8: Add the CSS**

In `apps/web/src/styles/tutorial.css`, append after the `tut-cost-*` block (near the `@keyframes tut-cost-fade` / its reduced-motion rule, before `.tut-ticket-specimen`):

```css
/* Claim-cost reference: a row per railway → the single card (with ×N) that pays for it. */
.tut-claim-cost {
  display: grid;
  gap: 0.55rem;
}
.tut-claim-cost-row {
  display: grid;
  grid-template-columns: auto auto auto;
  align-items: center;
  gap: 0.5rem;
  justify-content: start;
}
.tut-claim-track {
  display: block;
}
.tut-claim-cost-arrow {
  font-size: 1.1rem;
  font-weight: 700;
  opacity: 0.7;
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `yarn workspace @trm/web test --run Specimens`
Expected: PASS — the generic mount loop (now incl. `claim-cost`) and the new three-row test pass.

- [ ] **Step 10: Typecheck + lint**

Run: `yarn workspace @trm/web typecheck` then `yarn lint`
Expected: both pass (the `Specimen` switch stays exhaustive over `SpecimenSpec`).

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/features/tutorial/types.ts apps/web/src/features/tutorial/Specimens.tsx apps/web/src/features/tutorial/Specimens.test.tsx apps/web/src/styles/tutorial.css
git commit -m "feat(web): claim-cost tutorial specimen"
```

---

### Task 2: Attach the specimen to the `claim.intro` beat

**Files:**

- Modify: `apps/web/src/features/tutorial/curriculum.ts` (the `claim` lesson's `intro` beat)

**Interfaces:**

- Consumes: `SpecimenSpec` `{ kind: 'claim-cost' }` produced by Task 1.
- Produces: the `claim.intro` beat now carries `specimen: { kind: 'claim-cost' }`, so the coachmark renders the graphic beside the rule text.

- [ ] **Step 1: Add the specimen to the beat**

In `apps/web/src/features/tutorial/curriculum.ts`, in the `claim` lesson, change the `intro` beat from:

```ts
      { id: 'intro', text: 'tutorial.claim.intro', mode: 'info' },
```

to:

```ts
      { id: 'intro', text: 'tutorial.claim.intro', mode: 'info', specimen: { kind: 'claim-cost' } },
```

- [ ] **Step 2: Verify the full web suite, typecheck, lint**

Run: `yarn workspace @trm/web test --run` then `yarn workspace @trm/web typecheck` then `yarn lint`
Expected: all pass (no scenario/i18n tests touch this beat; no new i18n keys were added).

- [ ] **Step 3: Manual visual check (optional but recommended)**

Run: `yarn workspace @trm/web dev`, open the tutorial, advance to the "宣告路線 / Claiming routes" lesson's first beat. Confirm: three railways (red len-2, blue len-4, gray len-3), each with a `→` to one card showing `×2` / `×4` / `×3`; the red/blue cards are static and colour-matched; the gray row's card cycles through colours. Toggle OS "reduce motion" and confirm the gray card stops animating.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/tutorial/curriculum.ts
git commit -m "feat(web): show claim-cost specimen on the claim.intro beat"
```

---

## Self-Review

**Spec coverage:**

- New specimen on `claim.intro` → Task 2. ✓
- Three rows, varying length, `[track] → [card ×N]` payment-modal idiom → Task 1 Step 6 (`ClaimCostSpecimen`, `TrainCarCard count`). ✓
- Colored rows static matching colour; gray row animated colour-cycling → Task 1 Steps 4 & 6 (`CyclingCard` reuse). ✓
- Reuse live board route classes / live card → `ClaimTrack` (`.route`/`.bed`/`.slot`), `TrainCarCard`. ✓
- Respect `prefers-reduced-motion` → `useReducedMotion` gate in `ClaimCostSpecimen`. ✓
- Lengths 2/4/3, colours red/blue/gray → `CLAIM_ROWS`. ✓
- No engine/text/scoring changes, no required i18n key → only the listed files change. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `SpecimenSpec` member `{ kind: 'claim-cost' }` matches the switch case and the test specs. `CyclingCard` `count?: number` is optional, so the existing `StationCostSpecimen` call still type-checks. `CardColor` values `'RED'`/`'BLUE'` are valid `@trm/shared` `CARD_COLORS`. `CARD_COLOR_TOKENS[color].hex` matches its use in `TrainCarCard`/`PaymentModal`. ✓
