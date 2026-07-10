import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GameModule } from '../game/game.module';
import { LobbyModule } from '../lobby/lobby.module';
import { HistoryModule } from '../history/history.module';
import { MapsModule } from '../maps/maps.module';
import { DashboardConfig } from './dashboard-config';
import { DashboardAccountRepo } from './dashboard-account.repo';
import { DashboardAuditRepo } from './audit.repo';
import { AuditService } from './audit.service';
import { DashboardGuard } from './dashboard.guard';
import { DashboardService } from './dashboard.service';
import { DashboardUsersService } from './dashboard-users.service';
import { DashboardGamesService } from './dashboard-games.service';
import { DashboardMaintainersService } from './dashboard-maintainers.service';
import { DashboardFeatureDefaultsService } from './dashboard-feature-defaults.service';
import { PurgeService } from './purge.service';
import { DashboardMapsService } from './dashboard-maps.service';
import { DashboardController } from './dashboard.controller';
import { DashboardUsersController } from './dashboard-users.controller';
import { DashboardGamesController } from './dashboard-games.controller';
import { DashboardMaintainersController } from './dashboard-maintainers.controller';
import { DashboardFeatureDefaultsController } from './dashboard-feature-defaults.controller';
import { DashboardPurgeController } from './dashboard-purge.controller';
import { DashboardMapsController } from './dashboard-maps.controller';
import { DashboardRatingsService } from './dashboard-ratings.service';
import { DashboardRatingsController } from './dashboard-ratings.controller';
import { DashboardBootstrap } from './dashboard-bootstrap';
import { RatingsModule } from '../ratings/ratings.module';

// Maintainer dashboard: access control lives in the separate `dashboardAccounts`
// collection (role + per-account overrides referencing users._id); every mutating
// endpoint writes to the append-only `dashboardAudit` log. Read endpoints must
// respect the hidden-information invariant: nothing about a LIVE game's hands,
// tickets, deck order, or seed ever leaves the server.
@Module({
  imports: [AuthModule, GameModule, LobbyModule, HistoryModule, MapsModule, RatingsModule],
  controllers: [
    DashboardController,
    DashboardUsersController,
    DashboardGamesController,
    DashboardMaintainersController,
    DashboardFeatureDefaultsController,
    DashboardPurgeController,
    DashboardMapsController,
    DashboardRatingsController,
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
    DashboardFeatureDefaultsService,
    DashboardBootstrap,
    PurgeService,
    DashboardMapsService,
    DashboardRatingsService,
  ],
})
export class DashboardModule {}
