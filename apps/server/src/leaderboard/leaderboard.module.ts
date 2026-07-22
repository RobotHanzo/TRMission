import { Module } from '@nestjs/common';
import { LeaderboardController } from './leaderboard.controller';
import { LeaderboardRepo } from './leaderboard.repo';
import { LeaderboardService } from './leaderboard.service';
import { AuthModule } from '../auth/auth.module';
import { HistoryModule } from '../history/history.module';

@Module({
  imports: [AuthModule, HistoryModule],
  controllers: [LeaderboardController],
  providers: [LeaderboardRepo, LeaderboardService],
  exports: [LeaderboardRepo, LeaderboardService],
})
export class LeaderboardModule {}
