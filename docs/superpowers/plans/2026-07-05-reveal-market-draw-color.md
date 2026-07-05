# Reveal Market Draw Color Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the flying-card animation show the real card color to every viewer when a player
takes a card from the face-up market, instead of hiding it behind a generic cover for non-drawers.

**Architecture:** One-line logic change in `intentsFromEvents` (`apps/web/src/game/animationModel.ts`):
the `cardTakenFaceup` branch stops gating `color` on "is this the local player," because the
underlying engine event is already `visibility: 'PUBLIC'` and the action log already shows the
real color to everyone. `cardDrawnBlind` (the blind deck draw) is untouched ??it stays private to
the drawer.

**Tech Stack:** TypeScript, Vitest (`apps/web`).

## Global Constraints

- Only `apps/web/src/game/animationModel.ts` and its test file change. No other file needs edits
  (spec: "Out of scope" ??sound cues, market slot cover/flip timing, blind-draw behavior).
- `cardDrawnBlind` behavior must not change.

---

### Task 1: Always reveal the real color for face-up market draws

**Files:**

- Modify: `apps/web/src/game/animationModel.ts:57-64`
- Test: `apps/web/src/game/animationModel.test.ts:44-50`

**Interfaces:**

- Consumes: existing `pbToCard(card: Pb): CardColor | null` from `apps/web/src/game/cards.ts`
  (already imported in `animationModel.ts:3`); existing `AnimIntent` union member
  `{ kind: 'cardFly'; toPlayerId: string; faceUp: boolean; color: CardColor | null; slot: number | null }`
  (`animationModel.ts:11`) ??unchanged shape, only how `color` is computed changes.
- Produces: nothing new consumed by other tasks ??this is the only task in this plan.

- [x] **Step 1: Update the test to expect the real color for a non-drawer viewer**

Replace the existing test in `apps/web/src/game/animationModel.test.ts` (currently lines 44-50):

```ts
it('face-up draw flies from the slot and flips the slot; opponent gets a cover', () => {
  const out = intentsFromEvents(snap, [
    event({ case: 'cardTakenFaceup', value: { playerId: 'p1', slot: 2, card: Pb.GREEN } as never }),
  ]);
  expect(out).toContainEqual({
    kind: 'cardFly',
    toPlayerId: 'p1',
    faceUp: true,
    color: null,
    slot: 2,
  });
  expect(out).toContainEqual({ kind: 'marketFlip', slot: 2 });
});
```

with:

```ts
it('face-up draw flies the real card for every viewer and flips the slot', () => {
  const out = intentsFromEvents(snap, [
    event({ case: 'cardTakenFaceup', value: { playerId: 'p1', slot: 2, card: Pb.GREEN } as never }),
  ]);
  expect(out).toContainEqual({
    kind: 'cardFly',
    toPlayerId: 'p1',
    faceUp: true,
    color: 'GREEN',
    slot: 2,
  });
  expect(out).toContainEqual({ kind: 'marketFlip', slot: 2 });
});
```

Note: `snap.you.playerId` is `'p0'` ([animationModel.test.ts:10](../../../apps/web/src/game/animationModel.test.ts#L10)),
so `playerId: 'p1'` in this test is genuinely a non-drawer/opponent viewpoint ??this is the exact
case the old code nulled out.

- [x] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @trm/web test --run animationModel`
Expected: FAIL ??the renamed test's `cardFly` assertion expects `color: 'GREEN'` but the current
code still produces `color: null` for `playerId: 'p1'` (not `me`).

- [x] **Step 3: Fix `intentsFromEvents` to always use the real color for face-up draws**

In `apps/web/src/game/animationModel.ts`, replace the `cardTakenFaceup` case body (currently
lines 57-64):

```ts
      case 'cardTakenFaceup':
        out.push({
          kind: 'cardFly',
          toPlayerId: ev.value.playerId,
          faceUp: true,
          color: ev.value.playerId === me ? pbToCard(ev.value.card) : null,
          slot: ev.value.slot,
        });
```

with:

```ts
      case 'cardTakenFaceup':
        out.push({
          kind: 'cardFly',
          toPlayerId: ev.value.playerId,
          faceUp: true,
          color: pbToCard(ev.value.card),
          slot: ev.value.slot,
        });
```

Leave the `marketCover`/`marketFlip` push immediately below (lines 65-71) untouched ??that logic
covers the _refilled_ slot's suspense timing, not the taken card's color, and is unrelated to this
change. Leave the `cardDrawnBlind` case (lines 48-56) untouched ??that draw is genuinely private
and still gates on `ev.value.playerId === me`.

- [x] **Step 4: Run the test to verify it passes**

Run: `yarn workspace @trm/web test --run animationModel`
Expected: PASS ??all tests in `animationModel.test.ts` green, including the updated face-up-draw
test and the untouched blind-draw test (`'my blind draw flies the real card; an opponent blind
draw flies a cover'`).

- [x] **Step 5: Run the full web test suite to check for regressions**

Run: `yarn workspace @trm/web test --run`
Expected: PASS ??no other suite (e.g. `soundModel.test.ts`, `logModel.test.ts`) asserts on
`cardFly`'s `color` field for opponents, so none should be affected.

- [x] **Step 6: Commit**

```bash
git add apps/web/src/game/animationModel.ts apps/web/src/game/animationModel.test.ts
git commit -m "fix(web): reveal real card color when opponents take from the market

Face-up market draws are already public (PUBLIC-visibility engine event,
already shown to every viewer in the action log), so the flying-card
animation should stop hiding the color for non-drawer viewers. Blind
deck draws stay hidden as before."
```
