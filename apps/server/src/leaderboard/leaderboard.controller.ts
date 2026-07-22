import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { apiSchema } from '../openapi/openapi';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { LeaderboardService } from './leaderboard.service';
import {
  LeaderboardPageSchema,
  LeaderboardQueryDto,
  StandingResponseSchema,
  StandingQueryDto,
} from './leaderboard.schemas';

@ApiTags('leaderboard')
@ApiBearerAuth('access-token')
@UseGuards(AccessTokenGuard)
@Controller('api/v1/leaderboard')
export class LeaderboardController {
  constructor(private readonly leaderboard: LeaderboardService) {}

  @Get()
  @ApiOperation({
    summary:
      'Top players by rating/wins/games-played, all-time or this season — registered users only',
  })
  @ApiResponse({ status: 200, schema: apiSchema(LeaderboardPageSchema) })
  list(@Query() query: LeaderboardQueryDto) {
    return this.leaderboard.list(query.scope, query.metric, query.cursor, query.limit);
  }

  @Get('me')
  @ApiOperation({ summary: "The caller's own standing, even off the visible page" })
  @ApiResponse({ status: 200, schema: apiSchema(StandingResponseSchema) })
  async me(@CurrentUser() user: AuthUser, @Query() query: StandingQueryDto) {
    const standing = await this.leaderboard.myStanding(user.userId, query.scope, query.metric);
    return { standing };
  }
}
