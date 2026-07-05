# Reveal market (face-up) draw color in the flying-card animation — design

**Date:** 2026-07-05
**Scope:** `apps/web` only (`game/animationModel.ts` + its test).

## Goal

When a player takes a card from the visible market, every viewer's flying-card animation should
show the real card color, not a generic branded cover. Blind draws from the deck are unaffected —
those remain a cover for everyone but the drawer.

## Why this is correct, not just cosmetic

A face-up market pick is already public information end-to-end:

- The engine emits `CARD_TAKEN_FACEUP` with `visibility: 'PUBLIC'`
  ([reduce.ts:329](../../../packages/engine/src/reduce.ts#L329)) — every viewer's snapshot/event
  stream carries the real `card` value, not a redacted one.
- The action log already renders the real color to all viewers unconditionally
  ([logModel.ts:98-104](../../../apps/web/src/game/logModel.ts#L98-L104)).

So `animationModel.ts`'s `cardTakenFaceup` branch nulling the color for non-actors
([animationModel.ts:57-64](../../../apps/web/src/game/animationModel.ts#L57-L64)) is inconsistent
with data the client already has and shows elsewhere — a display bug, not a hidden-information
leak to fix carefully. `cardDrawnBlind` (deck draw) is a separate case and is genuinely private;
it is not touched by this change.

## Change

In `intentsFromEvents` (`apps/web/src/game/animationModel.ts`):

- `cardTakenFaceup`: always set `color: pbToCard(ev.value.card)` (drop the
  `ev.value.playerId === me` gate). `faceUp` stays `true`; `slot`/`marketFlip`/`marketCover` logic
  is untouched.
- `cardDrawnBlind`: unchanged — color stays gated to the drawer only.

## Tests

Update `apps/web/src/game/animationModel.test.ts`, the `'face-up draw flies from the slot and
flips the slot; opponent gets a cover'` case (line ~44-50): the opponent-perspective assertion
should expect `color: 'GREEN'` (the real card), not `null`. Rename the test description since
there is no longer a cover for this case. The blind-draw test (`'my blind draw flies the real
card; an opponent blind draw flies a cover'`) is unaffected.

## Out of scope

- Sound cues (`soundModel.ts`) key off the event `case`, not `color` — no change.
- The market slot's own cover/flip timing (`marketCover`/`marketFlip`, mid-draw refill suspense)
  is unrelated to the taken card's color and is untouched.
- `cardDrawnBlind` behavior (blind deck draws stay hidden for opponents).
