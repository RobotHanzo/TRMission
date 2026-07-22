// The dispatcher: decode an inbound frame → authenticate/route → (for game
// commands) serialize through the match queue → write-ahead persist → commit on the
// authoritative engine → fan out a per-recipient redacted Snapshot + cosmetic
// EventBatch. It operates on bytes + a Sink, so the full loop can be driven over real
// protobuf without a socket. Persistence is optional (Step A ran without it); when a
// store is present, actions are durable-before-visible and games recover on reconnect.
import { fromBinary } from '@bufbuild/protobuf';
import { Logger } from '@nestjs/common';
import {
  ClientEnvelopeSchema,
  RejectionCode,
  type ClientEnvelope,
  type GameEvent as PbGameEvent,
  type CameraView,
  type Chat,
} from '@trm/proto';
import {
  asPlayerId,
  isChatPresetId,
  messageKeyFor,
  SESSION_REPLACED_CLOSE_CODE,
} from '@trm/shared';
import type { PlayerId } from '@trm/shared';
import { boardForContentHash, ENGINE_VERSION, teammates } from '@trm/engine';
import type { Action, Board, GameConfig, GameEvent } from '@trm/engine';
import { isEngineVersionSupported } from '../persistence/engine-compat';
import type { GameRegistry, Match } from '../game/game-registry';
import { GameSession, type Prepared } from '../game/game-session';
import { Connection, type CloseFn, type Sink } from './connection';
import { DevTicketVerifier, type TicketVerifier } from './ticket';
import type { GameStorePort } from '../persistence/types';
import { NOOP_METRICS, type MetricsHooks } from '../observability/hooks';
import { chooseBotAction, isBotId, type BotProfile } from '@trm/bots';
import { botStepDelayMs } from './bot-pacing';
import { chooseTimeoutAction, turnActor } from './turn-timeout';
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
  historyReplayFrame,
  cameraMovedFrame,
  pongFrame,
  playerConnectionChangedFrame,
  turnTimerFrame,
  gamePausedFrame,
  seatControlChangedFrame,
} from '@trm/codec';
import type { ChatEntry, ChatContent, MatchOptions } from '../persistence/types';

/** A recorded connection change, anchored to the action count at the moment it happened (not yet
 *  redacted/positioned — `sendHistory` maps `afterActionCount` to a per-recipient event index). */
interface ConnectionLogRecord {
  playerId: string;
  connected: boolean;
  afterActionCount: number;
}

/** Framework-free push seam (the Nest PushService is adapted into this by game.module). */
export interface PushSink {
  yourTurn(gameId: string, playerId: string): void;
  gameOver(gameId: string, playerIds: string[]): void;
  /** The game was marked inactive (auto-play paused) — nudge its socketless humans back. */
  gamePaused?(gameId: string, playerIds: string[]): void;
}

/** Why a game's per-turn auto-play was suspended. */
export type PauseReason = 'afk_streak' | 'no_humans_connected';

export interface GameHubOptions {
  verifier?: TicketVerifier;
  store?: GameStorePort;
  /** May be async — custom-map recovery resolves content from Mongo, not just the static registry. */
  boardResolver?: (config: GameConfig) => Board | Promise<Board>;
  metrics?: MetricsHooks;
  /** Pause between consecutive bot moves so humans can follow the action (0 in tests). */
  botMoveDelayMs?: number;
  /** Per-turn time limit (ms); on lapse the server auto-plays a default action for the current
   *  human player (issue #13). Default 75s; 0 disables the timer entirely (used in tests). */
  turnTimeoutMs?: number;
  /** Consecutive timed-out human turns (with no real human action or seat (re)bind in between)
   *  after which the game is marked inactive and auto-play stops — otherwise a table of bots plays
   *  a deserted game to completion on its own. Default 5; <=0 disables the streak pause. A lapse
   *  that finds not a single seated human socket connected pauses immediately regardless. */
  autoPlayPauseAfter?: number;
  /** Consecutive timed-out turns for one player after which — while OTHER humans are still
   *  connected — their seat is handed to a MEDIUM takeover bot so the table stops waiting a full
   *  budget every round. The player's own next action or seat (re)bind reclaims the seat. Default
   *  3; <=0 disables takeover. Never fires in a deserted game (the inactive pause wins there). */
  botTakeoverAfter?: number;
  /** In-process retries for a transient bot-move persist failure before a delayed re-drive (default 3). */
  botPersistRetries?: number;
  /** Delay between in-process persist retries, ms (default 500; 0 in tests). */
  botPersistRetryDelayMs?: number;
  /** Delay before re-driving a game whose persist kept failing, ms (default 15s; small in tests). */
  botDriverRescheduleMs?: number;
  /** Push sink for turn/game notifications (absent = no pushes). */
  push?: PushSink;
  /** Debounce before a your-turn push to a socketless player, ms (default 15s; 0 = next tick). */
  yourTurnDelayMs?: number;
  /** Debounce before a dropped connection is logged as "left" in the action log, ms (default 20s;
   *  a reconnect within this window — e.g. a page reload — never surfaces at all). */
  playerLeftDelayMs?: number;
}

export type EndGameResult =
  | 'ended'
  | 'already_ended'
  | 'not_found'
  | 'invalid_player'
  | 'persist_failed';

/**
 * A persisted game that can never be brought back to life (incompatible engine major, or a
 * snapshot+tail that no longer replays). Distinct from an infrastructure failure: the client is
 * told the game is unavailable rather than being left to retry forever.
 */
export class GameUnrecoverableError extends Error {
  constructor(
    readonly gameId: string,
    reason: string,
  ) {
    super(`game ${gameId} is unrecoverable: ${reason}`);
    this.name = 'GameUnrecoverableError';
  }
}

const describeError = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const CHAT_MAX_LEN = 2048;
const CHAT_RATE_MAX = 5;
const CHAT_RATE_WINDOW_MS = 5000;

const DEFAULT_BOT_PERSIST_RETRIES = 3;
const DEFAULT_BOT_PERSIST_RETRY_DELAY_MS = 500;
const DEFAULT_BOT_DRIVER_RESCHEDULE_MS = 15_000;
const DEFAULT_TURN_TIMEOUT_MS = 75_000;
const DEFAULT_AUTOPLAY_PAUSE_AFTER = 5;
const DEFAULT_BOT_TAKEOVER_AFTER = 3;

type BotMoveOutcome = 'moved' | 'noLegalAction' | 'persistFailed';

