import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { apiSchema } from '../openapi/openapi';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { DashboardGuard } from './dashboard.guard';
import { RequirePermission } from './require-permission.decorator';
import { DashboardGamesService } from './dashboard-games.service';
import {
  DashboardGameDetailSchema,
  DashboardRoomRowSchema,
  GameLogSchema,
  GamesListQueryDto,
  GamesListSchema,
  ModerationReasonDto,
  ModerationReasonSchema,
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

  @Post('games/:gameId/terminate')
  @HttpCode(200)
  @RequirePermission('games.terminate')
  @ApiOperation({
    summary: 'Force-terminate a stuck LIVE game',
    description:
      'Marks the game TERMINATED (never replayable, no history archive), evicts it from ' +
      'the hub, notifies connected players/spectators, and closes its room.',
  })
  @ApiBody({ schema: apiSchema(ModerationReasonSchema) })
  @ApiResponse({ status: 200, schema: apiSchema(DashboardGameDetailSchema) })
  terminate(
    @Param('gameId') gameId: string,
    @CurrentUser() actor: AuthUser,
    @Body() body: ModerationReasonDto,
  ) {
    return this.games.terminate(actor, gameId, body.reason);
  }

  @Get('rooms')
  @RequirePermission('rooms.read')
  @ApiOperation({ summary: 'List rooms by status, most recently active first' })
  @ApiResponse({ status: 200, schema: apiSchema(RoomsListSchema) })
  listRooms(@Query() query: RoomsListQueryDto) {
    return this.games.listRooms(query);
  }

  @Post('rooms/:code/close')
  @HttpCode(200)
  @RequirePermission('rooms.close')
  @ApiOperation({
    summary: 'Force-close a LOBBY room (409 if STARTED — terminate its game instead)',
  })
  @ApiBody({ schema: apiSchema(ModerationReasonSchema) })
  @ApiResponse({ status: 200, schema: apiSchema(DashboardRoomRowSchema) })
  closeRoom(
    @Param('code') code: string,
    @CurrentUser() actor: AuthUser,
    @Body() body: ModerationReasonDto,
  ) {
    return this.games.closeRoom(actor, code, body.reason);
  }
}
