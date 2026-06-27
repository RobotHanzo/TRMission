import { Controller, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { HistoryRepo } from './history.repo';
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
  @ApiOperation({ summary: 'List your recent finished games' })
  list(@CurrentUser() user: AuthUser) {
    return this.repo.listForUser(user.userId);
  }

  @Get(':gameId')
  @ApiOperation({ summary: 'Get one finished game (scoreboard + seed for replay)' })
  async get(@Param('gameId') gameId: string) {
    const doc = await this.repo.get(gameId);
    if (!doc) throw new NotFoundException('game not found');
    return doc;
  }
}
