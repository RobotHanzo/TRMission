// The dispatcher: decode an inbound frame → authenticate/route → (for game
// commands) serialize through the match queue → apply on the authoritative engine
// → fan out a per-recipient redacted Snapshot + cosmetic EventBatch. This is the
// whole realtime loop; it operates on bytes + a Sink, so the full game can be
// driven over real protobuf without a socket (Step A proof).
import { fromBinary } from '@bufbuild/protobuf';
import {
  ClientEnvelopeSchema,
  RejectionCode,
  type ClientEnvelope,
  type GameEvent as PbGameEvent,
} from '@trm/proto';
import { asPlayerId, messageKeyFor } from '@trm/shared';
import type { Board, GameConfig, GameEvent } from '@trm/engine';
import type { GameRegistry, Match } from '../game/game-registry';
import { Connection, type Sink } from './connection';
import { DevTicketVerifier, type TicketVerifier } from './ticket';
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
  pongFrame,
} from '../codec';

export class GameHub {
  private readonly connections = new Map<string, Connection>();
  /** gameId → (playerId → that player's current connection). */
  private readonly members = new Map<string, Map<string, Connection>>();

  constructor(
    private readonly registry: GameRegistry,
    private readonly verifier: TicketVerifier = new DevTicketVerifier(),
  ) {}

  createMatch(gameId: string, board: Board, config: GameConfig): Match {
    this.members.set(gameId, new Map());
    return this.registry.create(gameId, board, config);
  }

  openConnection(id: string, sink: Sink): Connection {
    const conn = new Connection(id, sink);
    this.connections.set(id, conn);
    return conn;
  }

  closeConnection(id: string): void {
    const conn = this.connections.get(id);
    if (conn?.binding) {
      const m = this.members.get(conn.binding.gameId);
      if (m?.get(conn.binding.player as string) === conn) m.delete(conn.binding.player as string);
    }
    this.connections.delete(id);
  }

  async receive(connId: string, bytes: Uint8Array): Promise<void> {
    const conn = this.connections.get(connId);
    if (!conn) return;

    let env: ClientEnvelope;
    try {
      env = fromBinary(ClientEnvelopeSchema, bytes);
    } catch {
      conn.send(rejectionFrame(0, RejectionCode.MALFORMED, 'errors:malformed', 'malformed frame'));
      return;
    }

    const cmd = env.command;
    switch (cmd.case) {
      case 'hello':
        this.onHello(conn, env.clientSeq, cmd.value.ticket);
        return;
      case 'ping':
        conn.send(pongFrame(cmd.value.nonce), env.clientSeq);
        return;
      case 'resync':
        this.onResync(conn);
        return;
      case 'chat':
        this.onChat(conn, cmd.value.text);
        return;
      case undefined:
        conn.send(
          rejectionFrame(
            env.clientSeq,
            RejectionCode.MALFORMED,
            'errors:malformed',
            'empty command',
          ),
        );
        return;
      default:
        await this.onGameCommand(conn, env);
        return;
    }
  }

  // ── routing ────────────────────────────────────────────────────────────────

  private onHello(conn: Connection, clientSeq: number, ticket: string): void {
    const binding = this.verifier.verify(ticket);
    if (!binding) {
      conn.send(
        rejectionFrame(
          clientSeq,
          RejectionCode.UNAUTHENTICATED,
          'errors:unauthenticated',
          'bad ticket',
        ),
      );
      return;
    }
    const match = this.registry.get(binding.gameId);
    if (!match) {
      conn.send(
        rejectionFrame(clientSeq, RejectionCode.NOT_IN_GAME, 'errors:notInGame', 'unknown game'),
      );
      return;
    }
    const player = asPlayerId(binding.playerId);
    const inGame = match.session.turnOrder.includes(player);
    if (!inGame || match.session.seatOf(player) !== binding.seat) {
      conn.send(
        rejectionFrame(
          clientSeq,
          RejectionCode.UNAUTHENTICATED,
          'errors:unauthenticated',
          'not a seat in this game',
        ),
      );
      return;
    }

    conn.binding = { gameId: binding.gameId, player, seat: binding.seat };
    conn.lastClientSeq = Math.max(conn.lastClientSeq, clientSeq);
    this.members.get(binding.gameId)?.set(binding.playerId, conn);

    conn.send(welcomeFrame(binding.gameId, binding.playerId, binding.seat), clientSeq);
    this.sendSnapshot(conn, match);
  }

  private onResync(conn: Connection): void {
    if (!conn.binding) {
      conn.send(
        rejectionFrame(0, RejectionCode.UNAUTHENTICATED, 'errors:unauthenticated', 'not bound'),
      );
      return;
    }
    const match = this.registry.get(conn.binding.gameId);
    if (match) this.sendSnapshot(conn, match);
  }

  private onChat(conn: Connection, text: string): void {
    if (!conn.binding) return;
    const members = this.members.get(conn.binding.gameId);
    if (!members) return;
    for (const member of members.values())
      member.send(chatFrame(conn.binding.player as string, text));
  }

  private async onGameCommand(conn: Connection, env: ClientEnvelope): Promise<void> {
    if (!conn.binding) {
      conn.send(
        rejectionFrame(
          env.clientSeq,
          RejectionCode.UNAUTHENTICATED,
          'errors:unauthenticated',
          'not bound',
        ),
      );
      return;
    }
    const match = this.registry.get(conn.binding.gameId);
    if (!match) {
      conn.send(
        rejectionFrame(
          env.clientSeq,
          RejectionCode.NOT_IN_GAME,
          'errors:notInGame',
          'unknown game',
        ),
      );
      return;
    }
    const player = conn.binding.player;

    await match.queue.run(() => {
      // Idempotency: client_seq is monotonic per socket; a replay (reconnect resend)
      // is dropped before it can apply twice (A7/A14).
      if (env.clientSeq <= conn.lastClientSeq) return;
      conn.lastClientSeq = env.clientSeq;

      const action = commandToAction(env.command, player);
      if (!action) return;

      const result = match.session.apply(action);
      if (!result.ok) {
        conn.send(
          rejectionFrame(
            env.clientSeq,
            rejectionToPb(result.violation.code),
            messageKeyFor(result.violation.code),
            result.violation.message,
          ),
        );
        return;
      }
      this.broadcast(match, result.events, conn, env.clientSeq);
    });
  }

  // ── fan-out ──────────────────────────────────────────────────────────────

  private sendSnapshot(conn: Connection, match: Match, ackClientSeq = 0): void {
    const player = conn.binding?.player ?? null;
    const view = match.session.project(player);
    conn.send(
      snapshotFrame(viewToSnapshot(view, match.session.stateVersion, player)),
      ackClientSeq,
    );
  }

  private broadcast(
    match: Match,
    events: readonly GameEvent[],
    actor: Connection,
    ackClientSeq: number,
  ): void {
    const members = this.members.get(match.session.gameId);
    if (!members) return;
    const version = match.session.stateVersion;

    for (const [playerIdStr, member] of members) {
      const player = asPlayerId(playerIdStr);
      const view = match.session.project(player);
      const ack = member === actor ? ackClientSeq : 0;
      member.send(snapshotFrame(viewToSnapshot(view, version, player)), ack);

      const pbEvents = events
        .map((e) => eventToProto(e, player))
        .filter((e): e is PbGameEvent => e !== null);
      if (pbEvents.length > 0) member.send(eventsFrame(version, pbEvents));
    }
  }
}
