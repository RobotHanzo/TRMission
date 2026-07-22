import { describe, it, expect } from 'vitest';
import { taiwanBoard, CONTENT_HASH, type GameConfig, type PlayerSeed } from '@trm/engine';
import { asPlayerId, type SeatIndex } from '@trm/shared';
import type { BotProfile } from '@trm/bots';
import { GameRegistry } from '../src/game/game-registry';
import { GameHub } from '../src/ws/hub';
import { makeDevTicket } from '../src/ws/ticket';
import { NOOP_METRICS, type MetricsHooks } from '../src/observability/hooks';
import { encodeClient, actionToCommand, decodeServer } from './helpers';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function until(pred: () => boolean, maxTicks = 1000): Promise<void> {
  for (let i = 0; i < maxTicks && !pred(); i++) await tick();
}

describe('per-turn timeout (issue #13)', () => {
  it('auto-plays a default move (blind draw) when the current human never acts, and announces the countdown', async () => {
    const board = taiwanBoard();
    const human = asPlayerId('human');
    const players: PlayerSeed[] = [
      { id: human, seat: 0 as SeatIndex },
      { id: asPlayerId('bot:a'), seat: 1 as SeatIndex },
    ];
    const bots: BotProfile[] = [{ playerId: 'bot:a', difficulty: 'EASY' }];
    const config: GameConfig = { seed: 'timeout-e2e', players, contentHash: CONTENT_HASH };

    let timedOut = 0;
    const metrics: MetricsHooks = {
      ...NOOP_METRICS,
      turnTimedOut: () => {
        timedOut++;
      },
    };

    // A tiny per-turn budget keeps the test fast; the lone bot resolves its own seat.
    const hub = new GameHub(new GameRegistry(), { botMoveDelayMs: 0, turnTimeoutMs: 20, metrics });
    const match = await hub.createMatch('to', board, config, bots);
    const { session } = match;

    const frames: ReturnType<typeof decodeServer>[] = [];
    hub.openConnection('hc', (bytes) => frames.push(decodeServer(bytes)));
    let seq = 0;
    await hub.receive(
      'hc',
      encodeClient(++seq, {
        case: 'hello',
        value: {
          ticket: makeDevTicket({ gameId: 'to', playerId: 'human', seat: 0 }),
          protocolVersion: 1,
        },
      }),
    );

    // SETUP_TICKETS is a simultaneous phase the per-turn timer deliberately skips, so the human
    // resolves their own initial offer; then they hold the first turn and do NOTHING.
    await until(() => session.hasPendingOffer(human));
    const offer = session.raw().players[human as string]!.pendingTicketOffer!;
    await hub.receive(
      'hc',
      encodeClient(
        ++seq,
        actionToCommand({ t: 'KEEP_INITIAL_TICKETS', player: human, keep: offer }),
      ),
    );

    const humanDrew = (): boolean =>
      session.appliedActions.some((a) => a.t === 'DRAW_BLIND' && a.player === human);
    await until(humanDrew);

    expect(humanDrew()).toBe(true); // the server drew a train card on the idle human's behalf
    expect(timedOut).toBeGreaterThan(0);
    // The client was handed the cosmetic countdown for the human's turn.
    expect(
      frames.some(
        (f) => f.event.case === 'turnTimer' && f.event.value.playerId === (human as string),
      ),
    ).toBe(true);

    await hub.evictMatch('to', 'test complete');
  }, 20_000);

  it('marks a game inactive after consecutive timed-out turns and resumes on a human action', async () => {
    const board = taiwanBoard();
    const human = asPlayerId('human');
    const players: PlayerSeed[] = [
      { id: human, seat: 0 as SeatIndex },
      { id: asPlayerId('bot:a'), seat: 1 as SeatIndex },
    ];
    const bots: BotProfile[] = [{ playerId: 'bot:a', difficulty: 'EASY' }];
    const config: GameConfig = { seed: 'afk-pause-e2e', players, contentHash: CONTENT_HASH };

    let timedOut = 0;
    const paused: string[] = [];
    const metrics: MetricsHooks = {
      ...NOOP_METRICS,
      turnTimedOut: () => {
        timedOut++;
      },
      autoPlayPaused: (reason) => {
        paused.push(reason);
      },
    };

    const hub = new GameHub(new GameRegistry(), {
      botMoveDelayMs: 0,
      turnTimeoutMs: 20,
      autoPlayPauseAfter: 2, // small streak so the test stays fast; prod default is 5
      metrics,
    });
    const match = await hub.createMatch('afk', board, config, bots);
    const { session } = match;

    const frames: ReturnType<typeof decodeServer>[] = [];
    hub.openConnection('hc', (bytes) => frames.push(decodeServer(bytes)));
    let seq = 0;
    await hub.receive(
      'hc',
      encodeClient(++seq, {
        case: 'hello',
        value: {
          ticket: makeDevTicket({ gameId: 'afk', playerId: 'human', seat: 0 }),
          protocolVersion: 1,
        },
      }),
    );
    await until(() => session.hasPendingOffer(human));
    const offer = session.raw().players[human as string]!.pendingTicketOffer!;
    await hub.receive(
      'hc',
      encodeClient(
        ++seq,
        actionToCommand({ t: 'KEEP_INITIAL_TICKETS', player: human, keep: offer }),
      ),
    );

    // The connected-but-idle human times out twice → the game is marked inactive.
    await until(() => paused.includes('afk_streak'));
    expect(timedOut).toBe(2);
    // Clients were told to drop the countdown AND shown the paused banner frame.
    expect(frames.some((f) => f.event.case === 'turnTimer' && f.event.value.playerId === '')).toBe(
      true,
    );
    expect(
      frames.some(
        (f) =>
          f.event.case === 'gamePaused' &&
          f.event.value.paused &&
          f.event.value.reason === 'afk_streak',
      ),
    ).toBe(true);

    // While inactive, several would-be turn budgets pass without a single further auto-play.
    const humanDraws = (): number =>
      session.appliedActions.filter((a) => a.t === 'DRAW_BLIND' && a.player === human).length;
    const drawsAtPause = humanDraws();
    await sleep(120);
    expect(timedOut).toBe(2);
    expect(humanDraws()).toBe(drawsAtPause);

    // The game rests on the human's turn; a real action resumes auto-play (and their idleness
    // afterwards times out again — the timer is armed once more).
    await hub.receive(
      'hc',
      encodeClient(++seq, actionToCommand({ t: 'DRAW_BLIND', player: human })),
    );
    await until(() => timedOut > 2);
    expect(timedOut).toBeGreaterThan(2);
    // The resume was announced too (paused=false with an empty reason).
    expect(frames.some((f) => f.event.case === 'gamePaused' && !f.event.value.paused)).toBe(true);

    await hub.evictMatch('afk', 'test complete');
  }, 20_000);

  it('never arms the turn timer for a solo room that opted to wait for its host', async () => {
    const board = taiwanBoard();
    const human = asPlayerId('human');
    const players: PlayerSeed[] = [
      { id: human, seat: 0 as SeatIndex },
      { id: asPlayerId('bot:a'), seat: 1 as SeatIndex },
    ];
    const bots: BotProfile[] = [{ playerId: 'bot:a', difficulty: 'EASY' }];
    const config: GameConfig = { seed: 'solo-wait-e2e', players, contentHash: CONTENT_HASH };

    let timedOut = 0;
    const metrics: MetricsHooks = {
      ...NOOP_METRICS,
      turnTimedOut: () => {
        timedOut++;
      },
    };
    const hub = new GameHub(new GameRegistry(), { botMoveDelayMs: 0, turnTimeoutMs: 20, metrics });
    const match = await hub.createMatch('solo', board, config, bots, { turnTimerDisabled: true });
    const { session } = match;

    const frames: ReturnType<typeof decodeServer>[] = [];
    hub.openConnection('hc', (bytes) => frames.push(decodeServer(bytes)));
    let seq = 0;
    await hub.receive(
      'hc',
      encodeClient(++seq, {
        case: 'hello',
        value: {
          ticket: makeDevTicket({ gameId: 'solo', playerId: 'human', seat: 0 }),
          protocolVersion: 1,
        },
      }),
    );
    await until(() => session.hasPendingOffer(human));
    const offer = session.raw().players[human as string]!.pendingTicketOffer!;
    await hub.receive(
      'hc',
      encodeClient(
        ++seq,
        actionToCommand({ t: 'KEEP_INITIAL_TICKETS', player: human, keep: offer }),
      ),
    );
    await until(() => session.phase === 'AWAIT_ACTION');

    // Many would-be turn budgets pass: nothing is auto-played, no countdown is ever announced,
    // and the game simply rests on the host's turn.
    await sleep(150);
    expect(timedOut).toBe(0);
    expect(frames.some((f) => f.event.case === 'turnTimer')).toBe(false);
    expect(session.currentPlayer).toBe(human);

    // The host can still act normally whenever they come back.
    await hub.receive(
      'hc',
      encodeClient(++seq, actionToCommand({ t: 'DRAW_BLIND', player: human })),
    );
    expect(session.appliedActions.some((a) => a.t === 'DRAW_BLIND' && a.player === human)).toBe(
      true,
    );

    await hub.evictMatch('solo', 'test complete');
  }, 20_000);

  it('hands a repeatedly timing-out seat to a MEDIUM bot while another human is present, and reclaims it on rebind', async () => {
    const board = taiwanBoard();
    const alice = asPlayerId('alice');
    const bruce = asPlayerId('bruce');
    const players: PlayerSeed[] = [
      { id: alice, seat: 0 as SeatIndex },
      { id: bruce, seat: 1 as SeatIndex },
    ];
    const config: GameConfig = { seed: 'takeover-e2e', players, contentHash: CONTENT_HASH };

    const control: { playerId: string; botControlled: boolean }[] = [];
    const takeovers: string[] = [];
    const metrics: MetricsHooks = {
      ...NOOP_METRICS,
      seatControlChanged: (kind) => {
        takeovers.push(kind);
      },
    };
    const hub = new GameHub(new GameRegistry(), {
      botMoveDelayMs: 0,
      turnTimeoutMs: 20,
      autoPlayPauseAfter: 100, // keep the game-level inactive pause out of this test's way
      botTakeoverAfter: 2,
      metrics,
    });
    const match = await hub.createMatch('tk', board, config, []);
    const { session } = match;

    hub.openConnection('ca', (bytes) => {
      const f = decodeServer(bytes);
      if (f.event.case === 'seatControlChanged') {
        control.push({
          playerId: f.event.value.playerId,
          botControlled: f.event.value.botControlled,
        });
      }
    });
    let aseq = 0;
    await hub.receive(
      'ca',
      encodeClient(++aseq, {
        case: 'hello',
        value: {
          ticket: makeDevTicket({ gameId: 'tk', playerId: 'alice', seat: 0 }),
          protocolVersion: 1,
        },
      }),
    );
    // Bruce binds only to resolve the simultaneous SETUP phase (the timer skips it), then drops.
    hub.openConnection('cb', () => {});
    const bruceTicket = makeDevTicket({ gameId: 'tk', playerId: 'bruce', seat: 1 });
    await hub.receive(
      'cb',
      encodeClient(1, { case: 'hello', value: { ticket: bruceTicket, protocolVersion: 1 } }),
    );
    await until(() => session.hasPendingOffer(alice) && session.hasPendingOffer(bruce));
    const aOffer = session.raw().players[alice as string]!.pendingTicketOffer!;
    const bOffer = session.raw().players[bruce as string]!.pendingTicketOffer!;
    await hub.receive(
      'ca',
      encodeClient(
        ++aseq,
        actionToCommand({ t: 'KEEP_INITIAL_TICKETS', player: alice, keep: aOffer }),
      ),
    );
    await hub.receive(
      'cb',
      encodeClient(2, actionToCommand({ t: 'KEEP_INITIAL_TICKETS', player: bruce, keep: bOffer })),
    );
    hub.closeConnection('cb');

    // Alice (connected, idle) times out but is never converted — no OTHER human is connected for
    // her. Bruce (gone) reaches 2 timed-out turns with Alice still at the table → MEDIUM takeover.
    await until(() => control.some((c) => c.playerId === 'bruce' && c.botControlled));
    expect(takeovers).toContain('takeover');
    expect(control.some((c) => c.playerId === 'alice' && c.botControlled)).toBe(false);

    // Bruce comes back: the rebind reclaims the seat and everyone is told.
    hub.openConnection('cb2', () => {});
    await hub.receive(
      'cb2',
      encodeClient(1, { case: 'hello', value: { ticket: bruceTicket, protocolVersion: 1 } }),
    );
    await until(() => control.some((c) => c.playerId === 'bruce' && !c.botControlled));
    expect(takeovers).toContain('reclaim');

    await hub.evictMatch('tk', 'test complete');
  }, 20_000);

  it('pauses instead of auto-playing when no human socket is connected, and resumes on reconnect', async () => {
    const board = taiwanBoard();
    const human = asPlayerId('human');
    const players: PlayerSeed[] = [
      { id: human, seat: 0 as SeatIndex },
      { id: asPlayerId('bot:a'), seat: 1 as SeatIndex },
    ];
    const bots: BotProfile[] = [{ playerId: 'bot:a', difficulty: 'EASY' }];
    const config: GameConfig = { seed: 'deserted-pause-e2e', players, contentHash: CONTENT_HASH };

    let timedOut = 0;
    const paused: string[] = [];
    const metrics: MetricsHooks = {
      ...NOOP_METRICS,
      turnTimedOut: () => {
        timedOut++;
      },
      autoPlayPaused: (reason) => {
        paused.push(reason);
      },
    };

    const hub = new GameHub(new GameRegistry(), { botMoveDelayMs: 0, turnTimeoutMs: 20, metrics });
    const match = await hub.createMatch('gone', board, config, bots);
    const { session } = match;

    hub.openConnection('hc', () => {});
    let seq = 0;
    const ticket = makeDevTicket({ gameId: 'gone', playerId: 'human', seat: 0 });
    await hub.receive(
      'hc',
      encodeClient(++seq, { case: 'hello', value: { ticket, protocolVersion: 1 } }),
    );
    await until(() => session.hasPendingOffer(human));
    const offer = session.raw().players[human as string]!.pendingTicketOffer!;
    await hub.receive(
      'hc',
      encodeClient(
        ++seq,
        actionToCommand({ t: 'KEEP_INITIAL_TICKETS', player: human, keep: offer }),
      ),
    );

    // The lone human's socket drops before their first turn lapses: the fire-time check finds no
    // connected human and pauses WITHOUT auto-playing anything for them.
    hub.closeConnection('hc');
    await until(() => paused.includes('no_humans_connected'));
    expect(timedOut).toBe(0);
    expect(session.appliedActions.some((a) => a.t === 'DRAW_BLIND' && a.player === human)).toBe(
      false,
    );

    // Reconnecting the seat resumes auto-play: the still-idle human now times out normally.
    hub.openConnection('hc2', () => {});
    await hub.receive(
      'hc2',
      encodeClient(1, { case: 'hello', value: { ticket, protocolVersion: 1 } }),
    );
    await until(() => timedOut > 0);
    expect(timedOut).toBeGreaterThan(0);

    await hub.evictMatch('gone', 'test complete');
  }, 20_000);
});
