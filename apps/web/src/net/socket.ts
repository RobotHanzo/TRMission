// Realtime client: protobuf frames over WebSocket. Treats Snapshot as ground truth
// and EventBatch as cosmetic. Auto-reconnects with backoff and re-hellos + resyncs.
import { create, toBinary, fromBinary, type MessageInitShape } from '@bufbuild/protobuf';
import {
  ClientEnvelopeSchema,
  ServerEnvelopeSchema,
  PROTOCOL_VERSION,
  type GameSnapshot,
  type GameEvent,
  type Rejection,
  type Welcome,
  type PaymentSchema,
} from '@trm/proto';

type Command = NonNullable<MessageInitShape<typeof ClientEnvelopeSchema>['command']>;
export type PaymentInit = MessageInitShape<typeof PaymentSchema>;

export type SocketStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface SocketHandlers {
  onStatus?(status: SocketStatus): void;
  onWelcome?(welcome: Welcome): void;
  onSnapshot?(snapshot: GameSnapshot): void;
  onEvents?(stateVersion: number, events: GameEvent[]): void;
  onRejection?(rejection: Rejection): void;
  onChat?(playerId: string, text: string): void;
}

function defaultWsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

export class GameSocket {
  private ws: WebSocket | null = null;
  private clientSeq = 0;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private reconnectAttempts = 0;
  private closed = false;

  constructor(
    private readonly ticket: string,
    private readonly handlers: SocketHandlers,
    private readonly url: string = defaultWsUrl(),
  ) {}

  connect(): void {
    this.handlers.onStatus?.(this.reconnectAttempts === 0 ? 'connecting' : 'reconnecting');
    const ws = new WebSocket(this.url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.handlers.onStatus?.('open');
      this.send({
        case: 'hello',
        value: { ticket: this.ticket, protocolVersion: PROTOCOL_VERSION },
      });
      this.send({ case: 'resync', value: {} });
      this.heartbeat = setInterval(
        () => this.send({ case: 'ping', value: { nonce: this.clientSeq } }),
        20_000,
      );
    };
    ws.onmessage = (ev: MessageEvent<ArrayBuffer>) => this.dispatch(new Uint8Array(ev.data));
    ws.onclose = () => {
      this.stopHeartbeat();
      if (this.closed) return;
      this.handlers.onStatus?.('reconnecting');
      const delay = Math.min(30_000, 2 ** this.reconnectAttempts * 500);
      this.reconnectAttempts += 1;
      setTimeout(() => this.connect(), delay);
    };
    ws.onerror = () => ws.close();
  }

  private dispatch(bytes: Uint8Array): void {
    const env = fromBinary(ServerEnvelopeSchema, bytes);
    switch (env.event.case) {
      case 'welcome':
        this.handlers.onWelcome?.(env.event.value);
        break;
      case 'snapshot':
        if (env.event.value.snapshot) this.handlers.onSnapshot?.(env.event.value.snapshot);
        break;
      case 'events':
        this.handlers.onEvents?.(env.event.value.stateVersion, env.event.value.events);
        break;
      case 'rejection':
        this.handlers.onRejection?.(env.event.value);
        break;
      case 'chat':
        this.handlers.onChat?.(env.event.value.playerId, env.event.value.text);
        break;
      default:
        break; // pong / unset
    }
  }

  private send(command: Command): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.clientSeq += 1;
    const env = create(ClientEnvelopeSchema, { clientSeq: this.clientSeq, command });
    this.ws.send(toBinary(ClientEnvelopeSchema, env));
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
  }

  // ── commands ──────────────────────────────────────────────────────────────
  resync(): void {
    this.send({ case: 'resync', value: {} });
  }
  chat(text: string): void {
    this.send({ case: 'chat', value: { text } });
  }
  keepInitialTickets(ticketIds: string[]): void {
    this.send({ case: 'keepInitialTickets', value: { ticketIds } });
  }
  keepTickets(ticketIds: string[]): void {
    this.send({ case: 'keepTickets', value: { ticketIds } });
  }
  drawBlind(): void {
    this.send({ case: 'drawBlind', value: {} });
  }
  drawFaceUp(slot: number): void {
    this.send({ case: 'drawFaceup', value: { slot } });
  }
  drawTickets(): void {
    this.send({ case: 'drawTickets', value: {} });
  }
  claimRoute(routeId: string, payment: PaymentInit): void {
    this.send({ case: 'claimRoute', value: { routeId, payment } });
  }
  buildStation(cityId: string, payment: PaymentInit): void {
    this.send({ case: 'buildStation', value: { cityId, payment } });
  }
  resolveTunnel(commit: boolean, extra?: PaymentInit): void {
    this.send({ case: 'resolveTunnel', value: commit ? { commit, extra } : { commit } });
  }
  pass(): void {
    this.send({ case: 'pass', value: {} });
  }

  close(): void {
    this.closed = true;
    this.stopHeartbeat();
    this.ws?.close();
    this.handlers.onStatus?.('closed');
  }
}
