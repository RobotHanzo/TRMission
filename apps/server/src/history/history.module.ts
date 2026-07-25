import { Module } from '@nestjs/common';
import { HistoryController } from './history.controller';
import { AdminReplayController } from './admin-replay.controller';
import { AdminReplayTicketGuard } from './admin-replay.guard';
import { AdminSpectateController } from './admin-spectate.controller';
import { AdminSpectateTicketGuard } from './admin-spectate.guard';
import { HistoryRepo } from './history.repo';
import { AuthModule } from '../auth/auth.module';
// Not DashboardModule: that module imports HistoryModule (dashboard-games/users services use
// HistoryRepo), so importing it back here would be circular. DashboardAccountRepo only depends
// on the globally-provided MONGO_DB token, so it's safe to provide a second instance here for
// the admin-ticket guards' per-request permission re-check.
import { DashboardAccountRepo } from '../dashboard/dashboard-account.repo';

@Module({
  imports: [AuthModule],
  controllers: [HistoryController, AdminReplayController, AdminSpectateController],
  providers: [HistoryRepo, AdminReplayTicketGuard, AdminSpectateTicketGuard, DashboardAccountRepo],
  exports: [HistoryRepo],
})
export class HistoryModule {}
