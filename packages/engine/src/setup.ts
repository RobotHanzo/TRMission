import type { PlayerId, TicketId, CardColor } from '@trm/shared';
import { DEFAULT_RULE_PARAMS, makeRng, shuffle } from '@trm/shared';
import type { Board } from './board';
import type { GameConfig } from './config';
import type { GameState, PlayerState } from './types/state';
import { SCHEMA_VERSION, ENGINE_VERSION } from './types/state';
import { buildDeck, drawOne } from './deck';
import { refillMarket } from './deck';
import { emptyHand } from './hand';

/**
 * Genesis state from config + content. RNG is consumed in a FIXED order so the game replays
 * byte-identically: (1) optional turn-order shuffle, (2) deck shuffle, (3) hand deals (no RNG),
 * (4) market fill (no RNG at start), (5) long-ticket shuffle, (6) short-ticket shuffle, (7) deals.
 */
export function initGame(board: Board, config: GameConfig): GameState {
  const ruleParams = { ...DEFAULT_RULE_PARAMS, ...(config.ruleParams ?? {}) };
  let rng = makeRng(config.seed);

  // (1) Turn order.
  let turnOrder: PlayerId[] = config.players.map((p) => p.id);
  if (config.shuffleTurnOrder) {
    const [shuffled, next] = shuffle(turnOrder, rng);
    turnOrder = shuffled;
    rng = next;
  }

  // (2) Deck.
  const built = buildDeck(ruleParams, rng);
  let deck: CardColor[] = built.deck;
  rng = built.rng;
  let discard = emptyHand();

  // (3) Deal starting hands (deterministic pops).
  const players: Record<string, PlayerState> = {};
  const handByPlayer = new Map<string, Record<CardColor, number>>();
  for (const seed of config.players) handByPlayer.set(seed.id as string, emptyHand());
  for (let i = 0; i < ruleParams.handStart; i++) {
    for (const seed of config.players) {
      const d = drawOne(deck, discard, rng);
      deck = d.deck;
      discard = d.discard;
      rng = d.rng;
      if (d.card) {
        const h = handByPlayer.get(seed.id as string);
        if (h) h[d.card] += 1;
      }
    }
  }

  // (4) Market.
  const refill = refillMarket(new Array(ruleParams.marketSize).fill(null), deck, discard, rng, ruleParams);
  const market = refill.market;
  deck = refill.deck;
  discard = refill.discard;
  rng = refill.rng;

  // (5)(6) Ticket decks.
  const longIds = board.content.tickets.filter((t) => t.deck === 'LONG').map((t) => t.id);
  const shortIds = board.content.tickets.filter((t) => t.deck === 'SHORT').map((t) => t.id);
  const [ticketDeckLong, rngAfterLong] = shuffle(longIds, rng);
  rng = rngAfterLong;
  const [ticketDeckShort, rngAfterShort] = shuffle(shortIds, rng);
  rng = rngAfterShort;

  // (7) Deal initial ticket offers (pop from top).
  const longDeck: TicketId[] = [...ticketDeckLong];
  const shortDeck: TicketId[] = [...ticketDeckShort];
  for (const seed of config.players) {
    const offer: TicketId[] = [];
    for (let i = 0; i < ruleParams.initialLongOffer; i++) {
      const t = longDeck.pop();
      if (t) offer.push(t);
    }
    for (let i = 0; i < ruleParams.initialShortOffer; i++) {
      const t = shortDeck.pop();
      if (t) offer.push(t);
    }
    players[seed.id as string] = {
      id: seed.id,
      seat: seed.seat,
      hand: handByPlayer.get(seed.id as string) ?? emptyHand(),
      trainCars: ruleParams.trainCarsStart,
      stationsRemaining: ruleParams.stationsPerPlayer,
      keptTickets: [],
      pendingTicketOffer: offer,
      routePoints: 0,
    };
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    engineVersion: ENGINE_VERSION,
    contentHash: config.contentHash,
    rng,
    ruleParams,
    turnOrder,
    players,
    turn: { orderIndex: 0, phase: 'SETUP_TICKETS', cardsDrawnThisTurn: 0 },
    deck,
    discard,
    market,
    ticketDeckLong: longDeck,
    ticketDeckShort: shortDeck,
    ownership: {},
    stations: [],
    pendingTunnel: null,
    endgame: { triggered: false, triggerPlayerIndex: -1, finalTurnsRemaining: 0 },
    consecutivePasses: 0,
    finalScores: null,
    actionSeq: 0,
  };
}
