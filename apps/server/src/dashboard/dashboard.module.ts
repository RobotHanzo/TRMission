import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GameModule } from '../game/game.module';
import { LobbyModule } from '../lobby/lobby.module';
import { HistoryModule } from '../history/history.module';
import { DashboardConfig } from './dashboard-config';
import { DashboardAccountRepo } from './dashboard-account.repo';
import { DashboardAuditRepo } from './audit.repo';
import { AuditService } from './audit.service';
import { DashboardGuard } from './dashboard.guard';
import { DashboardService } from './dashboard.service';
import { DashboardUsersService } from './dashboard-users.service';
import { DashboardGamesService } from './dashboard-games.service';
import { DashboardMaintainersService } from './dashboard-maintainers.service';
import { PurgeService } from './purge.service';
import { DashboardController } from './dashboard.controller';
import { DashboardUsersController } from './dashboard-users.controller';
import { DashboardGamesController } from './dashboard-games.controller';
import { DashboardMaintainersController } from './dashboard-maintainers.controller';
import { DashboardBootstrap } from './dashboard-bootstrap';

// Maintainer dashboard: access control lives in the separate `dashboardAccounts`
// collection (role + per-account overrides referencing users._id); every mutating
// endpoint writes to the append-only `dashboardAudit` log. Read endpoints must
// respect the hidden-information invariant: nothing about a LIVE game's hands,
// tickets, deck order, or seed ever leaves the server.
@Module({
  imports: [AuthModule, GameModule, LobbyModule, HistoryModule],
  controllers: [
    DashboardController,
    DashboardUsersController,
    DashboardGamesController,
    DashboardMaintainersController,
  ],
  providers: [
    DashboardConfig,
    DashboardAccountRepo,
    DashboardAuditRepo,
    AuditService,
    DashboardGuard,
    DashboardService,
    DashboardUsersService,
    DashboardGamesService,
    DashboardMaintainersService,
    DashboardBootstrap,
    PurgeService,
  ],
})
export class DashboardModule {}
