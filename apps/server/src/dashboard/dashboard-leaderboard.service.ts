import { Injectable } from '@nestjs/common';
import { LeaderboardService } from '../leaderboard/leaderboard.service';
import type { LeaderboardListQueryDto } from './dashboard.schemas';

@Injectable()
export class DashboardLeaderboardService {
  constructor(private readonly leaderboard: LeaderboardService) {}

  list(query: LeaderboardListQueryDto) {
    return this.leaderboard.list(query.scope, query.metric, query.cursor, query.limit);
  }
}
