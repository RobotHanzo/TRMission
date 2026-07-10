import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { apiSchema } from '../openapi/openapi';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { RatingsRepo } from './ratings.repo';
import { RatingResultSchema, SubmitRatingDto, SubmitRatingSchema } from './ratings.schemas';

@ApiTags('ratings')
@ApiBearerAuth('access-token')
@UseGuards(AccessTokenGuard)
@Controller('api/v1/ratings')
export class RatingsController {
  constructor(private readonly ratings: RatingsRepo) {}

  @Post()
  @ApiOperation({
    summary: 'Submit a 1-5 star app rating, tagged with the game/room it was submitted from',
  })
  @ApiBody({ schema: apiSchema(SubmitRatingSchema) })
  @ApiResponse({ status: 201, schema: apiSchema(RatingResultSchema) })
  async submit(@CurrentUser() user: AuthUser, @Body() body: SubmitRatingDto) {
    const doc = await this.ratings.insert(user.userId, body.gameId, body.roomId, body.stars);
    return { id: doc._id, stars: doc.stars, createdAt: doc.createdAt.toISOString() };
  }
}
