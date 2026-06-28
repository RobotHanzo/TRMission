# Action Log + Chat Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-game comms column (an action log over a chat) that backfills the full game history on (re)connect, with members-only chat that is length- and rate-limited.

**Architecture:** The action log is a **client-side projection** of the `GameEvent` stream (live + a server-replayed history), never animated. The server re-derives the event history by replaying the recorded action log (`GameSession.history()`), redacts it per-viewer, and ships it once in a new `HistoryReplay` frame alongside the persisted chat log. Chat is persisted in a new `gameChats` collection and kept in an in-memory per-game list in the hub.

**Tech Stack:** protobuf-es (`@trm/proto`), NestJS + MongoDB native driver (`apps/server`), React + Vite 5 + Zustand + react-i18next (`apps/web`), vitest + Testing-Library.

## Global Constraints

- Yarn 4 + Turborepo, Node 20+. Package build order: `proto → shared → map-data → engine → apps/{server,web}`.
- After editing any `.proto`, run `yarn workspace @trm/proto generate`. `packages/proto/src/gen/**` is gitignored; drift between `.proto` and `src/gen` is a CI failure.
- The 6th card colour is **PURPLE** everywhere (never PINK). Seat colours are abstract indices coloured client-side via `SEAT_COLORS` (`theme/colors.ts`).
- Engine purity (no `Date`/`Math.random`) is enforced in `@trm/engine` **only**. The hub (`apps/server`) may use wall-clock — chat rate-limiting uses `Date.now()`.
- `apps/web` pins **Vite ^5** — do not bump.
- Hidden information: raw `GameState` must never reach the wire; all egress goes through redaction. Keep `trm_security_leak_blocked_total` at zero and the wire-leak e2e green. **History events use the same `eventToProto(e, viewer)` redaction as live events.**
- UI ships in **Traditional Chinese (primary) + English**.
- Chat: **members-only** (spectators read the public log but cannot send/receive chat). `CHAT_MAX_LEN = 2048` chars; rate limit `5` messages per `5000` ms per connection.

## Refinements decided during planning (vs. the spec)

- **No new `RejectionCode`.** Reuse the existing `REJECTION_CODE_RATE_LIMITED` (rate) and `REJECTION_CODE_MALFORMED` (over-length). The proto change is limited to `HistoryReplay` + `ChatEntry`.
- **Chat limits are enforced on BOTH ends:** client-side for instant inline feedback (so the normal client never trips the server), server-side as the authoritative backstop. The global rejection toast is left untouched.
- **Blind draws log as "drew from the deck"** with no card colour (less noise; the colour is already a redacted secret for opponents).
- **Names + seat colours resolve at render** (LogPanel/ChatPanel read `useGame` snapshot + `useRoster`), so late-loading roster names and locale changes apply live; `logModel` stays pure and snapshot-free.

## File Structure

**Create:**
- `apps/web/src/game/logModel.ts` — pure `GameEvent[] → LogDatum[]` (kind + importance + data).
- `apps/web/src/store/log.ts` — action-log store (live + history ingest, cap 1000).
- `apps/web/src/store/chat.ts` — chat message store (live + history ingest, cap 500).
- `apps/web/src/hooks/useMediaQuery.ts` — matchMedia hook (jsdom-safe).
- `apps/web/src/components/LogPanel.tsx`, `ChatPanel.tsx`, `CommsPanel.tsx`.
- `apps/server/test/history-session.spec.ts`, `apps/server/test/chat-store.spec.ts`, `apps/server/test/history-chat.e2e.spec.ts`.
- Web tests: `logModel.test.ts`, `store/log.test.ts`, `store/chat.test.ts`, `components/LogPanel.test.tsx`, `components/ChatPanel.test.tsx`.

**Modify:**
- `packages/proto/proto/trmission/v1/server.proto` — `ChatEntry`, `HistoryReplay`, oneof entry.
- `apps/server/src/game/game-session.ts` — `history()`.
- `apps/server/src/codec/frames.ts` — `historyReplayFrame`.
- `apps/server/src/persistence/types.ts` + `game-store.ts` — chat persistence.
- `apps/server/src/ws/hub.ts` + `connection.ts` — history-on-hello + chat enforcement/persistence.
- `apps/web/src/net/socket.ts` + `net/connection.ts` — `onHistory` + store wiring.
- `apps/web/src/screens/GameScreen.tsx`, `styles/game.css`, `i18n/index.ts`.

---

## Task 1: Proto — `HistoryReplay` + `ChatEntry`

**Files:**
- Modify: `packages/proto/proto/trmission/v1/server.proto`
- Test: `packages/proto/test/proto.spec.ts`

**Interfaces:**
- Produces: `HistoryReplay { events: GameEvent[]; chat: ChatEntry[]; stateVersion: number }`, `ChatEntry { playerId: string; text: string; ts: bigint }`, and `ServerEnvelope.event` oneof case `'history'`. Schemas `HistoryReplaySchema`, `ChatEntrySchema` exported from `@trm/proto`.

- [ ] **Step 1: Add the messages to `server.proto`.** Insert after the `ChatBroadcast` message (around line 157):

```proto
// One persisted chat line, replayed in a HistoryReplay on (re)connect.
message ChatEntry {
  string player_id = 1;
  string text = 2;
  int64 ts = 3;
}

// Sent once after the snapshot on (re)connect: the full game history, redacted
// per-recipient. The client routes this to the log/chat ONLY — never to the
// animation/sound channel — so a reconnect does not replay the whole game.
message HistoryReplay {
  repeated GameEvent events = 1; // log-only; same redaction as live events
  repeated ChatEntry chat = 2;   // empty for spectators (members-only chat)
  uint32 state_version = 3;
}
```

- [ ] **Step 2: Add the oneof entry.** In `message ServerEnvelope`, after `CameraMoved camera_moved = 9;`:

```proto
    HistoryReplay history = 10;
```

- [ ] **Step 3: Regenerate.**

Run: `yarn workspace @trm/proto generate`
Expected: completes; `packages/proto/src/gen/` now contains `HistoryReplaySchema` / `ChatEntrySchema`.

- [ ] **Step 4: Write the round-trip test.** Append to `packages/proto/test/proto.spec.ts` (inside the existing `describe`):

```ts
  it('round-trips a HistoryReplay envelope with chat entries', () => {
    const env = create(ServerEnvelopeSchema, {
      serverSeq: 3,
      event: {
        case: 'history',
        value: {
          stateVersion: 12,
          events: [],
          chat: [{ playerId: 'p2', text: 'hello', ts: 1719600000000n }],
        },
      },
    });
    const back = fromBinary(ServerEnvelopeSchema, toBinary(ServerEnvelopeSchema, env));
    expect(back.event.case).toBe('history');
    if (back.event.case !== 'history') throw new Error('wrong case');
    expect(back.event.value.stateVersion).toBe(12);
    expect(back.event.value.chat[0]?.text).toBe('hello');
    expect(back.event.value.chat[0]?.ts).toBe(1719600000000n);
  });
```

- [ ] **Step 5: Run the test.**

Run: `yarn workspace @trm/proto test`
Expected: PASS (all proto round-trips, including the new one).

- [ ] **Step 6: Commit.**

```bash
git add packages/proto/proto packages/proto/test
git commit -m "Proto: HistoryReplay + ChatEntry frames for log/chat backfill"
```

---

## Task 2: Server — `GameSession.history()`

**Files:**
- Modify: `apps/server/src/game/game-session.ts`
- Test: `apps/server/test/history-session.spec.ts`

**Interfaces:**
- Consumes: existing engine `initGame`, `reduce` (already imported in `game-session.ts`); `appliedActions`, `board`, `config` on the session.
- Produces: `GameSession.history(): GameEvent[]` — the full cosmetic event stream re-derived by replaying `appliedActions` from genesis. Pure; never mutates the live state.

