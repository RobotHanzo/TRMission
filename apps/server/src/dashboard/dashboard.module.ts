import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DashboardConfig } from './dashboard-config';
import { DashboardAccountRepo } from './dashboard-account.repo';
import { DashboardAuditRepo } from './audit.repo';
import { AuditService } from './audit.service';
import { DashboardGuard } from './dashboard.guard';
import { DashboardController } from './dashboard.controller';
import { DashboardBootstrap } from './dashboard-bootstrap';

// Maintainer dashboard: access control lives in the separate `dashboardAccounts`
// collection (role + per-account overrides referencing users._id); every mutating
// endpoint writes to the append-only `dashboardAudit` log.
@Module({
  imports: [AuthModule],
  controllers: [DashboardController],
  providers: [
    DashboardConfig,
    DashboardAccountRepo,
    DashboardAuditRepo,
    AuditService,
    DashboardGuard,
    DashboardBootstrap,
  ],
})
export class DashboardModule {}