export class GameHub {
  private readonly log = new Logger('bots');
  private readonly connections = new Map<string, Connection>();
  /** gameId → (playerId → that player's current connection). */
  private readonly members = new Map<string, Map<string, Connection>>();
  /** gameId → spectator connections (seat -1): receive public snapshots/events, can never act. */
  private readonly spectators = new Map<string, Set<Connection>>();
  private readonly verifier: TicketVerifier;
  private readonly store: GameStorePort | undefined;
  private readonly boardResolver: (config: GameConfig) => Board | Promise<Board>;
  private readonly metrics: MetricsHooks;
  private readonly botMoveDelayMs: number;
  private readonly turnTimeoutMs: number;
  /** gameId → pending per-turn timeout (one per game — there is one player on the clock). */
  private readonly turnTimers = new Map<string, NodeJS.Timeout>();
  /** gameId → the active turn's absolute wall-clock deadline, so a (re)connecting client can be
   *  handed the CURRENT remaining time rather than a fresh full budget. */
  private readonly turnDeadlines = new Map<string, { player: string; at: number }>();
  private readonly autoPlayPauseAfter: number;
  private readonly botTakeoverAfter: number;
  /** gameId → consecutive auto-played (timed-out) human turns since the last real human action
   *  or seat (re)bind. */
  private readonly timeoutStreak = new Map<string, number>();
  /** gameId → (playerId → that player's consecutive timed-out turns) — feeds the MEDIUM-bot seat
   *  takeover; reset by the player's own action or seat (re)bind. */
  private readonly playerTimeoutStrikes = new Map<string, Map<string, number>>();
  /** Games marked inactive (→ why): their humans kept timing out (or none held a live socket), so
   *  the per-turn auto-play is suspended and the match rests at a human turn until someone
   *  returns. Bots only ever act on their own turns, so a paused game cannot advance on its own. */
  private readonly autoPlayPaused = new Map<string, PauseReason>();
  /** gameId → server-side behaviour flags stamped at creation (persisted; recovery restores). */
  private readonly matchOptions = new Map<string, MatchOptions>();
  private readonly botPersistRetries: number;
  private readonly botPersistRetryDelayMs: number;
  private readonly botDriverRescheduleMs: number;
  /** gameId → (botPlayerId → profile). */
  private readonly bots = new Map<string, Map<string, BotProfile>>();
  /** gameIds with an in-flight bot driver loop (prevents overlapping drivers). */
  private readonly driving = new Set<string>();
  /**
   * gameId → the most recent camera framing seen for that game, so a member who
   * (re)connects or toggles "follow" mid-turn gets the acting player's view at once.
   * Ephemeral and cosmetic — never persisted; the client filters it by current player.
   */
  private readonly lastCamera = new Map<string, { playerId: string; view: CameraView }>();
  /** gameId → ordered chat lines (replayed in HistoryReplay; persisted via the store). */
  private readonly chatLog = new Map<string, ChatEntry[]>();
  /**
   * gameId → ordered player-connection changes (replayed in HistoryReplay). In-memory only —
   * ephemeral cosmetic bookkeeping (like `lastCamera`), never engine actions, never persisted:
   * a server restart drops it, which only means a recovered game's backfill starts clean.
   */
  private readonly connectionLog = new Map<string, ConnectionLogRecord[]>();
  /** gameId → (playerId → pending debounced "player left" timer). */
  private readonly leaveTimers = new Map<string, Map<string, NodeJS.Timeout>>();
  /** gameId → playerIds with an outstanding "left" notice (cleared, and mirrored as a
   *  "reconnected" notice, the next time that player successfully re-binds a seat). */
  private readonly leftNotice = new Map<string, Set<string>>();
  private readonly push: PushSink | undefined;
  private readonly yourTurnDelayMs: number;
  private readonly playerLeftDelayMs: number;
  /** gameId → pending your-turn reminder (one per game — there is one current player). */
  private readonly pushTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly registry: GameRegistry,
    options: GameHubOptions = {},
  ) {
    this.verifier = options.verifier ?? new DevTicketVerifier();
    this.store = options.store;
    this.boardResolver =
      options.boardResolver ?? ((config: GameConfig) => boardForContentHash(config.contentHash));
    this.metrics = options.metrics ?? NOOP_METRICS;
    this.botMoveDelayMs = options.botMoveDelayMs ?? 600;
    this.turnTimeoutMs = options.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS;
    this.autoPlayPauseAfter = options.autoPlayPauseAfter ?? DEFAULT_AUTOPLAY_PAUSE_AFTER;
    this.botTakeoverAfter = options.botTakeoverAfter ?? DEFAULT_BOT_TAKEOVER_AFTER;
    this.botPersistRetries = options.botPersistRetries ?? DEFAULT_BOT_PERSIST_RETRIES;
    this.botPersistRetryDelayMs =
      options.botPersistRetryDelayMs ?? DEFAULT_BOT_PERSIST_RETRY_DELAY_MS;
    this.botDriverRescheduleMs = options.botDriverRescheduleMs ?? DEFAULT_BOT_DRIVER_RESCHEDULE_MS;
    this.push = options.push;
    this.yourTurnDelayMs = options.yourTurnDelayMs ?? 15_000;
    this.playerLeftDelayMs = options.playerLeftDelayMs ?? 20_000;
  }

  async createMatch(
    gameId: string,
    board: Board,
    config: GameConfig,
    bots: readonly BotProfile[] = [],
    options?: MatchOptions,
  ): Promise<Match> {
    this.members.set(gameId, new Map());
    this.chatLog.set(gameId, []);
    this.connectionLog.set(gameId, []);
    const match = this.registry.create(gameId, board, config);
    if (bots.length > 0) this.bots.set(gameId, new Map(bots.map((b) => [b.playerId, b])));
    if (options && Object.keys(options).length > 0) this.matchOptions.set(gameId, { ...options });
    if (this.store) {
      await this.store.createGame(
        gameId,
        config,
        match.session.raw(),
        match.session.digest(),
        bots,
        options,
      );
    }
    // Bots resolve their initial tickets and play any opening turns immediately.
    void this.driveBots(gameId);
    return match;
  }

  /**
   * Rehydrate a persisted game into memory (crash recovery / lazy load on reconnect).
   *
   * Throws `GameUnrecoverableError` when the game cannot be resumed — an engine major the current
   * engine can't run, or a snapshot+tail that fails to replay. Callers must handle it: it means
   * "this game is dead", not "the server is broken".
   */
  async recoverMatch(gameId: string): Promise<Match | null> {
    if (!this.store) return null;
    const data = await this.store.loadForRecovery(gameId);
    if (!data) return null;
    // A game written by an older engine major carries an older `GameState` SHAPE. Splicing it into
    // the current reducer is what used to crash the process (a pre-v8 `events` blob has no
    // `luckyContracts`/`resources`), and its stored digests could never re-verify anyway.
    if (!isEngineVersionSupported(data.engineVersion)) {
      throw new GameUnrecoverableError(
        gameId,
        `engine v${data.engineVersion ?? 'unstamped'} game cannot run on v${ENGINE_VERSION}`,
      );
    }
    const board = await this.boardResolver(data.config);
    let session: GameSession;
    try {
      session = GameSession.restore(
        gameId,
        board,
        data.config,
        data.snapshot?.state ?? null,
        data.preSnapshotActions,
        data.tail,
      );
    } catch (err) {
      throw new GameUnrecoverableError(gameId, `replay failed: ${describeError(err)}`);
    }
    const match = this.registry.adopt(gameId, session);
    if (!this.members.has(gameId)) this.members.set(gameId, new Map());
    if (!this.connectionLog.has(gameId)) this.connectionLog.set(gameId, []);
    if (this.store && !this.chatLog.has(gameId)) {
      try {
        this.chatLog.set(gameId, await this.store.loadChat(gameId));
      } catch {
        this.chatLog.set(gameId, []); // non-fatal: chat is cosmetic
      }
    }
    if (data.bots && data.bots.length > 0 && !this.bots.has(gameId)) {
      this.bots.set(
        gameId,
        new Map(
          data.bots.map((b) => [b.playerId, { playerId: b.playerId, difficulty: b.difficulty }]),
        ),
      );
    }
    if (data.matchOptions && !this.matchOptions.has(gameId)) {
      this.matchOptions.set(gameId, data.matchOptions);
    }
    // A recovered game may be waiting on a bot — resume the driver.
    void this.driveBots(gameId);
    return match;
  }

  /**
   * Evict a match from memory and tell connected clients (maintainer termination).
   * The DB status flip is the CALLER's responsibility and must happen BEFORE this
   * call — loadForRecovery refuses TERMINATED games, so a reconnect racing the
   * eviction cannot resurrect the match. Safe no-op when the game isn't resident.
   */
  async evictMatch(gameId: string, message: string): Promise<void> {
    const match = this.registry.get(gameId);
    if (match) {
      // Drain: serialize behind any in-flight command so we never evict mid-apply.
      await match.queue.run(async () => {});
    }
    const note = rejectionFrame(0, RejectionCode.NOT_IN_GAME, 'errors:gameTerminated', message);
    for (const conn of this.members.get(gameId)?.values() ?? []) conn.send(note);
    for (const conn of this.spectators.get(gameId) ?? []) conn.send(note);
    this.members.delete(gameId);
    this.spectators.delete(gameId);
    this.bots.delete(gameId);
    this.chatLog.delete(gameId);
    this.connectionLog.delete(gameId);
    for (const timer of this.leaveTimers.get(gameId)?.values() ?? []) clearTimeout(timer);
    this.leaveTimers.delete(gameId);
    this.leftNotice.delete(gameId);
    this.lastCamera.delete(gameId);
    this.clearYourTurnTimer(gameId);
    this.clearTurnTimer(gameId);
    this.timeoutStreak.delete(gameId);
    this.playerTimeoutStrikes.delete(gameId);
    this.autoPlayPaused.delete(gameId);
    this.matchOptions.delete(gameId);
    // After removal the bot driver's next registry.get() misses and its loop exits;
    // stragglers' commands take the existing NOT_IN_GAME path.
    this.registry.remove(gameId);
  }

  /**
   * Whether a game has actually finished — checked authoritatively server-side before rematch is
   * allowed to reset a room, never inferred from client UI state. The in-memory registry is the
   * fast path (a completed match stays resident until evictMatch removes it, which never happens
   * on natural completion); the store is a durable fallback for the rare case where the server
   * restarted between game-over and the rematch call.
   */
  async isGameOver(gameId: string): Promise<boolean> {
    const match = this.registry.get(gameId);
    if (match) return match.session.phase === 'GAME_OVER';
    const status = await this.store?.getStatus(gameId);
    return status === 'COMPLETED';
  }

  /**
   * Complete a live game immediately after the room-level vote authorizes it. The synthetic
   * END_GAME action travels through the same queue and write-ahead path as gameplay commands, so
   * recovery and replay reproduce the scored GAME_OVER state exactly. The room service owns
   * authorization; this method still requires a seated player id for a trustworthy audit action.
   */
  async endGame(gameId: string, requestedBy: PlayerId): Promise<EndGameResult> {
    let match = this.registry.get(gameId);
    if (!match) match = (await this.recoverMatch(gameId)) ?? undefined;
    if (!match) return 'not_found';

    return match.queue.run(async () => {
      if (match.session.phase === 'GAME_OVER') return 'already_ended';

      const action: Action = { t: 'END_GAME', player: requestedBy };
      const prep = match.session.prepare(action);
      if (!prep.ok) return 'invalid_player';

      const applied = await this.applyPrepared(match, action, prep.prepared);
      if (!applied.ok) return 'persist_failed';

      this.broadcast(match, prep.prepared.events, null, 0);
      return 'ended';
    });
  }

  openConnection(id: string, sink: Sink, closeFn?: CloseFn): Connection {
    const conn = new Connection(id, sink, closeFn);
    this.connections.set(id, conn);
    this.metrics.connectionOpened();
    return conn;
  }

  closeConnection(id: string): void {
    const conn = this.connections.get(id);
    if (!conn) return;
    if (conn.binding) {
      const { gameId, player, seat } = conn.binding;
      const m = this.members.get(gameId);
      const wasCurrent = m?.get(player as string) === conn;
      if (wasCurrent) m.delete(player as string);
      this.spectators.get(gameId)?.delete(conn);
      // Only a still-current seated member's drop is a real disconnect — a stale connection
      // finally closing after SESSION_REPLACED already handed the seat to a new one is not.
      if (wasCurrent && seat >= 0) this.scheduleLeaveCheck(gameId, player as string);
    }
    this.connections.delete(id);
    this.metrics.connectionClosed();
  }

  /**
   * Debounce a dropped seated connection before logging it as "left" — a page reload or brief
   * network blip reconnects well within the window and never surfaces at all (cancelled by
   * `onHello`'s re-bind). Re-schedules (restarts the window) on repeated flapping.
   */
  private scheduleLeaveCheck(gameId: string, playerId: string): void {
    const match = this.registry.get(gameId);
    if (!match || match.session.phase === 'GAME_OVER') return;
    let perGame = this.leaveTimers.get(gameId);
    if (!perGame) {
      perGame = new Map();
      this.leaveTimers.set(gameId, perGame);
    }
    const existing = perGame.get(playerId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      perGame!.delete(playerId);
      // Fire-time re-check: still no live connection, game still resident and live.
      if (this.members.get(gameId)?.has(playerId)) return;
      const live = this.registry.get(gameId);
      if (!live || live.session.phase === 'GAME_OVER') return;
      this.recordConnectionChange(gameId, playerId, false, live);
    }, this.playerLeftDelayMs);
    timer.unref?.();
    perGame.set(playerId, timer);
  }

  private cancelLeaveCheck(gameId: string, playerId: string): void {
    const timer = this.leaveTimers.get(gameId)?.get(playerId);
    if (timer) {
      clearTimeout(timer);
      this.leaveTimers.get(gameId)?.delete(playerId);
    }
  }

  /** Record + broadcast a player-connection change (cosmetic; never touches game state). */
  private recordConnectionChange(
    gameId: string,
    playerId: string,
    connected: boolean,
    match: Match,
  ): void {
    const log = this.connectionLog.get(gameId) ?? [];
    log.push({ playerId, connected, afterActionCount: match.session.appliedActions.length });
    this.connectionLog.set(gameId, log);

    const frame = playerConnectionChangedFrame(playerId, connected);
    for (const conn of this.members.get(gameId)?.values() ?? []) conn.send(frame);
    for (const conn of this.spectators.get(gameId) ?? []) conn.send(frame);

    const notices = this.leftNotice.get(gameId) ?? new Set<string>();
    if (connected) notices.delete(playerId);
    else notices.add(playerId);
    this.leftNotice.set(gameId, notices);
  }

  /**
   * Entry point for every inbound frame. It NEVER rejects: an unexpected throw anywhere downstream
   * would otherwise surface as an unhandled rejection and take the whole process down (the socket
   * layer dispatches it fire-and-forget). One bad frame — or one corrupt persisted game — must cost
   * that one client its command, not every game on the server.
   */
  async receive(connId: string, bytes: Uint8Array): Promise<void> {
    try {
      await this.dispatch(connId, bytes);
    } catch (err) {
      this.log.error(`unhandled error while processing a frame: ${describeError(err)}`);
      this.metrics.internalError?.();
      this.connections
        .get(connId)
        ?.send(
          rejectionFrame(0, RejectionCode.INTERNAL, 'errors:internal', 'internal server error'),
        );
    }
  }

  private async dispatch(connId: string, bytes: Uint8Array): Promise<void> {
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
        await this.onChat(conn, env.clientSeq, cmd.value.content, cmd.value.teamOnly);
        return;
      case 'cameraUpdate':
        this.onCameraUpdate(conn, cmd.value.view);
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
      try {
        const recovered = await this.recoverMatch(binding.gameId);
        if (recovered) match = recovered;
      } catch (err) {
        if (!(err instanceof GameUnrecoverableError)) throw err;
        // The game is dead, the server is fine. Say so instead of dying (issues #22, #26).
        this.log.error(err.message);
        this.metrics.recoveryFailed?.();
        conn.send(
          rejectionFrame(
            clientSeq,
            RejectionCode.NOT_IN_GAME,
            'errors:gameUnavailable',
            'this game can no longer be resumed',
          ),
        );
        return;
      }
    }
    if (!match) {
      conn.send(
        rejectionFrame(clientSeq, RejectionCode.NOT_IN_GAME, 'errors:notInGame', 'unknown game'),
      );
      return;
    }
    const player = asPlayerId(binding.playerId);

    // Spectator binding (seat -1): no seat, projected as a null viewer (no SelfView). Never added
    // to `members`, so it cannot act and never receives private events.
    if (binding.seat < 0) {
      conn.binding = { gameId: binding.gameId, player, seat: -1 };
      conn.lastClientSeq = Math.max(conn.lastClientSeq, clientSeq);
      let set = this.spectators.get(binding.gameId);
      if (!set) {
        set = new Set();
        this.spectators.set(binding.gameId, set);
      }
      set.add(conn);
      // Persist who spectated — grants post-game history/replay access. Never for seated
      // players (a member can mint a spectate ticket; their role stays "player").
      // Fire-and-forget: a store hiccup must not break the hello path (same posture as chat).
      if (this.store && !match.session.turnOrder.includes(player)) {
        void this.store.addSpectator(binding.gameId, binding.playerId).catch(() => {});
      }
      // The Welcome.seat field is uint32 and unused by the client for spectators (they are
      // identified by the absent SelfView in the snapshot); send 0 to keep the binding at -1.
      conn.send(welcomeFrame(binding.gameId, binding.playerId, 0), clientSeq);
      this.sendProjected(conn, match, null, clientSeq);
      this.sendHistory(conn, match, null);
      this.sendCachedCamera(conn);
      this.sendTurnTimer(conn, match);
      this.sendMatchStatus(conn, match);
      return;
    }

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
    this.cancelLeaveCheck(binding.gameId, binding.playerId);
    // A seated human is (back) in the room: reset their timeout strikes and the AFK streak,
    // reclaim their seat from a takeover bot, and if the game had been marked inactive re-arm the
    // per-turn timer. Spectator binds never resume — they cannot act, so resuming for them would
    // just hand the game back to the bots with no player present.
    this.playerTimeoutStrikes.get(binding.gameId)?.delete(binding.playerId);
    this.reclaimSeat(match, binding.playerId);
    this.resumeAutoPlay(match);
    // Only announce a return if a "left" notice actually fired earlier — a reconnect inside the
    // debounce window (the common reload/blip case) was never announced, so it stays silent.
    if (this.leftNotice.get(binding.gameId)?.has(binding.playerId)) {
      this.recordConnectionChange(binding.gameId, binding.playerId, true, match);
    }

    conn.send(welcomeFrame(binding.gameId, binding.playerId, binding.seat), clientSeq);
    this.sendSnapshot(conn, match);
    this.sendHistory(conn, match, player);
    this.sendCachedCamera(conn);
    this.sendTurnTimer(conn, match);
    this.sendMatchStatus(conn, match);
  }

  private onResync(conn: Connection): void {
    if (!conn.binding) {
      conn.send(
        rejectionFrame(0, RejectionCode.UNAUTHENTICATED, 'errors:unauthenticated', 'not bound'),
      );
      return;
    }
    const match = this.registry.get(conn.binding.gameId);
    if (match) {
      this.sendSnapshot(conn, match);
      this.sendCachedCamera(conn);
      this.sendTurnTimer(conn, match);
      this.sendMatchStatus(conn, match);
    }
  }

  private async onChat(
    conn: Connection,
    clientSeq: number,
    content: Chat['content'],
    teamOnly = false,
  ): Promise<void> {
    if (!conn.binding) return; // unbound → no chat

    let toSend: ChatContent;
    if (content.case === 'text') {
      const text = content.value.trim();
      if (text.length === 0) return; // ignore empty
      if (text.length > CHAT_MAX_LEN) {
        conn.send(
          rejectionFrame(clientSeq, RejectionCode.MALFORMED, 'errors:chatTooLong', 'chat too long'),
        );
        return;
      }
      toSend = { case: 'text', value: text };
    } else if (content.case === 'presetId') {
      if (!isChatPresetId(content.value)) {
        conn.send(
          rejectionFrame(
            clientSeq,
            RejectionCode.MALFORMED,
            'errors:chatInvalidPreset',
            'unknown chat preset',
          ),
        );
        return;
      }
      toSend = { case: 'presetId', value: content.value };
    } else {
      return; // empty oneof — nothing to send
    }

    const now = Date.now();
    conn.chatTimes = conn.chatTimes.filter((ts) => now - ts < CHAT_RATE_WINDOW_MS);
    if (conn.chatTimes.length >= CHAT_RATE_MAX) {
      conn.send(
        rejectionFrame(
          clientSeq,
          RejectionCode.RATE_LIMITED,
          'errors:chatRateLimited',
          'chat rate limited',
        ),
      );
      return;
    }
    conn.chatTimes.push(now);

    const gameId = conn.binding.gameId;
    const playerId = conn.binding.player as string;
    const members = this.members.get(gameId);

    // Team channel: deliver to the sender's side only. Deliberately EPHEMERAL — not appended to
    // the chat log and not persisted — because that log is replayed to every member (and to
    // spectators) on reconnect, which would leak a private line after the fact. Spectators are
    // excluded for the same reason: the channel is what replaces table talk between partners.
    if (teamOnly) {
      const match = this.registry.get(gameId);
      const side = match ? teammates(match.session.raw(), conn.binding.player) : null;
      if (!side || side.length <= 1) return; // not a team game — silently drop rather than broadcast
      if (members) {
        for (const [memberId, member] of members) {
          if (side.includes(memberId as PlayerId)) member.send(chatFrame(playerId, toSend, true));
        }
      }
      return;
    }

    const log = this.chatLog.get(gameId) ?? [];
    const seq = log.length;
    log.push({ playerId, content: toSend, ts: now });
    this.chatLog.set(gameId, log);
    if (this.store) {
      try {
        await this.store.appendChat(gameId, seq, playerId, toSend);
      } catch {
        // non-fatal: in-memory log still serves this session's backfill
      }
    }

    if (members) for (const member of members.values()) member.send(chatFrame(playerId, toSend));
    const specs = this.spectators.get(gameId);
    if (specs) for (const spec of specs) spec.send(chatFrame(playerId, toSend));
  }

  /**
   * Relay a member's camera framing to the other members so they can "follow" the
   * acting player. Deliberately OUTSIDE the command queue / persistence / digest: it
   * is cosmetic, carries no hidden information (board coordinates only), and so is a
   * sibling of chat rather than an engine action.
   */
  private onCameraUpdate(conn: Connection, view: CameraView | undefined): void {
    if (!conn.binding || !view) return;
    const playerId = conn.binding.player as string;
    this.lastCamera.set(conn.binding.gameId, { playerId, view });
    const members = this.members.get(conn.binding.gameId);
    if (!members) return;
    for (const [memberId, member] of members)
      if (memberId !== playerId) member.send(cameraMovedFrame(playerId, view));
  }

  /** Replay the cached camera framing to a freshly (re)connected member, if any. */
  private sendCachedCamera(conn: Connection): void {
    if (!conn.binding) return;
    const cam = this.lastCamera.get(conn.binding.gameId);
    if (!cam || cam.playerId === (conn.binding.player as string)) return;
    conn.send(cameraMovedFrame(cam.playerId, cam.view));
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
    if (conn.binding.seat < 0) {
      conn.send(
        rejectionFrame(
          env.clientSeq,
          RejectionCode.NOT_IN_GAME,
          'errors:notInGame',
          'spectators cannot act',
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
      // A real human action clears any inactive marking, resets the player's timeout strikes,
      // and reclaims their seat from a takeover bot; the broadcast below re-arms the timer.
      this.playerTimeoutStrikes.get(gameId)?.delete(player as string);
      this.reclaimSeat(match, player as string, false);
      this.resumeAutoPlay(match, false);
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
   *
   * Once it's a bot's turn, nothing else will ever prompt that bot again — a human can't
   * act out of turn, and nothing but a human command (or recovery) re-invokes this driver.
   * So a bot turn that can't make progress must be handled here, not left to "try again
   * later": a transient persist failure gets a few in-process retries and then a delayed
   * re-drive (self-heals once the store recovers); a policy that finds no legal action at
   * all falls back to PASS directly against the reducer (`botMove`) before giving up, since
   * PASS is guaranteed legal whenever no other move is (rule A15). Either failure mode is
   * metered via `botDriverStalled` — it should never fire outside of injected-failure tests.
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
        const revealedCount = match.session.raw().pendingTunnel?.revealed.length ?? 0;
        const delay = botStepDelayMs(match.session.phase, revealedCount, this.botMoveDelayMs);
        if (delay > 0) await sleep(delay);

        let outcome: BotMoveOutcome;
        for (let attempt = 0; ; attempt++) {
          outcome = await match.queue.run(() => this.botMove(match, profile));
          if (outcome !== 'persistFailed' || attempt >= this.botPersistRetries) break;
          await sleep(this.botPersistRetryDelayMs);
        }
        if (outcome === 'moved') continue;
        if (outcome === 'persistFailed') {
          this.log.error(
            `persist kept failing for bot ${profile.playerId} in game ${gameId} after ${this.botPersistRetries + 1} attempts; rescheduling driver`,
          );
          this.metrics.botDriverStalled('persist_failed');
          this.scheduleBotDriverRetry(gameId);
        }
        break; // 'noLegalAction' (even PASS failed), or persist retries exhausted.
      }
    } finally {
      this.driving.delete(gameId);
    }
  }

  private scheduleBotDriverRetry(gameId: string): void {
    setTimeout(() => void this.driveBots(gameId), this.botDriverRescheduleMs);
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

  /** Choose + apply one move for `profile`. */
  private async botMove(match: Match, profile: BotProfile): Promise<BotMoveOutcome> {
    const botId = asPlayerId(profile.playerId);
    const chosen = chooseBotAction(
      match.session.board,
      match.session.raw(),
      botId,
      profile.difficulty,
    );
    const chosenPrep = chosen ? match.session.prepare(chosen) : null;

    let action: Action;
    let prep: Prepared;
    if (chosen && chosenPrep?.ok) {
      action = chosen;
      prep = chosenPrep.prepared;
    } else {
      // The policy (or its chosen action) failed — this should be unreachable, since
      // `legalActions` guarantees PASS is legal whenever no other move is. Try PASS directly
      // against the reducer rather than freezing the match on an assumption that turned out
      // to be wrong.
      const passAction: Action = { t: 'PASS', player: botId };
      const passPrep = match.session.prepare(passAction);
      if (!passPrep.ok) {
        this.log.error(
          `bot ${profile.playerId} has no legal action (including PASS) in game ${match.session.gameId} phase ${match.session.phase}`,
        );
        this.metrics.botDriverStalled('no_legal_action');
        return 'noLegalAction';
      }
      this.log.warn(
        `bot ${profile.playerId} policy returned no usable action in game ${match.session.gameId}; falling back to PASS`,
      );
      action = passAction;
      prep = passPrep.prepared;
    }

    this.metrics.commandReceived();
    const startedAt = performance.now();
    const applied = await this.applyPrepared(match, action, prep);
    if (!applied.ok) return 'persistFailed';
    this.broadcast(match, prep.events, null, 0);
    this.metrics.commandApplied((performance.now() - startedAt) / 1000);
    return 'moved';
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

  /** One-shot backfill: the redacted event history + (for members) the chat log + the
   *  connection-change log, the last spliced in at roughly the right point via the per-viewer
   *  wire-event count reached after each action (redaction can drop events, so this recount is
   *  per-recipient rather than reusing the engine-side action boundaries directly). */
  private sendHistory(conn: Connection, match: Match, viewer: PlayerId | null): void {
    const gameId = match.session.gameId;
    const { events, actionBoundaries } = match.session.history();
    const wireEvents: PbGameEvent[] = [];
    const wireBoundaries: number[] = [0];
    let engineIdx = 0;
    for (const boundary of actionBoundaries) {
      while (engineIdx < boundary) {
        const pb = eventToProto(events[engineIdx]!, viewer);
        if (pb) wireEvents.push(pb);
        engineIdx++;
      }
      wireBoundaries.push(wireEvents.length);
    }
    const connectionLog = (this.connectionLog.get(gameId) ?? []).map((c) => ({
      playerId: c.playerId,
      connected: c.connected,
      afterEventIndex: wireBoundaries[c.afterActionCount] ?? wireEvents.length,
    }));
    const chat = this.chatLog.get(gameId) ?? [];
    conn.send(historyReplayFrame(wireEvents, chat, match.session.stateVersion, connectionLog));
  }

  private clearYourTurnTimer(gameId: string): void {
    const timer = this.pushTimers.get(gameId);
    if (timer) {
      clearTimeout(timer);
      this.pushTimers.delete(gameId);
    }
  }

  // ── per-turn timeout (issue #13) ─────────────────────────────────────────────

  private clearTurnTimer(gameId: string): void {
    const timer = this.turnTimers.get(gameId);
    if (timer) {
      clearTimeout(timer);
      this.turnTimers.delete(gameId);
    }
    this.turnDeadlines.delete(gameId);
  }

  /** Whether any seated human currently holds a live socket for this game (bots never connect,
   *  and spectators are tracked separately, so `members` is seated humans by construction). */
  private hasConnectedHuman(gameId: string): boolean {
    for (const playerId of this.members.get(gameId)?.keys() ?? []) {
      if (!isBotId(playerId)) return true;
    }
    return false;
  }

  /** Whether a seated human OTHER than `except` holds a live socket (the takeover gate: a bot
   *  only takes a seat while somebody else is actually waiting on it). */
  private hasOtherConnectedHuman(gameId: string, except: string): boolean {
    for (const playerId of this.members.get(gameId)?.keys() ?? []) {
      if (playerId !== except && !isBotId(playerId)) return true;
    }
    return false;
  }

  /** Fan a cosmetic frame to every member and spectator of a match. */
  private broadcastCosmetic(match: Match, frame: ReturnType<typeof gamePausedFrame>): void {
    const gameId = match.session.gameId;
    for (const conn of this.members.get(gameId)?.values() ?? []) conn.send(frame);
    for (const conn of this.spectators.get(gameId) ?? []) conn.send(frame);
  }

  /** Fire-and-forget pausedAt stamp — purge reaps games that stay paused past its threshold. */
  private stampPaused(gameId: string, at: Date | null): void {
    const p = this.store?.setPausedAt?.(gameId, at);
    if (p) void p.catch(() => {});
  }

  /**
   * Mark a game inactive and suspend its per-turn auto-play: its humans kept timing out
   * (`afk_streak`) or none of them held a live socket when the timer lapsed
   * (`no_humans_connected`). The match simply rests at a human turn — bots only act on their own
   * turns, so nothing advances until `resumeAutoPlay` (a seat (re)bind or a real human action).
   * Clients get a GamePaused frame (banner) and socketless humans a come-back push.
   */
  private pauseAutoPlay(match: Match, reason: PauseReason): void {
    const gameId = match.session.gameId;
    if (!this.autoPlayPaused.has(gameId)) {
      this.autoPlayPaused.set(gameId, reason);
      this.metrics.autoPlayPaused?.(reason);
      this.log.warn(`game ${gameId} marked inactive (${reason}); per-turn auto-play paused`);
      this.broadcastCosmetic(match, gamePausedFrame(true, reason));
      this.stampPaused(gameId, new Date());
      if (this.push?.gamePaused) {
        const absent = match.session.turnOrder
          .map((p) => p as string)
          .filter((p) => !isBotId(p) && !this.members.get(gameId)?.has(p));
        if (absent.length > 0) this.push.gamePaused(gameId, absent);
      }
    }
    this.clearTurnTimer(gameId);
    this.broadcastTurnTimer(match, '', 0); // drop any countdown clients were showing
  }

  /** A human is present again — reset the AFK streak and, if the game had been marked inactive,
   *  lift it (re-arming the timer unless the caller's own fan-out is about to). */
  private resumeAutoPlay(match: Match, rearm = true): void {
    const gameId = match.session.gameId;
    this.timeoutStreak.delete(gameId);
    if (!this.autoPlayPaused.delete(gameId)) return;
    this.log.log(`game ${gameId} is active again; per-turn auto-play resumed`);
    this.broadcastCosmetic(match, gamePausedFrame(false, ''));
    this.stampPaused(gameId, null);
    if (rearm) this.scheduleTurnTimeout(match);
  }

  /** Hand a (re)connecting client the current pause/seat-control status (cosmetic, like the
   *  countdown): whether the game is marked inactive, and which seats a takeover bot is playing. */
  private sendMatchStatus(conn: Connection, match: Match): void {
    const gameId = match.session.gameId;
    const reason = this.autoPlayPaused.get(gameId);
    if (reason) conn.send(gamePausedFrame(true, reason));
    for (const playerId of this.bots.get(gameId)?.keys() ?? []) {
      // Room bots (bot: ids) are announced by the roster; only converted human seats are news.
      if (!isBotId(playerId)) conn.send(seatControlChangedFrame(playerId, true));
    }
  }

  /** Persist the (changed) roster + append the durable seat-control record. Best-effort: the
   *  in-memory roster is authoritative for the live process; recovery re-reads the persisted one. */
  private persistRoster(match: Match, playerId: string, botControlled: boolean): void {
    const gameId = match.session.gameId;
    const roster = [...(this.bots.get(gameId)?.values() ?? [])];
    const p = this.store?.updateBots?.(gameId, roster, {
      playerId,
      botControlled,
      seq: match.session.stateVersion,
    });
    if (p) {
      void p.catch(() =>
        this.log.warn(`failed to persist seat-control change for ${playerId} in game ${gameId}`),
      );
    }
  }

  /**
   * Hand a repeatedly-timing-out seat to a MEDIUM takeover bot (the user-facing contract: takeover
   * planning always uses the MEDIUM policy, regardless of the room's own bots). The bot's moves go
   * through the ordinary bot-driver path, so every one of them is a logged, replayable action; the
   * takeover itself is broadcast to clients and appended to the game doc's seatControlLog.
   */
  private takeOverSeat(match: Match, playerId: PlayerId): void {
    const gameId = match.session.gameId;
    let roster = this.bots.get(gameId);
    if (!roster) {
      roster = new Map();
      this.bots.set(gameId, roster);
    }
    roster.set(playerId as string, { playerId: playerId as string, difficulty: 'MEDIUM' });
    this.playerTimeoutStrikes.get(gameId)?.delete(playerId as string);
    this.metrics.seatControlChanged?.('takeover');
    this.log.warn(
      `seat ${playerId as string} in game ${gameId} handed to a MEDIUM bot after repeated timeouts`,
    );
    this.broadcastCosmetic(match, seatControlChangedFrame(playerId as string, true));
    this.persistRoster(match, playerId as string, true);
  }

  /** The player acted or (re)bound their seat — take it back from the takeover bot. No-op unless
   *  a takeover is actually active for them (room bots never reclaim: they have bot: ids and
   *  never bind or send commands). */
  private reclaimSeat(match: Match, playerId: string, rearm = true): void {
    if (isBotId(playerId)) return;
    const gameId = match.session.gameId;
    if (!this.bots.get(gameId)?.delete(playerId)) return;
    this.metrics.seatControlChanged?.('reclaim');
    this.log.log(`seat ${playerId} in game ${gameId} reclaimed by its player`);
    this.broadcastCosmetic(match, seatControlChangedFrame(playerId, false));
    this.persistRoster(match, playerId, false);
    // The seat may be the current turn with no timer armed (bot-controlled seats carry none).
    if (rearm) this.scheduleTurnTimeout(match);
  }

  /**
   * (Re)arm the per-turn timeout after every commit, off the same fan-out humans and bots share.
   * A single human is ever "on the clock" (the current player in a single-actor phase); a bot turn,
   * game over, or the simultaneous SETUP_TICKETS phase carries no timer. Rearming on every commit
   * means a player's own sub-actions (e.g. drawing the first of two cards) refresh their budget —
   * the timer bounds each pending decision, and once one lapses the rest of that turn is completed
   * at once in `runTurnTimeout`. Also fans out the cosmetic `TurnTimer` countdown to every client.
   * A game marked inactive stays disarmed here until a human bind/action resumes it.
   */
  private scheduleTurnTimeout(match: Match): void {
    const gameId = match.session.gameId;
    const prev = this.turnTimers.get(gameId);
    if (prev) {
      clearTimeout(prev);
      this.turnTimers.delete(gameId);
    }
    if (this.turnTimeoutMs <= 0) return; // disabled (tests)
    // A solo room (host + bots) that opted to wait for its human never arms the timer at all.
    if (this.matchOptions.get(gameId)?.turnTimerDisabled) return;

    if (match.session.phase === 'GAME_OVER') {
      // Terminal hygiene — a finished game can never pause or resume again.
      this.timeoutStreak.delete(gameId);
      this.playerTimeoutStrikes.delete(gameId);
      this.autoPlayPaused.delete(gameId);
    } else if (this.autoPlayPaused.has(gameId)) {
      // Inactive — stay disarmed (and keep client countdowns cleared) until a human returns.
      if (this.turnDeadlines.delete(gameId)) this.broadcastTurnTimer(match, '', 0);
      return;
    }

    const hadCountdown = this.turnDeadlines.has(gameId);
    this.turnDeadlines.delete(gameId);
    const actor = turnActor(match.session.raw());
    // No timer for a room bot NOR a seat a takeover bot is playing (the driver moves for both).
    if (!actor || isBotId(actor as string) || this.bots.get(gameId)?.has(actor as string)) {
      // Nobody human is on the clock — clear any countdown the clients were showing.
      if (hadCountdown) this.broadcastTurnTimer(match, '', 0);
      return;
    }

    this.turnDeadlines.set(gameId, {
      player: actor as string,
      at: Date.now() + this.turnTimeoutMs,
    });
    const timer = setTimeout(() => {
      this.turnTimers.delete(gameId);
      void this.runTurnTimeout(gameId, actor);
    }, this.turnTimeoutMs);
    timer.unref?.();
    this.turnTimers.set(gameId, timer);
    this.broadcastTurnTimer(match, actor as string, this.turnTimeoutMs);
  }

  /** Fan out the cosmetic countdown frame (playerId "" + 0 clears it). */
  private broadcastTurnTimer(match: Match, playerId: string, remainingMs: number): void {
    const gameId = match.session.gameId;
    const frame = turnTimerFrame(playerId, remainingMs, this.turnTimeoutMs);
    for (const conn of this.members.get(gameId)?.values() ?? []) conn.send(frame);
    for (const conn of this.spectators.get(gameId) ?? []) conn.send(frame);
  }

  /** Hand a single (re)connecting client the CURRENT countdown (remaining, not a fresh budget). */
  private sendTurnTimer(conn: Connection, match: Match): void {
    const d = this.turnDeadlines.get(match.session.gameId);
    if (!d) return;
    const remaining = Math.max(0, d.at - Date.now());
    conn.send(turnTimerFrame(d.player, remaining, this.turnTimeoutMs));
  }

  /**
   * The timer lapsed: auto-play the timed-out player's default action(s) through the SAME
   * prepare→persist→commit→fan-out path humans and bots use (so each is a logged, replay-safe
   * action), looping until the turn leaves them. A turn is at most a few sub-actions (drawing two
   * cards is the max), so the guard is generous. Chosen from `legalActions`, so it can never inject
   * an illegal move; a persist failure bails (the player keeps the turn, a later commit re-arms).
   *
   * Two guards keep a deserted table from playing itself to completion (the auto-play exists to
   * keep the game moving for the OTHER people at it, so with nobody around it has no purpose):
   * a lapse that finds no seated human socket at all pauses the game instead of auto-playing, and
   * `autoPlayPauseAfter` consecutive auto-played turns with no real human action in between pause
   * it even while sockets linger open.
   */
  private async runTurnTimeout(gameId: string, actor: PlayerId): Promise<void> {
    const match = this.registry.get(gameId);
    if (!match) return;
    if (!this.hasConnectedHuman(gameId)) {
      this.pauseAutoPlay(match, 'no_humans_connected');
      return;
    }
    let autoPlayed = false;
    await match.queue.run(async () => {
      for (let guard = 0; guard < 20; guard++) {
        const s = match.session;
        // Re-check under the queue: the player may have acted while we waited for the lock.
        if (turnActor(s.raw()) !== actor) break;
        const action = chooseTimeoutAction(s.board, s.raw(), actor);
        if (!action) break;
        const prep = s.prepare(action);
        if (!prep.ok) break;
        this.metrics.commandReceived();
        const startedAt = performance.now();
        const applied = await this.applyPrepared(match, action, prep.prepared);
        if (!applied.ok) {
          this.log.warn(
            `turn-timeout auto-move persist failed for ${actor as string} in game ${gameId}`,
          );
          break;
        }
        if (!autoPlayed) {
          this.metrics.turnTimedOut?.();
          autoPlayed = true;
        }
        this.broadcast(match, prep.prepared.events, null, 0);
        this.metrics.commandApplied((performance.now() - startedAt) / 1000);
      }
    });
    if (autoPlayed) {
      const streak = (this.timeoutStreak.get(gameId) ?? 0) + 1;
      this.timeoutStreak.set(gameId, streak);
      let perPlayer = this.playerTimeoutStrikes.get(gameId);
      if (!perPlayer) {
        perPlayer = new Map();
        this.playerTimeoutStrikes.set(gameId, perPlayer);
      }
      const strikes = (perPlayer.get(actor as string) ?? 0) + 1;
      perPlayer.set(actor as string, strikes);
      if (this.autoPlayPauseAfter > 0 && streak >= this.autoPlayPauseAfter) {
        this.pauseAutoPlay(match, 'afk_streak');
      } else if (
        this.botTakeoverAfter > 0 &&
        strikes >= this.botTakeoverAfter &&
        !this.bots.get(gameId)?.has(actor as string) &&
        this.hasOtherConnectedHuman(gameId, actor as string)
      ) {
        // Other humans are still at the table: hand the habitually timing-out seat to a MEDIUM
        // bot so they stop waiting a full budget every round. In a deserted game the inactive
        // pause above wins instead — a takeover there would just make bots play to nobody.
        this.takeOverSeat(match, actor);
      }
    }
    // The auto-completed turn may now be a bot's — let the driver take over (a paused game still
    // lets bots finish the current round; it then rests at the next human turn, disarmed).
    void this.driveBots(gameId);
  }

  /**
   * Push triggers, fed by the same commit fan-out humans and bots share. TURN_STARTED
   * schedules a debounced your-turn reminder for a socketless human (re-checked at fire
   * time — a reconnect or superseding turn cancels it); GAME_ENDED notifies absent humans.
   */
  private maybeNotify(match: Match, events: readonly GameEvent[]): void {
    if (!this.push) return;
    const push = this.push;
    const gameId = match.session.gameId;
    for (const ev of events) {
      if (ev.e === 'TURN_STARTED') {
        this.clearYourTurnTimer(gameId); // a new turn supersedes any pending reminder
        const player = ev.player as string;
        // No your-turn nudge for room bots or a seat a takeover bot is playing.
        if (isBotId(player) || this.bots.get(gameId)?.has(player)) continue;
        if (this.members.get(gameId)?.has(player)) continue;
        const timer = setTimeout(() => {
          this.pushTimers.delete(gameId);
          // Fire-time re-check: still their turn, still no socket.
          if (match.session.currentPlayer !== ev.player) return;
          if (this.members.get(gameId)?.has(player)) return;
          push.yourTurn(gameId, player);
        }, this.yourTurnDelayMs);
        timer.unref?.();
        this.pushTimers.set(gameId, timer);
      } else if (ev.e === 'GAME_ENDED') {
        this.clearYourTurnTimer(gameId);
        const absent = match.session.turnOrder
          .map((p) => p as string)
          .filter((p) => !isBotId(p) && !this.members.get(gameId)?.has(p));
        if (absent.length > 0) push.gameOver(gameId, absent);
      }
    }
  }

  private broadcast(
    match: Match,
    events: readonly GameEvent[],
    actor: Connection | null,
    ackClientSeq: number,
  ): void {
    this.maybeNotify(match, events);
    this.scheduleTurnTimeout(match);
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

    // Spectators: a null-viewer snapshot + PUBLIC events only (private events drop to null).
    const specs = this.spectators.get(match.session.gameId);
    if (specs && specs.size > 0) {
      const pubEvents = events
        .map((e) => eventToProto(e, null))
        .filter((e): e is PbGameEvent => e !== null);
      for (const spec of specs) {
        this.sendProjected(spec, match, null, 0);
        if (pubEvents.length > 0) spec.send(eventsFrame(version, pubEvents));
      }
    }
  }
}