- [ ] **Step 1: Write the failing test.** Create `apps/server/test/history-session.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { taiwanBoard, CONTENT_HASH, type GameConfig, type GameEvent } from '@trm/engine';
import { asPlayerId } from '@trm/shared';
import { GameSession } from '../src/game/game-session';
import { pickAction } from './helpers';

const config: GameConfig = {
  seed: 'hist-1',
  players: [
    { id: asPlayerId('p0'), seat: 0 },
    { id: asPlayerId('p1'), seat: 1 },
    { id: asPlayerId('p2'), seat: 2 },
  ],
  contentHash: CONTENT_HASH,
};

describe('GameSession.history()', () => {
  it('reproduces exactly the events from replaying the applied actions', () => {
    const board = taiwanBoard();
    const session = new GameSession('h', board, config);
    const captured: GameEvent[] = [];

    let guard = 0;
    while (session.phase !== 'GAME_OVER') {
      if (++guard > 50_000) throw new Error('did not terminate');
      const state = session.raw();
      const actor =
        state.turn.phase === 'SETUP_TICKETS'
          ? config.players.map((p) => p.id).find((p) => session.hasPendingOffer(p))
          : session.currentPlayer;
      if (!actor) throw new Error(`no actor in ${state.turn.phase}`);
      const res = session.apply(pickAction(board, state, actor));
      if (!res.ok) throw new Error(`rejected: ${res.violation.code}`);
      captured.push(...res.events);
    }

    expect(session.history()).toEqual(captured);
    expect(session.history().length).toBeGreaterThan(0);
  });

  it('returns [] for a freshly created session', () => {
    const session = new GameSession('h2', taiwanBoard(), config);
    expect(session.history()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `yarn workspace @trm/server test --run history-session`
Expected: FAIL — `session.history is not a function`.

- [ ] **Step 3: Implement `history()`.** In `apps/server/src/game/game-session.ts`, add this method after `restore` (before `project`):

```ts
  /**
   * Re-derive the full cosmetic event history by replaying every applied action from
   * genesis through a throwaway state. Pure: it never touches the live `this.state`.
   * Used to backfill the client action log on (re)connect (events are deterministic, so
   * nothing extra needs to be persisted).
   */
  history(): GameEvent[] {
    let state = initGame(this.board, this.config);
    const out: GameEvent[] = [];
    for (const action of this.appliedActions) {
      const res = reduce(this.board, state, action);
      if (!res.ok) break; // appliedActions are all legal; defensive
      out.push(...res.value.events);
      state = res.value.state;
    }
    return out;
  }
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `yarn workspace @trm/server test --run history-session`
Expected: PASS (both cases).

- [ ] **Step 5: Commit.**

```bash
git add apps/server/src/game/game-session.ts apps/server/test/history-session.spec.ts
git commit -m "Server: GameSession.history() re-derives the event stream from the action log"
```

---

## Task 3: Server — chat persistence in the store

**Files:**
- Modify: `apps/server/src/persistence/types.ts`, `apps/server/src/persistence/game-store.ts`
- Test: `apps/server/test/chat-store.spec.ts`

**Interfaces:**
- Produces: `ChatEntry { playerId: string; text: string; ts: number }` (server-internal); `GameStorePort.appendChat(gameId, seq, playerId, text): Promise<void>` and `loadChat(gameId): Promise<ChatEntry[]>`; `MongoGameStore` implementing both; `gameChats` unique `(gameId, seq)` index in `ensureIndexes`.

- [ ] **Step 1: Write the failing test.** Create `apps/server/test/chat-store.spec.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, type Db } from 'mongodb';
import { MongoGameStore, ensureIndexes } from '../src/persistence/game-store';

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
});

afterAll(async () => {
  await client.close();
  await mongod.stop();
});

describe('chat persistence', () => {
  it('appends and loads chat entries in order', async () => {
    await store.appendChat('cg', 0, 'p1', 'first');
    await store.appendChat('cg', 1, 'p2', 'second');
    const out = await store.loadChat('cg');
    expect(out.map((c) => c.text)).toEqual(['first', 'second']);
    expect(out[0].playerId).toBe('p1');
    expect(typeof out[0].ts).toBe('number');
  });

  it('keeps games isolated and rejects duplicate (gameId, seq)', async () => {
    await store.appendChat('cg2', 0, 'p1', 'x');
    expect(await store.loadChat('cg2')).toHaveLength(1);
    await expect(store.appendChat('cg2', 0, 'p1', 'dup')).rejects.toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `yarn workspace @trm/server test --run chat-store`
Expected: FAIL — `store.appendChat is not a function`.

- [ ] **Step 3: Add the types.** In `apps/server/src/persistence/types.ts`, add after `GameSnapshotDoc` (around line 48):

```ts
/** A persisted chat line. Chat is non-authoritative (outside the engine/digest). */
export interface GameChatDoc {
  gameId: string;
  seq: number;
  playerId: string;
  text: string;
  ts: Date;
}

/** In-memory chat line (the hub keeps these per game and replays them on connect). */
export interface ChatEntry {
  playerId: string;
  text: string;
  ts: number;
}
```

Then add to the `GameStorePort` interface (after `loadForRecovery`):

```ts
  appendChat(gameId: string, seq: number, playerId: string, text: string): Promise<void>;
  loadChat(gameId: string): Promise<ChatEntry[]>;
```

- [ ] **Step 4: Implement in `MongoGameStore`.** In `apps/server/src/persistence/game-store.ts`:

In the imports from `./types`, add `type GameChatDoc` and `type ChatEntry`.

In `ensureIndexes`, after the `gameSnapshots` index:

```ts
  await db
    .collection<GameChatDoc>('gameChats')
    .createIndex({ gameId: 1, seq: 1 }, { unique: true });
```

Add the collection field (next to `private readonly history`):

```ts
  private readonly chats: Collection<GameChatDoc>;
```

In the constructor (after `this.history = ...`):

```ts
    this.chats = db.collection<GameChatDoc>('gameChats');
```

Add the two methods after `loadForRecovery`:

```ts
  async appendChat(gameId: string, seq: number, playerId: string, text: string): Promise<void> {
    await this.chats.insertOne(
      { gameId, seq, playerId, text, ts: new Date() },
      { writeConcern: { w: 'majority' } },
    );
  }

  async loadChat(gameId: string): Promise<ChatEntry[]> {
    const docs = await this.chats.find({ gameId }).sort({ seq: 1 }).toArray();
    return docs.map((d) => ({ playerId: d.playerId, text: d.text, ts: d.ts.getTime() }));
  }
```

- [ ] **Step 5: Run the test to verify it passes.**

Run: `yarn workspace @trm/server test --run chat-store`
Expected: PASS (both cases).

- [ ] **Step 6: Commit.**

```bash
git add apps/server/src/persistence apps/server/test/chat-store.spec.ts
git commit -m "Server: persist chat in a gameChats collection (append/load)"
```

---

## Task 4: Server — `historyReplayFrame`, history-on-hello, chat enforcement

**Files:**
- Modify: `apps/server/src/codec/frames.ts`, `apps/server/src/ws/connection.ts`, `apps/server/src/ws/hub.ts`
- Test: `apps/server/test/history-chat.e2e.spec.ts`

**Interfaces:**
- Consumes: `GameSession.history()` (Task 2), `store.appendChat`/`loadChat` (Task 3), `eventToProto` (existing), the `'history'` oneof (Task 1).
- Produces: `historyReplayFrame(events, chat, stateVersion)` builder; the hub sends a `HistoryReplay` to every connection right after the snapshot, and `onChat` enforces `CHAT_MAX_LEN`/rate limit + persists.

- [ ] **Step 1: Add the frame builder.** In `apps/server/src/codec/frames.ts`, add at the end:

```ts
// One-shot backfill of the game's event history (already redacted) + persisted chat,
// sent after the snapshot on (re)connect. The client routes this to the log/chat only.
export const historyReplayFrame = (
  events: PbGameEvent[],
  chat: readonly { playerId: string; text: string; ts: number }[],
  stateVersion: number,
): ServerEvent => ({
  case: 'history',
  value: {
    events,
    chat: chat.map((c) => ({ playerId: c.playerId, text: c.text, ts: BigInt(c.ts) })),
    stateVersion,
  },
});
```

- [ ] **Step 2: Add per-connection rate state.** In `apps/server/src/ws/connection.ts`, add a field to `Connection` (after `binding`):

```ts
  /** Wall-clock timestamps of recent chat sends, for the per-connection rate limit. */
  chatTimes: number[] = [];
```

- [ ] **Step 3: Write the failing e2e test.** Create `apps/server/test/history-chat.e2e.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { taiwanBoard, CONTENT_HASH, type GameConfig } from '@trm/engine';
import { asPlayerId } from '@trm/shared';
import { CardColor, RejectionCode, type ServerEnvelope } from '@trm/proto';
import { GameRegistry } from '../src/game/game-registry';
import { GameHub } from '../src/ws/hub';
import { makeDevTicket } from '../src/ws/ticket';
import { encodeClient, decodeServer, pickAction } from './helpers';

const players = [
  { id: asPlayerId('p1'), seat: 0 },
  { id: asPlayerId('p2'), seat: 1 },
];
const config: GameConfig = { seed: 'hc-1', players, contentHash: CONTENT_HASH };

function hello(pid: string, seat: number, seq: number) {
  return encodeClient(seq, {
    case: 'hello',
    value: { ticket: makeDevTicket({ gameId: 'g', playerId: pid, seat }), protocolVersion: 1 },
  });
}
const historyOf = (frames: ServerEnvelope[]) =>
  frames.find((f) => f.event.case === 'history')?.event.value as
    | { events: { event: { case?: string; value?: unknown } }[]; chat: { text: string }[] }
    | undefined;

