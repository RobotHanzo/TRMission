import { describe, it, expect } from 'vitest';
import { asPlayerId, CARD_COLORS } from '@trm/shared';
import type { Board } from '../src/board';
import type { GameState, PlayerState } from '../src/types/state';
import type { EventsState, EventScheduleEntry } from '../src/types/events-state';
import type { RouteDef, TicketDef } from '@trm/map-data';
import { makeConfig, playGreedyGame } from './helpers';
import { initGame } from '../src/setup';
import { reduce } from '../src/reduce';
import { endTurn, currentPlayerId } from '../src/turn';
import { redactFor } from '../src/selectors';
import { checkInvariants } from '../src/invariants';
import { replay, stateDigest, cloneState } from '../src/serialize';
import type { GameEvent } from '../src/types/events';

type Mode = 'light' | 'moderate' | 'intense';

function emptyEvents(mode: Mode = 'light'): EventsState {
  return {
    mode,
    roundIndex: 1,
    nextIdx: 0,
    schedule: [],
    suppressed: [],
    active: [],
    hotspots: {},
    charters: [],
    luckyContracts: [],
    reopenBonus: [],
    repairedRouteIds: [],
    resources: {},
  };
}

/** initGame + resolve every initial ticket offer → AWAIT_ACTION, with events mode on. */
function afterSetup(
  numPlayers: number,
  seed: string,
  mode: Mode,
): { board: Board; state: GameState } {
  const { board, config } = makeConfig(numPlayers, seed, { eventsMode: mode });
  let state = initGame(board, config);
  while (state.turn.phase === 'SETUP_TICKETS') {
    const pid = state.turnOrder.find((id) => state.players[id as string]?.pendingTicketOffer)!;
    const offer = state.players[pid as string]!.pendingTicketOffer!;
    const res = reduce(board, state, {
      t: 'KEEP_INITIAL_TICKETS',
      player: pid,
      keep: offer.slice(0, state.ruleParams.minKeepInitial),
    });
    if (!res.ok) throw new Error('setup keep failed');
    state = res.value.state;
  }
  return { board, state };
}

const withEvents = (state: GameState, events: EventsState): GameState => ({ ...state, events });

const step = (board: Board, state: GameState): { state: GameState; events: GameEvent[] } =>
  endTurn(board, state, { wasPass: false });

function totalHands(state: GameState): number {
  let n = 0;
  for (const p of Object.values(state.players)) for (const c of CARD_COLORS) n += p.hand[c];
  return n;
}

const kindsOf = (events: readonly GameEvent[]): string[] => events.map((e) => e.e);

