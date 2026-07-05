import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { create, toBinary } from '@bufbuild/protobuf';
import { ServerEnvelopeSchema } from '@trm/proto';
import { SESSION_REPLACED_CLOSE_CODE } from '@trm/shared';
import { GameSocket } from './socket';

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