describe('history + chat over the hub', () => {
  it('backfills the redacted event history on hello and never leaks offered tickets', async () => {
    const board = taiwanBoard();
    const hub = new GameHub(new GameRegistry());
    const match = await hub.createMatch('g', board, config);

    // Drive a handful of moves directly on the session (populates appliedActions).
    for (let i = 0; i < 12 && match.session.phase !== 'GAME_OVER'; i++) {
      const state = match.session.raw();
      const actor =
        state.turn.phase === 'SETUP_TICKETS'
          ? players.map((p) => p.id).find((p) => match.session.hasPendingOffer(p))
          : match.session.currentPlayer;
      if (!actor) break;
      match.session.apply(pickAction(board, state, actor));
    }

    const frames: ServerEnvelope[] = [];
    hub.openConnection('c2', (b) => frames.push(decodeServer(b)));
    await hub.receive('c2', hello('p2', 1, 1));

    const h = historyOf(frames);
    expect(h).toBeTruthy();
    // p2 must NOT see p1's private ticket offers in the backfilled history…
    const cases = h!.events.map((e) => e.event.case);
    expect(cases).not.toContain('initialTicketsOffered');
    expect(cases).not.toContain('ticketsOffered');
    // …and must receive at least the public game-started / turn-started events.
    expect(cases).toContain('turnStarted');
  });

  it('broadcasts chat to members, persists it, and enforces length + rate limits', async () => {
    const board = taiwanBoard();
    const hub = new GameHub(new GameRegistry());
    await hub.createMatch('g', board, config);

    const f1: ServerEnvelope[] = [];
    const f2: ServerEnvelope[] = [];
    hub.openConnection('c1', (b) => f1.push(decodeServer(b)));
    hub.openConnection('c2', (b) => f2.push(decodeServer(b)));
    await hub.receive('c1', hello('p1', 0, 1));
    await hub.receive('c2', hello('p2', 1, 1));
    f1.length = 0;
    f2.length = 0;

    await hub.receive('c1', encodeClient(2, { case: 'chat', value: { text: '  hi there  ' } }));
    const chat1 = f1.find((f) => f.event.case === 'chat')?.event.value as { text: string } | undefined;
    const chat2 = f2.find((f) => f.event.case === 'chat')?.event.value as { text: string } | undefined;
    expect(chat1?.text).toBe('hi there'); // trimmed
    expect(chat2?.text).toBe('hi there'); // both members receive it

    // Over-length → MALFORMED rejection, nothing broadcast.
    f2.length = 0;
    await hub.receive('c1', encodeClient(3, { case: 'chat', value: { text: 'x'.repeat(2049) } }));
    const rej = f1.find((f) => f.event.case === 'rejection')?.event.value as { code: number } | undefined;
    expect(rej?.code).toBe(RejectionCode.MALFORMED);
    expect(f2.find((f) => f.event.case === 'chat')).toBeUndefined();

    // Rate limit: 5 allowed in the window, the 6th is rejected.
    let lastRej: number | undefined;
    for (let i = 0; i < 6; i++) {
      await hub.receive('c1', encodeClient(10 + i, { case: 'chat', value: { text: `m${i}` } }));
    }
    lastRej = (f1.filter((f) => f.event.case === 'rejection').pop()?.event.value as { code: number }).code;
    expect(lastRej).toBe(RejectionCode.RATE_LIMITED);
  });
});
```

- [ ] **Step 4: Run it to verify it fails.**

Run: `yarn workspace @trm/server test --run history-chat`
Expected: FAIL — no `history` frame is sent; chat is unlimited.

- [ ] **Step 5: Wire the hub.** In `apps/server/src/ws/hub.ts`:

5a. Add imports. Extend the codec import block to include `historyReplayFrame`, and add the `ChatEntry` type:

```ts
import {
  rejectionToPb,
  viewToSnapshot,
  eventToProto,
  commandToAction,
  welcomeFrame,
  snapshotFrame,
  eventsFrame,
  rejectionFrame,
  chatFrame,
  historyReplayFrame,
  cameraMovedFrame,
  pongFrame,
} from '../codec';
import type { ChatEntry } from '../persistence/types';
```

5b. Add constants just below the `const sleep = ...` line (top of the file):

```ts
const CHAT_MAX_LEN = 2048;
const CHAT_RATE_MAX = 5;
const CHAT_RATE_WINDOW_MS = 5000;
```

5c. Add the in-memory chat log field (next to `lastCamera`):

```ts
  /** gameId → ordered chat lines (replayed in HistoryReplay; persisted via the store). */
  private readonly chatLog = new Map<string, ChatEntry[]>();
```

5d. Seed it in `createMatch` (after `this.members.set(gameId, new Map());`):

```ts
    this.chatLog.set(gameId, []);
```

5e. Hydrate it in `recoverMatch` (after `const match = this.registry.adopt(...)`, before the bots block):

```ts
    if (this.store && !this.chatLog.has(gameId)) {
      try {
        this.chatLog.set(gameId, await this.store.loadChat(gameId));
      } catch {
        this.chatLog.set(gameId, []); // non-fatal: chat is cosmetic
      }
    }
```

5f. Send history after the snapshot. In `onHello`, in the **spectator branch**, after `this.sendProjected(conn, match, null, clientSeq);`:

```ts
      this.sendHistory(conn, match, null);
```

and in the **member path**, after `this.sendSnapshot(conn, match);`:

```ts
    this.sendHistory(conn, match, player);
```

5g. Change the chat route to pass `clientSeq`. Replace the `case 'chat':` block in `receive`:

```ts
      case 'chat':
        await this.onChat(conn, env.clientSeq, cmd.value.text);
        return;
```

5h. Replace `onChat` with the enforced + persisted version:

```ts
  private async onChat(conn: Connection, clientSeq: number, raw: string): Promise<void> {
    if (!conn.binding || conn.binding.seat < 0) return; // unbound or spectator → no chat
    const text = raw.trim();
    if (text.length === 0) return; // ignore empty
    if (text.length > CHAT_MAX_LEN) {
      conn.send(
        rejectionFrame(clientSeq, RejectionCode.MALFORMED, 'errors:chatTooLong', 'chat too long'),
      );
      return;
    }
    const now = Date.now();
    conn.chatTimes = conn.chatTimes.filter((ts) => now - ts < CHAT_RATE_WINDOW_MS);
    if (conn.chatTimes.length >= CHAT_RATE_MAX) {
      conn.send(
        rejectionFrame(
          clientSeq,
          RejectionCode.RATE_LIMITED,
          'errors:chatRateLimited',
          'chat rate limited',
        ),
      );
      return;
    }
    conn.chatTimes.push(now);

    const gameId = conn.binding.gameId;
    const playerId = conn.binding.player as string;
    const log = this.chatLog.get(gameId) ?? [];
    const seq = log.length;
    log.push({ playerId, text, ts: now });
    this.chatLog.set(gameId, log);
    if (this.store) {
      try {
        await this.store.appendChat(gameId, seq, playerId, text);
      } catch {
        // non-fatal: in-memory log still serves this session's backfill
      }
    }

    const members = this.members.get(gameId);
    if (!members) return;
    for (const member of members.values()) member.send(chatFrame(playerId, text));
  }
```

5i. Add the `sendHistory` helper in the fan-out section (next to `sendSnapshot`):

```ts
  /** One-shot backfill: the redacted event history + (for members) the chat log. */
  private sendHistory(conn: Connection, match: Match, viewer: PlayerId | null): void {
    const events = match.session
      .history()
      .map((e) => eventToProto(e, viewer))
      .filter((e): e is PbGameEvent => e !== null);
    const chat = viewer === null ? [] : (this.chatLog.get(match.session.gameId) ?? []);
    conn.send(historyReplayFrame(events, chat, match.session.stateVersion));
  }
```

- [ ] **Step 6: Run the e2e test to verify it passes.**

Run: `yarn workspace @trm/server test --run history-chat`
Expected: PASS (both cases).

- [ ] **Step 7: Run the full server suite (guard the leak/recovery tests).**

Run: `yarn workspace @trm/server test`
Expected: PASS — including `wire-game.e2e`, `persistence`, `bots.e2e`. (The added `HistoryReplay` carries only `eventToProto`-redacted events, so the hidden-info guarantee is unchanged.)

- [ ] **Step 8: Commit.**

```bash
git add apps/server/src/codec/frames.ts apps/server/src/ws apps/server/test/history-chat.e2e.spec.ts
git commit -m "Server: backfill HistoryReplay on hello; enforce + persist chat"
```

---

## Task 5: Web — `logModel` (pure event → log entry)

**Files:**
- Create: `apps/web/src/game/logModel.ts`
- Test: `apps/web/src/game/logModel.test.ts`

**Interfaces:**
- Consumes: proto `GameEvent`; `pbToCard` from `./cards`.
- Produces: `type Importance = 'normal' | 'highlight' | 'alert'`; `type LogKind`; `interface LogDatum { kind; playerId: string|null; data: Record<string,unknown>; importance }`; `interface LogEntry extends LogDatum { id: number }`; `entriesFromEvents(events: GameEvent[]): LogDatum[]`.

- [ ] **Step 1: Write the failing test.** Create `apps/web/src/game/logModel.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { create } from '@bufbuild/protobuf';
import { GameEventSchema, CardColor } from '@trm/proto';
import { entriesFromEvents } from './logModel';

