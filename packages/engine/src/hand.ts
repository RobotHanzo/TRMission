import type { CardColor } from '@trm/shared';
import { CARD_COLORS, emptyHand } from '@trm/shared';

/** Pure helpers over colour-count multisets (hands & discard). All return NEW objects. */

export type CardCounts = Record<CardColor, number>;

export function cloneCounts(h: Readonly<CardCounts>): CardCounts {
  return { ...h };
}

export function totalCards(h: Readonly<CardCounts>): number {
  let n = 0;
  for (const c of CARD_COLORS) n += h[c];
  return n;
}

export function addCard(h: Readonly<CardCounts>, card: CardColor, n = 1): CardCounts {
  const out = { ...h };
  out[card] += n;
  return out;
}

export function removeCard(h: Readonly<CardCounts>, card: CardColor, n = 1): CardCounts {
  const out = { ...h };
  out[card] -= n;
  return out;
}

/** Add a whole multiset to another. */
export function addCounts(a: Readonly<CardCounts>, b: Readonly<CardCounts>): CardCounts {
  const out = { ...a };
  for (const c of CARD_COLORS) out[c] += b[c];
  return out;
}

/** Build a single-card counts object. */
export function single(card: CardColor, n = 1): CardCounts {
  const out = emptyHand();
  out[card] = n;
  return out;
}

export { emptyHand };
