import { Module } from '@nestjs/common';
import { RatingsController } from './ratings.controller';
import { RatingsRepo } from './ratings.repo';
import { RatingsThrottlerGuard } from './ratings-throttle.guard';
import { AuthModule } from '../auth/auth.module';
import { HistoryModule } from '../history/history.module';

@Module({
  imports: [AuthModule, HistoryModule],
  controllers: [RatingsController],
  providers: [RatingsRepo, RatingsThrottlerGuard],
  exports: [RatingsRepo],
})
export class RatingsModule {}
