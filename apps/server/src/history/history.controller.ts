import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { HistoryRepo } from './history.repo';
import {
  MatchSummarySchema,
  ReplayPayloadSchema,
  SetVisibilityDto,
  SetVisibilitySchema,
} from './history.schemas';
import { apiSchema } from '../openapi/openapi';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { OptionalAccessTokenGuard } from '../auth/optional-access-token.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { UserRepo } from '../auth/user.repo';
import { featureDisabled } from '../auth/feature.guard';
import type { AuthUser } from '../auth/auth.types';

@ApiTags('history')
@ApiBearerAuth('access-token')
@Controller('api/v1/history')
export class HistoryController {
  constructor(
    private readonly repo: HistoryRepo,
    private readonly users: UserRepo,
  ) {}

  @Get()
  @UseGuards(AccessTokenGuard)
  @ApiOperation({ summary: 'List finished games you played in or spectated' })
  @ApiResponse({ status: 200, schema: apiSchema(z.array(MatchSummarySchema)) })
  list(@CurrentUser() user: AuthUser) {
    return this.repo.listForUser(user.userId);
  }

  @Get(':gameId')
  @UseGuards(AccessTokenGuard)
  @ApiOperation({ summary: 'One finished game (scoreboard) — members and spectators only' })
  async get(@Param('gameId') gameId: string, @CurrentUser() user: AuthUser) {
    // 404 (not 403) for non-members: don't reveal whether the game exists.
    const doc = await this.repo.getForUser(gameId, user.userId);
    if (!doc) throw new NotFoundException('game not found');
    return doc;
  }

  @Patch(':gameId/visibility')
  @HttpCode(200)
  @UseGuards(AccessTokenGuard)
  @ApiOperation({
    summary: "Set a finished game's replay visibility (seated players with replayReview only)",
  })
  @ApiBody({ schema: apiSchema(SetVisibilitySchema) })
  @ApiResponse({ status: 200, schema: apiSchema(SetVisibilitySchema) })
  async setVisibility(
    @Param('gameId') gameId: string,
    @CurrentUser() user: AuthUser,
    @Body() body: SetVisibilityDto,
  ) {
    // Seatedness first, feature second: a spectator, outsider, or unknown game keeps the
    // nondisclosing 404 (a feature-403 must never become an existence oracle); only a
    // proven seated player without the replayReview feature gets the disclosed 403.
    const doc = await this.repo.get(gameId);
    if (!doc || !doc.players.some((p) => p.userId === user.userId)) {
      throw new NotFoundException('game not found');
    }
    if (!(await this.users.hasFeature(user.userId, 'replayReview'))) {
      throw featureDisabled('replayReview');
    }
    // The repo filter re-checks seatedness atomically with the write.
    const ok = await this.repo.setVisibility(gameId, user.userId, body.visibility);
    if (!ok) throw new NotFoundException('game not found');
    return { visibility: body.visibility };
  }

  @Get(':gameId/replay')
  @UseGuards(OptionalAccessTokenGuard)
  @ApiOperation({
    summary:
      'Replay payload (config + action log) — members with the replayReview feature, ' +
      'or anyone when view-by-link',
  })
  @ApiResponse({ status: 200, schema: apiSchema(ReplayPayloadSchema) })
  async replay(@Param('gameId') gameId: string, @CurrentUser() user: AuthUser | undefined) {
    // Membership (player/spectator) grants access only WITH the replayReview feature;
    // otherwise the archive's visibility decides — 'link' admits anyone holding the URL
    // (anonymous visitors included, features irrelevant), while 'private' (or a legacy doc
    // with no flag) 404s without revealing the game exists. A member without the feature
    // gets a disclosed 403 instead: their own history already shows the game exists.
    const doc = await this.repo.get(gameId);
    if (!doc) throw new NotFoundException('game not found');
    const isPlayer = !!user && doc.players.some((p) => p.userId === user.userId);
    const isMember = isPlayer || (!!user && (doc.spectators ?? []).includes(user.userId));
    const visibility = doc.replayVisibility === 'link' ? 'link' : 'private';
    const canReview =
      isMember && user ? await this.users.hasFeature(user.userId, 'replayReview') : false;
    if (!canReview && visibility !== 'link') {
      if (!isMember) throw new NotFoundException('game not found');
      throw featureDisabled('replayReview');
    }

    // The repo additionally hard-gates on status=COMPLETED — a live game's action log encodes
    // hidden information and must never leave the server.
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
      visibility,
      canConfigureVisibility: isPlayer && canReview,
    };
  }
}
