// F15: banning an account must revoke its *realtime* session too, not just future ws-game
// tickets — `GameHub.revokeUser` drops every live connection for a banned userId, and `onHello`
// consults a cache-backed ban check (`GameHub.isBanned`) at ticket-parse time AND again
// immediately before either bind point.
//
// Two properties matter beyond "a ban eventually works":
//  1. `onHello` on a resident (warm) game used to be pure in-memory (JWT verify + a Map lookup).
//     A ws-game ticket is replayable across unlimited connections until it expires, and nothing
//     else rate-limits new connections/hellos — so an unconditional per-hello DB read would be a
//     fresh, unthrottled amplification path. The ban cache must bound a burst of hellos for one
//     user to about one DB read, not one per hello/connection.
//  2. `revokeUser` only drops connections that are ALREADY bound at the instant it scans. A hello
//     concurrently in flight for the same user — one that already passed its first ban check and
//     is now awaiting the cold-game recovery path — must still be caught by a SECOND, immediately
//     pre-bind check once that await resolves, or it would bind a banned account with nothing else
//     ever re-checking ban status on it again.
import { describe, it, expect } from 'vitest';
import {
  taiwanBoard,
  CONTENT_HASH,
  ENGINE_VERSION,
  type PlayerSeed,
  type GameConfig,
} from '@trm/engine';
import { asPlayerId, ACCOUNT_DISABLED_CLOSE_CODE } from '@trm/shared';
import { RejectionCode, type ServerEnvelope } from '@trm/proto';
import { GameRegistry } from '../src/game/game-registry';
import { GameSession } from '../src/game/game-session';
import { GameHub, type BanGuardPort } from '../src/ws/hub';
import { makeDevTicket } from '../src/ws/ticket';
import type { ChatEntry, GameStorePort, RecoveryData } from '../src/persistence/types';
import { encodeClient, decodeServer } from './helpers';

const board = taiwanBoard();
const players: PlayerSeed[] = [
  { id: asPlayerId('p1'), seat: 0 },
  { id: asPlayerId('p2'), seat: 1 },
];
const config: GameConfig = { seed: 'ban-race', players, contentHash: CONTENT_HASH };

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Counts every DB call so tests can assert a burst of hellos collapses to ~1 read. */
class FakeBanGuard implements BanGuardPort {
  calls = 0;
  banned = new Set<string>();
  async isDisabled(userId: string): Promise<boolean> {
    this.calls++;
    return this.banned.has(userId);
  }
}

/**
 * A store whose `loadForRecovery` can be held open until the test releases it — the same shape of
 * mock used to reproduce a real `onHello` await window (mirrors how a slow cold-recovery path is
 * simulated for the analogous hello/recovery race).
 */
class SlowRecoveryStore implements GameStorePort {
  private release: (() => void) | null = null;
  private gate: Promise<void> | null = null;
  private recoveryData: RecoveryData | null = null;

  /** Arm the next `loadForRecovery` call to block until `unblock()` is called. */
  hold(): void {
    this.gate = new Promise((r) => (this.release = r));
  }
  unblock(): void {
    this.release?.();
  }
  prime(data: RecoveryData): void {
    this.recoveryData = data;
  }

  async createGame(): Promise<void> {}
  async appendAction(): Promise<void> {}
  async recordCompletion(): Promise<void> {}
  async getStatus(): Promise<undefined> {
    return undefined;
  }
  async addSpectator(): Promise<void> {}
  async loadForRecovery(): Promise<RecoveryData | null> {
    if (this.gate) await this.gate;
    return this.recoveryData;
  }
  async appendChat(): Promise<void> {}
  async loadChat(): Promise<ChatEntry[]> {
    return [];
  }
}

/** Valid, digest-free recovery data for a fresh genesis game (no tail ⇒ nothing to re-verify). */
function genesisRecoveryData(gameId: string): RecoveryData {
  const session = new GameSession(gameId, board, config);
  return {
    config,
    snapshot: { seq: 0, state: session.raw() },
    tail: [],
    preSnapshotActions: [],
    bots: [],
    engineVersion: ENGINE_VERSION,
  };
}

interface Wired {
  hub: GameHub;
  received: Map<string, ServerEnvelope[]>;
  terminated: Map<string, [number, string]>;
  seq: Map<string, number>;
}

function openConn(w: Wired, connId: string): void {
  w.received.set(connId, []);
  w.seq.set(connId, 0);
  w.hub.openConnection(
    connId,
    (bytes) => w.received.get(connId)!.push(decodeServer(bytes)),
    (code, reason) => w.terminated.set(connId, [code, reason]),
  );
}

