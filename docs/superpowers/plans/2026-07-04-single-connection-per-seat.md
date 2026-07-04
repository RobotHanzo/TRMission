# Single Connection Per Seat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce one live WebSocket connection per (room, seat): when a second `Hello` binds a
seat that already has a connection, the older connection is force-closed and shown a blocking
"disconnected elsewhere" dialog; the newer connection keeps playing normally.

**Architecture:** `GameHub.onHello` (server) detects an existing, different `Connection` already
bound to the seat being claimed, sends it a `Rejection` frame carrying a new `SESSION_REPLACED`
code, then force-closes its socket with a dedicated WS close code (`4001`). The client's
`GameSocket` recognizes that close code, suppresses its normal auto-reconnect backoff, and fires a
new `onSessionReplaced` handler that flips a zustand store flag; `GameScreen` renders a blocking
modal (styled like `RoomScreen.tsx`'s existing "kicked" dialog) gated on that flag.

**Tech Stack:** NestJS + `ws` + protobuf-es (server, `apps/server`), React + zustand + i18next
(client, `apps/web`), vitest (both), Yarn 4 / Turborepo monorepo, `@trm/shared` cross-cutting
constants, `@trm/proto` (buf-generated wire types).

## Global Constraints

- Spec source of truth: `docs/superpowers/specs/2026-07-04-single-connection-per-seat-design.md`.
- Scope is per room/seat, not per account — a player may still hold two different rooms open in
  two different tabs simultaneously. Do not add any cross-room tracking.
- Only seated players (seat ≥ 0) are affected. Spectator connections (seat `-1`, the `spectators`
  `Set` in `hub.ts`) are unaffected — do not touch that path.
- After editing `packages/proto/proto/trmission/v1/common.proto`, regenerate with
  `yarn workspace @trm/proto generate`. `src/gen/**` is gitignored; a drift between it and the
  `.proto` is a CI failure, so always regenerate in the same task as a `.proto` edit.
- Server tests live under `apps/server/test/*.spec.ts` only (`apps/server/vitest.config.ts`:
  `include: ['test/**/*.spec.ts']`). A test file placed under `apps/server/src/**` will silently
  never run — always add new server tests under `apps/server/test/`.
- Web tests are colocated under `apps/web/src/**/*.{test,spec}.{ts,tsx}` (existing convention;
  `apps/web/vite.config.ts`: `include: ['src/**/*.{test,spec}.{ts,tsx}']`).
- `apps/server` runs via swc (`@swc-node/register`/`unplugin-swc`), never tsx/esbuild — do not
  change server build/dev tooling as part of this work.
- The one WS close code this feature introduces is `SESSION_REPLACED_CLOSE_CODE = 4001`,
  defined exactly once in `@trm/shared` and imported by both the server and the client — never
  duplicate the literal.

---

### Task 1: Shared WS close-code constant

**Files:**
- Create: `packages/shared/src/ws.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces: `SESSION_REPLACED_CLOSE_CODE: number` (value `4001`), importable as
  `import { SESSION_REPLACED_CLOSE_CODE } from '@trm/shared'`. Consumed by Task 3 (server) and
  Task 4 (client).

**Note on testing:** `packages/shared/src` has no existing precedent for testing plain constants
(`enums.ts`/`constants.ts`/`roomCode.ts` have no `*.test.ts` files — they're exercised indirectly
by their consumers). This task is a pure constant addition with no branching logic to red/green, so
its "test" is the typecheck plus the consumers added in Tasks 3 and 4, which import and assert
against the actual value.

- [ ] **Step 1: Create the constant file**

```ts
// packages/shared/src/ws.ts
/**
 * Custom WS close code (application range, RFC 6455 §7.4.2) sent by the server when a
 * connection is force-closed because another connection took over its seat. The client
 * checks this code to suppress its normal auto-reconnect.
 */
export const SESSION_REPLACED_CLOSE_CODE = 4001;
```

- [ ] **Step 2: Export it from the package entrypoint**

Edit `packages/shared/src/index.ts` — add one line (order matches the existing alphabetical-ish
grouping, appended at the end):

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
```

- [ ] **Step 3: Typecheck**

Run: `yarn workspace @trm/shared typecheck`
Expected: passes with no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/ws.ts packages/shared/src/index.ts
git commit -m "feat(shared): add SESSION_REPLACED_CLOSE_CODE constant"
```

---

### Task 2: Server forced-close capability

**Files:**
- Modify: `apps/server/src/ws/connection.ts`
- Modify: `apps/server/src/ws/hub.ts` (only the `openConnection` method, lines 190-195)
- Modify: `apps/server/src/ws/ws-server.ts`
- Test: `apps/server/test/connection.spec.ts` (new)

**Interfaces:**
- Produces: `export type CloseFn = (code: number, reason: string) => void` from `connection.ts`;
  `Connection.terminate(code: number, reason: string): void`; `Connection`'s constructor gains an
  optional 3rd param `closeFn?: CloseFn`; `GameHub.openConnection(id: string, sink: Sink, closeFn?:
  CloseFn): Connection`. Consumed by Task 3 (hub kick logic) and production `ws-server.ts` wiring
  in this same task.
- Consumes: nothing new from earlier tasks.

- [ ] **Step 1: Write the failing test**

Create `apps/server/test/connection.spec.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { GameRegistry } from '../src/game/game-registry';
import { GameHub } from '../src/ws/hub';
import { Connection } from '../src/ws/connection';

describe('Connection.terminate', () => {
  it('invokes the closeFn with the given code and reason', () => {
    const closeFn = vi.fn();
    const conn = new Connection('c1', () => {}, closeFn);
    conn.terminate(4001, 'session_replaced');
    expect(closeFn).toHaveBeenCalledWith(4001, 'session_replaced');
  });

  it('is a no-op when no closeFn was provided', () => {
    const conn = new Connection('c1', () => {});
    expect(() => conn.terminate(4001, 'session_replaced')).not.toThrow();
  });
});

describe('GameHub.openConnection', () => {
  it('threads an optional closeFn through to the returned Connection', () => {
    const hub = new GameHub(new GameRegistry());
    const closeFn = vi.fn();
    const conn = hub.openConnection('c1', () => {}, closeFn);
    conn.terminate(4001, 'session_replaced');
    expect(closeFn).toHaveBeenCalledWith(4001, 'session_replaced');
  });

  it('keeps working with the existing 2-arg call (closeFn stays optional)', () => {
    const hub = new GameHub(new GameRegistry());
    const conn = hub.openConnection('c2', () => {});
    expect(() => conn.terminate(4001, 'session_replaced')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `yarn workspace @trm/server test --run connection.spec`
Expected: FAIL to compile — `Connection`'s constructor doesn't accept a 3rd argument and has no
`terminate` method yet; `GameHub.openConnection` doesn't accept a 3rd argument either.

- [ ] **Step 3: Implement the `Connection` changes**

Replace `apps/server/src/ws/connection.ts` in full:

```ts
// A single client socket. Owns the outbound server_seq and the idempotency cursor
// (highest client_seq already processed, A7). Transport-agnostic: `sink` is just a
// byte writer, so the dispatcher can be exercised in-process with zero network.
import { create, toBinary } from '@bufbuild/protobuf';
import { ServerEnvelopeSchema } from '@trm/proto';
import type { PlayerId } from '@trm/shared';
import type { ServerEvent } from '@trm/codec';

export type Sink = (bytes: Uint8Array) => void;

/** Force-close the underlying transport (e.g. a seat was claimed by another connection). */
export type CloseFn = (code: number, reason: string) => void;

export interface ConnectionBinding {
  readonly gameId: string;
  readonly player: PlayerId;
  readonly seat: number;
}

export class Connection {
  private serverSeq = 0;
  lastClientSeq = 0;
  binding: ConnectionBinding | null = null;
  /** Wall-clock timestamps of recent chat sends, for the per-connection rate limit. */
  chatTimes: number[] = [];

  constructor(
    readonly id: string,
    private readonly sink: Sink,
    private readonly closeFn?: CloseFn,
  ) {}

  get isBound(): boolean {
    return this.binding !== null;
  }

  send(event: ServerEvent, ackClientSeq = 0): void {
    this.serverSeq += 1;
    const env = create(ServerEnvelopeSchema, { serverSeq: this.serverSeq, ackClientSeq, event });
    this.sink(toBinary(ServerEnvelopeSchema, env));
  }

  /** Force-close the transport, e.g. when another connection has taken over this seat. */
  terminate(code: number, reason: string): void {
    this.closeFn?.(code, reason);
  }
}
```

- [ ] **Step 4: Update `GameHub.openConnection`**

In `apps/server/src/ws/hub.ts`, change the import on line 22 from:

```ts
import { Connection, type Sink } from './connection';
```

to:

```ts
import { Connection, type CloseFn, type Sink } from './connection';
```

Then change the `openConnection` method (currently lines 190-195):

```ts
  openConnection(id: string, sink: Sink): Connection {
    const conn = new Connection(id, sink);
    this.connections.set(id, conn);
    this.metrics.connectionOpened();
    return conn;
  }
```

to:

```ts
  openConnection(id: string, sink: Sink, closeFn?: CloseFn): Connection {
    const conn = new Connection(id, sink, closeFn);
    this.connections.set(id, conn);
    this.metrics.connectionOpened();
    return conn;
  }
```

- [ ] **Step 5: Wire the real socket close in `ws-server.ts`**

In `apps/server/src/ws/ws-server.ts`, change (currently lines 17-19):

```ts
    hub.openConnection(id, (bytes) => {
      if (socket.readyState === socket.OPEN) socket.send(bytes);
    });
```

to:

```ts
    hub.openConnection(
      id,
      (bytes) => {
        if (socket.readyState === socket.OPEN) socket.send(bytes);
      },
      (code, reason) => socket.close(code, reason),
    );
```

- [ ] **Step 6: Run the test, confirm it passes**

Run: `yarn workspace @trm/server test --run connection.spec`
Expected: PASS (4 tests).

- [ ] **Step 7: Run the full server suite to confirm no regressions**

Run: `yarn workspace @trm/server test`
Expected: all existing suites still PASS (every existing `hub.openConnection(id, sink)` 2-arg call
site keeps compiling since `closeFn` is optional).

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/ws/connection.ts apps/server/src/ws/hub.ts apps/server/src/ws/ws-server.ts apps/server/test/connection.spec.ts
git commit -m "feat(server): add a forced-close capability to Connection"
```

---

### Task 3: Proto `SESSION_REPLACED` code + kick-on-Hello logic

**Files:**
- Modify: `packages/proto/proto/trmission/v1/common.proto`
- Modify: `apps/server/src/ws/hub.ts` (`onHello`, and its `@trm/shared` import line)
- Test: `apps/server/test/ws-session-replace.e2e.spec.ts` (new)

**Interfaces:**
- Consumes: `Connection.terminate` + `GameHub.openConnection`'s `closeFn` param (Task 2);
  `SESSION_REPLACED_CLOSE_CODE` (Task 1).
- Produces: `RejectionCode.SESSION_REPLACED` (generated proto enum value `7`); the kick behavior in
  `onHello` that later tasks don't directly depend on (this is the terminal server-side behavior).

- [ ] **Step 1: Add the proto enum value**

In `packages/proto/proto/trmission/v1/common.proto`, change:

```proto
  REJECTION_CODE_UNAUTHENTICATED = 1;
  REJECTION_CODE_BAD_SEQUENCE = 2;
  REJECTION_CODE_MALFORMED = 3;
  REJECTION_CODE_NOT_IN_GAME = 4;
  REJECTION_CODE_RATE_LIMITED = 5;
  REJECTION_CODE_INTERNAL = 6;

  // engine rule violations (RuleViolationCode)
```

to:

```proto
  REJECTION_CODE_UNAUTHENTICATED = 1;
  REJECTION_CODE_BAD_SEQUENCE = 2;
  REJECTION_CODE_MALFORMED = 3;
  REJECTION_CODE_NOT_IN_GAME = 4;
  REJECTION_CODE_RATE_LIMITED = 5;
  REJECTION_CODE_INTERNAL = 6;
  REJECTION_CODE_SESSION_REPLACED = 7;

  // engine rule violations (RuleViolationCode)
```

- [ ] **Step 2: Regenerate the proto codegen**

Run: `yarn workspace @trm/proto generate`
Expected: succeeds; `packages/proto/src/gen/**` now contains `RejectionCode.SESSION_REPLACED = 7`
(protobuf-es strips the `REJECTION_CODE_` prefix, matching every other value in this enum).

- [ ] **Step 3: Write the failing e2e test**

Create `apps/server/test/ws-session-replace.e2e.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { taiwanBoard, CONTENT_HASH, type PlayerSeed } from '@trm/engine';
import { asPlayerId, SESSION_REPLACED_CLOSE_CODE } from '@trm/shared';
import { RejectionCode, type ServerEnvelope } from '@trm/proto';
import { GameRegistry } from '../src/game/game-registry';
import { GameHub } from '../src/ws/hub';
import { makeDevTicket } from '../src/ws/ticket';
import { encodeClient, decodeServer } from './helpers';

const players: PlayerSeed[] = [
  { id: asPlayerId('p1'), seat: 0 },
  { id: asPlayerId('p2'), seat: 1 },
  { id: asPlayerId('p3'), seat: 2 },
];
const gameId = 'sess';

interface Wired {
  hub: GameHub;
  received: Map<string, ServerEnvelope[]>;
  terminated: Map<string, [number, string]>;
  seq: Map<string, number>;
}

async function wireGame(): Promise<Wired> {
  const hub = new GameHub(new GameRegistry());
  await hub.createMatch(gameId, taiwanBoard(), {
    seed: 'sess-1',
    players,
    contentHash: CONTENT_HASH,
  });
  return { hub, received: new Map(), terminated: new Map(), seq: new Map() };
}

/** Open a new connection (its own connId) whose frames + terminate call are captured. */
function openConn(w: Wired, connId: string): void {
  w.received.set(connId, []);
  w.seq.set(connId, 0);
  w.hub.openConnection(
    connId,
    (bytes) => w.received.get(connId)!.push(decodeServer(bytes)),
    (code, reason) => w.terminated.set(connId, [code, reason]),
  );
}

const hello = async (w: Wired, connId: string, pid: string, seat: number): Promise<void> => {
  const next = (w.seq.get(connId) ?? 0) + 1;
  w.seq.set(connId, next);
  await w.hub.receive(
    connId,
    encodeClient(next, {
      case: 'hello',
      value: { ticket: makeDevTicket({ gameId, playerId: pid, seat }), protocolVersion: 2 },
    }),
  );
};

const rejections = (w: Wired, connId: string): ServerEnvelope[] =>
  (w.received.get(connId) ?? []).filter((f) => f.event.case === 'rejection');

describe('single connection per seat', () => {
  it('kicks the older connection when a second Hello binds the same seat', async () => {
    const w = await wireGame();
    openConn(w, 'p1-a');
    openConn(w, 'p1-b');

    await hello(w, 'p1-a', 'p1', 0);
    await hello(w, 'p1-b', 'p1', 0); // same seat, a different connection

    const rej = rejections(w, 'p1-a');
    expect(rej).toHaveLength(1);
    const frame = rej[0];
    if (frame?.event.case !== 'rejection') throw new Error('unreachable');
    expect(frame.event.value.code).toBe(RejectionCode.SESSION_REPLACED);
    expect(frame.event.value.messageKey).toBe('errors:sessionReplaced');
    expect(w.terminated.get('p1-a')).toEqual([SESSION_REPLACED_CLOSE_CODE, 'session_replaced']);

    // The newer connection was never touched and keeps playing normally.
    expect(w.terminated.get('p1-b')).toBeUndefined();
    expect(rejections(w, 'p1-b')).toHaveLength(0);
  });

  it('does not kick itself on a same-connection reconnect (same connId re-Hello)', async () => {
    const w = await wireGame();
    openConn(w, 'p1-a');

    await hello(w, 'p1-a', 'p1', 0);
    await hello(w, 'p1-a', 'p1', 0); // reconnect: same connId, same seat

    expect(w.terminated.get('p1-a')).toBeUndefined();
    expect(rejections(w, 'p1-a')).toHaveLength(0);
  });

  it('does not affect a different seat in the same room', async () => {
    const w = await wireGame();
    openConn(w, 'p1-a');
    openConn(w, 'p2-a');

    await hello(w, 'p1-a', 'p1', 0);
    await hello(w, 'p2-a', 'p2', 1);

    expect(w.terminated.get('p1-a')).toBeUndefined();
    expect(w.terminated.get('p2-a')).toBeUndefined();
  });
});
```

- [ ] **Step 4: Run it, confirm it fails**

Run: `yarn workspace @trm/server test --run ws-session-replace`
Expected: FAIL — the first test's `expect(rej).toHaveLength(1)` sees `0` (no kick logic exists
yet), and `w.terminated.get('p1-a')` is `undefined` instead of the expected tuple.

- [ ] **Step 5: Add the `@trm/shared` import**

In `apps/server/src/ws/hub.ts`, change line 16 from:

```ts
import { asPlayerId, messageKeyFor } from '@trm/shared';
```

to:

```ts
import { asPlayerId, messageKeyFor, SESSION_REPLACED_CLOSE_CODE } from '@trm/shared';
```

- [ ] **Step 6: Implement the kick-on-Hello check**

In `apps/server/src/ws/hub.ts`'s `onHello`, insert the check immediately before the existing
seat-binding line. Change:

```ts
    conn.binding = { gameId: binding.gameId, player, seat: binding.seat };
    conn.lastClientSeq = Math.max(conn.lastClientSeq, clientSeq);
    this.members.get(binding.gameId)?.set(binding.playerId, conn);
```

to:

```ts
    const prev = this.members.get(binding.gameId)?.get(binding.playerId);
    if (prev && prev !== conn) {
      prev.send(
        rejectionFrame(
          0,
          RejectionCode.SESSION_REPLACED,
          'errors:sessionReplaced',
          'connected elsewhere',
        ),
      );
      prev.terminate(SESSION_REPLACED_CLOSE_CODE, 'session_replaced');
    }

    conn.binding = { gameId: binding.gameId, player, seat: binding.seat };
    conn.lastClientSeq = Math.max(conn.lastClientSeq, clientSeq);
    this.members.get(binding.gameId)?.set(binding.playerId, conn);
```

(`rejectionFrame` and `RejectionCode` are already imported at the top of `hub.ts` — no further
import changes needed.)

- [ ] **Step 7: Run the test, confirm it passes**

Run: `yarn workspace @trm/server test --run ws-session-replace`
Expected: PASS (3 tests).

- [ ] **Step 8: Run the full server suite to confirm no regressions**

Run: `yarn workspace @trm/server test`
Expected: all suites PASS — in particular `ws-camera.e2e.spec.ts`'s existing "reconnect" case
(`await hello(w, 'p1', 0);` twice on the same connId, `ws-camera.e2e.spec.ts:98-112`) must still
pass, since that's the same-connection-reuse path this task's `prev !== conn` guard is designed to
leave alone.

- [ ] **Step 9: Commit**

```bash
git add packages/proto/proto/trmission/v1/common.proto apps/server/src/ws/hub.ts apps/server/test/ws-session-replace.e2e.spec.ts
git commit -m "feat(server): kick the older connection when a seat is re-claimed"
```

---

### Task 4: Client `GameSocket` — recognize the forced close

**Files:**
- Modify: `apps/web/src/net/socket.ts`
- Test: `apps/web/src/net/socket.test.ts` (append)

**Interfaces:**
- Consumes: `SESSION_REPLACED_CLOSE_CODE` from `@trm/shared` (Task 1).
- Produces: `SocketHandlers.onSessionReplaced?(): void`, invoked instead of the normal
  `'reconnecting'` status flip when the close code matches. Consumed by Task 5.

- [ ] **Step 1: Write the failing test**

In `apps/web/src/net/socket.test.ts`, change the top-of-file vitest import (currently
`import { describe, it, expect, vi } from 'vitest';`) to:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
```

Add one new import line directly below the existing `@trm/proto` import:

```ts
import { SESSION_REPLACED_CLOSE_CODE } from '@trm/shared';
```

The rest of the file (the `deliver()` helper and the existing `describe('GameSocket history
dispatch', ...)` block) stays exactly as-is. Append this new code at the end of the file:

```ts
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  binaryType = '';
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(): void {}
  close(): void {}
}

describe('GameSocket forced close (session replaced)', () => {
  beforeEach(() => {
    FakeWebSocket.instances.length = 0;
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('suppresses reconnect and fires onSessionReplaced on the dedicated close code', () => {
    const onSessionReplaced = vi.fn();
    const onStatus = vi.fn();
    const socket = new GameSocket('tkt', { onSessionReplaced, onStatus }, 'ws://x');
    socket.connect();
    const ws = FakeWebSocket.instances[0];
    if (!ws) throw new Error('unreachable');
    ws.onclose?.({ code: SESSION_REPLACED_CLOSE_CODE, reason: 'session_replaced' } as CloseEvent);
    expect(onSessionReplaced).toHaveBeenCalledTimes(1);
    expect(onStatus).not.toHaveBeenCalledWith('reconnecting');
  });

  it('still auto-reconnects on an ordinary close code', () => {
    vi.useFakeTimers();
    try {
      const onSessionReplaced = vi.fn();
      const onStatus = vi.fn();
      const socket = new GameSocket('tkt', { onSessionReplaced, onStatus }, 'ws://x');
      socket.connect();
      const ws = FakeWebSocket.instances[0];
      if (!ws) throw new Error('unreachable');
      ws.onclose?.({ code: 1006, reason: '' } as CloseEvent);
      expect(onSessionReplaced).not.toHaveBeenCalled();
      expect(onStatus).toHaveBeenCalledWith('reconnecting');
    } finally {
      vi.useRealTimers();
    }
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `yarn workspace @trm/web test --run socket.test`
Expected: FAIL — `SocketHandlers` has no `onSessionReplaced`, and `onclose` never reads the event's
`code`, so `onSessionReplaced` is never called and `onStatus` is invoked with `'reconnecting'` in
both cases.

- [ ] **Step 3: Implement the `socket.ts` changes**

Add the import (with the existing `@trm/proto` import block):

```ts
import {
  ClientEnvelopeSchema,
  ServerEnvelopeSchema,
  PROTOCOL_VERSION,
  type GameSnapshot,
  type GameEvent,
  type Rejection,
  type Welcome,
  type CameraView,
  type PaymentSchema,
} from '@trm/proto';
import { SESSION_REPLACED_CLOSE_CODE } from '@trm/shared';
```

Add `onSessionReplaced` to `SocketHandlers` (after `onCameraMoved`):

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

Change `ws.onclose` (currently):

```ts
    ws.onclose = () => {
      this.stopHeartbeat();
      if (this.closed) return;
      this.handlers.onStatus?.('reconnecting');
      const delay = Math.min(30_000, 2 ** this.reconnectAttempts * 500);
      this.reconnectAttempts += 1;
      setTimeout(() => this.connect(), delay);
    };
```

to:

```ts
    ws.onclose = (ev: CloseEvent) => {
      this.stopHeartbeat();
      if (this.closed) return;
      if (ev.code === SESSION_REPLACED_CLOSE_CODE) {
        this.closed = true;
        this.handlers.onSessionReplaced?.();
        return;
      }
      this.handlers.onStatus?.('reconnecting');
      const delay = Math.min(30_000, 2 ** this.reconnectAttempts * 500);
      this.reconnectAttempts += 1;
      setTimeout(() => this.connect(), delay);
    };
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `yarn workspace @trm/web test --run socket.test`
Expected: PASS (3 tests: the existing history-dispatch test + the 2 new ones).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/net/socket.ts apps/web/src/net/socket.test.ts
git commit -m "feat(web): recognize the session-replaced close code in GameSocket"
```

---

### Task 5: Client store wiring — `sessionReplaced` flag

**Files:**
- Modify: `apps/web/src/store/game.ts`
- Modify: `apps/web/src/net/connection.ts`
- Test: `apps/web/src/store/game.test.ts` (append)

**Interfaces:**
- Consumes: `SocketHandlers.onSessionReplaced` (Task 4).
- Produces: `GameState.sessionReplaced: boolean`, `GameState.setSessionReplaced(v: boolean): void`.
  Consumed by Task 6.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/src/store/game.test.ts`:

```ts
describe('game store session replaced', () => {
  beforeEach(() => useGame.getState().reset());

  it('setSessionReplaced flips the flag', () => {
    expect(useGame.getState().sessionReplaced).toBe(false);
    useGame.getState().setSessionReplaced(true);
    expect(useGame.getState().sessionReplaced).toBe(true);
  });

  it('reset clears sessionReplaced', () => {
    useGame.getState().setSessionReplaced(true);
    useGame.getState().reset();
    expect(useGame.getState().sessionReplaced).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `yarn workspace @trm/web test --run store/game.test`
Expected: FAIL to compile — `GameState` has no `sessionReplaced` field or `setSessionReplaced`
method yet.

- [ ] **Step 3: Implement the `game.ts` changes**

In `apps/web/src/store/game.ts`, update the `GameState` interface (add after `rejection`):

```ts
interface GameState {
  snapshot: GameSnapshot | null;
  status: SocketStatus;
  recentEvents: GameEvent[];
  /** Latest delivered batch (animation hint channel); null until the first batch / after reset. */
  lastBatch: EventBatch | null;
  rejection: RejectionInfo | null;
  /** Set when this connection was force-closed because another connection took the same seat. */
  sessionReplaced: boolean;
  /** Latest camera framing broadcast by a member; consumed by "follow the acting player". */
  actingCamera: ActingCamera | null;
  applySnapshot(snapshot: GameSnapshot): void;
  applyEvents(stateVersion: number, events: GameEvent[]): void;
  applyCameraMoved(playerId: string, view: CameraView): void;
  setStatus(status: SocketStatus): void;
  setRejection(rejection: RejectionInfo | null): void;
  setSessionReplaced(sessionReplaced: boolean): void;
  reset(): void;
}
```

Update the `creator` (add initial state after `rejection: null,`, the setter after `setRejection`,
and clear it in `reset`):

```ts
const creator: StateCreator<GameState> = (set) => ({
  snapshot: null,
  status: 'closed',
  recentEvents: [],
  lastBatch: null,
  rejection: null,
  sessionReplaced: false,
  actingCamera: null,
  // Snapshot is authoritative; ignore any that arrives out of order (older version).
  // A turn handover (current player changed) drops any stale follow-camera so the next
  // actor's framing starts clean rather than snapping to the previous player's last view.
  applySnapshot: (snapshot) =>
    set((s) => {
      if (s.snapshot && s.snapshot.stateVersion > snapshot.stateVersion) return s;
      const turnChanged = s.snapshot?.currentPlayerId !== snapshot.currentPlayerId;
      return turnChanged ? { snapshot, actingCamera: null } : { snapshot };
    }),
  applyEvents: (_v, events) =>
    set((s) => ({
      recentEvents: [...s.recentEvents, ...events].slice(-50),
      lastBatch: { seq: (s.lastBatch?.seq ?? 0) + 1, events },
    })),
  // Keep only the framing of whoever is acting right now; ignore relays from anyone else.
  applyCameraMoved: (playerId, view) =>
    set((s) =>
      s.snapshot?.currentPlayerId === playerId
        ? { actingCamera: { playerId, view: { cx: view.cx, cy: view.cy, span: view.span } } }
        : s,
    ),
  setStatus: (status) => set({ status }),
  setRejection: (rejection) => set({ rejection }),
  setSessionReplaced: (sessionReplaced) => set({ sessionReplaced }),
  reset: () =>
    set({
      snapshot: null,
      recentEvents: [],
      lastBatch: null,
      rejection: null,
      sessionReplaced: false,
      actingCamera: null,
    }),
});
```

- [ ] **Step 4: Wire the handler in `net/connection.ts`**

In `apps/web/src/net/connection.ts`, add `onSessionReplaced` to the `GameSocket` handlers object
(after `onCameraMoved`):

```ts
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
    onSessionReplaced: () => useGame.getState().setSessionReplaced(true),
  });
```

- [ ] **Step 5: Run the test, confirm it passes**

Run: `yarn workspace @trm/web test --run store/game.test`
Expected: PASS (all existing `game store` tests + the 2 new ones).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/store/game.ts apps/web/src/net/connection.ts apps/web/src/store/game.test.ts
git commit -m "feat(web): add sessionReplaced flag to the game store"
```

---

### Task 6: Dialog UI + i18n

**Files:**
- Modify: `apps/web/src/i18n/index.ts`
- Modify: `apps/web/src/screens/GameScreen.tsx`
- Test: `apps/web/src/screens/GameScreen.test.tsx` (append)

**Interfaces:**
- Consumes: `GameState.sessionReplaced` (Task 5); `useUi`'s `goHome` (already used in
  `GameScreen.tsx` — note `goHome()` already tears down the socket internally via
  `disconnectGame()`, `store/ui.ts:225-229`, so this task does not call `disconnectGame` directly,
  matching how `RoomScreen.tsx`'s existing kicked dialog and `GameScreen.tsx`'s own `leave` both
  just call `goHome`).
- Produces: the user-visible feature — no further consumers.

- [ ] **Step 1: Write the failing test**

Append this new `describe` block at the end of `apps/web/src/screens/GameScreen.test.tsx` (no
import changes needed — `useGame`, `useUi`, `render`, `screen`, `fireEvent` are all already
imported):

```tsx
describe('GameScreen session replaced', () => {
  beforeEach(() => {
    useUi.setState({ view: 'game', ticket: 'tkt', roomCode: 'ABCD', gameId: 'g1' });
  });
  afterEach(() => vi.restoreAllMocks());

  it('shows a blocking dialog and returns home on acknowledgement', () => {
    useGame.setState({ snapshot: null, sessionReplaced: true });
    render(<GameScreen />);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '返回首頁' }));
    expect(useUi.getState().view).toBe('home');
  });
});
```

Note: this test does not assert on `disconnectGame` being called — the mocked `disconnectGame`
from `../net/connection` is a plain `vi.fn()` whose call history is **not** cleared by this file's
`afterEach(() => vi.restoreAllMocks())` (that only restores `vi.spyOn` spies, not factory-created
`vi.fn()`s), and the earlier `GameScreen leave confirmation` tests in this same file already
trigger it via `goHome()` — so a `toHaveBeenCalled()` assertion here would pass unconditionally
regardless of this task's code, which is why the navigation outcome (`view === 'home'`) is the
right thing to assert instead.

- [ ] **Step 2: Run it, confirm it fails**

Run: `yarn workspace @trm/web test --run screens/GameScreen.test`
Expected: FAIL — `useGame.setState({ ..., sessionReplaced: true })` doesn't error (the store
already has the field from Task 5), but no `role="alertdialog"` element exists yet, so
`screen.getByRole('alertdialog')` throws.

- [ ] **Step 3: Add the i18n keys**

In `apps/web/src/i18n/index.ts`, in the zh-Hant block, change:

```ts
      kickedTitle: '你已被移出房間',
      kickedBody: '房主已將你移出此房間。',
      kickedAck: '返回首頁',
```

to:

```ts
      kickedTitle: '你已被移出房間',
      kickedBody: '房主已將你移出此房間。',
      kickedAck: '返回首頁',
      sessionReplacedTitle: '連線已在別處建立',
      sessionReplacedBody: '你的座位已在另一個分頁或裝置上重新連線，這個分頁已中斷連線。',
      sessionReplacedAck: '返回首頁',
```

In the en block, change:

```ts
      kickedTitle: "You've been removed",
      kickedBody: 'The host removed you from this room.',
      kickedAck: 'Back to home',
```

to:

```ts
      kickedTitle: "You've been removed",
      kickedBody: 'The host removed you from this room.',
      kickedAck: 'Back to home',
      sessionReplacedTitle: 'Disconnected elsewhere',
      sessionReplacedBody:
        'Your seat was reconnected from another tab or device, so this tab was disconnected.',
      sessionReplacedAck: 'Back to home',
```

- [ ] **Step 4: Render the dialog in `GameScreen.tsx`**

Replace `apps/web/src/screens/GameScreen.tsx` in full:

```tsx
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useGame } from '../store/game';
import { useUi } from '../store/ui';
import { useRoster } from '../store/roster';
import { api } from '../net/rest';
import { connectGame, getSocket } from '../net/connection';
import { useActiveContent } from '../game/useActiveContent';
import { GameStage } from './GameStage';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useConfirmAction } from '../hooks/useConfirmAction';

/**
 * Live-game shell: owns the socket connect + roster fetch, then delegates the board + HUD to the
 * presentational `GameStage` (shared with the tutorial / encyclopedia sandbox).
 */
export function GameScreen() {
  const { t } = useTranslation();
  const ticket = useUi((s) => s.ticket);
  const roomCode = useUi((s) => s.roomCode);
  const goHome = useUi((s) => s.goHome);

  const snapshot = useGame((s) => s.snapshot);
  const sessionReplaced = useGame((s) => s.sessionReplaced);
  const setRoster = useRoster((s) => s.setMembers);
  const contentStatus = useActiveContent(snapshot?.contentHash);

  useEffect(() => {
    if (ticket && !getSocket()) connectGame(ticket);
  }, [ticket]);
  // Pull the room's members (real account names / bot labels) so the trackers, scoreboard and turn
  // banner can show them instead of "P{seat+1}". Snapshots carry ids only — names are lobby data.
  useEffect(() => {
    if (!roomCode) return;
    let cancelled = false;
    api
      .getRoom(roomCode)
      .then((r) => {
        if (!cancelled) setRoster(r.members);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [roomCode, setRoster]);

  const {
    open: leaveOpen,
    request: requestLeave,
    confirm: confirmLeave,
    cancel: cancelLeave,
  } = useConfirmAction();

  // goHome tears down the socket. Nothing is at stake before the first snapshot arrives, so only
  // confirm once there's an actual game (live play, or the post-game-over ScoreBoard) to abandon.
  const leave = () => {
    if (snapshot) requestLeave(goHome);
    else goHome();
  };

  // Another connection took over this seat — the socket is already closed and will not
  // reconnect. This takes priority over the connecting/error/board states below, since none of
  // them are recoverable once the seat has been claimed elsewhere.
  if (sessionReplaced) {
    return (
      <div className="modal-backdrop">
        <div
          className="modal stack"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="session-replaced-title"
        >
          <h3 id="session-replaced-title">{t('sessionReplacedTitle')}</h3>
          <p>{t('sessionReplacedBody')}</p>
          <div className="row">
            <button className="primary" onClick={goHome}>
              {t('sessionReplacedAck')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!snapshot || contentStatus === 'loading') {
    return (
      <div className="card">
        {t('connecting')} · <button onClick={leave}>{t('back')}</button>
      </div>
    );
  }
  if (contentStatus === 'error') {
    return (
      <div className="card">
        {t('history.unknownMap')} · <button onClick={leave}>{t('back')}</button>
      </div>
    );
  }

  return (
    <>
      <GameStage snapshot={snapshot} commands={getSocket()} onLeave={leave} />
      {leaveOpen && (
        <ConfirmDialog
          title={t('leaveConfirmTitle')}
          message={t('leaveConfirmBody')}
          onConfirm={confirmLeave}
          onCancel={cancelLeave}
        />
      )}
    </>
  );
}
```

- [ ] **Step 5: Run the test, confirm it passes**

Run: `yarn workspace @trm/web test --run screens/GameScreen.test`
Expected: PASS (the new test, plus the existing spectator/leave-confirmation suites in the same
file — `sessionReplaced` defaults to `false` there so the early return never triggers for them).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/i18n/index.ts apps/web/src/screens/GameScreen.tsx apps/web/src/screens/GameScreen.test.tsx
git commit -m "feat(web): show a blocking dialog when the session is replaced elsewhere"
```

---

### Task 7: Full validation

**Files:** none (verification only).

**Interfaces:** none — this task only runs the whole repo's gates.

- [ ] **Step 1: Full typecheck**

Run: `yarn typecheck`
Expected: PASS across every workspace.

- [ ] **Step 2: Full lint**

Run: `yarn lint`
Expected: PASS.

- [ ] **Step 3: Full test suite**

Run: `yarn test`
Expected: PASS across every workspace (this re-runs everything from Tasks 2-6 plus the full
pre-existing suite, confirming no cross-package regression).

- [ ] **Step 4: Manual smoke check (optional but recommended)**

Start the dev stack (`docker compose up -d mongo`, `yarn workspace @trm/server dev`,
`yarn workspace @trm/web dev`), open the same room/seat in two browser tabs, and confirm the first
tab shows the "disconnected elsewhere" dialog within a second or two of the second tab connecting,
and that clicking its button returns to the home screen.

- [ ] **Step 5: Nothing to commit**

This task only runs verification — if Steps 1-3 all pass, there is nothing new to stage or commit.
