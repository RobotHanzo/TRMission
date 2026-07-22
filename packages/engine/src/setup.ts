import type { PlayerId, TicketId, CardColor } from '@trm/shared';
import { DEFAULT_RULE_PARAMS, makeRng, nextInt, shuffle, teamOfSeat } from '@trm/shared';
import type { Board } from './board';
import type { GameConfig } from './config';
import type { GameState, PlayerState } from './types/state';
import { SCHEMA_VERSION, ENGINE_VERSION } from './types/state';
import { buildDeck, drawOne } from './deck';
import { refillMarket } from './deck';
import { emptyHand } from './hand';
import { generateSchedule } from './events/schedule';

/**
 * Genesis state from config + content. RNG is consumed in a FIXED order so the game replays
 * byte-identically: (1) optional turn-order shuffle, (2) deck shuffle, (3) hand deals (no RNG),
 * (4) market fill (no RNG at start), (5) long-ticket shuffle, (6) short-ticket shuffle, (7) deals,
 * (8) random-event schedule. Step (8) draws ZERO when `eventsMode` is off/absent, so an off-mode
 * genesis produces a byte-identical rng counter to a pre-events game.
 */
/**
 * Resolve team rosters from the seat map, or `undefined` for a free-for-all. Each roster is in
 * ascending seat order, and membership is `seat % teamCount` — so partners are interleaved around
 * the table by construction and no seating pass can ever break the alternation.
 */
function buildTeams(config: GameConfig): PlayerId[][] | undefined {
  const teamCount = config.teamCount;
  if (teamCount === undefined) return undefined;
  const rosters: PlayerId[][] = Array.from({ length: teamCount }, () => []);
  for (const seed of [...config.players].sort((a, b) => a.seat - b.seat)) {
    (rosters[teamOfSeat(seed.seat, teamCount)] as PlayerId[]).push(seed.id);
  }
  return rosters;
}

export function initGame(board: Board, config: GameConfig): GameState {
  const ruleParams = { ...DEFAULT_RULE_PARAMS, ...(config.ruleParams ?? {}) };
  let rng = makeRng(config.seed);

  // (1) Turn order. A team game seats partners interleaved (`seat % teamCount`), so turn order
  // must stay seat-ascending or teams would stop alternating; it is randomised by ROTATION only
  // (one nextInt draw), which changes who opens without ever putting two teammates back to back.
  // The free-for-all path is untouched, so its RNG stream stays byte-identical to pre-v12.
  let turnOrder: PlayerId[];
  if (config.teamCount !== undefined) {
    const bySeat = [...config.players].sort((a, b) => a.seat - b.seat).map((p) => p.id);
    if (config.shuffleTurnOrder) {
      const [offset, next] = nextInt(rng, bySeat.length);
      rng = next;
      turnOrder = [...bySeat.slice(offset), ...bySeat.slice(0, offset)];
    } else {
      turnOrder = bySeat;
    }
  } else {
    turnOrder = config.players.map((p) => p.id);
    if (config.shuffleTurnOrder) {
      const [shuffled, next] = shuffle(turnOrder, rng);
      turnOrder = shuffled;
      rng = next;
    }
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
  const refill = refillMarket(
    new Array(ruleParams.marketSize).fill(null),
    deck,
    discard,
    rng,
    ruleParams,
  );
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
      completedTickets: [],
    };
  }

  // (8) Random-event schedule — appended AFTER every other draw. Returns [undefined, rng] with the
  // rng untouched when the feature is off, so off-mode genesis stays byte-identical to a v4 game.
  const [events, rngAfterEvents] = generateSchedule(board, ruleParams, rng);
  rng = rngAfterEvents;

  // (9) Teams. Pure derivation from the seat map — consumes NO rng, so a free-for-all genesis is
  // byte-identical to pre-v12 and the keys below are omitted entirely rather than set undefined.
  const teams = buildTeams(config);
  const teamPools = teams ? teams.map(() => emptyHand()) : undefined;

  return {
    schemaVersion: SCHEMA_VERSION,
    engineVersion: ENGINE_VERSION,
    contentHash: config.contentHash,
    rng,
    ruleParams,
    ...(events ? { events } : {}),
    ...(teams && teamPools ? { teams, teamPools } : {}),
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