describe('events runtime — round ticking', () => {
  it('increments roundIndex exactly on an order wrap (2p and 3p)', () => {
    for (const np of [2, 3] as const) {
      const { board, state } = afterSetup(np, `ri-${np}`, 'light');
      let s = withEvents(state, emptyEvents());
      expect(s.events!.roundIndex).toBe(1);
      // The wrap happens on the np-th endTurn.
      for (let i = 1; i <= np; i++) {
        s = step(board, s).state;
        expect(s.events!.roundIndex).toBe(i < np ? 1 : 2);
      }
      // One more full round → roundIndex 3.
      for (let i = 0; i < np; i++) s = step(board, s).state;
      expect(s.events!.roundIndex).toBe(3);
    }
  });

  it('announces a telegraphed entry exactly one round before it starts, in the §8 batch order', () => {
    const { board, state } = afterSetup(2, 'announce', 'light');
    const sched: EventScheduleEntry[] = [
      { id: 'ev1', kind: 'TYPHOON_DAY_OFF', startRound: 3, durationRounds: 1, telegraphed: true },
    ];
    let s = withEvents(state, { ...emptyEvents(), schedule: sched });
    const batches: GameEvent[][] = [];
    for (let i = 0; i < 4; i++) {
      const out = step(board, s);
      batches.push(out.events);
      s = out.state;
    }
    // Batch 1 (endTurn #2) wraps into round 2 → ANNOUNCE. Batch 3 (endTurn #4) → START.
    const announceBatch = batches[1]!;
    const startBatch = batches[3]!;
    expect(kindsOf(announceBatch)).toContain('EVENT_ANNOUNCED');
    expect(kindsOf(startBatch)).toContain('EVENT_STARTED');
    // No cross-contamination.
    expect(kindsOf(batches[0]!)).not.toContain('EVENT_ANNOUNCED');
    expect(kindsOf(batches[0]!)).not.toContain('EVENT_STARTED');
    expect(kindsOf(batches[2]!)).not.toContain('EVENT_STARTED');
    // Order within the announce batch: TURN_ENDED < EVENT_ANNOUNCED < TURN_STARTED.
    const ak = kindsOf(announceBatch);
    expect(ak.indexOf('TURN_ENDED')).toBeLessThan(ak.indexOf('EVENT_ANNOUNCED'));
    expect(ak.indexOf('EVENT_ANNOUNCED')).toBeLessThan(ak.indexOf('TURN_STARTED'));
    // Order within the start batch: TURN_ENDED < EVENT_STARTED < TURN_STARTED.
    const sk = kindsOf(startBatch);
    expect(sk.indexOf('TURN_ENDED')).toBeLessThan(sk.indexOf('EVENT_STARTED'));
    expect(sk.indexOf('EVENT_STARTED')).toBeLessThan(sk.indexOf('TURN_STARTED'));
  });

  it('RAILWAY_GALA deals one blind card to every player (conservation holds)', () => {
    const { board, state } = afterSetup(3, 'gala', 'light');
    const sched: EventScheduleEntry[] = [
      { id: 'ev1', kind: 'RAILWAY_GALA', startRound: 2, durationRounds: 1, telegraphed: false },
    ];
    let s = withEvents(state, { ...emptyEvents(), schedule: sched });
    const handsBefore = totalHands(s);
    const deckBefore = s.deck.length;
    let batch: GameEvent[] = [];
    for (let i = 0; i < 3; i++) {
      const out = step(board, s);
      batch = out.events;
      s = out.state;
    }
    expect(kindsOf(batch)).toContain('EVENT_STARTED');
    expect(batch.filter((e) => e.e === 'CARD_DRAWN_BLIND').length).toBe(3);
    expect(totalHands(s)).toBe(handsBefore + 3);
    expect(s.deck.length).toBe(deckBefore - 3); // deep deck, no reshuffle
    expect(checkInvariants(board, s)).toEqual([]);
    // Gala flags a free-station window for EXACTLY its own round (startRound 2 → untilRound 2).
    expect(s.events!.freeStation).toEqual({ untilRound: 2 });
    expect(redactFor(board, s, asPlayerId('p0')).events!.freeStationAvailable).toBe(true);
  });

  it('suppresses a surprise entry in quiet-endgame (no events, id recorded)', () => {
    const { board, state } = afterSetup(2, 'quiet-surprise', 'light');
    const city = board.cityIds[0]!;
    const sched: EventScheduleEntry[] = [
      {
        id: 'ev1',
        kind: 'VIRAL_HOTSPOT',
        startRound: 2,
        durationRounds: 0,
        telegraphed: false,
        cityId: city,
      },
    ];
    let s = withEvents(
      { ...state, endgame: { triggered: true, triggerPlayerIndex: 0, finalTurnsRemaining: 20 } },
      { ...emptyEvents(), schedule: sched },
    );
    let batch: GameEvent[] = [];
    for (let i = 0; i < 2; i++) {
      const out = step(board, s);
      batch = out.events;
      s = out.state;
    }
    expect(kindsOf(batch)).not.toContain('EVENT_STARTED');
    expect(s.events!.suppressed).toContain('ev1');
    expect(s.events!.nextIdx).toBe(1);
    expect(Object.keys(s.events!.hotspots)).toEqual([]);
  });

  it('still starts a telegraphed entry that was already announced before the game went quiet', () => {
    const { board, state } = afterSetup(2, 'quiet-announced', 'light');
    const sched: EventScheduleEntry[] = [
      { id: 'ev1', kind: 'TYPHOON_DAY_OFF', startRound: 3, durationRounds: 1, telegraphed: true },
    ];
    let s = withEvents(state, { ...emptyEvents(), schedule: sched });
    s = step(board, s).state; // round 1
    const announce = step(board, s); // wrap → round 2 announce (not quiet)
    s = announce.state;
    expect(kindsOf(announce.events)).toContain('EVENT_ANNOUNCED');
    // Game goes quiet AFTER the announcement.
    s = { ...s, endgame: { triggered: true, triggerPlayerIndex: 0, finalTurnsRemaining: 20 } };
    s = step(board, s).state; // round 2
    const start = step(board, s); // wrap → round 3 start (telegraphed always starts)
    expect(kindsOf(start.events)).toContain('EVENT_STARTED');
  });

  it('does NOT tick on the game-ending turn (all-PASS)', () => {
    const { board, state } = afterSetup(2, 'ending', 'light');
    const sched: EventScheduleEntry[] = [
      { id: 'ev1', kind: 'RAILWAY_GALA', startRound: 2, durationRounds: 1, telegraphed: false },
    ];
    // Last player about to take the round-completing PASS; consecutivePasses reaches n → all-PASS end.
    const s = withEvents(
      { ...state, turn: { ...state.turn, orderIndex: 1 }, consecutivePasses: 1 },
      { ...emptyEvents(), schedule: sched },
    );
    const out = endTurn(board, s, { wasPass: true });
    expect(out.state.turn.phase).toBe('GAME_OVER');
    expect(kindsOf(out.events)).not.toContain('EVENT_STARTED');
    expect(out.state.events!.roundIndex).toBe(1); // untouched — no tick ran
  });

  it('runs the rule-7.5 forced ticket re-draw AFTER a round tick (offer emitted last)', () => {
    const { board, config } = makeConfig(2, 'r75-events', { eventsMode: 'light' });
    const s0 = initGame(board, config);
    const p0 = asPlayerId('p0');
    // A ticket joined by a single simple route, so owning that route own-connects the ticket.
    let picked: { t: TicketDef; r: RouteDef } | null = null;
    for (const t of board.content.tickets) {
      const r = board.content.routes.find(
        (rt) =>
          !rt.isTunnel &&
          rt.ferryLocos === 0 &&
          rt.doubleGroup === undefined &&
          ((rt.a === t.a && rt.b === t.b) || (rt.a === t.b && rt.b === t.a)),
      );
      if (r) {
        picked = { t, r };
        break;
      }
    }
    if (!picked) throw new Error('no direct ticket route');
    const players: Record<string, PlayerState> = {};
    for (const [id, p] of Object.entries(s0.players)) {
      players[id] = { ...p, pendingTicketOffer: null };
    }
    players['p0'] = { ...players['p0']!, keptTickets: [picked.t.id] };
    const sched: EventScheduleEntry[] = [
      { id: 'ev1', kind: 'STAMP_RALLY', startRound: 2, durationRounds: 3, telegraphed: false },
    ];
    const state: GameState = {
      ...cloneState(s0),
      players,
      ownership: { [picked.r.id as string]: { owner: p0 } },
      turn: { orderIndex: 1, phase: 'AWAIT_ACTION', cardsDrawnThisTurn: 0 },
      events: { ...emptyEvents(), schedule: sched },
    };
    const out = endTurn(board, state, { wasPass: false });
    expect(out.state.turn.phase).toBe('TICKET_SELECTION');
    expect(currentPlayerId(out.state)).toBe(p0);
    const ks = kindsOf(out.events);
    expect(ks).toContain('EVENT_STARTED');
    expect(ks[ks.length - 1]).toBe('TICKETS_OFFERED'); // forced draw stays last, on post-tick state
    expect(ks.indexOf('EVENT_STARTED')).toBeLessThan(ks.indexOf('TICKETS_OFFERED'));
  });
});

