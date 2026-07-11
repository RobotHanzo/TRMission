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
  type CameraView,
  type PaymentSchema,
  CardColor as PbCardColor,
  EventPerk as PbEventPerk,
} from '@trm/proto';
import type { CardColor } from '@trm/shared';
import { SESSION_REPLACED_CLOSE_CODE } from '@trm/shared';
import type { EventPerkChoice } from './commands';

type Command = NonNullable<MessageInitShape<typeof ClientEnvelopeSchema>['command']>;
export type PaymentInit = MessageInitShape<typeof PaymentSchema>;

export type SocketStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

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

/** A board-space camera framing (board units), the payload of a camera update. */
export type CameraViewInit = { cx: number; cy: number; span: number };

const CARD_TO_PB: Record<CardColor, PbCardColor> = {
  RED: PbCardColor.RED,
  ORANGE: PbCardColor.ORANGE,
  YELLOW: PbCardColor.YELLOW,
  GREEN: PbCardColor.GREEN,
  BLUE: PbCardColor.BLUE,
  PURPLE: PbCardColor.PURPLE,
  BLACK: PbCardColor.BLACK,
  WHITE: PbCardColor.WHITE,
  LOCOMOTIVE: PbCardColor.LOCOMOTIVE,
};

/**
 * Mints a fresh ws-game ticket for a reconnect. The ticket handed to the constructor is short-lived
 * (server default 45s) and is almost always expired by the time the socket drops — a server restart
 * mid-game being the canonical case — so every reconnect re-mints one rather than replaying the
 * stale one (which the gateway would reject UNAUTHENTICATED, leaving the socket open-but-unbound).
 */
export type TicketRefresh = () => Promise<string>;

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
  /** Current ticket; the seed one for the first connect, re-minted before each reconnect. */
  private ticket: string;

  constructor(
    ticket: string,
    private readonly handlers: SocketHandlers,
    private readonly url: string = defaultWsUrl(),
    private readonly refreshTicket?: TicketRefresh,
  ) {
    this.ticket = ticket;
  }

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
      setTimeout(() => void this.reconnect(), delay);
    };
    ws.onerror = () => ws.close();
  }

  /**
   * Re-mint a fresh ticket (the old one is short-lived and usually expired after a drop), then open
   * a new socket. If minting fails — server still restarting, or a transient REST error — fall back
   * to the current ticket and connect anyway: a rejected hello just closes the socket and the
   * backoff loop schedules the next attempt, so minting is retried until the server recovers.
   */
  private async reconnect(): Promise<void> {
    if (this.closed) return;
    if (this.refreshTicket) {
      try {
        this.ticket = await this.refreshTicket();
      } catch {
        // keep the previous ticket; the ensuing close reschedules another attempt.
      }
    }
    if (this.closed) return;
    this.connect();
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
      case 'cameraMoved':
        if (env.event.value.view)
          this.handlers.onCameraMoved?.(env.event.value.playerId, env.event.value.view);
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
    this.send({ case: 'chat', value: { content: { case: 'text', value: text } } });
  }
  /** Send a preset ("canned") chat message by id — resolved to text by every viewer's own i18n. */
  chatPreset(presetId: string): void {
    this.send({ case: 'chat', value: { content: { case: 'presetId', value: presetId } } });
  }
  /** Broadcast this client's camera framing so others can follow (ephemeral, cosmetic). */
  cameraUpdate(view: CameraViewInit): void {
    this.send({ case: 'cameraUpdate', value: { view } });
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
  relocateLanternHost(cityId: string): void {
    this.send({ case: 'relocateLanternHost', value: { cityId } });
  }
  repairRoute(routeId: string, payment: PaymentInit): void {
    this.send({ case: 'repairRoute', value: { routeId, payment } });
  }
  nightMarketSwap(giveColor: CardColor, slot: number): void {
    this.send({ case: 'nightMarketSwap', value: { giveColor: CARD_TO_PB[giveColor], slot } });
  }
  chooseEventPerk(perk: EventPerkChoice): void {
    const value =
      perk === 'CLAIM_DISCOUNT'
        ? PbEventPerk.CLAIM_DISCOUNT
        : perk === 'DRAW_TWO'
          ? PbEventPerk.DRAW_TWO
          : PbEventPerk.REPAIR_PERMIT;
    this.send({ case: 'chooseEventPerk', value: { perk: value } });
  }
  startHiveDraw(): void {
    this.send({ case: 'startHiveDraw', value: {} });
  }
  continueHiveDraw(): void {
    this.send({ case: 'continueHiveDraw', value: {} });
  }
  stopHiveDraw(): void {
    this.send({ case: 'stopHiveDraw', value: {} });
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
