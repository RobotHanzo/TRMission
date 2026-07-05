import { Module } from '@nestjs/common';
import { HistoryController } from './history.controller';
import { AdminReplayController } from './admin-replay.controller';
import { AdminReplayTicketGuard } from './admin-replay.guard';
import { HistoryRepo } from './history.repo';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [HistoryController, AdminReplayController],
  providers: [HistoryRepo, AdminReplayTicketGuard],
  exports: [HistoryRepo],
})
export class HistoryModule {}
