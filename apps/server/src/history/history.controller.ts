import { Controller, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { HistoryRepo } from './history.repo';
import { MatchSummarySchema } from './history.schemas';
import { apiSchema } from '../openapi/openapi';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';

@ApiTags('history')
@ApiBearerAuth('access-token')
@UseGuards(AccessTokenGuard)
@Controller('api/v1/history')
export class HistoryController {
  constructor(private readonly repo: HistoryRepo) {}

  @Get()
  @ApiOperation({ summary: 'List finished games you played in or spectated' })
  @ApiResponse({ status: 200, schema: apiSchema(z.array(MatchSummarySchema)) })
  list(@CurrentUser() user: AuthUser) {
    return this.repo.listForUser(user.userId);
  }

  @Get(':gameId')
  @ApiOperation({ summary: 'One finished game (scoreboard) — members and spectators only' })
  async get(@Param('gameId') gameId: string, @CurrentUser() user: AuthUser) {
    // 404 (not 403) for non-members: don't reveal whether the game exists.
    const doc = await this.repo.getForUser(gameId, user.userId);
    if (!doc) throw new NotFoundException('game not found');
    return doc;
  }
}
