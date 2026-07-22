import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Collection, Db } from 'mongodb';
import { isBotId } from '@trm/bots';
import { MONGO_DB } from '../db/tokens';
import { HistoryRepo } from '../history/history.repo';
import type { MatchHistoryDoc } from '../persistence/types';
import type { UserDoc } from '../auth/user.repo';
import { LeaderboardRepo } from './leaderboard.repo';
import { computeEloDeltas, DEFAULT_ELO_RATING, type EloParticipant } from './elo';
import { ratingUnits } from './rating-units';
import { ALL_TIME_SCOPE, currentSeasonId, seasonScope } from './season';
import { decodeRankCursor, encodeRankCursor } from './rank-cursor';
import type { LeaderboardMetric, LeaderboardScopeKind, PlayerStatsDoc } from './leaderboard.types';

const CAS_RETRIES = 5;

export interface LeaderboardRow {
  userId: string;
  displayName?: string;
  rank: number;
  rating: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
}

/** 'season' always means the CURRENT calendar-month season — v1 exposes no season browser. */
const resolveScope = (kind: LeaderboardScopeKind): string =>
  kind === 'allTime' ? ALL_TIME_SCOPE : seasonScope(currentSeasonId(new Date()));

@Injectable()
export class LeaderboardService {
  private readonly users: Collection<UserDoc>;
  private readonly logger = new Logger('leaderboard');

  constructor(
    @Inject(MONGO_DB) db: Db,
    private readonly repo: LeaderboardRepo,
    private readonly history: HistoryRepo,
  ) {
    this.users = db.collection<UserDoc>('users');
  }

  /**
   * Fire-and-forget hook called from GameHub right after `recordCompletion`. Safe to call
   * speculatively (a maintainer-terminated game never archived a matchHistory doc, so this
   * simply no-ops) and safe to call more than once for the same gameId (the claim is a unique
   * insert — the second call always loses the race and returns immediately).
   */
  async onGameOver(gameId: string): Promise<void> {
    try {
      if (!(await this.repo.tryClaim(gameId))) return;
      const doc = await this.history.get(gameId);
      if (!doc) return;
      await this.apply(doc);
    } catch (err) {
      this.logger.warn(`update failed for game ${gameId}: ${(err as Error).message}`);
    }
  }

  private async apply(doc: MatchHistoryDoc): Promise<void> {
    const humanIds = doc.players.map((p) => p.userId).filter((id) => !isBotId(id));
    const userDocs = humanIds.length
      ? await this.users.find({ _id: { $in: humanIds } }, { projection: { isGuest: 1 } }).toArray()
      : [];
    const registered = new Set(userDocs.filter((u) => !u.isGuest).map((u) => u._id));
    const ratedIds = doc.players.map((p) => p.userId).filter((id) => registered.has(id));
    if (ratedIds.length === 0) return;

    const scopes = [ALL_TIME_SCOPE, seasonScope(currentSeasonId(doc.completedAt))];
    for (const scope of scopes) {
      await this.applyScope(scope, ratedIds, doc.finalScores);
    }
  }

  private async applyScope(
    scope: string,
    ratedIds: string[],
    scores: MatchHistoryDoc['finalScores'],
  ): Promise<void> {
    const units = ratingUnits(scores, new Set(ratedIds));
    if (units.length === 0) return;

    const memberDocs = new Map(
      await Promise.all(
        ratedIds.map(async (id) => [id, await this.repo.getOne(`${id}:${scope}`)] as const),
      ),
    );

    const eloParticipants: EloParticipant[] = units.map((unit) => {
      const ratings = unit.memberUserIds.map(
        (id) => memberDocs.get(id)?.rating ?? DEFAULT_ELO_RATING,
      );
      const games = unit.memberUserIds.map((id) => memberDocs.get(id)?.gamesPlayed ?? 0);
      return {
        id: unit.key,
        rating: ratings.reduce((a, b) => a + b, 0) / ratings.length,
        gamesPlayed: Math.round(games.reduce((a, b) => a + b, 0) / games.length),
        rank: unit.rank,
      };
    });
    const unitDeltas = computeEloDeltas(eloParticipants);

    const memberDelta = new Map<string, number>();
    const memberWon = new Map<string, boolean>();
    for (const unit of units) {
      const delta = unitDeltas.get(unit.key) ?? 0;
      for (const id of unit.memberUserIds) {
        memberDelta.set(id, delta);
        memberWon.set(id, unit.rank === 0);
      }
    }

    await Promise.all(
      [...memberDelta.keys()].map((userId) =>
        this.applyOne(userId, scope, memberDelta.get(userId) ?? 0, memberWon.get(userId) ?? false),
      ),
    );
  }