const ev = (event: Parameters<typeof create<typeof GameEventSchema>>[1]['event']) =>
  create(GameEventSchema, { event });

describe('entriesFromEvents', () => {
  it('maps important actions with the right importance', () => {
    const out = entriesFromEvents([
      ev({ case: 'routeClaimed', value: { playerId: 'p1', routeId: 'R1', pointsAwarded: 7 } }),
      ev({ case: 'stationBuilt', value: { playerId: 'p2', cityId: 'C9' } }),
      ev({ case: 'endgameTriggered', value: { playerId: 'p1', finalTurnsRemaining: 2 } }),
    ]);
    expect(out).toEqual([
      { kind: 'routeClaimed', playerId: 'p1', data: { routeId: 'R1', points: 7 }, importance: 'highlight' },
      { kind: 'stationBuilt', playerId: 'p2', data: { cityId: 'C9' }, importance: 'highlight' },
      { kind: 'endgame', playerId: 'p1', data: { turns: 2 }, importance: 'alert' },
    ]);
  });

  it('omits noisy ambient events', () => {
    const out = entriesFromEvents([
      ev({ case: 'marketRefilled', value: { market: [] } }),
      ev({ case: 'deckReshuffled', value: {} }),
      ev({ case: 'turnEnded', value: { playerId: 'p1' } }),
      ev({ case: 'initialTicketsOffered', value: { playerId: 'p1', ticketIds: ['L1'] } }),
    ]);
    expect(out).toEqual([]);
  });

  it('reads the face-up card colour but not blind draws', () => {
    const out = entriesFromEvents([
      ev({ case: 'cardTakenFaceup', value: { playerId: 'p1', slot: 0, card: CardColor.BLUE } }),
      ev({ case: 'cardDrawnBlind', value: { playerId: 'p1', card: CardColor.UNSPECIFIED } }),
    ]);
    expect(out[0]).toMatchObject({ kind: 'tookFaceup', data: { color: 'BLUE' } });
    expect(out[1]).toMatchObject({ kind: 'drewBlind', data: {} });
  });
});
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `yarn workspace @trm/web test --run logModel`
Expected: FAIL — cannot find `./logModel`.

- [ ] **Step 3: Implement `logModel.ts`.** Create `apps/web/src/game/logModel.ts`:

```ts
import type { GameEvent } from '@trm/proto';
import { pbToCard } from './cards';

export type Importance = 'normal' | 'highlight' | 'alert';

export type LogKind =
  | 'gameStarted'
  | 'turnStarted'
  | 'routeClaimed'
  | 'stationBuilt'
  | 'tunnelRevealed'
  | 'tunnelCommitted'
  | 'tunnelAborted'
  | 'drewBlind'
  | 'tookFaceup'
  | 'ticketsKept'
  | 'passed'
  | 'endgame'
  | 'gameEnded';

export interface LogDatum {
  kind: LogKind;
  playerId: string | null;
  data: Record<string, unknown>;
  importance: Importance;
}

export interface LogEntry extends LogDatum {
  id: number;
}

/**
 * Pure projection of a delivered event batch into log rows. Names + seat colours are
 * resolved later at render (so late roster names + locale changes apply); this only
 * carries ids/counts. Ambient/noisy events (market refill/recycle, deck reshuffle,
 * turn-ended, private ticket offers, double-route lock) are omitted.
 */
export function entriesFromEvents(events: GameEvent[]): LogDatum[] {
  const out: LogDatum[] = [];
  for (const e of events) {
    const ev = e.event;
    switch (ev.case) {
      case 'gameStarted':
        out.push({ kind: 'gameStarted', playerId: null, data: {}, importance: 'normal' });
        break;
      case 'turnStarted':
        out.push({ kind: 'turnStarted', playerId: ev.value.playerId, data: {}, importance: 'normal' });
        break;
      case 'routeClaimed':
        out.push({
          kind: 'routeClaimed',
          playerId: ev.value.playerId,
          data: { routeId: ev.value.routeId, points: ev.value.pointsAwarded },
          importance: 'highlight',
        });
        break;
      case 'stationBuilt':
        out.push({
          kind: 'stationBuilt',
          playerId: ev.value.playerId,
          data: { cityId: ev.value.cityId },
          importance: 'highlight',
        });
        break;
      case 'tunnelRevealed':
        out.push({
          kind: 'tunnelRevealed',
          playerId: ev.value.playerId,
          data: { routeId: ev.value.routeId },
          importance: 'normal',
        });
        break;
      case 'tunnelResolved':
        out.push(
          ev.value.committed
            ? {
                kind: 'tunnelCommitted',
                playerId: ev.value.playerId,
                data: { routeId: ev.value.routeId },
                importance: 'highlight',
              }
            : {
                kind: 'tunnelAborted',
                playerId: ev.value.playerId,
                data: { routeId: ev.value.routeId },
                importance: 'normal',
              },
        );
        break;
      case 'cardDrawnBlind':
        out.push({ kind: 'drewBlind', playerId: ev.value.playerId, data: {}, importance: 'normal' });
        break;
      case 'cardTakenFaceup':
        out.push({
          kind: 'tookFaceup',
          playerId: ev.value.playerId,
          data: { color: pbToCard(ev.value.card) },
          importance: 'normal',
        });
        break;
      case 'initialTicketsKept':
      case 'ticketsKept':
        out.push({
          kind: 'ticketsKept',
          playerId: ev.value.playerId,
          data: { count: ev.value.keptCount },
          importance: 'normal',
        });
        break;
      case 'playerPassed':
        out.push({ kind: 'passed', playerId: ev.value.playerId, data: {}, importance: 'normal' });
        break;
      case 'endgameTriggered':
        out.push({
          kind: 'endgame',
          playerId: ev.value.playerId,
          data: { turns: ev.value.finalTurnsRemaining },
          importance: 'alert',
        });
        break;
      case 'gameEnded':
        out.push({ kind: 'gameEnded', playerId: null, data: {}, importance: 'alert' });
        break;
      default:
        break; // omit the rest
    }
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `yarn workspace @trm/web test --run logModel`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/web/src/game/logModel.ts apps/web/src/game/logModel.test.ts
git commit -m "Web: pure logModel — GameEvent → log rows with importance"
```

---

## Task 6: Web — log + chat stores

**Files:**
- Create: `apps/web/src/store/log.ts`, `apps/web/src/store/chat.ts`
- Test: `apps/web/src/store/log.test.ts`, `apps/web/src/store/chat.test.ts`

**Interfaces:**
- Consumes: `entriesFromEvents`, `LogEntry` from `../game/logModel`.
- Produces: `useLog` with `entries: LogEntry[]`, `ingestLive(events)`, `ingestHistory(events)`, `reset()`. `useChat` with `messages: ChatMessage[]` (`{ id, playerId, text }`), `ingest({playerId,text})`, `ingestHistory(msgs)`, `reset()`.

- [ ] **Step 1: Write the failing tests.** Create `apps/web/src/store/log.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { create } from '@bufbuild/protobuf';
import { GameEventSchema } from '@trm/proto';
import { useLog } from './log';

const turn = (playerId: string) =>
  create(GameEventSchema, { event: { case: 'turnStarted', value: { playerId, orderIndex: 0 } } });

describe('useLog', () => {
  beforeEach(() => useLog.getState().reset());

  it('appends live events with unique ids', () => {
    useLog.getState().ingestLive([turn('p1')]);
    useLog.getState().ingestLive([turn('p2')]);
    const e = useLog.getState().entries;
    expect(e).toHaveLength(2);
    expect(e[0].id).not.toBe(e[1].id);
    expect(e[1].playerId).toBe('p2');
  });

  it('applies history only when empty (history precedes live)', () => {
    useLog.getState().ingestHistory([turn('p1'), turn('p2')]);
    expect(useLog.getState().entries).toHaveLength(2);
    useLog.getState().ingestHistory([turn('p3')]); // ignored — already populated
    expect(useLog.getState().entries).toHaveLength(2);
  });

  it('reset clears entries', () => {
    useLog.getState().ingestLive([turn('p1')]);
    useLog.getState().reset();
    expect(useLog.getState().entries).toEqual([]);
  });
});
```

