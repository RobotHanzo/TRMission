import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { apiSchema } from '../openapi/openapi';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { DashboardGuard } from './dashboard.guard';
import { RequirePermission } from './require-permission.decorator';
import { DashboardGamesService } from './dashboard-games.service';
import {
  DashboardGameDetailSchema,
  GameLogSchema,
  GamesListQueryDto,
  GamesListSchema,
  RoomsListQueryDto,
  RoomsListSchema,
} from './dashboard.schemas';

@ApiTags('dashboard')
@ApiBearerAuth('access-token')
@UseGuards(AccessTokenGuard, DashboardGuard)
@Controller('api/v1/dashboard')
export class DashboardGamesController {
  constructor(private readonly games: DashboardGamesService) {}

  @Get('games')
  @RequirePermission('games.read')
  @ApiOperation({ summary: 'List games by status, most recently active first' })
  @ApiResponse({ status: 200, schema: apiSchema(GamesListSchema) })
  listGames(@Query() query: GamesListQueryDto) {
    return this.games.listGames(query);
  }

  @Get('games/:gameId')
  @RequirePermission('games.read')
  @ApiOperation({
    summary:
      'One game: metadata, players, room, chat. A LIVE game never exposes its seed, state, or actions.',
  })
  @ApiResponse({ status: 200, schema: apiSchema(DashboardGameDetailSchema) })
  gameDetail(@Param('gameId') gameId: string) {
    return this.games.gameDetail(gameId);
  }

  @Get('games/:gameId/log')
  @RequirePermission('games.readLog')
  @ApiOperation({
    summary: 'Full action log with per-action digests — COMPLETED games only (409 otherwise)',
  })
  @ApiResponse({ status: 200, schema: apiSchema(GameLogSchema) })
  gameLog(@Param('gameId') gameId: string) {
    return this.games.gameLog(gameId);
  }

  @Get('games/:gameId/replay')
  @RequirePermission('games.readLog')
  @ApiOperation({
    summary: 'Replay payload without membership gating — still COMPLETED games only',
  })
  gameReplay(@Param('gameId') gameId: string) {
    return this.games.gameReplay(gameId);
  }

  @Get('rooms')
  @RequirePermission('rooms.read')
  @ApiOperation({ summary: 'List rooms by status, most recently active first' })
  @ApiResponse({ status: 200, schema: apiSchema(RoomsListSchema) })
  listRooms(@Query() query: RoomsListQueryDto) {
    return this.games.listRooms(query);
  }
}
