import type { CardColor, RngState, RuleParams } from '@trm/shared';
import { CARD_COLORS, shuffle } from '@trm/shared';
import type { CardCounts } from './hand';
import { addCard, emptyHand, totalCards } from './hand';

/** Build a fresh ordered draw deck (top = last element) from the deck composition. */
export function buildDeck(params: RuleParams, rng: RngState): { deck: CardColor[]; rng: RngState } {
  const cards: CardColor[] = [];
  for (const c of CARD_COLORS) {
    const n = c === 'LOCOMOTIVE' ? params.locomotiveCount : params.deckPerColor;
    for (let i = 0; i < n; i++) cards.push(c);
  }
  const [deck, next] = shuffle(cards, rng);
  return { deck, rng: next };
}

/** Discard multiset → a deterministic ordered array (canonical colour order) for reshuffling. */
function discardToArray(discard: Readonly<CardCounts>): CardColor[] {
  const out: CardColor[] = [];
  for (const c of CARD_COLORS) {
    for (let i = 0; i < discard[c]; i++) out.push(c);
  }
  return out;
}

export interface Reshuffled {
  deck: CardColor[];
  discard: CardCounts;
  rng: RngState;
}

/** Shuffle the discard pile back into (under) the draw deck. */
export function reshuffleDiscard(
  deck: readonly CardColor[],
  discard: Readonly<CardCounts>,
  rng: RngState,
): Reshuffled {
  const arr = discardToArray(discard);
  const [shuffled, next] = shuffle(arr, rng);
  return { deck: [...shuffled, ...deck], discard: emptyHand(), rng: next };
}

export interface DrawOne {
  card: CardColor | null;
  deck: CardColor[];
  discard: CardCounts;
  rng: RngState;
  reshuffled: boolean;
}

/** Draw a single card from the deck top, reshuffling the discard in first if the deck is empty. */
export function drawOne(
  deck: readonly CardColor[],
  discard: Readonly<CardCounts>,
  rng: RngState,
): DrawOne {
  let workDeck = deck.slice();
  let workDiscard: CardCounts = { ...discard };
  let workRng = rng;
  let reshuffled = false;

  if (workDeck.length === 0) {
    if (totalCards(workDiscard) === 0) {
      return { card: null, deck: workDeck, discard: workDiscard, rng: workRng, reshuffled: false };
    }
    const r = reshuffleDiscard(workDeck, workDiscard, workRng);
    workDeck = r.deck;
    workDiscard = r.discard;
    workRng = r.rng;
    reshuffled = true;
  }

  const card = workDeck.pop() ?? null;
  return { card, deck: workDeck, discard: workDiscard, rng: workRng, reshuffled };
}

export interface RefillResult {
  market: (CardColor | null)[];
  deck: CardColor[];
  discard: CardCounts;
  rng: RngState;
  reshuffled: boolean;
  recycled: boolean;
}

function countLocos(market: readonly (CardColor | null)[]): number {
  let n = 0;
  for (const c of market) if (c === 'LOCOMOTIVE') n++;
  return n;
}

/**
 * Fill empty market slots from the deck, then apply the "3 face-up Locomotives → discard
 * all 5 and redraw" rule, looping until the market no longer has ≥ threshold locos or the
 * draw pool is exhausted (guarded against the degenerate loco-only loop).
 */
export function refillMarket(
  market: readonly (CardColor | null)[],
  deck: readonly CardColor[],
  discard: Readonly<CardCounts>,
  rng: RngState,
  params: RuleParams,
): RefillResult {
  const work = market.slice();
  let workDeck = deck.slice();
  let workDiscard: CardCounts = { ...discard };
  let workRng = rng;
  let reshuffled = false;
  let recycled = false;

  const fillEmpty = (): void => {
    for (let i = 0; i < params.marketSize; i++) {
      if (work[i] === null || work[i] === undefined) {
        const d = drawOne(workDeck, workDiscard, workRng);
        workDeck = d.deck;
        workDiscard = d.discard;
        workRng = d.rng;
        if (d.reshuffled) reshuffled = true;
        work[i] = d.card;
      }
    }
  };

  // Ensure full size.
  while (work.length < params.marketSize) work.push(null);
  fillEmpty();

  let guard = 0;
  while (
    countLocos(work) >= params.locoRecycleThreshold &&
    workDeck.length + totalCards(workDiscard) > 0 &&
    guard < 50
  ) {
    guard++;
    recycled = true;
    // Discard the whole market, then refill.
    for (let i = 0; i < work.length; i++) {
      const c = work[i];
      if (c !== null && c !== undefined) workDiscard = addCard(workDiscard, c);
      work[i] = null;
    }
    fillEmpty();
  }

  return { market: work, deck: workDeck, discard: workDiscard, rng: workRng, reshuffled, recycled };
}
