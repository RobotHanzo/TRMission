import { fromBinary } from '@bufbuild/protobuf';
import { ClientEnvelopeSchema, PROTOCOL_VERSION } from '@trm/proto';
import { SESSION_REPLACED_CLOSE_CODE } from '@trm/shared';
import { GameSocket, type SocketHandlers } from './socket';

class FakeWebSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  binaryType = '';
  readyState = FakeWebSocket.OPEN;
  sent: Uint8Array[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: ArrayBuffer }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(data: ArrayBufferView | ArrayBuffer): void {
    this.sent.push(new Uint8Array(data as ArrayBuffer));
  }
  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
  }
}

describe('mobile GameSocket', () => {
  const realWS = (globalThis as { WebSocket?: unknown }).WebSocket;
  beforeEach(() => {
    FakeWebSocket.instances = [];
    (globalThis as { WebSocket?: unknown }).WebSocket = FakeWebSocket;
  });
  afterEach(() => {
    (globalThis as { WebSocket?: unknown }).WebSocket = realWS;
  });

  it('sets binaryType=arraybuffer and sends ClientHello (ticket + protocol version) first', () => {
    const socket = new GameSocket('ticket-xyz', {}, 'ws://test.local/ws');
    socket.connect();
    const ws = FakeWebSocket.instances[0];
    expect(ws.url).toBe('ws://test.local/ws');
    expect(ws.binaryType).toBe('arraybuffer');

    ws.onopen!();

    const hello = fromBinary(ClientEnvelopeSchema, ws.sent[0]);
    expect(hello.command.case).toBe('hello');
    if (hello.command.case !== 'hello') throw new Error('expected hello');
    expect(hello.command.value.ticket).toBe('ticket-xyz');
    expect(hello.command.value.protocolVersion).toBe(PROTOCOL_VERSION);

    const resync = fromBinary(ClientEnvelopeSchema, ws.sent[1]);
    expect(resync.command.case).toBe('resync');

    socket.close(); // clears the heartbeat interval
  });

  it('does not reconnect after a session-replaced close', () => {
    const onSessionReplaced = jest.fn();
    const handlers: SocketHandlers = { onSessionReplaced };
    const socket = new GameSocket('t', handlers, 'ws://test.local/ws');
    socket.connect();
    const ws = FakeWebSocket.instances[0];
    ws.onopen!();

    ws.onclose!({ code: SESSION_REPLACED_CLOSE_CODE });

    expect(onSessionReplaced).toHaveBeenCalledTimes(1);
    expect(FakeWebSocket.instances).toHaveLength(1); // no new socket constructed
  });

  it('reconnects with backoff after an unexpected close', () => {
    jest.useFakeTimers();
    try {
      const socket = new GameSocket('t', {}, 'ws://test.local/ws');
      socket.connect();
      FakeWebSocket.instances[0].onopen!();

      FakeWebSocket.instances[0].onclose!({ code: 1006 }); // abnormal closure
      jest.advanceTimersByTime(600); // first backoff is 500ms

      expect(FakeWebSocket.instances.length).toBeGreaterThanOrEqual(2);
      socket.close();
    } finally {
      jest.useRealTimers();
    }
  });
});
