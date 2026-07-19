import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Collection, Db } from 'mongodb';
import { asPlayerId } from '@trm/shared';
import { isBotId } from '@trm/bots';
import { MONGO_DB } from '../db/tokens';
import { env } from '../config/env';
import { GameHub } from '../ws/hub';
import { GameRegistry } from '../game/game-registry';
import { RoomRepo, type RoomDoc } from '../lobby/room.repo';
import type { GameDoc, GameEventDoc, GameSnapshotDoc, GameChatDoc } from '../persistence/types';
import type { AuthUser } from '../auth/auth.types';
import { AuditService } from './audit.service';
import { DashboardAuditRepo } from './audit.repo';
import { MetricsService } from '../observability/metrics.service';

export type PurgeTrigger = 'auto' | 'manual';

export interface PurgeSummary {
  roomsDeleted: number;
  gamesDeleted: number;
  /** LIVE games that sat paused (inactive) past the threshold and were ENDED (scored+archived). */
  pausedGamesEnded: number;
  capped: boolean;
}

const SWEEP_CAP = 500;
const SYSTEM_ACTOR_ID = 'system:purge';

/**
 * Hard-delete mechanics for rooms/games, shared by the manual admin delete buttons and the
 * background purge sweep (added in a later change). A room/game is always terminated/closed
 * first if it's still active — never deleted out from under a live session.
 */
