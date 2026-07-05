# Preset (prebuilt) Chat Messages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let players send canned "preset" chat messages (e.g. "Good luck, have fun!") in the pre-game lobby and in-game, carried over the wire as a semantic id and translated into each viewer's own display language at render time — never as pre-formatted text.

**Architecture:** The wire (both the in-game protobuf `Chat`/`ChatBroadcast`/`ChatEntry` messages and the REST `RoomView`) carries only `{ presetId }` for a preset message; every client resolves `chat.presets.<ID>` through its own i18n at render. A single catalog of ids lives in `@trm/shared` and is imported everywhere else — server (validation), web (buttons + i18n), admin (i18n + moderation marking). In-game chat gains a second `oneof` arm alongside the existing free-text path; lobby chat is new and rides the lobby's existing 2-second REST poll, no new transport.

**Tech Stack:** TypeScript, NestJS + MongoDB (server), React + Vite + zustand + react-i18next (web/admin), protobuf-es via buf (`@trm/proto`), Vitest + Testing Library + supertest + mongodb-memory-server.

## Global Constraints

- The preset catalog is exactly these 12 ids, in this order:
  `GREETING`, `GOOD_LUCK`, `THANKS`, `SORRY`, `ONE_MOMENT`, `NICE_MOVE`, `WELL_PLAYED`, `GOOD_GAME`, `LETS_GO`, `STILL_THERE`, `YES`, `NO`.
- The catalog is defined once in `@trm/shared` and imported everywhere — never re-enumerated.
- Free-text chat is unchanged in behavior; presets are a sibling on the same channel, not a replacement.
- Eligibility mirrors the existing chat rule: seated members only (in-game: `seat >= 0`; lobby: any room member) — never spectators.
- No visual marking of presets in the players' own chat UI. Admin dashboard is the only surface that translates + marks presets distinctly from free text.
- `PROTOCOL_VERSION` bumps 4→5 (wrapping existing wire fields into a `oneof` — this is wire-compatible, no field renumbering).
- Rate limits: `CHAT_RATE_MAX = 5` per `CHAT_RATE_WINDOW_MS = 5000` ms, shared by text and preset sends, both in-game (per-connection) and lobby (derived from the persisted array).
- Every workspace touched must pass its own `typecheck`/`lint`/`test` before the task's commit.

---

## Task 1: `@trm/shared` — the preset catalog

**Files:**

- Create: `packages/shared/src/chat-presets.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/test/chat-presets.spec.ts`

**Interfaces:**

- Produces: `CHAT_PRESET_IDS: readonly string[]` (12-element const tuple), `type ChatPresetId`, `isChatPresetId(v: string): v is ChatPresetId` — imported by every later task in this plan.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/test/chat-presets.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { CHAT_PRESET_IDS, isChatPresetId } from '../src/chat-presets';

