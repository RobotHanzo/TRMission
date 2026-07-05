import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { apiSchema } from '../openapi/openapi';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { DashboardGuard } from './dashboard.guard';
import { RequirePermission } from './require-permission.decorator';
import { PurgeService } from './purge.service';
import { PurgeRunResultSchema, PurgeStatusSchema } from './dashboard.schemas';

@ApiTags('dashboard')
@ApiBearerAuth('access-token')
@UseGuards(AccessTokenGuard, DashboardGuard)
@Controller('api/v1/dashboard/purge')
export class DashboardPurgeController {
  constructor(private readonly purge: PurgeService) {}

  @Get('status')
  @RequirePermission('purge.read')
  @ApiOperation({ summary: 'Purge configuration, thresholds, and recent runs' })
  @ApiResponse({ status: 200, schema: apiSchema(PurgeStatusSchema) })
  status() {
    return this.purge.status();
  }

  @Post('run')
  @HttpCode(200)
  @RequirePermission('purge.run')
  @ApiOperation({
    summary: 'Run the inactive-session purge sweep immediately (admin-only)',
    description:
      'Deletes stale LOBBY rooms and LIVE games past their idle threshold (games are ' +
      'force-terminated first); a STARTED room whose linked game has gone idle is deleted ' +
      'too (the game record itself is only touched if still LIVE). Terminal records are ' +
      'never auto-deleted.',
  })
  @ApiResponse({ status: 200, schema: apiSchema(PurgeRunResultSchema) })
  run(@CurrentUser() actor: AuthUser) {
    return this.purge.runSweep('manual', actor);
  }
}