@Injectable()
export class PurgeService implements OnModuleInit, OnModuleDestroy {
  private readonly games: Collection<GameDoc>;
  private readonly events: Collection<GameEventDoc>;
  private readonly snapshots: Collection<GameSnapshotDoc>;
  private readonly chats: Collection<GameChatDoc>;
  private readonly roomsCol: Collection<RoomDoc>;
  private readonly logger = new Logger('purge');
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(MONGO_DB) db: Db,
    private readonly registry: GameRegistry,
    private readonly hub: GameHub,
    private readonly rooms: RoomRepo,
    private readonly audit: AuditService,
    private readonly auditRepo: DashboardAuditRepo,
    private readonly metrics: MetricsService,
  ) {
    this.games = db.collection<GameDoc>('games');
    this.events = db.collection<GameEventDoc>('gameEvents');
    this.snapshots = db.collection<GameSnapshotDoc>('gameSnapshots');
    this.chats = db.collection<GameChatDoc>('gameChats');
    this.roomsCol = db.collection<RoomDoc>('rooms');
  }

  onModuleInit(): void {
    if (env.purgeAutoEnabled) {
      this.timer = setInterval(() => {
        void this.runSweep('auto').catch((e) => this.logger.error('auto-purge sweep failed', e));
      }, env.purgeIntervalMs);
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Terminate a LIVE game in place: CAS to TERMINATED, evict, close its room. A no-op
   *  (not an error) if the game isn't LIVE — callers that only need "stop it if it's still
   *  running" (room deletion, added later) rely on this; the game's record is never touched
   *  here. */
  private async terminateIfLive(
    gameId: string,
    terminatedBy: string,
    reason: string,
  ): Promise<void> {
    const now = new Date();
    const res = await this.games.updateOne(
      { _id: gameId, status: 'LIVE' },
      {
        $set: {
          status: 'TERMINATED',
          terminatedAt: now,
          terminatedBy,
          terminatedReason: reason,
          updatedAt: now,
        },
      },
    );
    if (res.matchedCount === 1) {
      await this.hub.evictMatch(gameId, reason);
      await this.rooms.closeByGameId(gameId);
    }
  }

  /** Fully delete a game: terminate it first if still LIVE, evict it from the hub if
   *  resident (a COMPLETED game never auto-evicts on natural completion — see hub.ts),
   *  then hard-delete the game doc plus every gameEvents/gameSnapshots/gameChats doc for
   *  it. matchHistory is never touched — it's the intentional archive. */
  private async purgeGameCore(
    gameId: string,
    terminatedBy: string,
    reason: string,
  ): Promise<GameDoc['status'] | null> {
    const game = await this.games.findOne({ _id: gameId });
    if (!game) return null;
    const priorStatus = game.status;
    if (priorStatus === 'LIVE') {
      await this.terminateIfLive(gameId, terminatedBy, reason);
    }
    if (this.registry.get(gameId) !== undefined) {
      await this.hub.evictMatch(gameId, reason);
    }
    await Promise.all([
      this.games.deleteOne({ _id: gameId }),
      this.events.deleteMany({ gameId }),
      this.snapshots.deleteMany({ gameId }),
      this.chats.deleteMany({ gameId }),
    ]);
    return priorStatus;
  }

  async deleteGame(actor: AuthUser, gameId: string, reason?: string): Promise<void> {
    const priorStatus = await this.purgeGameCore(
      gameId,
      actor.userId,
      reason ?? 'deleted by a maintainer',
    );
    if (priorStatus === null) throw new NotFoundException('game not found');
    await this.audit.log(
      actor,
      'game.delete',
      { type: 'game', id: gameId },
      { reason, priorStatus },
    );
    this.metrics.gamePurged('manual', priorStatus);
  }

  /** Delete a room: close it first if LOBBY, terminate (not delete) its linked game if
   *  STARTED with one still LIVE, then hard-delete the room doc regardless of status. A
   *  STARTED room whose game is already COMPLETED/TERMINATED is left as-is — deleting the
   *  game itself is a separate action on the Games view. */
  private async purgeRoomCore(
    code: string,
    terminatedBy: string,
    reason: string,
  ): Promise<RoomDoc['status'] | null> {
    let room = await this.rooms.get(code);
    if (!room) return null;
    const priorStatus = room.status;
    if (room.status === 'LOBBY') {
      await this.rooms.closeLobby(code);
      room = (await this.rooms.get(code)) ?? room;
    }
    if (room.status === 'STARTED' && room.gameId) {
      await this.terminateIfLive(room.gameId, terminatedBy, reason);
    }
    await this.roomsCol.deleteOne({ _id: code });
    return priorStatus;
  }

  async deleteRoom(actor: AuthUser, code: string, reason?: string): Promise<void> {
    const priorStatus = await this.purgeRoomCore(
      code,
      actor.userId,
      reason ?? 'deleted by a maintainer',
    );
    if (priorStatus === null) throw new NotFoundException('room not found');
    await this.audit.log(actor, 'room.delete', { type: 'room', id: code }, { reason, priorStatus });
    this.metrics.roomPurged('manual', priorStatus);
  }

  /**
   * Terminate every LIVE game and close every LOBBY room the user is currently seated in —
   * the teardown half of a maintainer account deletion. `findActiveByMember` already returns
   * only LOBBY rooms + STARTED rooms whose game is still LIVE. `terminateIfLive` also closes
   * the STARTED room (via `closeByGameId`), so a STARTED entry needs no extra close here.
   * Returns counts for the audit trail.
   */
  async terminateActiveForMember(
    terminatedBy: string,
    userId: string,
    reason: string,
  ): Promise<{ gamesTerminated: number; roomsClosed: number }> {
    const active = await this.rooms.findActiveByMember(userId, 100);
    let gamesTerminated = 0;
    let roomsClosed = 0;
    for (const room of active) {
      if (room.status === 'STARTED' && room.gameId) {
        await this.terminateIfLive(room.gameId, terminatedBy, reason);
        gamesTerminated++;
      } else if (room.status === 'LOBBY') {
        await this.rooms.closeLobby(room._id);
        roomsClosed++;
      }
    }
    return { gamesTerminated, roomsClosed };
  }

  /**
   * End a LIVE game that sat inactive (auto-play paused) past GAME_PAUSED_PURGE_HOURS. Unlike the
   * hard purge, this goes through the normal END_GAME path — the game is scored, archived to
   * matchHistory, and stays replayable; only the room is closed so the seats free up. Falls back
   * to terminate when ending is impossible (e.g. no human seat, unrecoverable state).
   */
  private async endPausedGame(game: GameDoc, terminatedBy: string): Promise<boolean> {
    const humanSeat = game.config.players.map((p) => p.id).find((id) => !isBotId(id));
    let ended = false;
    if (humanSeat) {
      try {
        const res = await this.hub.endGame(game._id, asPlayerId(humanSeat));
        ended = res === 'ended' || res === 'already_ended';
      } catch {
        ended = false;
      }
    }
    if (!ended) {
      await this.terminateIfLive(game._id, terminatedBy, 'auto-purge: game paused too long');
      return false;
    }
    await this.rooms.closeByGameId(game._id);
    return true;
  }

  async runSweep(trigger: PurgeTrigger, actor?: AuthUser): Promise<PurgeSummary> {
    if (trigger === 'manual' && !actor) throw new Error('manual sweep requires an actor');
    const terminatedBy = trigger === 'auto' ? SYSTEM_ACTOR_ID : actor!.userId;
    const now = Date.now();
    const gameThreshold = new Date(now - env.gameLivePurgeHours * 3_600_000);
    const roomThreshold = new Date(now - env.roomLobbyPurgeHours * 3_600_000);
    const pausedThreshold = new Date(now - env.gamePausedPurgeHours * 3_600_000);

    // Paused games FIRST: an ended game flips to COMPLETED before the stale-LIVE query below
    // runs, so the same sweep can never also hard-delete the game it just ended and archived.
    const pausedGames = await this.games
      .find({ status: 'LIVE', pausedAt: { $lt: pausedThreshold } })
      .limit(SWEEP_CAP + 1)
      .toArray();
    const pausedCapped = pausedGames.length > SWEEP_CAP;
    let pausedGamesEnded = 0;
    for (const g of pausedGames.slice(0, SWEEP_CAP)) {
      if (await this.endPausedGame(g, terminatedBy)) pausedGamesEnded++;
    }

    const staleGames = await this.games
      .find({ status: 'LIVE', updatedAt: { $lt: gameThreshold } })
      .limit(SWEEP_CAP + 1)
      .toArray();
    const gamesCapped = staleGames.length > SWEEP_CAP;
    for (const g of staleGames.slice(0, SWEEP_CAP)) {
      const prior = await this.purgeGameCore(g._id, terminatedBy, 'auto-purge: inactive LIVE game');
      if (prior) this.metrics.gamePurged(trigger, prior);
    }

    const staleLobby = await this.roomsCol
      .find({ status: 'LOBBY', updatedAt: { $lt: roomThreshold } })
      .limit(SWEEP_CAP + 1)
      .toArray();
    const lobbyCapped = staleLobby.length > SWEEP_CAP;
    for (const r of staleLobby.slice(0, SWEEP_CAP)) {
      const prior = await this.purgeRoomCore(
        r._id,
        terminatedBy,
        'auto-purge: inactive LOBBY room',
      );
      if (prior) this.metrics.roomPurged(trigger, prior);
    }

    const staleStarted = await this.roomsCol
      .aggregate<RoomDoc>([
        { $match: { status: 'STARTED' } },
        { $lookup: { from: 'games', localField: 'gameId', foreignField: '_id', as: 'game' } },
        {
          $addFields: {
            effectiveUpdatedAt: {
              $ifNull: [{ $arrayElemAt: ['$game.updatedAt', 0] }, '$updatedAt'],
            },
          },
        },
        { $match: { effectiveUpdatedAt: { $lt: gameThreshold } } },
        { $project: { game: 0, effectiveUpdatedAt: 0 } },
        { $limit: SWEEP_CAP + 1 },
      ])
      .toArray();
    const startedCapped = staleStarted.length > SWEEP_CAP;
    for (const r of staleStarted.slice(0, SWEEP_CAP)) {
      const prior = await this.purgeRoomCore(
        r._id,
        terminatedBy,
        'auto-purge: inactive STARTED room',
      );
      if (prior) this.metrics.roomPurged(trigger, prior);
    }

    const summary: PurgeSummary = {
      gamesDeleted: Math.min(staleGames.length, SWEEP_CAP),
      roomsDeleted:
        Math.min(staleLobby.length, SWEEP_CAP) + Math.min(staleStarted.length, SWEEP_CAP),
      pausedGamesEnded,
      capped: gamesCapped || lobbyCapped || startedCapped || pausedCapped,
    };
    const params = {
      ...summary,
      thresholds: {
        gameLiveHours: env.gameLivePurgeHours,
        roomLobbyHours: env.roomLobbyPurgeHours,
        gamePausedHours: env.gamePausedPurgeHours,
      },
    };
    if (trigger === 'auto') {
      // An idle auto sweep that changed nothing isn't worth an audit row (it would otherwise
      // stream 0/0 entries on every interval and fill the Purge view's recent-runs table).
      if (summary.roomsDeleted > 0 || summary.gamesDeleted > 0 || summary.pausedGamesEnded > 0) {
        await this.audit.logSystem('purge.run', undefined, params);
      }
    } else {
      // A manual run always logs — it records that an operator triggered a sweep, even a no-op.
      await this.audit.log(actor!, 'purge.run', undefined, params);
    }
    return summary;
  }

  async status(): Promise<{
    autoEnabled: boolean;
    intervalMs: number;
    roomLobbyPurgeHours: number;
    gameLivePurgeHours: number;
    gamePausedPurgeHours: number;
    recentRuns: {
      at: string;
      actorName: string;
      roomsDeleted: number;
      gamesDeleted: number;
      capped: boolean;
    }[];
  }> {
    const entries = await this.auditRepo.listByAction('purge.run', 10);
    return {
      autoEnabled: env.purgeAutoEnabled,
      intervalMs: env.purgeIntervalMs,
      roomLobbyPurgeHours: env.roomLobbyPurgeHours,
      gameLivePurgeHours: env.gameLivePurgeHours,
      gamePausedPurgeHours: env.gamePausedPurgeHours,
      recentRuns: entries.map((e) => ({
        at: e.at.toISOString(),
        actorName: e.actorName,
        roomsDeleted: (e.params?.roomsDeleted as number | undefined) ?? 0,
        gamesDeleted: (e.params?.gamesDeleted as number | undefined) ?? 0,
        capped: (e.params?.capped as boolean | undefined) ?? false,
      })),
    };
  }
}
