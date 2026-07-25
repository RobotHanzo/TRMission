import { Body, Controller, NotFoundException, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { apiSchema } from '../openapi/openapi';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { HistoryRepo } from '../history/history.repo';
import { RatingsRepo } from './ratings.repo';
import { RatingsThrottlerGuard } from './ratings-throttle.guard';
import { RatingResultSchema, SubmitRatingDto, SubmitRatingSchema } from './ratings.schemas';

@ApiTags('ratings')
@ApiBearerAuth('access-token')
@UseGuards(AccessTokenGuard)
@Controller('api/v1/ratings')
export class RatingsController {
  constructor(
    private readonly ratings: RatingsRepo,
    private readonly history: HistoryRepo,
  ) {}

  @Post()
  @UseGuards(RatingsThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Submit a 1-5 star app rating, tagged with the game/room it was submitted from',
  })
  @ApiBody({ schema: apiSchema(SubmitRatingSchema) })
  @ApiResponse({ status: 201, schema: apiSchema(RatingResultSchema) })
  async submit(@CurrentUser() user: AuthUser, @Body() body: SubmitRatingDto) {
    // Only a player or spectator of the referenced game may rate it — mirrors
    // GET /history/:gameId's membership check (matchHistory is written only on completion, so
    // this also naturally restricts ratings to finished games, matching the client's endgame
    // rating prompt). 404, not 403: don't reveal whether an unrelated gameId exists.
    const membership = await this.history.getForUser(body.gameId, user.userId);
    if (!membership) throw new NotFoundException('game not found');

    const doc = await this.ratings.upsert(
      user.userId,
      body.gameId,
      body.roomId,
      body.stars,
      body.text,
    );
    return {
      id: doc._id,
      stars: doc.stars,
      ...(doc.text ? { text: doc.text } : {}),
      createdAt: doc.createdAt.toISOString(),
    };
  }
}