describe('events runtime — full games & redaction', () => {
  it('drives full greedy games with events on and replays byte-identically', () => {
    for (const mode of ['light', 'moderate', 'intense'] as Mode[]) {
      for (const np of [2, 3, 4]) {
        const r = playGreedyGame(np, `evt-${mode}-${np}`, { ruleParams: { eventsMode: mode } });
        expect(r.finalState.turn.phase).toBe('GAME_OVER');
        const replayed = replay(r.board, r.config, r.log);
        expect(stateDigest(replayed.state)).toBe(stateDigest(r.finalState));
      }
    }
  });

  it('projects a forecast during the announced window and never leaks the hidden schedule', () => {
    const { board, state } = afterSetup(2, 'redact-forecast', 'light');
    const sched: EventScheduleEntry[] = [
      { id: 'ev1', kind: 'TYPHOON_DAY_OFF', startRound: 3, durationRounds: 1, telegraphed: true },
    ];
    let s = withEvents(state, { ...emptyEvents(), schedule: sched });
    s = step(board, s).state; // round 1
    s = step(board, s).state; // wrap → round 2 (announced window: startRound 3 === roundIndex+1)
    const view = redactFor(board, s, asPlayerId('p0'));
    expect(view.events).toBeDefined();
    expect(view.events!.forecast?.id).toBe('ev1');
    expect(view.settings.eventsMode).toBe('light');
    const serialized = JSON.stringify(view.events);
    expect(serialized).not.toContain('schedule');
    expect(serialized).not.toContain('nextIdx');
    expect(serialized).not.toContain('suppressed');
    // Spectator (null viewer) sees the identical events block.
    expect(redactFor(board, s, null).events).toEqual(view.events);
  });

  it('omits the events block and reports eventsMode off for an off-mode game', () => {
    const { board, config } = makeConfig(2, 'off-redact');
    const off = initGame(board, config);
    const view = redactFor(board, off, asPlayerId('p0'));
    expect(view.events).toBeUndefined();
    expect(view.settings.eventsMode).toBe('off');
  });
});
