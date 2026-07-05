import {
  Inject,
  Injectable,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Collection, Db } from 'mongodb';
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
      this.timer = setInterval(() => void this.runSweep('auto'), env.purgeIntervalMs);
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
    await this.audit.log(
      actor,
      'room.delete',
      { type: 'room', id: code },
      { reason, priorStatus },
    );
    this.metrics.roomPurged('manual', priorStatus);
  }

  async runSweep(trigger: PurgeTrigger, actor?: AuthUser): Promise<PurgeSummary> {
    if (trigger === 'manual' && !actor) throw new Error('manual sweep requires an actor');
    const terminatedBy = trigger === 'auto' ? SYSTEM_ACTOR_ID : actor!.userId;
    const now = Date.now();
    const gameThreshold = new Date(now - env.gameLivePurgeHours * 3_600_000);
    const roomThreshold = new Date(now - env.roomLobbyPurgeHours * 3_600_000);

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
      const prior = await this.purgeRoomCore(r._id, terminatedBy, 'auto-purge: inactive LOBBY room');
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
      capped: gamesCapped || lobbyCapped || startedCapped,
    };
    const params = {
      ...summary,
      thresholds: {
        gameLiveHours: env.gameLivePurgeHours,
        roomLobbyHours: env.roomLobbyPurgeHours,
      },
    };
    if (trigger === 'auto') {
      await this.audit.logSystem('purge.run', undefined, params);
    } else {
      await this.audit.log(actor!, 'purge.run', undefined, params);
    }
    return summary;
  }

  async status(): Promise<{
    autoEnabled: boolean;
    intervalMs: number;
    roomLobbyPurgeHours: number;
    gameLivePurgeHours: number;
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
