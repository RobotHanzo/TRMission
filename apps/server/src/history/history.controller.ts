import { Controller, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { HistoryRepo } from './history.repo';
import { MatchSummarySchema, ReplayPayloadSchema } from './history.schemas';
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

  @Get(':gameId/replay')
  @ApiOperation({ summary: 'Replay payload (config + action log) for a finished game' })
  @ApiResponse({ status: 200, schema: apiSchema(ReplayPayloadSchema) })
  async replay(@Param('gameId') gameId: string, @CurrentUser() user: AuthUser) {
    // Same membership gate as `get`; the repo additionally hard-gates on status=COMPLETED —
    // a live game's action log encodes hidden information and must never leave the server.
    const doc = await this.repo.getForUser(gameId, user.userId);
    if (!doc) throw new NotFoundException('game not found');
    const data = await this.repo.loadReplay(gameId);
    if (!data) throw new NotFoundException('replay not available');

    const names = await this.repo.displayNames(doc.players.map((p) => p.userId));
    const botsById = new Map(data.bots.map((b) => [b.playerId, b]));
    return {
      gameId: doc._id,
      config: data.config,
      engineVersion: data.engineVersion,
      schemaVersion: data.schemaVersion,
      actions: data.actions,
      players: doc.players.map((p) => ({
        userId: p.userId,
        seat: p.seat,
        ...(names.has(p.userId) ? { displayName: names.get(p.userId) } : {}),
        ...(botsById.has(p.userId)
          ? { isBot: true, difficulty: botsById.get(p.userId)!.difficulty }
          : {}),
      })),
      winners: doc.winners,
      completedAt: doc.completedAt.toISOString(),
      ...(data.finalDigest ? { finalDigest: data.finalDigest } : {}),
    };
  }
}