Create `apps/web/src/store/chat.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useChat } from './chat';

describe('useChat', () => {
  beforeEach(() => useChat.getState().reset());

  it('appends live messages with ids', () => {
    useChat.getState().ingest({ playerId: 'p1', text: 'hi' });
    useChat.getState().ingest({ playerId: 'p2', text: 'yo' });
    const m = useChat.getState().messages;
    expect(m.map((x) => x.text)).toEqual(['hi', 'yo']);
    expect(m[0].id).not.toBe(m[1].id);
  });

  it('applies history only when empty', () => {
    useChat.getState().ingestHistory([{ playerId: 'p1', text: 'a' }]);
    useChat.getState().ingestHistory([{ playerId: 'p1', text: 'b' }]);
    expect(useChat.getState().messages).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run them to verify they fail.**

Run: `yarn workspace @trm/web test --run store/log store/chat`
Expected: FAIL — cannot find `./log` / `./chat`.

- [ ] **Step 3: Implement the stores.** Create `apps/web/src/store/log.ts`:

```ts
import { create } from 'zustand';
import type { GameEvent } from '@trm/proto';
import { entriesFromEvents, type LogEntry } from '../game/logModel';

const CAP = 1000;

interface LogState {
  entries: LogEntry[];
  nextId: number;
  ingestLive(events: GameEvent[]): void;
  ingestHistory(events: GameEvent[]): void;
  reset(): void;
}

export const useLog = create<LogState>()((set) => ({
  entries: [],
  nextId: 1,
  ingestLive: (events) =>
    set((s) => {
      const datas = entriesFromEvents(events);
      if (datas.length === 0) return s;
      let id = s.nextId;
      const entries = [...s.entries];
      for (const d of datas) entries.push({ id: id++, ...d });
      return { entries: entries.slice(-CAP), nextId: id };
    }),
  // History is a one-shot backfill delivered before live events; ignore if already filled.
  ingestHistory: (events) =>
    set((s) => {
      if (s.entries.length > 0) return s;
      const entries = entriesFromEvents(events).map((d, i) => ({ id: i + 1, ...d }));
      return { entries: entries.slice(-CAP), nextId: entries.length + 1 };
    }),
  reset: () => set({ entries: [], nextId: 1 }),
}));
```

Create `apps/web/src/store/chat.ts`:

```ts
import { create } from 'zustand';

export interface ChatMessage {
  id: number;
  playerId: string;
  text: string;
}

const CAP = 500;

interface ChatState {
  messages: ChatMessage[];
  nextId: number;
  ingest(msg: { playerId: string; text: string }): void;
  ingestHistory(msgs: { playerId: string; text: string }[]): void;
  reset(): void;
}

export const useChat = create<ChatState>()((set) => ({
  messages: [],
  nextId: 1,
  ingest: (msg) =>
    set((s) => ({
      messages: [...s.messages, { id: s.nextId, ...msg }].slice(-CAP),
      nextId: s.nextId + 1,
    })),
  ingestHistory: (msgs) =>
    set((s) => {
      if (s.messages.length > 0) return s;
      const messages = msgs.map((m, i) => ({ id: i + 1, ...m }));
      return { messages: messages.slice(-CAP), nextId: messages.length + 1 };
    }),
  reset: () => set({ messages: [], nextId: 1 }),
}));
```

- [ ] **Step 4: Run the tests to verify they pass.**

Run: `yarn workspace @trm/web test --run store/log store/chat`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/web/src/store/log.ts apps/web/src/store/chat.ts apps/web/src/store/log.test.ts apps/web/src/store/chat.test.ts
git commit -m "Web: log + chat stores (live + one-shot history ingest)"
```

---

## Task 7: Web — socket `onHistory` + connection wiring

**Files:**
- Modify: `apps/web/src/net/socket.ts`, `apps/web/src/net/connection.ts`
- Test: extend `apps/web/src/store/log.test.ts` is NOT needed; covered by a focused socket dispatch test below.
- Test: `apps/web/src/net/socket.test.ts` (create if absent)

**Interfaces:**
- Consumes: the `'history'` oneof (Task 1); `useLog`, `useChat` (Task 6).
- Produces: `SocketHandlers.onHistory?(events: GameEvent[], chat: { playerId: string; text: string }[])`; `connection.ts` resets both stores on connect, feeds the log on `onEvents`, and routes chat/history.

- [ ] **Step 1: Write the failing test.** Create (or append to) `apps/web/src/net/socket.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { create, toBinary } from '@bufbuild/protobuf';
import { ServerEnvelopeSchema } from '@trm/proto';
import { GameSocket } from './socket';

function deliver(socket: GameSocket, env: Parameters<typeof create<typeof ServerEnvelopeSchema>>[1]) {
  // Reach into the private dispatch via the message path.
  (socket as unknown as { dispatch(b: Uint8Array): void }).dispatch(
    toBinary(ServerEnvelopeSchema, create(ServerEnvelopeSchema, env)),
  );
}

describe('GameSocket history dispatch', () => {
  it('routes a HistoryReplay frame to onHistory', () => {
    const onHistory = vi.fn();
    const socket = new GameSocket('tkt', { onHistory }, 'ws://x');
    deliver(socket, {
      serverSeq: 1,
      event: {
        case: 'history',
        value: { stateVersion: 3, events: [], chat: [{ playerId: 'p1', text: 'hi', ts: 5n }] },
      },
    });
    expect(onHistory).toHaveBeenCalledTimes(1);
    expect(onHistory.mock.calls[0][1]).toEqual([{ playerId: 'p1', text: 'hi' }]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `yarn workspace @trm/web test --run net/socket`
Expected: FAIL — `onHistory` never called (no `history` case).

- [ ] **Step 3: Add the handler + dispatch case.** In `apps/web/src/net/socket.ts`:

Add to the `SocketHandlers` interface (after `onChat`):

```ts
  /** One-shot backfill of the action-log history + persisted chat on (re)connect. */
  onHistory?(events: GameEvent[], chat: { playerId: string; text: string }[]): void;
```

Add a case in `dispatch` (after the `'chat'` case):

```ts
      case 'history':
        this.handlers.onHistory?.(
          env.event.value.events,
          env.event.value.chat.map((c) => ({ playerId: c.playerId, text: c.text })),
        );
        break;
```

- [ ] **Step 4: Run the socket test to verify it passes.**

Run: `yarn workspace @trm/web test --run net/socket`
Expected: PASS.

- [ ] **Step 5: Wire `connection.ts`.** Replace `apps/web/src/net/connection.ts` body with:

```ts
import { GameSocket } from './socket';
import { useGame } from '../store/game';
import { useLog } from '../store/log';
import { useChat } from '../store/chat';

// Single live game socket, wired to the game/log/chat stores.
let socket: GameSocket | null = null;

export function connectGame(ticket: string): GameSocket {
  disconnectGame();
  useGame.getState().reset();
  useLog.getState().reset();
  useChat.getState().reset();
  socket = new GameSocket(ticket, {
    onStatus: (status) => useGame.getState().setStatus(status),
    onSnapshot: (snapshot) => useGame.getState().applySnapshot(snapshot),
    onEvents: (version, events) => {
      useGame.getState().applyEvents(version, events);
      useLog.getState().ingestLive(events);
    },
    onRejection: (r) => useGame.getState().setRejection({ code: r.code, messageKey: r.messageKey }),
    onChat: (playerId, text) => useChat.getState().ingest({ playerId, text }),
    onHistory: (events, chat) => {
      useLog.getState().ingestHistory(events);
      useChat.getState().ingestHistory(chat);
    },
    onCameraMoved: (playerId, view) => useGame.getState().applyCameraMoved(playerId, view),
  });
  socket.connect();
  return socket;
}

export const getSocket = (): GameSocket | null => socket;

export function disconnectGame(): void {
  socket?.close();
  socket = null;
}
```

- [ ] **Step 6: Run the web suite to confirm no regressions.**

Run: `yarn workspace @trm/web test --run net store`
Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add apps/web/src/net/socket.ts apps/web/src/net/socket.test.ts apps/web/src/net/connection.ts
git commit -m "Web: route HistoryReplay to onHistory; feed log + reset stores on connect"
```

---

## Task 8: Web — `LogPanel` + log i18n

**Files:**
- Create: `apps/web/src/components/LogPanel.tsx`
- Modify: `apps/web/src/i18n/index.ts`
- Test: `apps/web/src/components/LogPanel.test.tsx`

**Interfaces:**
- Consumes: `useLog`, `useGame`, `useUi`, `usePlayerName`, `SEAT_COLORS`/`CARD_COLOR_TOKENS`, `cityName`/`routeById`, `LogEntry`.
- Produces: `<LogPanel />` — renders the log entries (translated + seat-coloured, importance classes), auto-scrolls to bottom.

- [ ] **Step 1: Add the i18n keys.** In `apps/web/src/i18n/index.ts`, add a `log` block inside **both** `'zh-Hant'.translation` and `en.translation` (place after the `somethingWentWrong` line in each, before the closing brace).