function helloBytes(gameId: string, pid: string, seat: number, clientSeq = 1): Uint8Array {
  return encodeClient(clientSeq, {
    case: 'hello',
    value: { ticket: makeDevTicket({ gameId, playerId: pid, seat }), protocolVersion: 2 },
  });
}

async function hello(
  w: Wired,
  connId: string,
  gameId: string,
  pid: string,
  seat: number,
): Promise<void> {
  const next = (w.seq.get(connId) ?? 0) + 1;
  w.seq.set(connId, next);
  await w.hub.receive(connId, helloBytes(gameId, pid, seat, next));
}

const rejections = (w: Wired, connId: string): ServerEnvelope[] =>
  (w.received.get(connId) ?? []).filter((f) => f.event.case === 'rejection');

const hasCase = (w: Wired, connId: string, c: string): boolean =>
  (w.received.get(connId) ?? []).some((f) => f.event.case === c);

describe('GameHub.revokeUser: drops live connections at ban time', () => {
  it("drops a seated player's live connection (rejection + terminate), leaves other seats alone", async () => {
    const hub = new GameHub(new GameRegistry());
    await hub.createMatch('g-seat', board, config);
    const w: Wired = { hub, received: new Map(), terminated: new Map(), seq: new Map() };
    openConn(w, 'p1-a');
    openConn(w, 'p2-a');
    await hello(w, 'p1-a', 'g-seat', 'p1', 0);
    await hello(w, 'p2-a', 'g-seat', 'p2', 1);

    const dropped = hub.revokeUser('p1');
    expect(dropped).toBe(1);
    expect(w.terminated.get('p1-a')).toEqual([ACCOUNT_DISABLED_CLOSE_CODE, 'account_disabled']);
    const rej = rejections(w, 'p1-a');
    expect(rej.length).toBeGreaterThan(0);
    const last = rej[rej.length - 1];
    if (last?.event.case !== 'rejection') throw new Error('unreachable');
    expect(last.event.value.code).toBe(RejectionCode.UNAUTHENTICATED);

    // p2 was never named in the ban — untouched.
    expect(w.terminated.get('p2-a')).toBeUndefined();
    expect(rejections(w, 'p2-a')).toHaveLength(0);
  });

  it('drops a live spectator connection', async () => {
    const hub = new GameHub(new GameRegistry());
    await hub.createMatch('g-spec', board, config);
    const w: Wired = { hub, received: new Map(), terminated: new Map(), seq: new Map() };
    openConn(w, 'watch-a');
    await hello(w, 'watch-a', 'g-spec', 'watcher', -1);

    const dropped = hub.revokeUser('watcher');
    expect(dropped).toBe(1);
    expect(w.terminated.get('watch-a')).toEqual([ACCOUNT_DISABLED_CLOSE_CODE, 'account_disabled']);
  });

  it('is a no-op (0 dropped) for a user with no live connection, and still poisons the cache', async () => {
    const banGuard = new FakeBanGuard();
    const hub = new GameHub(new GameRegistry(), { banGuard });
    await hub.createMatch('g-none', board, config);

    expect(hub.revokeUser('ghost')).toBe(0);

    // The poisoned cache still refuses a fresh hello for that user without ever touching the DB.
    const w: Wired = { hub, received: new Map(), terminated: new Map(), seq: new Map() };
    openConn(w, 'late');
    await hello(w, 'late', 'g-none', 'ghost', -1);
    expect(rejections(w, 'late')).toHaveLength(1);
    expect(banGuard.calls).toBe(0);
  });
});

describe('GameHub ban check: a pre-ban ticket cannot be redeemed after the ban lands', () => {
  it('refuses a hello for an already-banned user even though the ticket itself is still valid', async () => {
    const banGuard = new FakeBanGuard();
    const hub = new GameHub(new GameRegistry(), { banGuard });
    await hub.createMatch('g-preban', board, config);

    // The ticket was minted (and would still verify) before the ban landed.
    const ticket = makeDevTicket({ gameId: 'g-preban', playerId: 'p1', seat: 0 });
    hub.revokeUser('p1'); // moderator bans p1 — nobody was connected yet, so this drops nothing

    const w: Wired = { hub, received: new Map(), terminated: new Map(), seq: new Map() };
    openConn(w, 'late');
    await w.hub.receive(
      'late',
      encodeClient(1, { case: 'hello', value: { ticket, protocolVersion: 2 } }),
    );

    const rej = rejections(w, 'late');
    expect(rej).toHaveLength(1);
    if (rej[0]?.event.case !== 'rejection') throw new Error('unreachable');
    expect(rej[0].event.value.code).toBe(RejectionCode.UNAUTHENTICATED);
    expect(hasCase(w, 'late', 'welcome')).toBe(false);
    // Cache hit — no DB round trip for the redeemed-post-ban hello.
    expect(banGuard.calls).toBe(0);
  });
});