describe('chat presets', () => {
  it('has exactly the 12 curated ids, in order', () => {
    expect(CHAT_PRESET_IDS).toEqual([
      'GREETING',
      'GOOD_LUCK',
      'THANKS',
      'SORRY',
      'ONE_MOMENT',
      'NICE_MOVE',
      'WELL_PLAYED',
      'GOOD_GAME',
      'LETS_GO',
      'STILL_THERE',
      'YES',
      'NO',
    ]);
  });

  it('isChatPresetId accepts every catalog id and rejects anything else', () => {
    for (const id of CHAT_PRESET_IDS) expect(isChatPresetId(id)).toBe(true);
    expect(isChatPresetId('NOT_A_PRESET')).toBe(false);
    expect(isChatPresetId('')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/shared test --run chat-presets`
Expected: FAIL — `Cannot find module '../src/chat-presets'`

- [ ] **Step 3: Write the implementation**

Create `packages/shared/src/chat-presets.ts`:

```ts
// Canonical catalog of preset ("canned") chat messages. The wire (in-game proto and the lobby
// REST RoomView) carries only the id; every client resolves `chat.presets.<ID>` through its own
// i18n at render, so the same message reads correctly regardless of the viewer's locale.
export const CHAT_PRESET_IDS = [
  'GREETING',
  'GOOD_LUCK',
  'THANKS',
  'SORRY',
  'ONE_MOMENT',
  'NICE_MOVE',
  'WELL_PLAYED',
  'GOOD_GAME',
  'LETS_GO',
  'STILL_THERE',
  'YES',
  'NO',
] as const;

export type ChatPresetId = (typeof CHAT_PRESET_IDS)[number];

export const isChatPresetId = (v: string): v is ChatPresetId =>
  (CHAT_PRESET_IDS as readonly string[]).includes(v);
```

- [ ] **Step 4: Export it from the package**

Modify `packages/shared/src/index.ts` — add one line (keep alphabetically-loose, appended like the rest):

```ts
export * from './enums';
export * from './constants';
export * from './ids';
export * from './rng';
export * from './digest';
export * from './result';
export * from './errors';
export * from './roomCode';
export * from './dashboard';
export * from './features';
export * from './ws';
export * from './chat-presets';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `yarn workspace @trm/shared test --run chat-presets`
Expected: PASS (2 tests)

- [ ] **Step 6: Typecheck + lint the workspace**

Run: `yarn workspace @trm/shared typecheck && yarn workspace @trm/shared lint`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/chat-presets.ts packages/shared/src/index.ts packages/shared/test/chat-presets.spec.ts
git commit -m "feat(shared): add the preset chat message catalog"
```

---

## Task 2: `@trm/proto` — wire schema for preset chat

**Files:**

- Modify: `packages/proto/proto/trmission/v1/client.proto`
- Modify: `packages/proto/proto/trmission/v1/server.proto`
- Modify: `packages/proto/src/index.ts`
- Modify: `packages/proto/test/proto.spec.ts`

**Interfaces:**

- Consumes: nothing from Task 1 (proto is dependency-free of `@trm/shared`).
- Produces: `Chat.content` oneof (`'text' | 'presetId'`), `ChatBroadcast.content` oneof, `ChatEntry.content` oneof — all with the same two-case shape `{ case: 'text', value: string } | { case: 'presetId', value: string }`. `PROTOCOL_VERSION = 5`. Consumed by Task 3 (`@trm/codec`) and Task 5 (`hub.ts`).

- [ ] **Step 1: Edit `client.proto`'s `Chat` message**

In `packages/proto/proto/trmission/v1/client.proto`, replace:

```proto
message Chat {
  string text = 1;
}
```

with:

```proto
message Chat {
  oneof content {
    string text = 1;
    string preset_id = 2;
  }
}
```

- [ ] **Step 2: Edit `server.proto`'s `ChatBroadcast` and `ChatEntry` messages**

In `packages/proto/proto/trmission/v1/server.proto`, replace:

```proto
message ChatBroadcast {
  string player_id = 1;
  string text = 2;
}

// One persisted chat line, replayed in a HistoryReplay on (re)connect.
message ChatEntry {
  string player_id = 1;
  string text = 2;
  int64 ts = 3;
}
```

with:

```proto
message ChatBroadcast {
  string player_id = 1;
  oneof content {
    string text = 2;
    string preset_id = 3;
  }
}

// One persisted chat line, replayed in a HistoryReplay on (re)connect.
message ChatEntry {
  string player_id = 1;
  oneof content {
    string text = 2;
    string preset_id = 4; // next free field number — ts already occupies 3
  }
  int64 ts = 3;
}
```

- [ ] **Step 3: Regenerate the TypeScript bindings**

Run: `yarn workspace @trm/proto generate`
Expected: regenerates `packages/proto/src/gen/` (gitignored) with no errors.

- [ ] **Step 4: Bump `PROTOCOL_VERSION` with an extended history comment**

Modify `packages/proto/src/index.ts` — replace:

```ts
// v3: random-events wire shape — GameSettings.events_mode, GameSnapshot.random_events, and the
// four RandomEvent* GameEvent oneof cases (M4).
// v4: TicketCompleted GameEvent oneof case (own-track ticket completion, now announced in every
// game — see ENGINE_VERSION v7 in @trm/engine).
export const PROTOCOL_VERSION = 4;
```

with:

```ts
// v3: random-events wire shape — GameSettings.events_mode, GameSnapshot.random_events, and the
// four RandomEvent* GameEvent oneof cases (M4).
// v4: TicketCompleted GameEvent oneof case (own-track ticket completion, now announced in every
// game — see ENGINE_VERSION v7 in @trm/engine).
// v5: preset_id oneof case on Chat/ChatBroadcast/ChatEntry — canned, per-locale-translated chat
// messages alongside free text (@trm/shared's chat-presets catalog).
export const PROTOCOL_VERSION = 5;
```

- [ ] **Step 5: Write the failing round-trip test**

In `packages/proto/test/proto.spec.ts`, add a new `it` inside the existing `describe('@trm/proto wire round-trip', ...)` block, right after the `'round-trips a HistoryReplay envelope with chat entries'` test:

```ts
it('round-trips a preset chat message on Chat, ChatBroadcast, and ChatEntry', () => {
  const clientEnv = create(ClientEnvelopeSchema, {
    clientSeq: 4,
    command: { case: 'chat', value: { content: { case: 'presetId', value: 'GOOD_LUCK' } } },
  });
  const clientBack = fromBinary(ClientEnvelopeSchema, toBinary(ClientEnvelopeSchema, clientEnv));
  expect(clientBack.command.case).toBe('chat');
  if (clientBack.command.case !== 'chat') throw new Error('wrong case');
  expect(clientBack.command.value.content.case).toBe('presetId');
  expect(clientBack.command.value.content.value).toBe('GOOD_LUCK');

  const broadcastEnv = create(ServerEnvelopeSchema, {
    serverSeq: 5,
    event: {
      case: 'chat',
      value: { playerId: 'p1', content: { case: 'presetId', value: 'THANKS' } },
    },
  });
  const broadcastBack = fromBinary(
    ServerEnvelopeSchema,
    toBinary(ServerEnvelopeSchema, broadcastEnv),
  );
  expect(broadcastBack.event.case).toBe('chat');
  if (broadcastBack.event.case !== 'chat') throw new Error('wrong case');
  expect(broadcastBack.event.value.content.case).toBe('presetId');
  expect(broadcastBack.event.value.content.value).toBe('THANKS');

  const historyEnv = create(ServerEnvelopeSchema, {
    serverSeq: 6,
    event: {
      case: 'history',
      value: {
        stateVersion: 1,
        events: [],
        chat: [
          { playerId: 'p2', ts: 1719600000000n, content: { case: 'presetId', value: 'GOOD_GAME' } },
        ],
      },
    },
  });
  const historyBack = fromBinary(ServerEnvelopeSchema, toBinary(ServerEnvelopeSchema, historyEnv));
  expect(historyBack.event.case).toBe('history');
  if (historyBack.event.case !== 'history') throw new Error('wrong case');
  expect(historyBack.event.value.chat[0]?.content.case).toBe('presetId');
  expect(historyBack.event.value.chat[0]?.content.value).toBe('GOOD_GAME');
});
```

- [ ] **Step 6: Run the test to verify it fails, then update the existing chat test's shape**

Run: `yarn workspace @trm/proto test`
Expected: FAIL — the new test fails to compile/run because the existing `'round-trips a HistoryReplay envelope with chat entries'` test still uses the old flat `text` field shape (`chat: [{ playerId: 'p2', text: 'hello', ts: ... }]`), which no longer matches the regenerated `ChatEntry` type.

Fix that existing test in the same file — replace:

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

with:

```ts
it('round-trips a HistoryReplay envelope with chat entries', () => {
  const env = create(ServerEnvelopeSchema, {
    serverSeq: 3,
    event: {
      case: 'history',
      value: {
        stateVersion: 12,
        events: [],
        chat: [{ playerId: 'p2', ts: 1719600000000n, content: { case: 'text', value: 'hello' } }],
      },
    },
  });
  const back = fromBinary(ServerEnvelopeSchema, toBinary(ServerEnvelopeSchema, env));
  expect(back.event.case).toBe('history');
  if (back.event.case !== 'history') throw new Error('wrong case');
  expect(back.event.value.stateVersion).toBe(12);
  expect(back.event.value.chat[0]?.content.case).toBe('text');
  expect(back.event.value.chat[0]?.content.value).toBe('hello');
  expect(back.event.value.chat[0]?.ts).toBe(1719600000000n);
});
```

- [ ] **Step 7: Run the full proto test suite to verify it passes**

Run: `yarn workspace @trm/proto test`
Expected: PASS (all tests, including both chat tests)

- [ ] **Step 8: Lint the proto sources**

Run: `yarn workspace @trm/proto lint:proto`
Expected: no errors

- [ ] **Step 9: Commit**

Note: `packages/proto/src/gen/` is gitignored — only the source `.proto` files, `index.ts`, and the test file are committed.

```bash
git add packages/proto/proto/trmission/v1/client.proto packages/proto/proto/trmission/v1/server.proto packages/proto/src/index.ts packages/proto/test/proto.spec.ts
git commit -m "feat(proto): add a preset_id oneof case to Chat/ChatBroadcast/ChatEntry"
```

---

## Task 3: `@trm/codec` — widen the chat frame builders

**Files:**

- Modify: `packages/codec/src/frames.ts`

**Interfaces:**

- Consumes: `ChatBroadcastSchema`, `ChatEntrySchema` from `@trm/proto` (Task 2).
- Produces: `chatFrame(playerId, content)`, `historyReplayFrame(events, chat, stateVersion)` where `content`/each `chat[].content` is `{ case: 'text'; value: string } | { case: 'presetId'; value: string }`. Consumed by Task 5 (`hub.ts`).

This task has no dedicated unit test today (these are simple, framework-free builders with no existing test file of their own — the existing `packages/codec/test/codec.spec.ts` does not cover `frames.ts`); its behavior is exercised end-to-end by Task 5's `history-chat.e2e.spec.ts`. Verification here is typecheck + the existing suite staying green.

- [ ] **Step 1: Widen the imports and add the shared `ChatContent` type alias**

In `packages/codec/src/frames.ts`, replace the import block:

```ts
import type { MessageInitShape } from '@bufbuild/protobuf';
import type {
  GameSnapshot,
  GameEvent as PbGameEvent,
  CameraView,
  RejectionCode,
  ServerEnvelopeSchema,
} from '@trm/proto';
import { PROTOCOL_VERSION } from '@trm/proto';

export type ServerEvent = NonNullable<MessageInitShape<typeof ServerEnvelopeSchema>['event']>;
```

with:

```ts
import type { MessageInitShape } from '@bufbuild/protobuf';
import type {
  GameSnapshot,
  GameEvent as PbGameEvent,
  CameraView,
  RejectionCode,
  ServerEnvelopeSchema,
  ChatBroadcastSchema,
} from '@trm/proto';
import { PROTOCOL_VERSION } from '@trm/proto';

export type ServerEvent = NonNullable<MessageInitShape<typeof ServerEnvelopeSchema>['event']>;
/** Either free text or a preset id — the same discriminated shape ChatBroadcast/ChatEntry carry. */
export type ChatContent = NonNullable<MessageInitShape<typeof ChatBroadcastSchema>['content']>;
```

- [ ] **Step 2: Widen `chatFrame`**

Replace:

```ts
export const chatFrame = (playerId: string, text: string): ServerEvent => ({
  case: 'chat',
  value: { playerId, text },
});
```

with:

```ts
export const chatFrame = (playerId: string, content: ChatContent): ServerEvent => ({
  case: 'chat',
  value: { playerId, content },
});
```

- [ ] **Step 3: Widen `historyReplayFrame`**

Replace:

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

with:

```ts
// One-shot backfill of the game's event history (already redacted) + persisted chat,
// sent after the snapshot on (re)connect. The client routes this to the log/chat only.
export const historyReplayFrame = (
  events: PbGameEvent[],
  chat: readonly { playerId: string; content: ChatContent; ts: number }[],
  stateVersion: number,
): ServerEvent => ({
  case: 'history',
  value: {
    events,
    chat: chat.map((c) => ({ playerId: c.playerId, content: c.content, ts: BigInt(c.ts) })),
    stateVersion,
  },
});
```

- [ ] **Step 4: Typecheck and run the existing suite**

Run: `yarn workspace @trm/codec typecheck && yarn workspace @trm/codec test`
Expected: PASS — no existing test references the old `text` field on these two builders, so nothing breaks; this only compiles cleanly because `ChatContent`'s shape is structurally what `chatFrame`/`historyReplayFrame`'s callers (Task 5) will now provide.

- [ ] **Step 5: Commit**

```bash
git add packages/codec/src/frames.ts
git commit -m "feat(codec): widen chatFrame/historyReplayFrame to carry preset or free-text content"
```

---

## Task 4: Server persistence — widen the chat store

**Files:**

- Modify: `apps/server/src/persistence/types.ts`
- Modify: `apps/server/src/persistence/game-store.ts`
- Test: `apps/server/test/chat-store.spec.ts`

**Interfaces:**

- Consumes: nothing new (no import of `@trm/shared`'s catalog here — persistence trusts its caller already validated the id; see Task 5).
- Produces: `ChatContent` type (`{ case: 'text'; value: string } | { case: 'presetId'; value: string }`), `GameChatDoc.content`, `ChatEntry.content`, `GameStorePort.appendChat(gameId, seq, playerId, content: ChatContent)`, `loadChat(gameId): Promise<ChatEntry[]>`. Consumed by Task 5 (`hub.ts`) and Task 11 (admin's `dashboard-games.service.ts`, which reads `GameChatDoc` directly).

- [ ] **Step 1: Widen the persistence types**

In `apps/server/src/persistence/types.ts`, replace:

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

with:

```ts
/** Either free-typed text or a validated preset id — the same discriminated shape the wire uses. */
export type ChatContent = { case: 'text'; value: string } | { case: 'presetId'; value: string };

/** A persisted chat line. Chat is non-authoritative (outside the engine/digest). */
export interface GameChatDoc {
  gameId: string;
  seq: number;
  playerId: string;
  content: ChatContent;
  ts: Date;
}

/** In-memory chat line (the hub keeps these per game and replays them on connect). */
export interface ChatEntry {
  playerId: string;
  content: ChatContent;
  ts: number;
}
```

Then update the `GameStorePort` interface in the same file — replace:

```ts
  appendChat(gameId: string, seq: number, playerId: string, text: string): Promise<void>;
  loadChat(gameId: string): Promise<ChatEntry[]>;
```

with:

```ts
  appendChat(gameId: string, seq: number, playerId: string, content: ChatContent): Promise<void>;
  loadChat(gameId: string): Promise<ChatEntry[]>;
```

- [ ] **Step 2: Write the failing test for the widened shape**

In `apps/server/test/chat-store.spec.ts`, replace the whole `describe('chat persistence', ...)` block:

```ts
describe('chat persistence', () => {
  it('appends and loads chat entries in order', async () => {
    await store.appendChat('cg', 0, 'p1', { case: 'text', value: 'first' });
    await store.appendChat('cg', 1, 'p2', { case: 'text', value: 'second' });
    const out = await store.loadChat('cg');
    expect(out.map((c) => c.content)).toEqual([
      { case: 'text', value: 'first' },
      { case: 'text', value: 'second' },
    ]);
    expect(out[0]?.playerId).toBe('p1');
    expect(typeof out[0]?.ts).toBe('number');
  });

  it('keeps games isolated and rejects duplicate (gameId, seq)', async () => {
    await store.appendChat('cg2', 0, 'p1', { case: 'text', value: 'x' });
    expect(await store.loadChat('cg2')).toHaveLength(1);
    await expect(
      store.appendChat('cg2', 0, 'p1', { case: 'text', value: 'dup' }),
    ).rejects.toBeTruthy();
  });

  it('persists a preset chat entry distinctly from free text', async () => {
    await store.appendChat('cg3', 0, 'p1', { case: 'text', value: 'hi' });
    await store.appendChat('cg3', 1, 'p2', { case: 'presetId', value: 'GOOD_LUCK' });
    const out = await store.loadChat('cg3');
    expect(out[0]?.content).toEqual({ case: 'text', value: 'hi' });
    expect(out[1]?.content).toEqual({ case: 'presetId', value: 'GOOD_LUCK' });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `yarn workspace @trm/server test --run chat-store`
Expected: FAIL — `MongoGameStore.appendChat` still has the old `(gameId, seq, playerId, text: string)` signature and writes a flat `text` field.

- [ ] **Step 4: Update `MongoGameStore`'s implementation**

In `apps/server/src/persistence/game-store.ts`, replace:

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

with:

```ts
  async appendChat(
    gameId: string,
    seq: number,
    playerId: string,
    content: ChatContent,
  ): Promise<void> {
    await this.chats.insertOne(
      { gameId, seq, playerId, content, ts: new Date() },
      { writeConcern: { w: 'majority' } },
    );
  }

  async loadChat(gameId: string): Promise<ChatEntry[]> {
    const docs = await this.chats.find({ gameId }).sort({ seq: 1 }).toArray();
    return docs.map((d) => ({ playerId: d.playerId, content: d.content, ts: d.ts.getTime() }));
  }
```

Also widen the file's import from `./types` to bring in `ChatContent`. Replace:

```ts
import {
  configToStored,
  storedToConfig,
  type GameStorePort,
  type RecoveryData,
  type GameDoc,
  type GameEventDoc,
  type GameSnapshotDoc,
  type MatchHistoryDoc,
  type GameChatDoc,
  type ChatEntry,
} from './types';
```

with:

```ts
import {
  configToStored,
  storedToConfig,
  type GameStorePort,
  type RecoveryData,
  type GameDoc,
  type GameEventDoc,
  type GameSnapshotDoc,
  type MatchHistoryDoc,
  type GameChatDoc,
  type ChatEntry,
  type ChatContent,
} from './types';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `yarn workspace @trm/server test --run chat-store`
Expected: PASS (3 tests)

- [ ] **Step 6: Typecheck the workspace**

Run: `yarn workspace @trm/server typecheck`
Expected: no errors (this also confirms `FlakyStore` in `apps/server/test/bot-driver-resilience.e2e.spec.ts` still satisfies `GameStorePort` — its `appendChat()`/`loadChat()` stubs take no parameters, which remains a valid implementation of a 4-parameter interface method in TypeScript's structural typing; no edit needed there).

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/persistence/types.ts apps/server/src/persistence/game-store.ts apps/server/test/chat-store.spec.ts
git commit -m "feat(server): widen persisted chat entries to carry preset or free-text content"
```

---

## Task 5: Server `hub.ts` — accept and broadcast preset chat

**Files:**

- Modify: `apps/server/src/ws/hub.ts`
- Test: `apps/server/test/history-chat.e2e.spec.ts`

**Interfaces:**

- Consumes: `isChatPresetId` from `@trm/shared` (Task 1), `Chat` type from `@trm/proto` (Task 2), `chatFrame`/`historyReplayFrame` from `@trm/codec` (Task 3), `ChatContent`/`ChatEntry` from `../persistence/types` (Task 4).
- Produces: `onChat` now branches on `content.case` and rejects an unrecognized preset with `errors:chatInvalidPreset`. No new public interface — this is the terminal server-side consumer for this feature's in-game path.

- [ ] **Step 1: Update the dispatch site**

In `apps/server/src/ws/hub.ts`, in the `receive()` method's `switch (cmd.case)`, replace:

```ts
      case 'chat':
        await this.onChat(conn, env.clientSeq, cmd.value.text);
        return;
```

with:

```ts
      case 'chat':
        await this.onChat(conn, env.clientSeq, cmd.value.content);
        return;
```

- [ ] **Step 2: Import the new types**

Add `Chat` to the existing `@trm/proto` type import, and `isChatPresetId` from `@trm/shared`. Replace:

```ts
import {
  ClientEnvelopeSchema,
  RejectionCode,
  type ClientEnvelope,
  type GameEvent as PbGameEvent,
  type CameraView,
} from '@trm/proto';
import { asPlayerId, messageKeyFor, SESSION_REPLACED_CLOSE_CODE } from '@trm/shared';
import type { PlayerId } from '@trm/shared';
```

with:

```ts
import {
  ClientEnvelopeSchema,
  RejectionCode,
  type ClientEnvelope,
  type GameEvent as PbGameEvent,
  type CameraView,
  type Chat,
} from '@trm/proto';
import {
  asPlayerId,
  isChatPresetId,
  messageKeyFor,
  SESSION_REPLACED_CLOSE_CODE,
} from '@trm/shared';
import type { PlayerId } from '@trm/shared';
```

Also widen the existing `import type { ChatEntry } from '../persistence/types';` line to also bring in `ChatContent`:

```ts
import type { ChatEntry, ChatContent } from '../persistence/types';
```

- [ ] **Step 3: Rewrite `onChat`**

Replace the whole method:

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

with:

```ts
  private async onChat(conn: Connection, clientSeq: number, content: Chat['content']): Promise<void> {
    if (!conn.binding || conn.binding.seat < 0) return; // unbound or spectator → no chat

    let toSend: ChatContent;
    if (content.case === 'text') {
      const text = content.value.trim();
      if (text.length === 0) return; // ignore empty
      if (text.length > CHAT_MAX_LEN) {
        conn.send(
          rejectionFrame(clientSeq, RejectionCode.MALFORMED, 'errors:chatTooLong', 'chat too long'),
        );
        return;
      }
      toSend = { case: 'text', value: text };
    } else if (content.case === 'presetId') {
      if (!isChatPresetId(content.value)) {
        conn.send(
          rejectionFrame(
            clientSeq,
            RejectionCode.MALFORMED,
            'errors:chatInvalidPreset',
            'unknown chat preset',
          ),
        );
        return;
      }
      toSend = { case: 'presetId', value: content.value };
    } else {
      return; // empty oneof — nothing to send
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
    log.push({ playerId, content: toSend, ts: now });
    this.chatLog.set(gameId, log);
    if (this.store) {
      try {
        await this.store.appendChat(gameId, seq, playerId, toSend);
      } catch {
        // non-fatal: in-memory log still serves this session's backfill
      }
    }

    const members = this.members.get(gameId);
    if (!members) return;
    for (const member of members.values()) member.send(chatFrame(playerId, toSend));
  }
```

- [ ] **Step 4: Write the failing e2e tests**

In `apps/server/test/history-chat.e2e.spec.ts`, replace the `historyOf` helper's type and the chat-sending test to match the new wire shape, then add a preset-specific test.

Replace:

```ts
const historyOf = (frames: ServerEnvelope[]) =>
  frames.find((f) => f.event.case === 'history')?.event.value as
    | { events: { event: { case?: string; value?: unknown } }[]; chat: { text: string }[] }
    | undefined;
```

with:

```ts
const historyOf = (frames: ServerEnvelope[]) =>
  frames.find((f) => f.event.case === 'history')?.event.value as
    | {
        events: { event: { case?: string; value?: unknown } }[];
        chat: { content: { case: string; value: string } }[];
      }
    | undefined;
```

Replace the whole `'broadcasts chat to members, persists it, and enforces length + rate limits'` test:

```ts
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

  await hub.receive(
    'c1',
    encodeClient(2, { case: 'chat', value: { content: { case: 'text', value: '  hi there  ' } } }),
  );
  const chat1 = f1.find((f) => f.event.case === 'chat')?.event.value as
    | { content: { case: string; value: string } }
    | undefined;
  const chat2 = f2.find((f) => f.event.case === 'chat')?.event.value as
    | { content: { case: string; value: string } }
    | undefined;
  expect(chat1?.content).toEqual({ case: 'text', value: 'hi there' }); // trimmed
  expect(chat2?.content).toEqual({ case: 'text', value: 'hi there' }); // both members receive it

  // Over-length → MALFORMED rejection, nothing broadcast.
  f2.length = 0;
  await hub.receive(
    'c1',
    encodeClient(3, {
      case: 'chat',
      value: { content: { case: 'text', value: 'x'.repeat(2049) } },
    }),
  );
  const rej = f1.find((f) => f.event.case === 'rejection')?.event.value as
    | { code: number }
    | undefined;
  expect(rej?.code).toBe(RejectionCode.MALFORMED);
  expect(f2.find((f) => f.event.case === 'chat')).toBeUndefined();

  // Rate limit: 5 allowed in the window, the 6th is rejected.
  for (let i = 0; i < 6; i++) {
    await hub.receive(
      'c1',
      encodeClient(10 + i, { case: 'chat', value: { content: { case: 'text', value: `m${i}` } } }),
    );
  }
  const lastRej = (
    f1.filter((f) => f.event.case === 'rejection').pop()?.event.value as { code: number }
  ).code;
  expect(lastRej).toBe(RejectionCode.RATE_LIMITED);
});

it('broadcasts a preset chat message and rejects an unrecognized preset id', async () => {
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

  await hub.receive(
    'c1',
    encodeClient(2, { case: 'chat', value: { content: { case: 'presetId', value: 'GOOD_LUCK' } } }),
  );
  const chat2 = f2.find((f) => f.event.case === 'chat')?.event.value as
    | { content: { case: string; value: string } }
    | undefined;
  expect(chat2?.content).toEqual({ case: 'presetId', value: 'GOOD_LUCK' });

  f1.length = 0;
  await hub.receive(
    'c1',
    encodeClient(3, { case: 'chat', value: { content: { case: 'presetId', value: 'NOT_REAL' } } }),
  );
  const rej = f1.find((f) => f.event.case === 'rejection')?.event.value as
    | { code: number; messageKey: string }
    | undefined;
  expect(rej?.code).toBe(RejectionCode.MALFORMED);
  expect(rej?.messageKey).toBe('errors:chatInvalidPreset');
});
```

- [ ] **Step 5: Run test to verify it fails, then passes**

Run: `yarn workspace @trm/server test --run history-chat`
Expected first: FAIL (hub.ts still has the old `onChat(conn, clientSeq, raw: string)` signature, so `encodeClient` calls with `content:` don't match what the running server expects and the old assertions on `.text` no longer compile against the updated helper type).
After Steps 1–3 are in place: PASS (all tests in the file, including the two chat tests).

- [ ] **Step 6: Typecheck, lint, and run the full server suite**

Run: `yarn workspace @trm/server typecheck && yarn workspace @trm/server lint && yarn workspace @trm/server test`
Expected: no errors; the wire-leak test (`test/wire-game.e2e.spec.ts`) and all other existing specs stay green.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/ws/hub.ts apps/server/test/history-chat.e2e.spec.ts
git commit -m "feat(server): accept and broadcast preset chat messages over the hub"
```

---

## Task 6: Web `net/socket.ts` — send and receive preset chat

**Files:**

- Modify: `apps/web/src/net/socket.ts`

**Interfaces:**

- Consumes: nothing new from earlier tasks (the wire types flow through automatically once `@trm/proto`/`@trm/codec` are rebuilt).
- Produces: `GameSocket.chatPreset(presetId: string): void`; `SocketHandlers.onChat`/`onHistory` now carry `ChatContent` instead of `text`. Consumed by Task 7 (`store/chat.ts`) and Task 8 (`ChatPanel.tsx`).

This is a small, framework-free wiring change with no dedicated unit test today (mirroring Task 3 — `socket.ts` has no test file of its own; it's exercised through `ChatPanel.test.tsx`, updated in Task 8). Verification is typecheck + the full web suite staying green.

- [ ] **Step 1: Add the `ChatContent` type and widen the handler signatures**

In `apps/web/src/net/socket.ts`, replace:

```ts
export interface SocketHandlers {
  onStatus?(status: SocketStatus): void;
  onWelcome?(welcome: Welcome): void;
  onSnapshot?(snapshot: GameSnapshot): void;
  onEvents?(stateVersion: number, events: GameEvent[]): void;
  onRejection?(rejection: Rejection): void;
  onChat?(playerId: string, text: string): void;
  /** One-shot backfill of the action-log history + persisted chat on (re)connect. */
  onHistory?(events: GameEvent[], chat: { playerId: string; text: string }[]): void;
  /** Another member's camera framing, relayed for "follow the acting player". */
  onCameraMoved?(playerId: string, view: CameraView): void;
  /** This seat was claimed by another connection; the socket will not auto-reconnect. */
  onSessionReplaced?(): void;
}
```

with:

```ts
/** Either free text or a preset id — the same discriminated shape the wire carries. */
export type ChatContent = { case: 'text'; value: string } | { case: 'presetId'; value: string };

export interface SocketHandlers {
  onStatus?(status: SocketStatus): void;
  onWelcome?(welcome: Welcome): void;
  onSnapshot?(snapshot: GameSnapshot): void;
  onEvents?(stateVersion: number, events: GameEvent[]): void;
  onRejection?(rejection: Rejection): void;
  onChat?(playerId: string, content: ChatContent): void;
  /** One-shot backfill of the action-log history + persisted chat on (re)connect. */
  onHistory?(events: GameEvent[], chat: { playerId: string; content: ChatContent }[]): void;
  /** Another member's camera framing, relayed for "follow the acting player". */
  onCameraMoved?(playerId: string, view: CameraView): void;
  /** This seat was claimed by another connection; the socket will not auto-reconnect. */
  onSessionReplaced?(): void;
}
```

- [ ] **Step 2: Update the dispatch switch**

Replace:

```ts
      case 'chat':
        this.handlers.onChat?.(env.event.value.playerId, env.event.value.text);
        break;
      case 'history':
        this.handlers.onHistory?.(
          env.event.value.events,
          env.event.value.chat.map((c) => ({ playerId: c.playerId, text: c.text })),
        );
        break;
```

with:

```ts
      case 'chat': {
        const content = env.event.value.content;
        if (content.case) this.handlers.onChat?.(env.event.value.playerId, content);
        break;
      }
      case 'history':
        this.handlers.onHistory?.(
          env.event.value.events,
          env.event.value.chat
            .filter((c) => c.content.case)
            .map((c) => ({ playerId: c.playerId, content: c.content as ChatContent })),
        );
        break;
```

- [ ] **Step 3: Update `chat()` and add `chatPreset()`**

Replace:

```ts
  chat(text: string): void {
    this.send({ case: 'chat', value: { text } });
  }
```

with:

```ts
  chat(text: string): void {
    this.send({ case: 'chat', value: { content: { case: 'text', value: text } } });
  }
  /** Send a preset ("canned") chat message by id — resolved to text by every viewer's own i18n. */
  chatPreset(presetId: string): void {
    this.send({ case: 'chat', value: { content: { case: 'presetId', value: presetId } } });
  }
```

- [ ] **Step 4: Typecheck**

Run: `yarn workspace @trm/web typecheck`
Expected: errors in `store/chat.ts`, `ChatPanel.tsx`, and their tests (they still use the old `text` shape) — this is expected; those are fixed in Tasks 7–8. Confirm the errors are ONLY in those files, not in `socket.ts` itself.

- [ ] **Step 5: Commit**

Commit alongside Task 7 instead — `socket.ts` alone doesn't typecheck cleanly against the rest of the still-unmigrated web app. Skip a standalone commit here; Task 7's commit will include this file. (Leave the change staged/uncommitted and continue directly into Task 7.)

---

## Task 7: Web chat store + preset helper + i18n

**Files:**

- Modify: `apps/web/src/store/chat.ts`
- Create: `apps/web/src/game/chatPresets.ts`
- Modify: `apps/web/src/game/chatErrors.ts`
- Modify: `apps/web/src/i18n/index.ts`
- Test: `apps/web/src/store/chat.test.ts`

**Interfaces:**

- Consumes: `ChatContent` from `../net/socket` (Task 6), `CHAT_PRESET_IDS`/`ChatPresetId` from `@trm/shared` (Task 1).
- Produces: `useChat`'s `ChatMessage.content`, `chatPresetKey(id)`. Consumed by Task 8 (`ChatPanel.tsx`).

- [ ] **Step 1: Write the failing test for the widened store**

Replace the whole content of `apps/web/src/store/chat.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useChat } from './chat';

describe('useChat', () => {
  beforeEach(() => useChat.getState().reset());

  it('appends live messages with ids', () => {
    useChat.getState().ingest({ playerId: 'p1', content: { case: 'text', value: 'hi' } });
    useChat.getState().ingest({ playerId: 'p2', content: { case: 'text', value: 'yo' } });
    const m = useChat.getState().messages;
    expect(m.map((x) => x.content)).toEqual([
      { case: 'text', value: 'hi' },
      { case: 'text', value: 'yo' },
    ]);
    expect(m[0]?.id).not.toBe(m[1]?.id);
  });

  it('replaces messages on each history backfill (transient reconnect re-fills)', () => {
    useChat.getState().ingestHistory([{ playerId: 'p1', content: { case: 'text', value: 'a' } }]);
    useChat.getState().ingestHistory([
      { playerId: 'p1', content: { case: 'text', value: 'b' } },
      { playerId: 'p2', content: { case: 'text', value: 'c' } },
    ]);
    const m = useChat.getState().messages;
    expect(m).toHaveLength(2);
    expect(m[0]?.content).toEqual({ case: 'text', value: 'b' });
  });

  it('tracks the last live message but ignores history backfill', () => {
    expect(useChat.getState().lastLive).toBeNull();
    useChat.getState().ingestHistory([{ playerId: 'p1', content: { case: 'text', value: 'a' } }]);
    expect(useChat.getState().lastLive).toBeNull();
    useChat.getState().ingest({ playerId: 'p2', content: { case: 'text', value: 'hi' } });
    expect(useChat.getState().lastLive).toEqual({
      id: 2,
      playerId: 'p2',
      content: { case: 'text', value: 'hi' },
    });
  });

  it('ingests a preset message distinctly from free text', () => {
    useChat
      .getState()
      .ingest({ playerId: 'p1', content: { case: 'presetId', value: 'GOOD_LUCK' } });
    expect(useChat.getState().messages[0]?.content).toEqual({
      case: 'presetId',
      value: 'GOOD_LUCK',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/web test --run store/chat.test`
Expected: FAIL — `useChat`'s `ChatMessage`/`ingest`/`ingestHistory` still use a flat `text: string` field.

- [ ] **Step 3: Update the store**

Replace the whole content of `apps/web/src/store/chat.ts`:

```ts
import { create } from 'zustand';
import type { ChatContent } from '../net/socket';

export interface ChatMessage {
  id: number;
  playerId: string;
  content: ChatContent;
}

const CAP = 500;

interface ChatState {
  messages: ChatMessage[];
  nextId: number;
  /** The most recently INGESTED live message (never set by ingestHistory) — lets consumers like the
   *  sound driver react to genuinely new chat only, never to a reconnect's history backfill. */
  lastLive: ChatMessage | null;
  ingest(msg: { playerId: string; content: ChatContent }): void;
  ingestHistory(msgs: { playerId: string; content: ChatContent }[]): void;
  reset(): void;
}

export const useChat = create<ChatState>()((set) => ({
  messages: [],
  nextId: 1,
  lastLive: null,
  ingest: (msg) =>
    set((s) => {
      const message = { id: s.nextId, ...msg };
      return {
        messages: [...s.messages, message].slice(-CAP),
        nextId: s.nextId + 1,
        lastLive: message,
      };
    }),
  // The server re-sends the complete chat log on every (re)connect (before live messages);
  // replace so a transient reconnect re-fills the gap. Live messages then append.
  ingestHistory: (msgs) =>
    set(() => {
      const messages = msgs.map((m, i) => ({ id: i + 1, ...m }));
      return { messages: messages.slice(-CAP), nextId: messages.length + 1 };
    }),
  reset: () => set({ messages: [], nextId: 1, lastLive: null }),
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @trm/web test --run store/chat.test`
Expected: PASS (4 tests)

- [ ] **Step 5: Create the preset helper module**

Create `apps/web/src/game/chatPresets.ts`:

```ts
import { CHAT_PRESET_IDS } from '@trm/shared';

export { CHAT_PRESET_IDS };

/** The i18n key for a preset chat message's translated text. */
export const chatPresetKey = (id: string): string => `chat.presets.${id}`;
```

- [ ] **Step 6: Extend the chat-rejection helper for the new rejection key**

In `apps/web/src/game/chatErrors.ts`, replace the whole file:

```ts
// Server chat-rejection message keys (the hub enforces members-only chat with a 2048-char
// limit + a 5/5s rate limit, and rejects an unrecognized preset id, with these i18n keys). The
// web surfaces them as inline chat feedback instead of the generic action-rejected toast.
export const CHAT_TOO_LONG_KEY = 'errors:chatTooLong';
export const CHAT_RATE_LIMITED_KEY = 'errors:chatRateLimited';
export const CHAT_INVALID_PRESET_KEY = 'errors:chatInvalidPreset';

/** Whether a rejection's messageKey is one of the chat-specific rejections. */
export const isChatRejectionKey = (key: string): boolean =>
  key === CHAT_TOO_LONG_KEY || key === CHAT_RATE_LIMITED_KEY || key === CHAT_INVALID_PRESET_KEY;

/** The `chat.*` i18n key to show for a chat-rejection messageKey, or null if not a chat one. */
export const chatRejectionHintKey = (key: string): string | null =>
  key === CHAT_TOO_LONG_KEY
    ? 'chat.tooLong'
    : key === CHAT_RATE_LIMITED_KEY
      ? 'chat.rateLimited'
      : key === CHAT_INVALID_PRESET_KEY
        ? 'chat.invalidPreset'
        : null;
```

- [ ] **Step 7: Add the i18n keys**

In `apps/web/src/i18n/index.ts`, replace the zh-Hant `chat: {...}` block:

```ts
      chat: {
        heading: '聊天',
        empty: '尚無訊息',
        placeholder: '輸入訊息…',
        spectatorDisabled: '觀戰中無法聊天',
        send: '傳送',
        rateLimited: '傳送太快,請稍候…',
        tooLong: '訊息過長(上限 2048 字)',
      },
```

with:

```ts
      chat: {
        heading: '聊天',
        empty: '尚無訊息',
        placeholder: '輸入訊息…',
        spectatorDisabled: '觀戰中無法聊天',
        send: '傳送',
        rateLimited: '傳送太快,請稍候…',
        tooLong: '訊息過長(上限 2048 字)',
        invalidPreset: '無法辨識的預設訊息',
        presets: {
          GREETING: '哈囉!',
          GOOD_LUCK: '祝你好運,玩得開心!',
          THANKS: '謝謝!',
          SORRY: '抱歉!',
          ONE_MOMENT: '請稍等一下',
          NICE_MOVE: '這步不錯!',
          WELL_PLAYED: '打得好!',
          GOOD_GAME: '這局精彩!',
          LETS_GO: '開始吧!',
          STILL_THERE: '你還在嗎?',
          YES: '好',
          NO: '不',
        },
      },
```

And the en `chat: {...}` block:

```ts
      chat: {
        heading: 'Chat',
        empty: 'No messages yet',
        placeholder: 'Type a message…',
        spectatorDisabled: "Spectators can't chat",
        send: 'Send',
        rateLimited: 'Slow down a moment…',
        tooLong: 'Message too long (max 2048).',
      },
```

with:

```ts
      chat: {
        heading: 'Chat',
        empty: 'No messages yet',
        placeholder: 'Type a message…',
        spectatorDisabled: "Spectators can't chat",
        send: 'Send',
        rateLimited: 'Slow down a moment…',
        tooLong: 'Message too long (max 2048).',
        invalidPreset: 'Unrecognized preset message',
        presets: {
          GREETING: 'Hello!',
          GOOD_LUCK: 'Good luck, have fun!',
          THANKS: 'Thanks!',
          SORRY: 'Sorry!',
          ONE_MOMENT: 'One moment please',
          NICE_MOVE: 'Nice move!',
          WELL_PLAYED: 'Well played!',
          GOOD_GAME: 'Good game!',
          LETS_GO: "Let's go!",
          STILL_THERE: 'Are you still there?',
          YES: 'Yes',
          NO: 'No',
        },
      },
```

- [ ] **Step 8: Typecheck**

Run: `yarn workspace @trm/web typecheck`
Expected: errors remain only in `ChatPanel.tsx`/`ChatPanel.test.tsx` (fixed in Task 8). `socket.ts`, `chat.ts`, `chatPresets.ts`, `chatErrors.ts`, and `i18n/index.ts` all compile cleanly.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/net/socket.ts apps/web/src/store/chat.ts apps/web/src/game/chatPresets.ts apps/web/src/game/chatErrors.ts apps/web/src/i18n/index.ts apps/web/src/store/chat.test.ts
git commit -m "feat(web): widen the chat store and add the preset catalog + i18n"
```

---

## Task 8: Web `ChatPanel.tsx` — preset button row + rendering

**Files:**

- Modify: `apps/web/src/components/ChatPanel.tsx`
- Modify: `apps/web/src/styles/game.css`
- Test: `apps/web/src/components/ChatPanel.test.tsx`

**Interfaces:**

- Consumes: `CHAT_PRESET_IDS`/`chatPresetKey` from `../game/chatPresets` (Task 7), `ChatContent` from `../net/socket` (Task 6), `GameSocket.chatPreset` (Task 6).
- Produces: the in-game chat UI's preset row. Terminal consumer for the in-game half of this feature.

- [ ] **Step 1: Write the failing tests**

Replace the whole content of `apps/web/src/components/ChatPanel.test.tsx`:

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
const chatPresetSpy = vi.fn();
vi.mock('../net/connection', () => ({
  getSocket: () => ({ chat: chatSpy, chatPreset: chatPresetSpy }),
}));

beforeEach(() => {
  chatSpy.mockClear();
  chatPresetSpy.mockClear();
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
    rejection: null,
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

  it('renders received free-text messages', () => {
    useChat.getState().ingest({ playerId: 'p1', content: { case: 'text', value: 'gg' } });
    render(<ChatPanel />);
    expect(screen.getByText('gg')).toBeInTheDocument();
  });

  it('renders a received preset message translated, not by its raw id', () => {
    useChat
      .getState()
      .ingest({ playerId: 'p1', content: { case: 'presetId', value: 'GOOD_LUCK' } });
    render(<ChatPanel />);
    expect(screen.getByText('祝你好運,玩得開心!')).toBeInTheDocument();
    expect(screen.queryByText('GOOD_LUCK')).not.toBeInTheDocument();
  });

  it('sends a preset message when a preset button is clicked', () => {
    render(<ChatPanel />);
    fireEvent.click(screen.getByRole('button', { name: '謝謝!' }));
    expect(chatPresetSpy).toHaveBeenCalledWith('THANKS');
  });

  it('disables the input and preset buttons for spectators', () => {
    render(<ChatPanel disabled />);
    expect(screen.getByRole('button', { name: '傳送' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '謝謝!' })).toBeDisabled();
  });

  it('shows an inline hint for a server chat rejection', () => {
    useGame.setState({ rejection: { code: 5, messageKey: 'errors:chatRateLimited' } });
    render(<ChatPanel />);
    expect(screen.getByText('傳送太快,請稍候…')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/web test --run ChatPanel`
Expected: FAIL — `ChatPanel.tsx` still renders `m.text` (compile error against the widened `ChatMessage`) and has no preset row.

- [ ] **Step 3: Rewrite `ChatPanel.tsx`**

Replace the whole file:

```tsx
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useChat } from '../store/chat';
import { useGame } from '../store/game';
import { getSocket } from '../net/connection';
import { usePlayerName } from '../game/playerName';
import { SEAT_COLORS } from '../theme/colors';
import { chatRejectionHintKey } from '../game/chatErrors';
import { CHAT_PRESET_IDS, chatPresetKey } from '../game/chatPresets';

const MAX_LEN = 2048;
const RATE_MAX = 5;
const RATE_WINDOW_MS = 5000;

export function ChatPanel({ disabled = false }: { disabled?: boolean }) {
  const { t } = useTranslation();
  const messages = useChat((s) => s.messages);
  const snapshot = useGame((s) => s.snapshot);
  const rejection = useGame((s) => s.rejection);
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

  // Surface a server-side chat rejection (length / rate limit / unknown preset) as inline chat
  // feedback instead of the generic action toast. Client guards usually prevent it ever firing.
  useEffect(() => {
    if (!rejection) return;
    const key = chatRejectionHintKey(rejection.messageKey);
    if (key) setHint(t(key));
  }, [rejection, t]);

  const seatOf = (pid: string): number => snapshot?.players.find((p) => p.id === pid)?.seat ?? 0;

  const withinRateLimit = (): boolean => {
    const now = Date.now();
    sentAt.current = sentAt.current.filter((ts) => now - ts < RATE_WINDOW_MS);
    if (sentAt.current.length >= RATE_MAX) {
      setHint(t('chat.rateLimited'));
      return false;
    }
    sentAt.current.push(now);
    return true;
  };

  const send = (): void => {
    const text = draft.trim();
    if (!text || disabled) return;
    if (!withinRateLimit()) return;
    getSocket()?.chat(text.slice(0, MAX_LEN));
    setDraft('');
    setHint(null);
  };

  const sendPreset = (id: string): void => {
    if (disabled) return;
    if (!withinRateLimit()) return;
    getSocket()?.chatPreset(id);
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
              <span
                className="chat-author"
                style={{ color: SEAT_COLORS[seatOf(m.playerId) % 5] ?? '#888' }}
              >
                {nameOf({ id: m.playerId, seat: seatOf(m.playerId), isMe: m.playerId === me })}
              </span>
              <span className="chat-text">
                {m.content.case === 'presetId'
                  ? t(chatPresetKey(m.content.value))
                  : m.content.value}
              </span>
            </div>
          ))
        )}
      </div>
      {hint && <p className="chat-hint">{hint}</p>}
      <div className="chat-presets">
        {CHAT_PRESET_IDS.map((id) => (
          <button
            key={id}
            type="button"
            className="chat-preset-btn"
            disabled={disabled}
            onClick={() => sendPreset(id)}
          >
            {t(chatPresetKey(id))}
          </button>
        ))}
      </div>
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

Note: the client-side rate-limit window (`sentAt`) is now shared by both `send()` and `sendPreset()` via the extracted `withinRateLimit()` helper — a burst of presets and typed messages draws from the same budget, matching the server's single per-connection limiter.

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @trm/web test --run ChatPanel`
Expected: PASS (6 tests)

- [ ] **Step 5: Add the preset row CSS**

In `apps/web/src/styles/game.css`, right after the existing `.chat-hint` rule, add:

```css
.chat-presets {
  display: flex;
  flex-wrap: wrap;
  gap: var(--tr-space-2);
  margin-bottom: var(--tr-space-2);
}
.chat-preset-btn {
  font-size: 0.78rem;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--tr-line);
  background: var(--tr-surface-2);
  color: var(--tr-ink);
  cursor: pointer;
}
.chat-preset-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
```

- [ ] **Step 6: Typecheck, lint, run the full web suite**

Run: `yarn workspace @trm/web typecheck && yarn workspace @trm/web lint && yarn workspace @trm/web test`
Expected: no errors, full suite green.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/ChatPanel.tsx apps/web/src/components/ChatPanel.test.tsx apps/web/src/styles/game.css
git commit -m "feat(web): add a preset chat message row to the in-game ChatPanel"
```

---

## Task 9: Lobby server — preset chat on the room

**Files:**

- Modify: `apps/server/src/lobby/room.repo.ts`
- Modify: `apps/server/src/lobby/lobby.schemas.ts`
- Modify: `apps/server/src/lobby/lobby.service.ts`
- Modify: `apps/server/src/lobby/lobby.controller.ts`
- Test: Create `apps/server/test/lobby-chat.e2e.spec.ts`

**Interfaces:**

- Consumes: `CHAT_PRESET_IDS`/`ChatPresetId` from `@trm/shared` (Task 1).
- Produces: `RoomDoc.chat`, `RoomRepo.sendChat(code, userId, presetId)`, `LobbyService.sendChat(code, user, presetId)`, `POST /rooms/:code/chat`, `RoomView.chat`. Consumed by Task 10 (web lobby UI).

- [ ] **Step 1: Add the chat entry type + field to `RoomDoc`, and the repo method**

In `apps/server/src/lobby/room.repo.ts`, add this import at the top (alongside the existing `EventsMode` import):

```ts
import type { ChatPresetId } from '@trm/shared';
```

Add a new exported type right after `RoomMember`'s interface (before `RoomDoc`):

```ts
export interface RoomChatEntry {
  userId: string;
  presetId: string;
  ts: number;
}
```

Add a `chat` field to `RoomDoc` — replace:

```ts
export interface RoomDoc {
  _id: string; // room code
  hostId: string;
  status: RoomStatus;
  members: RoomMember[];
  maxPlayers: number;
  settings: RoomSettings;
  gameId?: string;
  seed?: string;
  createdAt: Date;
  updatedAt: Date;
}
```

with:

```ts
export interface RoomDoc {
  _id: string; // room code
  hostId: string;
  status: RoomStatus;
  members: RoomMember[];
  maxPlayers: number;
  settings: RoomSettings;
  gameId?: string;
  seed?: string;
  /** Capped, ephemeral preset-only chat for the lobby (never persisted past the room's lifetime). */
  chat?: RoomChatEntry[];
  createdAt: Date;
  updatedAt: Date;
}
```

Add the result type alongside the other `*Result` type aliases:

```ts
export type SendChatResult = RoomDoc | 'not_found' | 'not_member' | 'rate_limited';
```

Add the constants near `ALPHABET`/`newCode`:

```ts
const ROOM_CHAT_CAP = 30;
const ROOM_CHAT_RATE_MAX = 5;
const ROOM_CHAT_RATE_WINDOW_MS = 5000;
```

Add the method — put it right after `setRematchVote` (before the class's closing brace):

```ts
  /** Any room member sends a preset chat message; rate-limited from the persisted array itself
   *  (no separate in-memory tracker) so it survives restarts without new state. */
  async sendChat(code: string, userId: string, presetId: ChatPresetId): Promise<SendChatResult> {
    const room = await this.col.findOne({ _id: code });
    if (!room) return 'not_found';
    if (!room.members.some((m) => m.userId === userId)) return 'not_member';

    const now = Date.now();
    const recent = (room.chat ?? []).filter(
      (c) => c.userId === userId && now - c.ts < ROOM_CHAT_RATE_WINDOW_MS,
    );
    if (recent.length >= ROOM_CHAT_RATE_MAX) return 'rate_limited';

    await this.col.updateOne(
      { _id: code },
      {
        $push: { chat: { $each: [{ userId, presetId, ts: now }], $slice: -ROOM_CHAT_CAP } },
        $set: { updatedAt: new Date() },
      },
    );
    return (await this.col.findOne({ _id: code })) ?? 'not_found';
  }
```

- [ ] **Step 2: Add the wire schema + DTO + response field**

In `apps/server/src/lobby/lobby.schemas.ts`, add the import:

```ts
import { CHAT_PRESET_IDS } from '@trm/shared';
```

Add the schema + DTO right after `RematchVoteSchema`:

```ts
export const ChatSchema = z.object({ presetId: z.enum(CHAT_PRESET_IDS) });
```

Add the DTO class alongside the other DTO classes:

```ts
export class ChatDto extends createZodDto(ChatSchema) {}
```

Add a chat-entry schema and wire it into `RoomViewSchema` — replace:

```ts
export const RoomViewSchema = z.object({
  code: z.string(),
  hostId: z.string(),
  status: z.enum(['LOBBY', 'STARTED', 'CLOSED']),
  maxPlayers: z.number(),
  members: z.array(RoomMemberSchema),
  settings: GameSettingsSchema,
  gameId: z.string().optional(),
  /** Resolved display name for settings.map, when known (e.g. an official map). */
  mapName: z.object({ zh: z.string(), en: z.string() }).optional(),
});
```

with:

```ts
export const RoomChatEntrySchema = z.object({
  userId: z.string(),
  presetId: z.string(),
  ts: z.number(),
});
export const RoomViewSchema = z.object({
  code: z.string(),
  hostId: z.string(),
  status: z.enum(['LOBBY', 'STARTED', 'CLOSED']),
  maxPlayers: z.number(),
  members: z.array(RoomMemberSchema),
  settings: GameSettingsSchema,
  gameId: z.string().optional(),
  /** Resolved display name for settings.map, when known (e.g. an official map). */
  mapName: z.object({ zh: z.string(), en: z.string() }).optional(),
  /** Capped, preset-only chat for the lobby (empty for a game already in progress). */
  chat: z.array(RoomChatEntrySchema),
});
```

- [ ] **Step 3: Wire the service method**

In `apps/server/src/lobby/lobby.service.ts`, add `ChatPresetId` to the `@trm/shared` import. Replace:

```ts
import { asPlayerId, type SeatIndex } from '@trm/shared';
```

with:

```ts
import { asPlayerId, type SeatIndex, type ChatPresetId } from '@trm/shared';
```

Add `chat` to `RoomView` and to `toView` — replace:

```ts
export interface RoomView {
  code: string;
  hostId: string;
  status: RoomDoc['status'];
  maxPlayers: number;
  members: RoomMember[];
  settings: RoomSettings;
  gameId?: string;
  mapName?: { zh: string; en: string };
}
```

with:

```ts
export interface RoomView {
  code: string;
  hostId: string;
  status: RoomDoc['status'];
  maxPlayers: number;
  members: RoomMember[];
  settings: RoomSettings;
  gameId?: string;
  mapName?: { zh: string; en: string };
  chat: RoomChatEntry[];
}
```

Also add `RoomChatEntry` to the `./room.repo` import list. Replace:

```ts
import {
  RoomRepo,
  DEFAULT_ROOM_SETTINGS,
  type MapSelector,
  type RoomDoc,
  type RoomMember,
  type RoomSettings,
  type RoomSettingsPatch,
} from './room.repo';
```

with:

```ts
import {
  RoomRepo,
  DEFAULT_ROOM_SETTINGS,
  type MapSelector,
  type RoomDoc,
  type RoomMember,
  type RoomSettings,
  type RoomSettingsPatch,
  type RoomChatEntry,
} from './room.repo';
```

Replace `toView`:

```ts
const toView = (r: RoomDoc): RoomView => {
  const settings = { ...DEFAULT_ROOM_SETTINGS, ...r.settings };
  const mapName = mapNameFor(settings.map);
  return {
    code: r._id,
    hostId: r.hostId,
    status: r.status,
    maxPlayers: r.maxPlayers,
    members: r.members,
    settings,
    ...(r.gameId ? { gameId: r.gameId } : {}),
    ...(mapName ? { mapName } : {}),
  };
};
```

with:

```ts
const toView = (r: RoomDoc): RoomView => {
  const settings = { ...DEFAULT_ROOM_SETTINGS, ...r.settings };
  const mapName = mapNameFor(settings.map);
  return {
    code: r._id,
    hostId: r.hostId,
    status: r.status,
    maxPlayers: r.maxPlayers,
    members: r.members,
    settings,
    ...(r.gameId ? { gameId: r.gameId } : {}),
    ...(mapName ? { mapName } : {}),
    chat: r.chat ?? [],
  };
};
```

Add the service method right after `voteRematch`:

```ts
  /** Any room member sends a preset chat message. */
  async sendChat(code: string, user: AuthUser, presetId: ChatPresetId): Promise<RoomView> {
    const r = await this.rooms.sendChat(code, user.userId, presetId);
    if (r === 'not_found') throw new NotFoundException('room not found');
    if (r === 'not_member') throw new ForbiddenException('not a member of this room');
    if (r === 'rate_limited') throw new BadRequestException('sending chat too fast');
    return toView(r);
  }
```

- [ ] **Step 4: Add the controller route**

In `apps/server/src/lobby/lobby.controller.ts`, add `ChatSchema`/`ChatDto` to the `./lobby.schemas` import list. Replace:

```ts
import {
  CreateRoomDto,
  ReadyDto,
  AddBotDto,
  UpdateSettingsDto,
  RematchVoteDto,
  CreateRoomSchema,
  ReadySchema,
  AddBotSchema,
  UpdateSettingsSchema,
  RematchVoteSchema,
  RoomViewSchema,
  RoomConfigSchema,
  TicketResultSchema,
} from './lobby.schemas';
```

with:

```ts
import {
  CreateRoomDto,
  ReadyDto,
  AddBotDto,
  UpdateSettingsDto,
  RematchVoteDto,
  ChatDto,
  CreateRoomSchema,
  ReadySchema,
  AddBotSchema,
  UpdateSettingsSchema,
  RematchVoteSchema,
  ChatSchema,
  RoomViewSchema,
  RoomConfigSchema,
  TicketResultSchema,
} from './lobby.schemas';
```

Add the route right after `rematchVote`:

```ts
  @Post(':code/chat')
  @HttpCode(200)
  @ApiOperation({ summary: 'Send a preset chat message to the room' })
  @ApiBody({ schema: apiSchema(ChatSchema) })
  @ApiResponse({ status: 200, schema: apiSchema(RoomViewSchema) })
  sendChat(@CurrentUser() user: AuthUser, @Param('code') code: string, @Body() body: ChatDto) {
    return this.lobby.sendChat(code.toUpperCase(), user, body.presetId);
  }
```

- [ ] **Step 5: Write the failing e2e test**

Create `apps/server/test/lobby-chat.e2e.spec.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from './app';

let t: TestApp;
const server = () => t.app.getHttpServer();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function guest(displayName: string): Promise<{ token: string; id: string }> {
  const res = await request(server()).post('/api/v1/auth/guest').send({ displayName }).expect(201);
  return { token: res.body.accessToken, id: res.body.user.id };
}

beforeAll(async () => {
  t = await createTestApp();
}, 60_000);

afterAll(() => t.close());

describe('lobby: preset chat', () => {
  it('lets a room member send a preset message, visible to every member', async () => {
    const a = await guest('Ada');
    const b = await guest('Bo');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);

    const sent = await request(server())
      .post(`/api/v1/rooms/${code}/chat`)
      .set(auth(a.token))
      .send({ presetId: 'GOOD_LUCK' })
      .expect(200);
    expect(sent.body.chat).toHaveLength(1);
    expect(sent.body.chat[0]).toMatchObject({ userId: a.id, presetId: 'GOOD_LUCK' });

    // The other member sees it too on their next read.
    const read = await request(server())
      .get(`/api/v1/rooms/${code}`)
      .set(auth(b.token))
      .expect(200);
    expect(read.body.chat[0]).toMatchObject({ userId: a.id, presetId: 'GOOD_LUCK' });
  });

  it('rejects an unrecognized preset id with a 400', async () => {
    const a = await guest('Ada2');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;

    await request(server())
      .post(`/api/v1/rooms/${code}/chat`)
      .set(auth(a.token))
      .send({ presetId: 'NOT_A_PRESET' })
      .expect(400);
  });

  it('rejects chat from someone who is not a member of the room', async () => {
    const a = await guest('Ada3');
    const outsider = await guest('Out');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;

    await request(server())
      .post(`/api/v1/rooms/${code}/chat`)
      .set(auth(outsider.token))
      .send({ presetId: 'GOOD_LUCK' })
      .expect(403);
  });

  it('rate-limits: 5 allowed in the window, the 6th is rejected', async () => {
    const a = await guest('Ada4');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;

    for (let i = 0; i < 5; i++) {
      await request(server())
        .post(`/api/v1/rooms/${code}/chat`)
        .set(auth(a.token))
        .send({ presetId: 'YES' })
        .expect(200);
    }
    await request(server())
      .post(`/api/v1/rooms/${code}/chat`)
      .set(auth(a.token))
      .send({ presetId: 'YES' })
      .expect(400);
  });

  it('caps the persisted chat log at 30 entries', async () => {
    const a = await guest('Ada5');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;

    // 35 sends spread across enough time to dodge the 5-per-5s rate limit: 7 bursts of 5,
    // pausing between bursts. Vitest's default timeout is generous enough for this in CI.
    for (let burst = 0; burst < 7; burst++) {
      for (let i = 0; i < 5; i++) {
        await request(server())
          .post(`/api/v1/rooms/${code}/chat`)
          .set(auth(a.token))
          .send({ presetId: 'YES' })
          .expect(200);
      }
      await new Promise((r) => setTimeout(r, 5100));
    }
    const read = await request(server())
      .get(`/api/v1/rooms/${code}`)
      .set(auth(a.token))
      .expect(200);
    expect(read.body.chat).toHaveLength(30);
  }, 60_000);
});
```

- [ ] **Step 6: Run test to verify it fails, then passes**

Run: `yarn workspace @trm/server test --run lobby-chat`
Expected first: FAIL (route doesn't exist yet — 404).
After Steps 1–4: PASS (5 tests).

- [ ] **Step 7: Typecheck, lint, and run the full server suite**

Run: `yarn workspace @trm/server typecheck && yarn workspace @trm/server lint && yarn workspace @trm/server test`
Expected: no errors, full suite green (confirm `apps/server/test/lobby.e2e.spec.ts` and the other pre-existing lobby specs still pass unchanged since `RoomView.chat` is additive).

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/lobby/room.repo.ts apps/server/src/lobby/lobby.schemas.ts apps/server/src/lobby/lobby.service.ts apps/server/src/lobby/lobby.controller.ts apps/server/test/lobby-chat.e2e.spec.ts
git commit -m "feat(server): let room members send preset chat messages in the lobby"
```

---

## Task 10: Web lobby UI — preset chat in `RoomScreen`

**Files:**

- Modify: `apps/web/src/net/rest.ts`
- Modify: `apps/web/src/screens/RoomScreen.tsx`
- Modify: `apps/web/src/styles/app.css`
- Modify: `apps/web/src/i18n/index.ts`
- Test: `apps/web/src/screens/RoomScreen.test.tsx`

**Interfaces:**

- Consumes: `CHAT_PRESET_IDS`/`chatPresetKey` from `../game/chatPresets` (Task 7).
- Produces: the lobby chat UI. Terminal consumer for the lobby half of this feature.

- [ ] **Step 1: Add the REST call + widen `RoomView`**

In `apps/web/src/net/rest.ts`, add a `chat` field to the `RoomView` interface — replace:

```ts
export interface RoomView {
  code: string;
  hostId: string;
  status: 'LOBBY' | 'STARTED' | 'CLOSED';
  maxPlayers: number;
  members: RoomMember[];
  settings: RoomSettings;
  gameId?: string;
  mapName?: { zh: string; en: string };
}
```

with:

```ts
export interface RoomChatEntry {
  userId: string;
  presetId: string;
  ts: number;
}
export interface RoomView {
  code: string;
  hostId: string;
  status: 'LOBBY' | 'STARTED' | 'CLOSED';
  maxPlayers: number;
  members: RoomMember[];
  settings: RoomSettings;
  gameId?: string;
  mapName?: { zh: string; en: string };
  chat: RoomChatEntry[];
}
```

Add the REST call right after `voteRematch:` in the `api` object:

```ts
  voteRematch: (code: string, wantsRematch: boolean) =>
    req<RoomView>('POST', `/rooms/${code}/rematch-vote`, { wantsRematch }),
  sendRoomChat: (code: string, presetId: string) =>
    req<RoomView>('POST', `/rooms/${code}/chat`, { presetId }),
```

- [ ] **Step 2: Write the failing tests**

In `apps/web/src/screens/RoomScreen.test.tsx`, add `sendRoomChat: vi.fn()` to the mocked `api` object (in the `vi.mock('../net/rest', ...)` factory), and `chat: []` to `baseRoom()`. Replace:

```ts
    api: {
      getRoom: vi.fn(),
      getTicket: vi.fn(),
      joinRoom: vi.fn(),
      spectate: vi.fn(),
      setReady: vi.fn(),
      leaveRoom: vi.fn(),
      addBot: vi.fn(),
      removeBot: vi.fn(),
      kickPlayer: vi.fn(),
      startRoom: vi.fn(),
      updateRoomSettings: vi.fn(),
      listMaps: vi.fn(() => Promise.resolve([])),
      getRoomsConfig: vi.fn(() => Promise.resolve({ randomEventsEnabled: false })),
    },
```

with:

```ts
    api: {
      getRoom: vi.fn(),
      getTicket: vi.fn(),
      joinRoom: vi.fn(),
      spectate: vi.fn(),
      setReady: vi.fn(),
      leaveRoom: vi.fn(),
      addBot: vi.fn(),
      removeBot: vi.fn(),
      kickPlayer: vi.fn(),
      startRoom: vi.fn(),
      updateRoomSettings: vi.fn(),
      listMaps: vi.fn(() => Promise.resolve([])),
      getRoomsConfig: vi.fn(() => Promise.resolve({ randomEventsEnabled: false })),
      sendRoomChat: vi.fn(),
    },
```

Replace `baseRoom`:

```ts
const baseRoom = () => ({
  code: 'ABCD',
  hostId: 'host',
  status: 'LOBBY' as 'LOBBY' | 'STARTED' | 'CLOSED',
  maxPlayers: 5,
  members: [member('host')] as ReturnType<typeof member>[],
  settings: {
    unlimitedStationBorrow: false,
    secondDrawAfterBlindRainbow: false,
    noUnfinishedTicketPenalty: false,
    doubleRouteSingleFor23: true,
    allowSpectating: true,
    visibility: 'PUBLIC' as 'PUBLIC' | 'INVITE_ONLY',
    map: { source: 'official', mapId: 'taiwan' } as MapSelector,
    eventsMode: 'off' as 'off' | 'light' | 'moderate' | 'intense',
  },
  gameId: undefined as string | undefined,
  mapName: undefined as { zh: string; en: string } | undefined,
});
```

with:

```ts
const baseRoom = () => ({
  code: 'ABCD',
  hostId: 'host',
  status: 'LOBBY' as 'LOBBY' | 'STARTED' | 'CLOSED',
  maxPlayers: 5,
  members: [member('host')] as ReturnType<typeof member>[],
  settings: {
    unlimitedStationBorrow: false,
    secondDrawAfterBlindRainbow: false,
    noUnfinishedTicketPenalty: false,
    doubleRouteSingleFor23: true,
    allowSpectating: true,
    visibility: 'PUBLIC' as 'PUBLIC' | 'INVITE_ONLY',
    map: { source: 'official', mapId: 'taiwan' } as MapSelector,
    eventsMode: 'off' as 'off' | 'light' | 'moderate' | 'intense',
  },
  gameId: undefined as string | undefined,
  mapName: undefined as { zh: string; en: string } | undefined,
  chat: [] as { userId: string; presetId: string; ts: number }[],
});
```

Add a new `describe` block at the end of the file:

```ts
describe('RoomScreen preset chat', () => {
  it('sends a preset message and shows it in the log with the translated text', async () => {
    mocked.getRoom.mockResolvedValue(room({ members: [member('host'), member('u-me')] }));
    (api.sendRoomChat as ReturnType<typeof vi.fn>).mockResolvedValue(
      room({
        members: [member('host'), member('u-me')],
        chat: [{ userId: 'u-me', presetId: 'GOOD_LUCK', ts: 1 }],
      }),
    );
    render(<RoomScreen />);
    const btn = await screen.findByRole('button', { name: '祝你好運,玩得開心!' });
    fireEvent.click(btn);
    expect(api.sendRoomChat).toHaveBeenCalledWith('ABCD', 'GOOD_LUCK');
    expect(await screen.findByText('祝你好運,玩得開心!', { selector: 'li *' })).toBeInTheDocument();
  });

  it('renders an existing chat log entry attributed to the sending member', async () => {
    mocked.getRoom.mockResolvedValue(
      room({
        members: [member('host'), member('u-me')],
        chat: [{ userId: 'host', presetId: 'THANKS', ts: 1 }],
      }),
    );
    render(<RoomScreen />);
    expect(await screen.findByText('謝謝!', { selector: 'li *' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `yarn workspace @trm/web test --run RoomScreen`
Expected: FAIL — no preset buttons or chat log render yet in `RoomScreen.tsx`.

- [ ] **Step 4: Add the chat UI to `RoomScreen.tsx`**

Add the import. Replace:

```tsx
import { Switch } from '../components/ui/Switch';
import { Segmented } from '../components/ui/Segmented';
import type { Locale } from '../store/ui';
```

with:

```tsx
import { Switch } from '../components/ui/Switch';
import { Segmented } from '../components/ui/Segmented';
import type { Locale } from '../store/ui';
import { CHAT_PRESET_IDS, chatPresetKey } from '../game/chatPresets';
```

Add `chatAuthorName` right after `memberName`'s definition — replace:

```ts
const memberName = (m: RoomMember): string =>
  m.isBot ? t('botName', { level: t(`difficulty_${m.difficulty ?? 'EASY'}`) }) : m.displayName;
```

with:

```ts
const memberName = (m: RoomMember): string =>
  m.isBot ? t('botName', { level: t(`difficulty_${m.difficulty ?? 'EASY'}`) }) : m.displayName;
const chatAuthorName = (userId: string): string => {
  const m = room.members.find((x) => x.userId === userId);
  return m ? memberName(m) : userId;
};
```

Add the `sendChat` handler right after `kick` — replace:

```ts
const kick = (userId: string) => void guard(api.kickPlayer(code, userId));
```

with:

```ts
const kick = (userId: string) => void guard(api.kickPlayer(code, userId));
const sendChat = (presetId: string) => void guard(api.sendRoomChat(code, presetId));
```

Add the chat card right after the member list's closing `</ul>` (before the `<fieldset className="card stack game-settings" ...>`) — replace:

```ts
      </ul>

      <fieldset className="card stack game-settings" disabled={settingsLocked}>
```

with:

```ts
      </ul>

      <div className="card stack room-chat">
        <div className="row wrap">
          {CHAT_PRESET_IDS.map((id) => (
            <button key={id} type="button" className="chip-btn" onClick={() => sendChat(id)}>
              {t(chatPresetKey(id))}
            </button>
          ))}
        </div>
        {room.chat.length > 0 && (
          <ul className="room-chat-log">
            {room.chat.map((c, i) => (
              <li key={i}>
                <strong>{chatAuthorName(c.userId)}</strong>: {t(chatPresetKey(c.presetId))}
              </li>
            ))}
          </ul>
        )}
      </div>

      <fieldset className="card stack game-settings" disabled={settingsLocked}>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `yarn workspace @trm/web test --run RoomScreen`
Expected: PASS (all existing + 2 new tests)

- [ ] **Step 6: Add the CSS**

In `apps/web/src/styles/app.css`, right after the `.bot-controls { flex-wrap: wrap; }` rule, add:

```css
.room-chat {
  gap: var(--tr-space-2);
}
.chip-btn {
  font-size: 0.8em;
  padding: 2px 10px;
  border-radius: 999px;
  border: 1px solid var(--tr-line);
  background: var(--tr-surface-2);
  color: var(--tr-ink);
  cursor: pointer;
}
.room-chat-log {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 0.85em;
}
```

- [ ] **Step 7: Typecheck, lint, run the full web suite**

Run: `yarn workspace @trm/web typecheck && yarn workspace @trm/web lint && yarn workspace @trm/web test`
Expected: no errors, full suite green.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/net/rest.ts apps/web/src/screens/RoomScreen.tsx apps/web/src/screens/RoomScreen.test.tsx apps/web/src/styles/app.css
git commit -m "feat(web): add preset chat to the lobby room screen"
```

---

## Task 11: Admin server — expose preset chat in game detail

**Files:**

- Modify: `apps/server/src/dashboard/dashboard-games.service.ts`
- Modify: `apps/server/src/dashboard/dashboard.schemas.ts`
- Test: `apps/server/test/dashboard-read.e2e.spec.ts`

**Interfaces:**

- Consumes: `GameChatDoc.content`/`ChatContent` from `../persistence/types` (Task 4, already widened).
- Produces: `GET /dashboard/games/:gameId` response's `chat[]` entries now carry `{ playerId, ts, kind: 'text' | 'preset', value }`. Consumed by Task 12 (admin web).

- [ ] **Step 1: Write the failing test**

In `apps/server/test/dashboard-read.e2e.spec.ts`, add this to the `beforeAll` block, right after the `gameEvents` insert (`await t.db.collection('gameEvents').insertMany([...]);`):

```ts
await t.db.collection('gameChats').insertMany([
  {
    gameId: doneGameId,
    seq: 0,
    playerId: 'p-one',
    content: { case: 'text', value: 'gg' },
    ts: now,
  },
  {
    gameId: doneGameId,
    seq: 1,
    playerId: 'p-two',
    content: { case: 'presetId', value: 'GOOD_GAME' },
    ts: now,
  },
] as never[]);
```

Add a new test inside the `describe('games', ...)` block, right after `'COMPLETED game detail includes the seed'`:

```ts
it('COMPLETED game detail exposes chat with a text/preset discriminator', async () => {
  const res = await request(server())
    .get(`/api/v1/dashboard/games/${doneGameId}`)
    .set(auth(admin.token))
    .expect(200);
  expect(res.body.chat).toEqual([
    { playerId: 'p-one', ts: expect.any(String), kind: 'text', value: 'gg' },
    { playerId: 'p-two', ts: expect.any(String), kind: 'preset', value: 'GOOD_GAME' },
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/server test --run dashboard-read`
Expected: FAIL — `gameDetail()` still maps `chat.map((c) => ({ playerId: c.playerId, text: c.text, ts: ... }))`, which no longer matches the (widened) `GameChatDoc` shape and doesn't produce `kind`/`value`.

- [ ] **Step 3: Update `gameDetail()`'s chat mapping**

In `apps/server/src/dashboard/dashboard-games.service.ts`, replace:

```ts
      chat: chat.map((c) => ({ playerId: c.playerId, text: c.text, ts: c.ts.toISOString() })),
```

with:

```ts
      chat: chat.map((c) => ({
        playerId: c.playerId,
        ts: c.ts.toISOString(),
        kind: c.content.case === 'presetId' ? ('preset' as const) : ('text' as const),
        value: c.content.value,
      })),
```

- [ ] **Step 4: Update the response schema**

In `apps/server/src/dashboard/dashboard.schemas.ts`, replace:

```ts
  chat: z.array(z.object({ playerId: z.string(), text: z.string(), ts: z.string() })),
```

with:

```ts
  chat: z.array(
    z.object({
      playerId: z.string(),
      ts: z.string(),
      kind: z.enum(['text', 'preset']),
      value: z.string(),
    }),
  ),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `yarn workspace @trm/server test --run dashboard-read`
Expected: PASS (all tests in the file, including the new one)

- [ ] **Step 6: Typecheck, lint, run the full server suite**

Run: `yarn workspace @trm/server typecheck && yarn workspace @trm/server lint && yarn workspace @trm/server test`
Expected: no errors, full suite green.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/dashboard/dashboard-games.service.ts apps/server/src/dashboard/dashboard.schemas.ts apps/server/test/dashboard-read.e2e.spec.ts
git commit -m "feat(server): expose a text/preset discriminator on dashboard game-detail chat"
```

---

## Task 12: Admin web — translated, marked preset chat in `GamesView`

**Files:**

- Modify: `apps/admin/src/net/rest.ts`
- Create: `apps/admin/src/game/chatPresets.ts`
- Modify: `apps/admin/src/i18n/index.ts`
- Modify: `apps/admin/src/views/GamesView.tsx`
- Test: Create `apps/admin/src/views/GamesView.test.tsx`

**Interfaces:**

- Consumes: `CHAT_PRESET_IDS` from `@trm/shared` (Task 1), the widened `chat[]` shape from `GET /dashboard/games/:id` (Task 11).
- Produces: nothing consumed further — this is the terminal task for the admin surface.

- [ ] **Step 1: Widen the `GameDetail` type**

In `apps/admin/src/net/rest.ts`, replace:

```ts
chat: {
  playerId: string;
  text: string;
  ts: string;
}
[];
```

with:

```ts
chat: {
  playerId: string;
  ts: string;
  kind: 'text' | 'preset';
  value: string;
}
[];
```

- [ ] **Step 2: Create the admin preset helper**

Create `apps/admin/src/game/chatPresets.ts`:

```ts
import { CHAT_PRESET_IDS } from '@trm/shared';

export { CHAT_PRESET_IDS };

/** The i18n key for a preset chat message's translated text. */
export const chatPresetKey = (id: string): string => `chat.presets.${id}`;
```

- [ ] **Step 3: Add the i18n keys**

In `apps/admin/src/i18n/index.ts`, add `chatPresetBadge` to `zhHant.games` — replace:

```ts
    chat: '聊天紀錄',
    chatEmpty: '沒有聊天訊息',
```

with:

```ts
    chat: '聊天紀錄',
    chatEmpty: '沒有聊天訊息',
    chatPresetBadge: '預設',
```

And to `en.games` — replace:

```ts
    chat: 'Chat transcript',
    chatEmpty: 'No chat messages',
```

with:

```ts
    chat: 'Chat transcript',
    chatEmpty: 'No chat messages',
    chatPresetBadge: 'Preset',
```

Add a new top-level `chat: { presets: {...} }` object to `zhHant`, right after the `games: {...}` block closes and before `rooms: {...}` starts. Replace:

```ts
    terminatedBy: '終止執行者',
    terminatedReason: '終止原因',
    bot: '電腦',
    you: '',
  },
  rooms: {
```

with:

```ts
    terminatedBy: '終止執行者',
    terminatedReason: '終止原因',
    bot: '電腦',
    you: '',
  },
  chat: {
    presets: {
      GREETING: '哈囉!',
      GOOD_LUCK: '祝你好運,玩得開心!',
      THANKS: '謝謝!',
      SORRY: '抱歉!',
      ONE_MOMENT: '請稍等一下',
      NICE_MOVE: '這步不錯!',
      WELL_PLAYED: '打得好!',
      GOOD_GAME: '這局精彩!',
      LETS_GO: '開始吧!',
      STILL_THERE: '你還在嗎?',
      YES: '好',
      NO: '不',
    },
  },
  rooms: {
```

And the matching block to `en`, right after ITS `games: {...}` block closes and before `rooms: {...}` starts. Replace:

```ts
    terminatedBy: 'Terminated by',
    terminatedReason: 'Reason',
    bot: 'bot',
    you: '',
  },
  rooms: {
```

with:

```ts
    terminatedBy: 'Terminated by',
    terminatedReason: 'Reason',
    bot: 'bot',
    you: '',
  },
  chat: {
    presets: {
      GREETING: 'Hello!',
      GOOD_LUCK: 'Good luck, have fun!',
      THANKS: 'Thanks!',
      SORRY: 'Sorry!',
      ONE_MOMENT: 'One moment please',
      NICE_MOVE: 'Nice move!',
      WELL_PLAYED: 'Well played!',
      GOOD_GAME: 'Good game!',
      LETS_GO: "Let's go!",
      STILL_THERE: 'Are you still there?',
      YES: 'Yes',
      NO: 'No',
    },
  },
  rooms: {
```

- [ ] **Step 4: Write the failing test**

Create `apps/admin/src/views/GamesView.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '../i18n';
import { GamesView } from './GamesView';
import { useUi } from '../store/ui';
import { useSession } from '../store/session';

interface Route {
  status: number;
  body: unknown;
}
function stubFetch(routes: Record<string, Route>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const hit = Object.entries(routes).find(([path]) => url.includes(path));
      const route = hit?.[1] ?? { status: 404, body: { message: 'not found' } };
      return new Response(JSON.stringify(route.body), { status: route.status });
    }),
  );
}

const GAME_DETAIL = {
  gameId: 'g1',
  status: 'COMPLETED',
  currentSeq: 2,
  engineVersion: 1,
  contentHash: 'abc',
  schemaVersion: 1,
  inMemory: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  seed: 'seed-1',
  players: [{ id: 'p-one', seat: 0, isBot: false }],
  spectators: [],
  chat: [
    { playerId: 'p-one', ts: '2026-01-01T00:00:00.000Z', kind: 'text', value: 'gg' },
    { playerId: 'p-two', ts: '2026-01-01T00:00:01.000Z', kind: 'preset', value: 'GOOD_GAME' },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  useUi.setState({ view: 'games', param: 'g1' });
  useSession.setState({
    phase: 'ready',
    user: { id: 'u1', displayName: 'Ops', isGuest: false },
    role: 'admin',
    permissions: new Set(['games.read']),
  });
  stubFetch({
    '/dashboard/games/g1': { status: 200, body: GAME_DETAIL },
    '/dashboard/games?': { status: 200, body: { games: [], nextCursor: null } },
  });
});

describe('GamesView chat section', () => {
  it('renders free text unmarked and a preset translated with a badge', async () => {
    render(<GamesView />);
    expect(await screen.findByText('gg')).toBeInTheDocument();
    expect(await screen.findByText('這局精彩!')).toBeInTheDocument();
    expect(screen.queryByText('GOOD_GAME')).not.toBeInTheDocument();
    expect(screen.getByText('預設')).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `yarn workspace @trm/admin test GamesView`
Expected: FAIL — `GamesView.tsx`'s chat section still renders `c.text` (which no longer exists on the widened `GameDetail.chat` entries) untranslated and unmarked.

- [ ] **Step 6: Update `GamesView.tsx`'s chat section**

Add the import to the top of `apps/admin/src/views/GamesView.tsx`. Replace:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError, type GameDetail, type GameLogEntry, type GameRow } from '../net/rest';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { SignalBadge, aspectForStatus } from '../components/SignalBadge';
import { Drawer } from '../components/Drawer';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { fmtDateTime, shortId } from '../lib/fmt';
```

with:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError, type GameDetail, type GameLogEntry, type GameRow } from '../net/rest';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { SignalBadge, aspectForStatus } from '../components/SignalBadge';
import { Drawer } from '../components/Drawer';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { fmtDateTime, shortId } from '../lib/fmt';
import { chatPresetKey } from '../game/chatPresets';
```

Replace the chat section:

```tsx
<section>
  <h3>{t('games.chat')}</h3>
  {detail.chat.length === 0 ? (
    <p className="oc-muted">{t('games.chatEmpty')}</p>
  ) : (
    detail.chat.map((c, i) => (
      <div className="oc-kv" key={i}>
        <span className="k oc-mono">{shortId(c.playerId)}</span>
        <span className="v" style={{ fontFamily: 'inherit' }}>
          {c.text}
        </span>
      </div>
    ))
  )}
</section>
```

with:

```tsx
<section>
  <h3>{t('games.chat')}</h3>
  {detail.chat.length === 0 ? (
    <p className="oc-muted">{t('games.chatEmpty')}</p>
  ) : (
    detail.chat.map((c, i) => (
      <div className="oc-kv" key={i}>
        <span className="k oc-mono">{shortId(c.playerId)}</span>
        <span className="v" style={{ fontFamily: 'inherit' }}>
          {c.kind === 'preset' ? (
            <>
              {t(chatPresetKey(c.value))}{' '}
              <span className="oc-chip">{t('games.chatPresetBadge')}</span>
            </>
          ) : (
            c.value
          )}
        </span>
      </div>
    ))
  )}
</section>
```

- [ ] **Step 7: Run test to verify it passes**

Run: `yarn workspace @trm/admin test GamesView`
Expected: PASS (1 test)

- [ ] **Step 8: Typecheck, lint, run the full admin suite**

Run: `yarn workspace @trm/admin typecheck && yarn workspace @trm/admin lint && yarn workspace @trm/admin test`
Expected: no errors, full suite green.

- [ ] **Step 9: Commit**

```bash
git add apps/admin/src/net/rest.ts apps/admin/src/game/chatPresets.ts apps/admin/src/i18n/index.ts apps/admin/src/views/GamesView.tsx apps/admin/src/views/GamesView.test.tsx
git commit -m "feat(admin): translate and badge preset chat messages in the game detail drawer"
```

---

## Task 13: Full verification sweep

**Files:** none (verification only).

- [ ] **Step 1: Full monorepo build (proto codegen → dependent packages)**

Run: `yarn build`
Expected: succeeds for every workspace (this re-runs `@trm/proto generate` as part of the `^build` dependency graph, confirming nothing downstream still references the old flat `text` fields).

- [ ] **Step 2: Full monorepo typecheck**

Run: `yarn typecheck`
Expected: no errors anywhere (catches any remaining caller of the old `chatFrame`/`historyReplayFrame`/`GameStorePort.appendChat` signatures, or any leftover `.text` access on a chat message across all workspaces).

- [ ] **Step 3: Full monorepo lint**

Run: `yarn lint`
Expected: no errors.

- [ ] **Step 4: Full monorepo test suite**

Run: `yarn test`
Expected: all green, across `@trm/shared`, `@trm/proto`, `@trm/codec`, `apps/server`, `apps/web`, `apps/admin`.

- [ ] **Step 5: Format check**

Run: `yarn format:check`
Expected: no diffs (run `yarn format` and re-stage if it reports any).

- [ ] **Step 6: Manual smoke test — in-game**

Run: `docker compose up -d mongo`, then in separate terminals `yarn workspace @trm/server dev` and `yarn workspace @trm/web dev`. Start a 2-player game (bots or a second browser/incognito tab). In the in-game chat panel:

- Confirm the preset button row renders above the text input, each button showing translated text.
- Click a preset button; confirm it appears in both players' chat logs.
- Switch one browser's locale (locale toggle in the UI) and confirm the same preset entry now reads in the other language without resending anything.
- Confirm free-text chat still works exactly as before (send, receive, length limit, rate limit).
- Reconnect (refresh) mid-game and confirm both preset and free-text messages backfill correctly via `HistoryReplay`.

- [ ] **Step 7: Manual smoke test — lobby**

Create a room with a second account/tab joined. Confirm the preset button row + chat log render in the lobby, sending a preset appears for both members within the 2-second poll window, and it survives a page refresh (persisted on the room doc) until the game starts.

- [ ] **Step 8: Manual smoke test — admin dashboard**

Run: `yarn workspace @trm/admin dev`. Open the completed game's detail drawer (or the one just played, once finished) as a maintainer account with `games.read`. Confirm free-text lines render as before, and the preset line you sent renders translated with the "預設"/"Preset" chip next to it.

- [ ] **Step 9: Final commit (if any format/lint fixes were needed)**

```bash
git add -A
git status
```

Review the diff before committing — only stage files this plan actually touched. If Step 5 reformatted anything:

```bash
git commit -m "chore: format fixes from the preset chat messages verification sweep"
```

If nothing changed in this step, skip the commit — the feature is already fully committed task-by-task.