zh-Hant:

```ts
      log: {
        heading: '紀錄',
        empty: '尚無動作',
        gameStarted: '遊戲開始',
        turnStarted: '輪到 {{name}}',
        routeClaimed: '{{name}} 鋪設了 {{route}}（+{{points}}）',
        stationBuilt: '{{name}} 在 {{city}} 建造車站',
        tunnelRevealed: '{{name}} 試掘隧道 {{route}}',
        tunnelCommitted: '{{name}} 完成隧道 {{route}}',
        tunnelAborted: '{{name}} 放棄隧道 {{route}}',
        drewBlind: '{{name}} 從牌堆抽牌',
        tookFaceup: '{{name}} 拿取一張車廂卡',
        ticketsKept: '{{name}} 保留了 {{count}} 張任務卡',
        passed: '{{name}} 跳過',
        endgame: '最終回合：剩 {{turns}} 回合',
        gameEnded: '遊戲結束',
      },
      chat: {
        heading: '聊天',
        empty: '尚無訊息',
        placeholder: '輸入訊息…',
        spectatorDisabled: '觀戰中無法聊天',
        send: '傳送',
        rateLimited: '傳送太快，請稍候…',
      },
      tabRail: '遊戲面板',
      tabComms: '紀錄 · 聊天',
```

en:

```ts
      log: {
        heading: 'Log',
        empty: 'No actions yet',
        gameStarted: 'Game started',
        turnStarted: "{{name}}'s turn",
        routeClaimed: '{{name}} built {{route}} (+{{points}})',
        stationBuilt: '{{name}} built a station at {{city}}',
        tunnelRevealed: '{{name}} probed the tunnel {{route}}',
        tunnelCommitted: '{{name}} completed the tunnel {{route}}',
        tunnelAborted: '{{name}} backed out of the tunnel {{route}}',
        drewBlind: '{{name}} drew from the deck',
        tookFaceup: '{{name}} took a train-car card',
        ticketsKept: '{{name}} kept {{count}} ticket(s)',
        passed: '{{name}} passed',
        endgame: 'Final round — {{turns}} turns left',
        gameEnded: 'Game over',
      },
      chat: {
        heading: 'Chat',
        empty: 'No messages yet',
        placeholder: 'Type a message…',
        spectatorDisabled: "Spectators can't chat",
        send: 'Send',
        rateLimited: 'Slow down a moment…',
      },
      tabRail: 'Game',
      tabComms: 'Log & chat',
```

- [ ] **Step 2: Write the failing test.** Create `apps/web/src/components/LogPanel.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { create } from '@bufbuild/protobuf';
import { GameSnapshotSchema, Phase } from '@trm/proto';
import '../i18n';
import { LogPanel } from './LogPanel';
import { useLog } from '../store/log';
import { useGame } from '../store/game';

beforeEach(() => {
  useLog.getState().reset();
  useGame.setState({
    snapshot: create(GameSnapshotSchema, {
      stateVersion: 1,
      phase: Phase.AWAIT_ACTION,
      currentPlayerId: 'p1',
      turnOrder: ['p1', 'p2'],
      players: [
        { id: 'p1', seat: 0, trainCars: 45, stationsRemaining: 3 },
        { id: 'p2', seat: 1, trainCars: 45, stationsRemaining: 3 },
      ],
    }),
  });
});

describe('LogPanel', () => {
  it('shows the empty state with no entries', () => {
    render(<LogPanel />);
    expect(screen.getByText('尚無動作')).toBeInTheDocument();
  });

  it('renders a highlighted route-claimed line', () => {
    useLog.setState({
      entries: [
        { id: 1, kind: 'routeClaimed', playerId: 'p1', data: { routeId: 'X', points: 7 }, importance: 'highlight' },
      ],
      nextId: 2,
    });
    render(<LogPanel />);
    // P1 fallback name (no roster) + points; importance class present.
    expect(screen.getByText(/P1/)).toBeInTheDocument();
    expect(document.querySelector('.log-line.log-highlight')).not.toBeNull();
  });
});
```

- [ ] **Step 3: Run it to verify it fails.**

Run: `yarn workspace @trm/web test --run LogPanel`
Expected: FAIL — cannot find `./LogPanel`.

- [ ] **Step 4: Implement `LogPanel.tsx`.** Create `apps/web/src/components/LogPanel.tsx`:

```tsx
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { GameSnapshot } from '@trm/proto';
import { useLog } from '../store/log';
import { useGame } from '../store/game';
import { useUi } from '../store/ui';
import { usePlayerName } from '../game/playerName';
import { SEAT_COLORS, CARD_COLOR_TOKENS } from '../theme/colors';
import { cityName, routeById } from '../game/content';
import type { CardColor } from '@trm/shared';
import type { LogEntry } from '../game/logModel';

const seatOf = (snapshot: GameSnapshot | null, playerId: string | null): number | null => {
  if (!snapshot || !playerId) return null;
  return snapshot.players.find((p) => p.id === playerId)?.seat ?? null;
};

export function LogPanel() {
  const { t } = useTranslation();
  const entries = useLog((s) => s.entries);
  const snapshot = useGame((s) => s.snapshot);
  const locale = useUi((s) => s.locale);
  const nameOf = usePlayerName();
  const me = snapshot?.you?.playerId ?? null;
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  const routeName = (id: string): string => {
    const r = routeById.get(id);
    return r ? `${cityName(r.a as string, locale)}–${cityName(r.b as string, locale)}` : id;
  };

  const lineText = (e: LogEntry): string => {
    const seat = seatOf(snapshot, e.playerId);
    const name =
      e.playerId === null ? '' : nameOf({ id: e.playerId, seat: seat ?? 0, isMe: e.playerId === me });
    switch (e.kind) {
      case 'gameStarted':
        return t('log.gameStarted');
      case 'gameEnded':
        return t('log.gameEnded');
      case 'turnStarted':
        return t('log.turnStarted', { name });
      case 'routeClaimed':
        return t('log.routeClaimed', { name, route: routeName(String(e.data.routeId)), points: e.data.points });
      case 'stationBuilt':
        return t('log.stationBuilt', { name, city: cityName(String(e.data.cityId), locale) });
      case 'tunnelRevealed':
        return t('log.tunnelRevealed', { name, route: routeName(String(e.data.routeId)) });
      case 'tunnelCommitted':
        return t('log.tunnelCommitted', { name, route: routeName(String(e.data.routeId)) });
      case 'tunnelAborted':
        return t('log.tunnelAborted', { name, route: routeName(String(e.data.routeId)) });
      case 'drewBlind':
        return t('log.drewBlind', { name });
      case 'tookFaceup':
        return t('log.tookFaceup', { name });
      case 'ticketsKept':
        return t('log.ticketsKept', { name, count: e.data.count });
      case 'passed':
        return t('log.passed', { name });
      case 'endgame':
        return t('log.endgame', { turns: e.data.turns });
    }
  };

  return (
    <section className="log-panel">
      <div className="tray-head">
        <h4>{t('log.heading')}</h4>
      </div>
      <div className="log-list" ref={listRef}>
        {entries.length === 0 ? (
          <p className="log-empty">{t('log.empty')}</p>
        ) : (
          entries.map((e) => {
            const seat = seatOf(snapshot, e.playerId);
            const color = e.data.color as CardColor | null | undefined;
            return (
              <div key={e.id} className={`log-line log-${e.importance}`}>
                {seat !== null && (
                  <span
                    className="log-dot"
                    style={{ background: SEAT_COLORS[seat % 5] ?? '#888' }}
                    aria-hidden
                  />
                )}
                <span className="log-text">{lineText(e)}</span>
                {e.kind === 'tookFaceup' && color && (
                  <span
                    className="log-chip"
                    style={{ background: CARD_COLOR_TOKENS[color].hex }}
                    title={CARD_COLOR_TOKENS[color].nameZh}
                    aria-hidden
                  />
                )}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes.**

Run: `yarn workspace @trm/web test --run LogPanel`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add apps/web/src/components/LogPanel.tsx apps/web/src/components/LogPanel.test.tsx apps/web/src/i18n/index.ts
git commit -m "Web: LogPanel renders seat-coloured, translated action log"
```

---

## Task 9: Web — `ChatPanel` (input, client-side limits)

**Files:**
- Create: `apps/web/src/components/ChatPanel.tsx`
- Test: `apps/web/src/components/ChatPanel.test.tsx`

**Interfaces:**
- Consumes: `useChat`, `useGame`, `getSocket`, `usePlayerName`, `SEAT_COLORS`. i18n `chat.*` (Task 8).
- Produces: `<ChatPanel disabled?: boolean />` — message list + input; trims, enforces `maxLength=2048` and a 5-msg/5s client guard; sends via `getSocket().chat`.