describe('GameHub ban check: DB cost of a burst of hellos is bounded (Objection A)', () => {
  it('a concurrent burst of hellos for one user collapses into a single DB read', async () => {
    const banGuard = new FakeBanGuard();
    const hub = new GameHub(new GameRegistry(), { banGuard });
    await hub.createMatch('g-burst', board, config);

    const w: Wired = { hub, received: new Map(), terminated: new Map(), seq: new Map() };
    const N = 25;
    const connIds = Array.from({ length: N }, (_, i) => `burst-${i}`);
    for (const id of connIds) openConn(w, id);

    // All N hellos are dispatched before any of them can resolve the DB read — the single-flight
    // in-process replayable-ticket flood this cache exists to bound.
    await Promise.all(connIds.map((id) => w.hub.receive(id, helloBytes('g-burst', 'p1', -1, 1))));

    expect(banGuard.calls).toBe(1);
    for (const id of connIds) expect(rejections(w, id)).toHaveLength(0);
  });

  it("re-reads the DB once the cached verdict's TTL expires", async () => {
    const banGuard = new FakeBanGuard();
    const hub = new GameHub(new GameRegistry(), { banGuard, banCacheTtlMs: 10 });
    await hub.createMatch('g-ttl', board, config);
    const w: Wired = { hub, received: new Map(), terminated: new Map(), seq: new Map() };
    openConn(w, 'a');
    openConn(w, 'b');

    await hello(w, 'a', 'g-ttl', 'p1', -1);
    expect(banGuard.calls).toBe(1);
    await new Promise((r) => setTimeout(r, 25)); // let the short TTL lapse
    await hello(w, 'b', 'g-ttl', 'p1', -1);
    expect(banGuard.calls).toBe(2);
  });
});

describe('GameHub ban check: the second, pre-bind re-check (Objection B)', () => {
  it('rejects a hello whose ban lands while it is awaiting cold-game recovery', async () => {
    const banGuard = new FakeBanGuard();
    const store = new SlowRecoveryStore();
    const gameId = 'g-race-banned';
    store.prime(genesisRecoveryData(gameId));
    const hub = new GameHub(new GameRegistry(), { banGuard, store });
    // Deliberately never `createMatch` — the game is "cold", forcing onHello onto the
    // recoverMatch(await store.loadForRecovery(...)) path where Objection B's window lives.

    const w: Wired = { hub, received: new Map(), terminated: new Map(), seq: new Map() };
    openConn(w, 'c1');
    store.hold();
    const inFlight = hello(w, 'c1', gameId, 'p1', 0);

    // Let the hello run past its FIRST ban check (not yet banned) and into the recovery await.
    await tick();
    // The ban lands *during* the delay — same effect as a moderator's dashboard action.
    const dropped = hub.revokeUser('p1');
    expect(dropped).toBe(0); // nothing was bound yet
    store.unblock();
    await inFlight;

    const rej = rejections(w, 'c1');
    expect(rej.length).toBeGreaterThan(0);
    const last = rej[rej.length - 1];
    if (last?.event.case !== 'rejection') throw new Error('unreachable');
    expect(last.event.value.code).toBe(RejectionCode.UNAUTHENTICATED);
    expect(hasCase(w, 'c1', 'welcome')).toBe(false);
    expect(hasCase(w, 'c1', 'snapshot')).toBe(false);
    // Only the first (pre-recovery) check ever reached the DB; the second, pre-bind check was a
    // synchronous cache hit against the poisoned entry — "doing it twice is cheap".
    expect(banGuard.calls).toBe(1);
  });

  it('binds normally when no ban lands during the same delay (no false positive)', async () => {
    const banGuard = new FakeBanGuard();
    const store = new SlowRecoveryStore();
    const gameId = 'g-race-clean';
    store.prime(genesisRecoveryData(gameId));
    const hub = new GameHub(new GameRegistry(), { banGuard, store });

    const w: Wired = { hub, received: new Map(), terminated: new Map(), seq: new Map() };
    openConn(w, 'c1');
    store.hold();
    const inFlight = hello(w, 'c1', gameId, 'p1', 0);
    await tick();
    store.unblock();
    await inFlight;

    expect(hasCase(w, 'c1', 'welcome')).toBe(true);
    expect(rejections(w, 'c1')).toHaveLength(0);
  });
});
