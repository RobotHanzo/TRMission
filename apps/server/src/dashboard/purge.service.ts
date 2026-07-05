import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Collection, Db } from 'mongodb';
import { MONGO_DB } from '../db/tokens';
import { GameHub } from '../ws/hub';
import { GameRegistry } from '../game/game-registry';
import { RoomRepo } from '../lobby/room.repo';
import type { GameDoc, GameEventDoc, GameSnapshotDoc, GameChatDoc } from '../persistence/types';
import type { AuthUser } from '../auth/auth.types';
import { AuditService } from './audit.service';
import { MetricsService } from '../observability/metrics.service';

/**
 * Hard-delete mechanics for rooms/games, shared by the manual admin delete buttons and the
 * background purge sweep (added in a later change). A room/game is always terminated/closed
 * first if it's still active — never deleted out from under a live session.
 */
@Injectable()
export class PurgeService {
  private readonly games: Collection<GameDoc>;
  private readonly events: Collection<GameEventDoc>;
  private readonly snapshots: Collection<GameSnapshotDoc>;
  private readonly chats: Collection<GameChatDoc>;

  constructor(
    @Inject(MONGO_DB) db: Db,
    private readonly registry: GameRegistry,
    private readonly hub: GameHub,
    private readonly rooms: RoomRepo,
    private readonly audit: AuditService,
    private readonly metrics: MetricsService,
  ) {
    this.games = db.collection<GameDoc>('games');
    this.events = db.collection<GameEventDoc>('gameEvents');
    this.snapshots = db.collection<GameSnapshotDoc>('gameSnapshots');
    this.chats = db.collection<GameChatDoc>('gameChats');
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
}
