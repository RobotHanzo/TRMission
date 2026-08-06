// Regression coverage for the chat rate-limit/log-size hardening (F27):
//   - the rate-limit window is keyed on (gameId, playerId) in the hub, not on the ephemeral
//     Connection — a reconnect (or a second socket on the same ticket) must not get a fresh budget.
//   - the per-game chat log is hard-capped at CHAT_LOG_MAX going forward.
//   - a game whose PERSISTED chat already exceeded the cap before this fix must not resurrect an
//     unbounded in-memory log on recovery — HistoryReplay stays bounded regardless of how large the
//     underlying Mongo collection already is.
//   - concurrent spectator sockets on one ticket are capped, oldest evicted.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, type Db } from 'mongodb';
import { taiwanBoard, CONTENT_HASH, type GameConfig, type PlayerSeed } from '@trm/engine';
import { asPlayerId, SESSION_REPLACED_CLOSE_CODE } from '@trm/shared';
import { RejectionCode, type ServerEnvelope } from '@trm/proto';
import { GameRegistry } from '../src/game/game-registry';
import { GameSession } from '../src/game/game-session';
import { GameHub } from '../src/ws/hub';
import { makeDevTicket } from '../src/ws/ticket';
import { ensureIndexes, MongoGameStore } from '../src/persistence/game-store';
import { encodeClient, decodeServer } from './helpers';

const players: PlayerSeed[] = [
  { id: asPlayerId('p1'), seat: 0 },
  { id: asPlayerId('p2'), seat: 1 },
];
const config: GameConfig = { seed: 'chat-rl-1', players, contentHash: CONTENT_HASH };
const board = taiwanBoard();

function hello(pid: string, seat: number, seq: number, gameId = 'g') {
  return encodeClient(seq, {
    case: 'hello',
    value: { ticket: makeDevTicket({ gameId, playerId: pid, seat }), protocolVersion: 1 },
  });
}

function chatText(seq: number, value: string) {
  return encodeClient(seq, { case: 'chat', value: { content: { case: 'text', value } } });
}

const historyOf = (frames: ServerEnvelope[]) =>
  frames.find((f) => f.event.case === 'history')?.event.value as
    { chat: { content: { case: string; value: string } }[] } | undefined;

const rejectionsOf = (frames: ServerEnvelope[]) =>
  frames
    .filter((f) => f.event.case === 'rejection')
    .map((f) => (f.event.value as { code: number; messageKey: string }) ?? undefined);

describe('chat rate limit is keyed on (gameId, playerId), not the Connection', () => {
  it('a reconnect (new socket, same ticket) shares the same rate-limit window rather than resetting it', async () => {
    const hub = new GameHub(new GameRegistry());
    await hub.createMatch('g', board, config);

    const f1: ServerEnvelope[] = [];
    hub.openConnection('c1', (b) => f1.push(decodeServer(b)));
    await hub.receive('c1', hello('p1', 0, 1));

    // Exhaust the 5-per-window budget on the first connection.
    for (let i = 0; i < 5; i++) {
      await hub.receive('c1', chatText(10 + i, `m${i}`));
    }
    expect(rejectionsOf(f1).some((r) => r.code === RejectionCode.RATE_LIMITED)).toBe(false);

    // Reconnect: a brand-new Connection object bound to the SAME seat/ticket. Under the old
    // per-Connection `conn.chatTimes` bug this would get an empty array and a fresh budget.
    const f2: ServerEnvelope[] = [];
    hub.openConnection('c1b', (b) => f2.push(decodeServer(b)));
    await hub.receive('c1b', hello('p1', 0, 1));

    await hub.receive('c1b', chatText(2, 'one-more'));
    const rej = rejectionsOf(f2);
    expect(rej.some((r) => r.code === RejectionCode.RATE_LIMITED)).toBe(true);
  });

  it('scopes the window per game and per player: another game, or another player in the same game, is unaffected', async () => {
    const hub = new GameHub(new GameRegistry());
    await hub.createMatch('g1', board, config);
    await hub.createMatch('g2', board, config);

    const f1: ServerEnvelope[] = [];
    const f2: ServerEnvelope[] = [];
    const fOther: ServerEnvelope[] = [];
    hub.openConnection('g1-p1', (b) => f1.push(decodeServer(b)));
    hub.openConnection('g1-p2', (b) => f2.push(decodeServer(b)));
    hub.openConnection('g2-p1', (b) => fOther.push(decodeServer(b)));
    await hub.receive('g1-p1', hello('p1', 0, 1, 'g1'));
    await hub.receive('g1-p2', hello('p2', 1, 1, 'g1'));
    await hub.receive('g2-p1', hello('p1', 0, 1, 'g2'));

    for (let i = 0; i < 5; i++) {
      await hub.receive('g1-p1', chatText(10 + i, `m${i}`));
    }
    f1.length = 0;
    await hub.receive('g1-p1', chatText(20, 'blocked'));
    expect(rejectionsOf(f1).some((r) => r.code === RejectionCode.RATE_LIMITED)).toBe(true);

    // p2, same game, own budget untouched.
    await hub.receive('g1-p2', chatText(2, 'still fine'));
    expect(rejectionsOf(f2).some((r) => r.code === RejectionCode.RATE_LIMITED)).toBe(false);

    // p1, but in a DIFFERENT game, own budget untouched.
    await hub.receive('g2-p1', chatText(2, 'still fine elsewhere'));
    expect(rejectionsOf(fOther).some((r) => r.code === RejectionCode.RATE_LIMITED)).toBe(false);
  });
});

