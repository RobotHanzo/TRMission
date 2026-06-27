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
import type { PlayerId } from '@trm/shared';
import { taiwanBoard } from '@trm/engine';
import type { Board, GameConfig, GameEvent } from '@trm/engine';
import type { GameRegistry, Match } from '../game/game-registry';
import { GameSession, type Prepared } from '../game/game-session';
import { Connection, type Sink } from './connection';
import { DevTicketVerifier, type TicketVerifier } from './ticket';
import type { GameStorePort } from '../persistence/types';
import { NOOP_METRICS, type MetricsHooks } from '../observability/hooks';
import { chooseBotAction } from '../bots/policy';
import type { BotProfile } from '../bots/types';
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
  metrics?: MetricsHooks;
  /** Pause between consecutive bot moves so humans can follow the action (0 in tests). */
  botMoveDelayMs?: number;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class GameHub {
  private readonly connections = new Map<string, Connection>();
  /** gameId → (playerId → that player's current connection). */
  private readonly members = new Map<string, Map<string, Connection>>();
  private readonly verifier: TicketVerifier;
  private readonly store: GameStorePort | undefined;
  private readonly boardResolver: (config: GameConfig) => Board;
  private readonly metrics: MetricsHooks;
  private readonly botMoveDelayMs: number;
  /** gameId → (botPlayerId → profile). */
  private readonly bots = new Map<string, Map<string, BotProfile>>();
  /** gameIds with an in-flight bot driver loop (prevents overlapping drivers). */
  private readonly driving = new Set<string>();

  constructor(
    private readonly registry: GameRegistry,
    options: GameHubOptions = {},
  ) {
    this.verifier = options.verifier ?? new DevTicketVerifier();
    this.store = options.store;
    this.boardResolver = options.boardResolver ?? (() => taiwanBoard());
    this.metrics = options.metrics ?? NOOP_METRICS;
    this.botMoveDelayMs = options.botMoveDelayMs ?? 600;
  }

  async createMatch(
    gameId: string,
    board: Board,
    config: GameConfig,
    bots: readonly BotProfile[] = [],
  ): Promise<Match> {
    this.members.set(gameId, new Map());
    const match = this.registry.create(gameId, board, config);
    if (bots.length > 0) this.bots.set(gameId, new Map(bots.map((b) => [b.playerId, b])));
    if (this.store) {
      await this.store.createGame(
        gameId,
        config,
        match.session.raw(),
        match.session.digest(),
        bots,
      );
    }
    // Bots resolve their initial tickets and play any opening turns immediately.
    void this.driveBots(gameId);
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
    if (data.bots && data.bots.length > 0 && !this.bots.has(gameId)) {
      this.bots.set(
        gameId,
        new Map(
          data.bots.map((b) => [b.playerId, { playerId: b.playerId, difficulty: b.difficulty }]),
        ),
      );
    }
    // A recovered game may be waiting on a bot — resume the driver.
    void this.driveBots(gameId);
    return match;
  }

  openConnection(id: string, sink: Sink): Connection {
    const conn = new Connection(id, sink);
    this.connections.set(id, conn);
    this.metrics.connectionOpened();
    return conn;
  }

  closeConnection(id: string): void {
    const conn = this.connections.get(id);
    if (!conn) return;
    if (conn.binding) {
      const m = this.members.get(conn.binding.gameId);
      if (m?.get(conn.binding.player as string) === conn) m.delete(conn.binding.player as string);
    }
    this.connections.delete(id);
    this.metrics.connectionClosed();
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
    const gameId = conn.binding.gameId;

    await match.queue.run(async () => {
      // Idempotency: client_seq is monotonic per socket; a replay is dropped (A7/A14).
      if (env.clientSeq <= conn.lastClientSeq) return;
      this.metrics.commandReceived();
      const startedAt = performance.now();

      const action = commandToAction(env.command, player);
      if (!action) {
        conn.lastClientSeq = env.clientSeq;
        return;
      }

      const prep = match.session.prepare(action);
      if (!prep.ok) {
        // A rule-rejected action is deterministic — consume the seq so a resend is a no-op.
        conn.lastClientSeq = env.clientSeq;
        this.metrics.commandRejected(prep.violation.code);
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

      const applied = await this.applyPrepared(match, action, prep.prepared);
      if (!applied.ok) {
        // Write-ahead persist failed: do NOT advance the seq, so the client may safely
        // retry this exact command.
        conn.send(
          rejectionFrame(
            env.clientSeq,
            RejectionCode.INTERNAL,
            'errors:internal',
            `persist failed: ${applied.error?.message ?? 'unknown'}`,
          ),
        );
        return;
      }
      conn.lastClientSeq = env.clientSeq;
      this.broadcast(match, prep.prepared.events, conn, env.clientSeq);
      this.metrics.commandApplied((performance.now() - startedAt) / 1000);
    });

    // A human move may have handed the turn to a bot — let the driver pick it up.
    void this.driveBots(gameId);
  }

  // ── bots ───────────────────────────────────────────────────────────────────

  /**
   * Write-ahead persist → commit → archive-on-completion, shared by human commands and
   * bot moves. Returns ok:false (without committing) if the durable append fails.
   */
  private async applyPrepared(
    match: Match,
    action: Parameters<GameSession['commit']>[1],
    prepared: Prepared,
  ): Promise<{ ok: true } | { ok: false; error?: Error }> {
    if (this.store) {
      try {
        await this.store.appendAction(
          match.session.gameId,
          prepared.stateVersion,
          action,
          prepared.digest,
          prepared.state,
        );
      } catch (err) {
        return { ok: false, error: err as Error };
      }
    }
    match.session.commit(prepared, action);
    if (this.store && prepared.state.turn.phase === 'GAME_OVER') {
      try {
        await this.store.recordCompletion(match.session.gameId, prepared.state);
      } catch {
        // non-fatal: status is a convenience flag; the event log remains the source of truth.
      }
    }
    return { ok: true };
  }

  /**
   * Drive every bot that can currently act, one move at a time through the match queue
   * (so bot moves interleave safely with human commands), until the turn returns to a
   * human or the game ends. Re-entrancy is guarded so only one driver runs per game.
   */
  private async driveBots(gameId: string): Promise<void> {
    const bots = this.bots.get(gameId);
    if (!bots || bots.size === 0 || this.driving.has(gameId)) return;
    this.driving.add(gameId);
    try {
      for (let guard = 0; guard < 10_000; guard++) {
        const match = this.registry.get(gameId);
        if (!match || match.session.phase === 'GAME_OVER') break;
        const profile = this.nextActableBot(match, bots);
        if (!profile) break; // nothing for a bot to do → waiting on a human
        if (this.botMoveDelayMs > 0) await sleep(this.botMoveDelayMs);

        let moved = false;
        await match.queue.run(async () => {
          moved = await this.botMove(match, profile);
        });
        if (!moved) break;
      }
    } finally {
      this.driving.delete(gameId);
    }
  }

  /** The first bot with a move available right now (turn owner, or a pending offer/tunnel). */
  private nextActableBot(match: Match, bots: Map<string, BotProfile>): BotProfile | undefined {
    const s = match.session;
    const phase = s.phase;
    const current = s.currentPlayer;
    const tunnelPlayer = s.raw().pendingTunnel?.playerId ?? null;
    for (const profile of bots.values()) {
      const pid = asPlayerId(profile.playerId);
      if (phase === 'SETUP_TICKETS') {
        if (s.hasPendingOffer(pid)) return profile;
      } else if (phase === 'TICKET_SELECTION') {
        if (current === pid && s.hasPendingOffer(pid)) return profile;
      } else if (phase === 'TUNNEL_PENDING') {
        if (tunnelPlayer === pid) return profile;
      } else if (current === pid) {
        return profile; // AWAIT_ACTION / DRAWING_CARDS
      }
    }
    return undefined;
  }

  /** Choose + apply one move for `profile`. Returns false if there was nothing valid to do. */
  private async botMove(match: Match, profile: BotProfile): Promise<boolean> {
    const action = chooseBotAction(
      match.session.board,
      match.session.raw(),
      asPlayerId(profile.playerId),
      profile.difficulty,
    );
    if (!action) return false;
    const prep = match.session.prepare(action);
    if (!prep.ok) return false; // defensive: the policy only ever returns legal actions
    this.metrics.commandReceived();
    const startedAt = performance.now();
    const applied = await this.applyPrepared(match, action, prep.prepared);
    if (!applied.ok) return false; // persist failure — retry on the next driver pass
    this.broadcast(match, prep.prepared.events, null, 0);
    this.metrics.commandApplied((performance.now() - startedAt) / 1000);
    return true;
  }

  // ── fan-out ──────────────────────────────────────────────────────────────

  /** Build the per-viewer snapshot, guard against mis-addressed private data, then send. */
  private sendProjected(
    conn: Connection,
    match: Match,
    player: PlayerId | null,
    ack: number,
  ): void {
    const snap = viewToSnapshot(match.session.project(player), match.session.stateVersion, player);
    // Egress guard (defence in depth): a snapshot's private `you` must be the recipient's.
    if (snap.you && snap.you.playerId !== (player as string | null)) {
      this.metrics.leakBlocked();
      return;
    }
    conn.send(snapshotFrame(snap), ack);
  }

  private sendSnapshot(conn: Connection, match: Match, ackClientSeq = 0): void {
    this.sendProjected(conn, match, conn.binding?.player ?? null, ackClientSeq);
  }

  private broadcast(
    match: Match,
    events: readonly GameEvent[],
    actor: Connection | null,
    ackClientSeq: number,
  ): void {
    const members = this.members.get(match.session.gameId);
    if (!members) return;
    const version = match.session.stateVersion;

    for (const [playerIdStr, member] of members) {
      const player = asPlayerId(playerIdStr);
      this.sendProjected(member, match, player, member === actor ? ackClientSeq : 0);

      const pbEvents = events
        .map((e) => eventToProto(e, player))
        .filter((e): e is PbGameEvent => e !== null);
      if (pbEvents.length > 0) member.send(eventsFrame(version, pbEvents));
    }
  }
}