  /** Read-modify-write with optimistic-concurrency retry: re-reads the doc fresh on every
   *  attempt so a concurrent write from a DIFFERENT completed game is never stomped — the
   *  rating delta itself was already fixed for this game, only its base can be stale. */
  private async applyOne(
    userId: string,
    scope: string,
    ratingDelta: number,
    won: boolean,
  ): Promise<void> {
    const id = `${userId}:${scope}`;
    for (let attempt = 0; attempt < CAS_RETRIES; attempt++) {
      const prior = await this.repo.getOne(id);
      const next = {
        rating: (prior?.rating ?? DEFAULT_ELO_RATING) + ratingDelta,
        gamesPlayed: (prior?.gamesPlayed ?? 0) + 1,
        wins: (prior?.wins ?? 0) + (won ? 1 : 0),
        losses: (prior?.losses ?? 0) + (won ? 0 : 1),
      };
      if (await this.repo.casWrite(id, userId, scope, prior?.version, next)) return;
    }
    this.logger.warn(`CAS retry exhausted for ${id}`);
  }

  /** Cursor-paginated top list for one scope+metric. Rank is computed per distinct value
   *  (memoized within the page — ties collapse to one lookup instead of one per row). */
  async list(
    scopeKind: LeaderboardScopeKind,
    metric: LeaderboardMetric,
    cursorRaw: string | undefined,
    limit: number,
  ): Promise<{ rows: LeaderboardRow[]; nextCursor: string | null }> {
    const scope = resolveScope(scopeKind);
    const cursor = decodeRankCursor(cursorRaw);
    const docs = await this.repo.top(scope, metric, cursor, limit);
    const names = await this.history.displayNames(docs.map((d) => d.userId));

    const rankCache = new Map<number, number>();
    const rankFor = async (value: number): Promise<number> => {
      const cached = rankCache.get(value);
      if (cached !== undefined) return cached;
      const rank = (await this.repo.countAbove(scope, metric, value)) + 1;
      rankCache.set(value, rank);
      return rank;
    };

    const rows: LeaderboardRow[] = [];
    for (const d of docs) rows.push(await this.toRow(d, metric, names, rankFor));

    const last = docs.length === limit ? docs[docs.length - 1] : undefined;
    return {
      rows,
      nextCursor: last ? encodeRankCursor(last[metric], last._id) : null,
    };
  }

  /** The caller's own standing, even off the visible page — null if they have no games yet. */
  async myStanding(
    userId: string,
    scopeKind: LeaderboardScopeKind,
    metric: LeaderboardMetric,
  ): Promise<LeaderboardRow | null> {
    const scope = resolveScope(scopeKind);
    const found = await this.repo.standing(userId, scope, metric);
    if (!found) return null;
    const names = await this.history.displayNames([userId]);
    const displayName = names.get(userId);
    return {
      userId,
      ...(displayName !== undefined ? { displayName } : {}),
      rank: found.rank,
      rating: found.doc.rating,
      gamesPlayed: found.doc.gamesPlayed,
      wins: found.doc.wins,
      losses: found.doc.losses,
    };
  }

  private async toRow(
    doc: PlayerStatsDoc,
    metric: LeaderboardMetric,
    names: Map<string, string>,
    rankFor: (value: number) => Promise<number>,
  ): Promise<LeaderboardRow> {
    const displayName = names.get(doc.userId);
    return {
      userId: doc.userId,
      ...(displayName !== undefined ? { displayName } : {}),
      rank: await rankFor(doc[metric]),
      rating: doc.rating,
      gamesPlayed: doc.gamesPlayed,
      wins: doc.wins,
      losses: doc.losses,
    };
  }
}
