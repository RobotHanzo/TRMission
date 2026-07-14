import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { create, toBinary, fromBinary } from '@bufbuild/protobuf';
import { ServerEnvelopeSchema, ClientEnvelopeSchema } from '@trm/proto';
import { SESSION_REPLACED_CLOSE_CODE } from '@trm/shared';
import { GameSocket } from '../src/net/socket';

function deliver(
  socket: GameSocket,
  env: Parameters<typeof create<typeof ServerEnvelopeSchema>>[1],
) {
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
        value: {
          stateVersion: 3,
          events: [],
          chat: [{ playerId: 'p1', ts: 5n, content: { case: 'text', value: 'hi' } }],
        },
      },
    });
    expect(onHistory).toHaveBeenCalledTimes(1);
    expect(onHistory.mock.calls[0]?.[1]).toEqual([
      { playerId: 'p1', content: { case: 'text', value: 'hi' } },
    ]);
  });
});

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static readonly OPEN = 1;
  onopen: (() => void) | null = null;
  onclose: ((ev: { code: number; reason?: string }) => void) | null = null;
  onmessage: ((ev: { data: ArrayBuffer }) => void) | null = null;
  onerror: (() => void) | null = null;
  binaryType = '';
  readyState = 1;
  /** Every frame the client wrote, captured for assertions. */
  sent: Uint8Array[] = [];
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(data: ArrayBufferLike): void {
    this.sent.push(new Uint8Array(data));
  }
  close(): void {}
}

/** The ticket carried by the first ClientHello this socket wrote, if any. */
function helloTicketOf(ws: FakeWebSocket): string | undefined {
  for (const bytes of ws.sent) {
    const env = fromBinary(ClientEnvelopeSchema, bytes);
    if (env.command.case === 'hello') return env.command.value.ticket;
  }
  return undefined;
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
    ws.onclose?.({ code: SESSION_REPLACED_CLOSE_CODE, reason: 'session_replaced' });
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
      ws.onclose?.({ code: 1006, reason: '' });
      expect(onSessionReplaced).not.toHaveBeenCalled();
      expect(onStatus).toHaveBeenCalledWith('reconnecting');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('GameSocket reconnect re-mints the ws ticket', () => {
  beforeEach(() => {
    FakeWebSocket.instances.length = 0;
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // The original ticket is short-lived (server default 45s); after a server restart it is expired,
  // so reusing it makes the reconnect's ClientHello fail UNAUTHENTICATED and the socket stays
  // open-but-unbound — the "keeps saying invalid actions" bug. A fresh ticket must be minted first.
  it('fetches a fresh ticket before reconnecting and sends it in the new hello', async () => {
    vi.useFakeTimers();
    try {
      const refreshTicket = vi.fn().mockResolvedValue('fresh-ticket');
      const socket = new GameSocket('stale-ticket', {}, 'ws://x', refreshTicket);
      socket.connect();
      const ws1 = FakeWebSocket.instances[0];
      if (!ws1) throw new Error('unreachable');
      ws1.onopen?.();
      expect(helloTicketOf(ws1)).toBe('stale-ticket'); // first connect uses the seed ticket

      ws1.onclose?.({ code: 1006, reason: '' });
      expect(refreshTicket).not.toHaveBeenCalled(); // deferred until the backoff elapses

      await vi.advanceTimersByTimeAsync(500);
      expect(refreshTicket).toHaveBeenCalledTimes(1);

      const ws2 = FakeWebSocket.instances[1];
      if (!ws2) throw new Error('reconnect did not open a new socket');
      ws2.onopen?.();
      expect(helloTicketOf(ws2)).toBe('fresh-ticket');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reconnects with the previous ticket if re-minting fails (keeps the backoff loop alive)', async () => {
    vi.useFakeTimers();
    try {
      const refreshTicket = vi.fn().mockRejectedValue(new Error('server still down'));
      const onStatus = vi.fn();
      const socket = new GameSocket('stale-ticket', { onStatus }, 'ws://x', refreshTicket);
      socket.connect();
      const ws1 = FakeWebSocket.instances[0];
      if (!ws1) throw new Error('unreachable');
      ws1.onopen?.();

      ws1.onclose?.({ code: 1006, reason: '' });
      await vi.advanceTimersByTimeAsync(500);
      expect(refreshTicket).toHaveBeenCalledTimes(1);
      // Even though minting failed, a socket is still opened so the close→backoff→retry loop
      // continues to fire until the server (and ticket minting) recover.
      const ws2 = FakeWebSocket.instances[1];
      if (!ws2) throw new Error('reconnect must still open a socket after a mint failure');
      ws2.onopen?.();
      expect(helloTicketOf(ws2)).toBe('stale-ticket');
    } finally {
      vi.useRealTimers();
    }
  });
});