- [ ] **Step 1: Write the failing test.** Create `apps/web/src/components/ChatPanel.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { create } from '@bufbuild/protobuf';
import { GameSnapshotSchema, Phase } from '@trm/proto';
import '../i18n';
import { ChatPanel } from './ChatPanel';
import { useChat } from '../store/chat';
import { useGame } from '../store/game';

const chatSpy = vi.fn();
vi.mock('../net/connection', () => ({ getSocket: () => ({ chat: chatSpy }) }));

beforeEach(() => {
  chatSpy.mockClear();
  useChat.getState().reset();
  useGame.setState({
    snapshot: create(GameSnapshotSchema, {
      stateVersion: 1,
      phase: Phase.AWAIT_ACTION,
      currentPlayerId: 'p1',
      turnOrder: ['p1'],
      players: [{ id: 'p1', seat: 0, trainCars: 45, stationsRemaining: 3 }],
      you: { playerId: 'p1', hand: {}, keptTicketIds: [], pendingOfferTicketIds: [] },
    }),
  });
});

describe('ChatPanel', () => {
  it('sends a trimmed message and clears the input', () => {
    render(<ChatPanel />);
    fireEvent.change(screen.getByPlaceholderText('輸入訊息…'), { target: { value: '  hello  ' } });
    fireEvent.click(screen.getByRole('button', { name: '傳送' }));
    expect(chatSpy).toHaveBeenCalledWith('hello');
    expect((screen.getByPlaceholderText('輸入訊息…') as HTMLInputElement).value).toBe('');
  });

  it('renders received messages', () => {
    useChat.getState().ingest({ playerId: 'p1', text: 'gg' });
    render(<ChatPanel />);
    expect(screen.getByText('gg')).toBeInTheDocument();
  });

  it('disables the input for spectators', () => {
    render(<ChatPanel disabled />);
    expect(screen.getByRole('button', { name: '傳送' })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `yarn workspace @trm/web test --run ChatPanel`
Expected: FAIL — cannot find `./ChatPanel`.

- [ ] **Step 3: Implement `ChatPanel.tsx`.** Create `apps/web/src/components/ChatPanel.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useChat } from '../store/chat';
import { useGame } from '../store/game';
import { getSocket } from '../net/connection';
import { usePlayerName } from '../game/playerName';
import { SEAT_COLORS } from '../theme/colors';

const MAX_LEN = 2048;
const RATE_MAX = 5;
const RATE_WINDOW_MS = 5000;

