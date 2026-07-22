import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { apiSchema } from '../openapi/openapi';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { DashboardGuard } from './dashboard.guard';
import { RequirePermission } from './require-permission.decorator';
import { DashboardLeaderboardService } from './dashboard-leaderboard.service';
import { LeaderboardListQueryDto, LeaderboardListSchema } from './dashboard.schemas';

@ApiTags('dashboard')
@ApiBearerAuth('access-token')
@UseGuards(AccessTokenGuard, DashboardGuard)
@Controller('api/v1/dashboard')
export class DashboardLeaderboardController {
  constructor(private readonly leaderboard: DashboardLeaderboardService) {}

  @Get('leaderboard')
  @RequirePermission('leaderboard.read')
  @ApiOperation({
    summary: 'Top players by rating/wins/games-played, all-time or this season (read-only)',
  })
  @ApiResponse({ status: 200, schema: apiSchema(LeaderboardListSchema) })
  list(@Query() query: LeaderboardListQueryDto) {
    return this.leaderboard.list(query);
  }
}
