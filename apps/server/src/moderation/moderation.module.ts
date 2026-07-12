import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MapsModule } from '../maps/maps.module';
import { BlocksController } from './blocks.controller';
import { ReportsController } from './reports.controller';
import { ReportRepo } from './report.repo';

// UGC compliance surface (Apple 1.2 / Play UGC): block/mute lists + abuse reports.
// The dashboard surfaces + resolves reports (DashboardModule imports ReportRepo).
@Module({
  imports: [AuthModule, MapsModule],
  controllers: [BlocksController, ReportsController],
  providers: [ReportRepo],
  exports: [ReportRepo],
})
export class ModerationModule {}