export function ChatPanel({ disabled = false }: { disabled?: boolean }) {
  const { t } = useTranslation();
  const messages = useChat((s) => s.messages);
  const snapshot = useGame((s) => s.snapshot);
  const nameOf = usePlayerName();
  const me = snapshot?.you?.playerId ?? null;
  const [draft, setDraft] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const sentAt = useRef<number[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const seatOf = (pid: string): number => snapshot?.players.find((p) => p.id === pid)?.seat ?? 0;

  const send = (): void => {
    const text = draft.trim();
    if (!text || disabled) return;
    const now = Date.now();
    sentAt.current = sentAt.current.filter((ts) => now - ts < RATE_WINDOW_MS);
    if (sentAt.current.length >= RATE_MAX) {
      setHint(t('chat.rateLimited'));
      return;
    }
    getSocket()?.chat(text.slice(0, MAX_LEN));
    sentAt.current.push(now);
    setDraft('');
    setHint(null);
  };

  return (
    <section className="chat-panel">
      <div className="tray-head">
        <h4>{t('chat.heading')}</h4>
      </div>
      <div className="chat-messages" ref={listRef}>
        {messages.length === 0 ? (
          <p className="chat-empty">{t('chat.empty')}</p>
        ) : (
          messages.map((m) => (
            <div className="chat-msg" key={m.id}>
              <span className="chat-author" style={{ color: SEAT_COLORS[seatOf(m.playerId) % 5] ?? '#888' }}>
                {nameOf({ id: m.playerId, seat: seatOf(m.playerId), isMe: m.playerId === me })}
              </span>
              <span className="chat-text">{m.text}</span>
            </div>
          ))
        )}
      </div>
      {hint && <p className="chat-hint">{hint}</p>}
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          type="text"
          maxLength={MAX_LEN}
          value={draft}
          disabled={disabled}
          placeholder={disabled ? t('chat.spectatorDisabled') : t('chat.placeholder')}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" disabled={disabled || draft.trim().length === 0}>
          {t('chat.send')}
        </button>
      </form>
    </section>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `yarn workspace @trm/web test --run ChatPanel`
Expected: PASS (all three cases).

- [ ] **Step 5: Commit.**

```bash
git add apps/web/src/components/ChatPanel.tsx apps/web/src/components/ChatPanel.test.tsx
git commit -m "Web: ChatPanel with client-side length + rate guards"
```

---

## Task 10: Web — `CommsPanel`, `useMediaQuery`, GameScreen + CSS

**Files:**
- Create: `apps/web/src/components/CommsPanel.tsx`, `apps/web/src/hooks/useMediaQuery.ts`
- Modify: `apps/web/src/screens/GameScreen.tsx`, `apps/web/src/styles/game.css`
- Test: `apps/web/src/screens/GameScreen.test.tsx` (verify still green)

**Interfaces:**
- Consumes: `LogPanel`, `ChatPanel`, `useMediaQuery`.
- Produces: `<CommsPanel chatDisabled: boolean />` (log over chat); `useMediaQuery(query): boolean`; GameScreen renders the comms region (third column ≥1200px, else a `[Rail | Log+Chat]` tab in the rail slot).

- [ ] **Step 1: Create `useMediaQuery.ts`.** Create `apps/web/src/hooks/useMediaQuery.ts`:

```ts
import { useEffect, useState } from 'react';

/** Reactive matchMedia. Returns false where matchMedia is unavailable (jsdom/SSR). */
export function useMediaQuery(query: string): boolean {
  const read = (): boolean =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false;
  const [matches, setMatches] = useState(read);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const onChange = (): void => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}
```

- [ ] **Step 2: Create `CommsPanel.tsx`.** Create `apps/web/src/components/CommsPanel.tsx`:

```tsx
import { LogPanel } from './LogPanel';
import { ChatPanel } from './ChatPanel';

/** The comms column content: action log on top, chat docked below. */
export function CommsPanel({ chatDisabled }: { chatDisabled: boolean }) {
  return (
    <div className="comms">
      <LogPanel />
      <ChatPanel disabled={chatDisabled} />
    </div>
  );
}
```

- [ ] **Step 3: Integrate into `GameScreen.tsx`.**

3a. Add imports (after the existing component imports, near line 33):

```ts
import { CommsPanel } from '../components/CommsPanel';
import { useMediaQuery } from '../hooks/useMediaQuery';
```

3b. Add hooks state inside the component (after `const goHome = useUi(...)`, near line 51):

```ts
  const wide = useMediaQuery('(min-width: 1200px)');
  const [commsTab, setCommsTab] = useState<'rail' | 'comms'>('rail');
```

(`useState` is already imported.)

3c. Replace the entire `return ( ... )` block (lines ~255–324, from `return (` to the final `);`) with:

```tsx
  const railInner = needKeep ? (
    <TicketChooser
      offered={snapshot.you?.pendingOfferTicketIds ?? []}
      minKeep={phase === Phase.SETUP_TICKETS ? 2 : 1}
      lockLong={phase === Phase.SETUP_TICKETS}
      hand={snapshot.you?.hand}
      handCount={myPub?.handCount ?? 0}
      keptTicketIds={snapshot.you?.keptTicketIds ?? []}
      completedIds={me ? completedByPlayer(snapshot).get(me) : undefined}
      onConfirm={confirmKeep}
    />
  ) : boardLayout === 'rail' ? (
    <>
      {trackers}
      {market}
      {handSection}
      {ticketsSection}
    </>
  ) : (
    <>
      {trackers}
      {market}
      {ticketsSection}
    </>
  );
  const showHandStrip = !needKeep && boardLayout === 'tray';
  const comms = <CommsPanel chatDisabled={isSpectator} />;

  return (
    <div className={`game game--${boardLayout}`} data-comms-tab={commsTab}>
      {isSpectator && (
        <div className="spectator-banner" role="status">
          <strong>{t('spectating')}</strong> — {t('spectatingHint')}
        </div>
      )}
      {boardPanel}
      {wide ? (
        <>
          <aside className="game-rail">{railInner}</aside>
          {showHandStrip && <div className="game-hand-strip">{handSection}</div>}
          <aside className="game-comms">{comms}</aside>
        </>
      ) : (
        <>
          <aside className="game-rail">
            <div className="comms-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={commsTab === 'rail'}
                className={commsTab === 'rail' ? 'active' : ''}
                onClick={() => setCommsTab('rail')}
              >
                {t('tabRail')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={commsTab === 'comms'}
                className={commsTab === 'comms' ? 'active' : ''}
                onClick={() => setCommsTab('comms')}
              >
                {t('tabComms')}
              </button>
            </div>
            {commsTab === 'rail' ? railInner : comms}
          </aside>
          {showHandStrip && commsTab === 'rail' && (
            <div className="game-hand-strip">{handSection}</div>
          )}
        </>
      )}

      {claim && (
        <PaymentModal
          title={claim.kind === 'route' ? t('claimRoute') : t('buildStation')}
          options={claim.payments}
          onPick={confirmPayment}
          onCancel={() => setClaim(null)}
        />
      )}
      {tunnelMine && snapshot.pendingTunnel && (
        <TunnelModal
          revealed={snapshot.pendingTunnel.revealed}
          extraRequired={snapshot.pendingTunnel.extraRequired}
          options={tunnelExtras}
          onCommit={(p) => {
            socket?.resolveTunnel(true, paymentToProto(p));
            setTunnelBase(null);
          }}
          onAbort={() => {
            socket?.resolveTunnel(false);
            setTunnelBase(null);
          }}
        />
      )}
      {phase === Phase.GAME_OVER && <ScoreBoard snapshot={snapshot} onLeave={leave} />}
      <Toast message={notice} variant="toast-notice" />
      <Toast message={rejection ? t('actionRejected') : null} />
      <AnimationLayer />
    </div>
  );
```

- [ ] **Step 4: Add the CSS.** In `apps/web/src/styles/game.css`:

4a. Add `--tr-comms-w` to the `.game` rule (after `--tr-rail-w: 340px;`):

```css
  --tr-comms-w: 320px;
```

4b. Add the three-column templates + comms styles. Insert after the `.game-hand-strip` rule (around line 59):

```css
/* ≥1200px: a third column for the log+chat sits beside the rail. Below this width the
   comms content shares the rail slot behind a [Rail | Log+Chat] tab (rendered in JSX). */
@media (min-width: 1200px) {
  .game--rail {
    grid-template-columns: minmax(0, 1fr) var(--tr-rail-w) var(--tr-comms-w);
    grid-template-areas: 'board rail comms';
  }
  .game--tray {
    grid-template-columns: minmax(0, 1fr) var(--tr-rail-w) var(--tr-comms-w);
    grid-template-areas:
      'board rail comms'
      'hand  hand hand';
  }
}
.game-comms {
  grid-area: comms;
  min-width: 0;
  min-height: 0;
  display: flex;
}
.comms {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--tr-space-3);
  background: var(--tr-surface);
  border: 1px solid var(--tr-line);
  border-radius: var(--tr-radius);
  overflow: hidden;
}
.comms .log-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: var(--tr-space-3) var(--tr-space-3) 0;
}
.log-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  scrollbar-width: thin;
  scrollbar-color: var(--tr-line) transparent;
}
.log-empty,
.chat-empty {
  color: var(--tr-ink-soft);
  font-size: 0.85em;
  padding: var(--tr-space-2);
}
.log-line {
  display: flex;
  align-items: baseline;
  gap: var(--tr-space-2);
  padding: 3px var(--tr-space-2);
  border-radius: var(--tr-radius-sm);
  font-size: 0.82rem;
  line-height: 1.3;
}
.log-line .log-dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 999px;
  align-self: center;
}
.log-line .log-text {
  min-width: 0;
}
.log-chip {
  flex: none;
  width: 12px;
  height: 12px;
  border-radius: 3px;
  border: 1px solid rgba(0, 0, 0, 0.2);
  align-self: center;
}
/* Important actions stand out; alerts (endgame / game over) read as a warm warning. */
.log-line.log-highlight {
  background: color-mix(in srgb, var(--tr-ink) 5%, transparent);
  font-weight: 600;
}
.log-line.log-alert {
  background: color-mix(in srgb, var(--tr-ember) 12%, transparent);
  font-weight: 700;
}
.chat-panel {
  flex: none;
  display: flex;
  flex-direction: column;
  max-height: 45%;
  border-top: 1px solid var(--tr-line);
  padding: var(--tr-space-2) var(--tr-space-3) var(--tr-space-3);
  gap: var(--tr-space-2);
}
.chat-messages {
  flex: 1;
  min-height: 4rem;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 3px;
  scrollbar-width: thin;
  scrollbar-color: var(--tr-line) transparent;
}
.chat-msg {
  font-size: 0.82rem;
  line-height: 1.3;
  word-break: break-word;
}
.chat-msg .chat-author {
  font-weight: 700;
  margin-right: 6px;
}
.chat-hint {
  margin: 0;
  font-size: 0.75rem;
  color: var(--tr-ember);
}
.chat-input {
  display: flex;
  gap: var(--tr-space-2);
}
.chat-input input {
  flex: 1;
  min-width: 0;
}
/* The [Rail | Log+Chat] tab bar, shown only below the three-column breakpoint. */
.comms-tabs {
  display: flex;
  gap: var(--tr-space-2);
  margin-bottom: var(--tr-space-3);
}
.comms-tabs button {
  flex: 1;
  background: var(--tr-surface-2);
  border: 1px solid var(--tr-line);
}
.comms-tabs button.active {
  background: var(--tr-ember);
  border-color: var(--tr-ember);
  color: #fff;
}
```

- [ ] **Step 5: Verify the existing GameScreen test still passes.**

Run: `yarn workspace @trm/web test --run GameScreen`
Expected: PASS — the spectator banner + disabled `跳過`/`抽任務卡` buttons still render (jsdom → `wide=false`, default tab `rail`, so `railInner` with the market actions renders).

- [ ] **Step 6: Run the full web suite + typecheck + lint.**

Run: `yarn workspace @trm/web test`
Run: `yarn typecheck`
Run: `yarn lint`
Expected: all PASS.

- [ ] **Step 7: Commit.**

```bash
git add apps/web/src/components/CommsPanel.tsx apps/web/src/hooks/useMediaQuery.ts apps/web/src/screens/GameScreen.tsx apps/web/src/styles/game.css
git commit -m "Web: comms column (log over chat) with responsive Rail/Log+Chat tabs"
```

---

## Task 11: Whole-stack verification

**Files:** none (verification only).

- [ ] **Step 1: Full build + checks across the monorepo.**

Run: `yarn build`
Run: `yarn typecheck`
Run: `yarn lint`
Run: `yarn test`
Expected: all PASS (proto codegen runs first via turbo; server + web suites green, including `wire-game.e2e` leak test and `persistence`).

- [ ] **Step 2: Manual smoke test.**

```bash
docker compose up -d mongo
yarn workspace @trm/server dev
yarn workspace @trm/web dev
```

Verify against a game with bots:
- The log fills with seat-coloured lines; route/station/tunnel-commit are highlighted; endgame + game-over read as alerts; market refills/reshuffles are absent.
- Send chat; both members see it. Paste >2048 chars → blocked by the input; fire 6 messages fast → the 6th shows the rate hint.
- Reconnect mid-game (kill the web tab, reopen): the log **and** chat backfill fully with **no** replayed fly-card animations or sounds.
- Resize across 1200px and 920px: three columns → `[Rail | Log+Chat]` tabs → single scrolling column.
- Open as a spectator: the log shows public actions; the chat input is disabled.

- [ ] **Step 3: Final commit (if any manual-fix tweaks were needed).**

```bash
git add -A
git commit -m "Chore: log + chat panel verification tweaks"
```

---

## Self-Review

**Spec coverage:** backfill log (Tasks 2, 4) ✓; backfill chat (Tasks 3, 4) ✓; members-only chat / spectator public log (Task 4 `onChat` seat guard + `sendHistory` viewer=null) ✓; 2048 + rate limit, server-authoritative (Task 4) + client UX (Task 9) ✓; log-only history (Task 7 routes `onHistory` away from `applyEvents`) ✓; importance colouring (Tasks 5, 8) ✓; three-column / tabbed / single-column responsive (Task 10) ✓; i18n zh-Hant + en (Task 8) ✓; redaction reuse + leak test green (Task 4 Step 7) ✓.

**Deviations (documented above):** reuse `RATE_LIMITED`/`MALFORMED` instead of a new `CHAT_REJECTED`; client mirrors limits for inline feedback (no global-toast change); blind draws logged without colour.

**Type consistency:** `LogDatum`/`LogEntry`/`entriesFromEvents` (Task 5) are consumed unchanged in Tasks 6 + 8; `ChatEntry` (server, Task 3) vs proto `ChatEntry` (Task 1) are intentionally distinct (server uses `ts: number`, the frame builder converts to `BigInt`); `onHistory(events, chat)` signature matches between `socket.ts` (Task 7) and `connection.ts` (Task 7); `sendHistory(viewer)`/`historyReplayFrame(events, chat, stateVersion)` align between Task 4 hub + Task 4 frame builder.
