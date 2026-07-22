// Realtime client: protobuf frames over WebSocket. Treats Snapshot as ground truth
// and EventBatch as cosmetic. Auto-reconnects with backoff and re-hellos + resyncs.
// Shared by apps/web and apps/mobile — the WS endpoint is injected (web derives it from
// `location`, mobile from its config), so this module stays platform-neutral. RN's WebSocket
// needs `binaryType` set explicitly; the browser tolerates it, so it is always set.
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
  onChat?(playerId: string, content: ChatContent, teamOnly?: boolean): void;
  /** One-shot backfill of the action-log history + persisted chat + connection-change log on
   *  (re)connect. `afterEventIndex` anchors each connection change to a splice point within
   *  this SAME `events` array. */
  onHistory?(
    events: GameEvent[],
    chat: { playerId: string; content: ChatContent }[],
    connectionLog: { playerId: string; connected: boolean; afterEventIndex: number }[],
  ): void;
  /** A seated player's connection was confirmed lost (after the server's debounce) or they
   *  returned — cosmetic hub bookkeeping, never a game event. */
  onPlayerConnectionChanged?(playerId: string, connected: boolean): void;
  /** Another member's camera framing, relayed for "follow the acting player". */
  onCameraMoved?(playerId: string, view: CameraView): void;
  /** The per-turn countdown for the player currently on the clock (issue #13): `remainingMs` until
   *  the server auto-plays for them. `playerId` "" (with 0) clears it (a bot's turn / game over). */
  onTurnTimer?(playerId: string, remainingMs: number, totalMs: number): void;
  /** The server marked the game inactive (auto-play suspended; `reason` is "afk_streak" |
   *  "no_humans_connected") or lifted the mark (`paused` false, reason ""). Cosmetic. */
  onGamePaused?(paused: boolean, reason: string): void;
  /** A seat's control changed hands between its human and the server's takeover bot. */
  onSeatControlChanged?(playerId: string, botControlled: boolean): void;
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
    private readonly url: string,
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
    // Structural event types: this file compiles under DOM (web), RN, and node lib settings, and
    // none of them agree on MessageEvent/CloseEvent — the two fields used are universal.
    ws.onmessage = (ev: { data: ArrayBuffer }) => this.dispatch(new Uint8Array(ev.data));
    ws.onclose = (ev: { code: number }) => {
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
        if (content.case)
          this.handlers.onChat?.(env.event.value.playerId, content, env.event.value.teamOnly);
        break;
      }
      case 'history':
        this.handlers.onHistory?.(
          env.event.value.events,
          env.event.value.chat
            .filter((c) => c.content.case)
            .map((c) => ({ playerId: c.playerId, content: c.content as ChatContent })),
          env.event.value.connectionLog.map((c) => ({
            playerId: c.playerId,
            connected: c.connected,
            afterEventIndex: c.afterEventIndex,
          })),
        );
        break;
      case 'playerConnectionChanged':
        this.handlers.onPlayerConnectionChanged?.(
          env.event.value.playerId,
          env.event.value.connected,
        );
        break;
      case 'cameraMoved':
        if (env.event.value.view)
          this.handlers.onCameraMoved?.(env.event.value.playerId, env.event.value.view);
        break;
      case 'turnTimer':
        this.handlers.onTurnTimer?.(
          env.event.value.playerId,
          env.event.value.remainingMs,
          env.event.value.totalMs,
        );
        break;
      case 'gamePaused':
        this.handlers.onGamePaused?.(env.event.value.paused, env.event.value.reason);
        break;
      case 'seatControlChanged':
        this.handlers.onSeatControlChanged?.(
          env.event.value.playerId,
          env.event.value.botControlled,
        );
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
  /** `teamOnly` addresses the sender's teammates only (team games); such lines are ephemeral —
   *  the server never persists them, so they do not come back in the reconnect backfill. */
  chat(text: string, teamOnly = false): void {
    this.send({ case: 'chat', value: { content: { case: 'text', value: text }, teamOnly } });
  }
  /** Send a preset ("canned") chat message by id — resolved to text by every viewer's own i18n. */
  chatPreset(presetId: string, teamOnly = false): void {
    this.send({
      case: 'chat',
      value: { content: { case: 'presetId', value: presetId }, teamOnly },
    });
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
  pushToTeamPool(color: CardColor): void {
    this.send({ case: 'pushToTeamPool', value: { color: CARD_TO_PB[color] } });
  }
  takeFromTeamPool(color: CardColor): void {
    this.send({ case: 'takeFromTeamPool', value: { color: CARD_TO_PB[color] } });
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