describe('per-game chat log is capped going forward', () => {
  it('refuses further chat once the game log reaches CHAT_LOG_MAX, without dropping older lines', async () => {
    const hub = new GameHub(new GameRegistry());
    await hub.createMatch('g', board, config);

    // Fill the shared per-game log to exactly 500 using many distinct (fresh, never-rate-limited)
    // spectator identities — spectators may chat too, and each fresh ticket gets its own 5-per-5s
    // budget, so this reaches the cap without waiting on the rate-limit window.
    for (let i = 0; i < 100; i++) {
      const connId = `spec-${i}`;
      hub.openConnection(connId, () => {});
      await hub.receive(
        connId,
        encodeClient(1, {
          case: 'hello',
          value: {
            ticket: makeDevTicket({ gameId: 'g', playerId: `watcher${i}`, seat: -1 }),
            protocolVersion: 1,
          },
        }),
      );
      for (let j = 0; j < 5; j++) {
        await hub.receive(connId, chatText(2 + j, `seed-${i}-${j}`));
      }
    }

    // One more, brand-new identity — never rate-limited, but the log itself is now full.
    const fFresh: ServerEnvelope[] = [];
    hub.openConnection('spec-new', (b) => fFresh.push(decodeServer(b)));
    await hub.receive(
      'spec-new',
      encodeClient(1, {
        case: 'hello',
        value: {
          ticket: makeDevTicket({ gameId: 'g', playerId: 'watcherNew', seat: -1 }),
          protocolVersion: 1,
        },
      }),
    );
    await hub.receive('spec-new', chatText(2, 'over the cap'));
    const rej = rejectionsOf(fFresh);
    expect(rej).toHaveLength(1);
    expect(rej[0]?.code).toBe(RejectionCode.RATE_LIMITED);

    // The log stayed at exactly the cap — the refused line was never appended.
    const fCheck: ServerEnvelope[] = [];
    hub.openConnection('spec-check', (b) => fCheck.push(decodeServer(b)));
    await hub.receive(
      'spec-check',
      encodeClient(1, {
        case: 'hello',
        value: {
          ticket: makeDevTicket({ gameId: 'g', playerId: 'watcherCheck', seat: -1 }),
          protocolVersion: 1,
        },
      }),
    );
    const h = historyOf(fCheck);
    expect(h?.chat).toHaveLength(500);
    expect(h?.chat[499]?.content).toEqual({ case: 'text', value: 'seed-99-4' });
  });
});

describe('concurrent spectator sockets are capped per ticket', () => {
  it('evicts the oldest spectator socket once a 5th binds the same ticket', async () => {
    const hub = new GameHub(new GameRegistry());
    await hub.createMatch('g', board, config);

    const terminated = new Map<string, [number, string]>();
    const frames = new Map<string, ServerEnvelope[]>();
    for (let i = 0; i < 5; i++) {
      const connId = `spec-${i}`;
      frames.set(connId, []);
      hub.openConnection(
        connId,
        (b) => frames.get(connId)!.push(decodeServer(b)),
        (code, reason) => terminated.set(connId, [code, reason]),
      );
      await hub.receive(
        connId,
        encodeClient(1, {
          case: 'hello',
          value: {
            ticket: makeDevTicket({ gameId: 'g', playerId: 'watcher', seat: -1 }),
            protocolVersion: 1,
          },
        }),
      );
    }

    // The FIRST (oldest) of the 5 sockets on the same ticket was evicted…
    expect(terminated.get('spec-0')).toEqual([SESSION_REPLACED_CLOSE_CODE, 'spectator_limit']);
    expect(
      rejectionsOf(frames.get('spec-0')!).some((r) => r.code === RejectionCode.SESSION_REPLACED),
    ).toBe(true);
    // …the other 4 (within the cap) were never touched.
    for (let i = 1; i < 5; i++) {
      expect(terminated.get(`spec-${i}`)).toBeUndefined();
    }
  });
});

describe('recovery truncates an already-oversized persisted chat log', () => {
  let mongod: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let store: MongoGameStore;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    client = new MongoClient(mongod.getUri());
    await client.connect();
    db = client.db('trm-test');
    await ensureIndexes(db);
    store = new MongoGameStore(db);
  }, 60_000);

  afterAll(async () => {
    await client?.close();
    await mongod?.stop();
  });

  it('caps the in-memory chatLog (and what HistoryReplay ever sends) at CHAT_LOG_MAX, even when the persisted collection has far more', async () => {
    const gameId = 'oversized';
    const live = new GameSession(gameId, board, config);
    await store.createGame(gameId, config, live.raw(), live.digest());

    // Seed 650 persisted chat docs directly in the store — more than CHAT_LOG_MAX (500) — mirroring
    // a game whose chat log already grew unbounded before this cap existed.
    for (let i = 0; i < 650; i++) {
      await store.appendChat(gameId, i, 'p1', { case: 'text', value: `chat-${i}` });
    }

    const hub = new GameHub(new GameRegistry(), { store });
    const frames: ServerEnvelope[] = [];
    hub.openConnection('c', (b) => frames.push(decodeServer(b)));
    // First hello for this game on this hub — triggers recoverMatch's backfill.
    await hub.receive('c', hello('p1', 0, 1, gameId));

    const h = historyOf(frames);
    expect(h?.chat).toHaveLength(500);
    // The LAST 500 of the 650 seeded docs (indices 150..649), not the first 500 and not the full
    // 650 — confirms it's a truncate-to-tail, not a silent drop of the newest lines.
    expect(h?.chat[0]?.content).toEqual({ case: 'text', value: 'chat-150' });
    expect(h?.chat[499]?.content).toEqual({ case: 'text', value: 'chat-649' });
  });
});
