// The dispatcher: decode an inbound frame → authenticate/route → (for game
// commands) serialize through the match queue → write-ahead persist → commit on the
// authoritative engine → fan out a per-recipient redacted Snapshot + cosmetic
// EventBatch. It operates on bytes + a Sink, so the full loop can be driven over real
// protobuf without a socket. Persistence is optional (Step A ran without it); when a
// store is present, actions are durable-before-visible and games recover on reconnect.
import { fromBinary } from '@bufbuild/protobuf';
import {
  ClientEnvelopeSchema,
  RejectionCode,
  type ClientEnvelope,
  type GameEvent as PbGameEvent,
} from '@trm/proto';
import { asPlayerId, messageKeyFor } from '@trm/shared';
import { taiwanBoard } from '@trm/engine';
import type { Board, GameConfig, GameEvent } from '@trm/engine';
import type { GameRegistry, Match } from '../game/game-registry';
import { GameSession } from '../game/game-session';
import { Connection, type Sink } from './connection';
import { DevTicketVerifier, type TicketVerifier } from './ticket';
import type { GameStorePort } from '../persistence/types';
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

export interface GameHubOptions {
  verifier?: TicketVerifier;
  store?: GameStorePort;
  boardResolver?: (config: GameConfig) => Board;
}

export class GameHub {
  private readonly connections = new Map<string, Connection>();
  /** gameId → (playerId → that player's current connection). */
  private readonly members = new Map<string, Map<string, Connection>>();
  private readonly verifier: TicketVerifier;
  private readonly store: GameStorePort | undefined;
  private readonly boardResolver: (config: GameConfig) => Board;

  constructor(
    private readonly registry: GameRegistry,
    options: GameHubOptions = {},
  ) {
    this.verifier = options.verifier ?? new DevTicketVerifier();
    this.store = options.store;
    this.boardResolver = options.boardResolver ?? (() => taiwanBoard());
  }

  async createMatch(gameId: string, board: Board, config: GameConfig): Promise<Match> {
    this.members.set(gameId, new Map());
    const match = this.registry.create(gameId, board, config);
    if (this.store) {
      await this.store.createGame(gameId, config, match.session.raw(), match.session.digest());
    }
    return match;
  }

  /** Rehydrate a persisted game into memory (crash recovery / lazy load on reconnect). */
  async recoverMatch(gameId: string): Promise<Match | null> {
    if (!this.store) return null;
    const data = await this.store.loadForRecovery(gameId);
    if (!data) return null;
    const board = this.boardResolver(data.config);
    const session = GameSession.restore(
      gameId,
      board,
      data.config,
      data.snapshot?.state ?? null,
      data.tail,
    );
    const match = this.registry.adopt(gameId, session);
    if (!this.members.has(gameId)) this.members.set(gameId, new Map());
    return match;
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
        await this.onHello(conn, env.clientSeq, cmd.value.ticket);
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

  private async onHello(conn: Connection, clientSeq: number, ticket: string): Promise<void> {
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
    let match = this.registry.get(binding.gameId);
    if (!match) {
      const recovered = await this.recoverMatch(binding.gameId);
      if (recovered) match = recovered;
    }
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

    await match.queue.run(async () => {
      // Idempotency: client_seq is monotonic per socket; a replay is dropped (A7/A14).
      if (env.clientSeq <= conn.lastClientSeq) return;

      const action = commandToAction(env.command, player);
      if (!action) {
        conn.lastClientSeq = env.clientSeq;
        return;
      }

      const prep = match.session.prepare(action);
      if (!prep.ok) {
        // A rule-rejected action is deterministic — consume the seq so a resend is a no-op.
        conn.lastClientSeq = env.clientSeq;
        conn.send(
          rejectionFrame(
            env.clientSeq,
            rejectionToPb(prep.violation.code),
            messageKeyFor(prep.violation.code),
            prep.violation.message,
          ),
        );
        return;
      }

      const { prepared } = prep;
      if (this.store) {
        try {
          // Write-ahead: durable before visible. On failure we do NOT advance the seq,
          // so the client may safely retry this exact command.
          await this.store.appendAction(
            match.session.gameId,
            prepared.stateVersion,
            action,
            prepared.digest,
            prepared.state,
          );
        } catch (err) {
          conn.send(
            rejectionFrame(
              env.clientSeq,
              RejectionCode.INTERNAL,
              'errors:internal',
              `persist failed: ${(err as Error).message}`,
            ),
          );
          return;
        }
      }

      conn.lastClientSeq = env.clientSeq;
      match.session.commit(prepared, action);
      if (this.store && prepared.state.turn.phase === 'GAME_OVER') {
        try {
          await this.store.markCompleted(match.session.gameId, prepared.digest);
        } catch {
          // non-fatal: status is a convenience flag; the event log remains the source of truth.
        }
      }
      this.broadcast(match, prepared.events, conn, env.clientSeq);
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
