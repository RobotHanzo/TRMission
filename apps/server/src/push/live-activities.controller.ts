import { Body, Controller, Delete, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { apiSchema } from '../openapi/openapi';
import { LiveActivityRepo } from './live-activity.repo';
import {
  RegisterLiveActivityDto,
  RegisterLiveActivitySchema,
  RemoveLiveActivityDto,
  RemoveLiveActivitySchema,
} from './push.schemas';
import type { AuthUser } from '../auth/auth.types';

/**
 * The iOS Live Activity push-token registry (issue #43) — the client posts the ActivityKit token it
 * gets after starting the in-game activity, so the server can keep that card current while the app
 * is suspended.
 *
 * Deliberately NOT gated on seat membership: `PushService.updateLiveActivities` only ever pushes
 * content derived from the recipient's OWN seat, so a token registered against a game the caller
 * isn't seated in receives nothing at all. Checking here as well would add a game lookup to a hot
 * path for no security gain, and a 404 would leak whether a game id exists.
 */
@ApiTags('push')
@Controller('api/v1/me/live-activities')
@UseGuards(AccessTokenGuard)
@ApiBearerAuth('access-token')
export class LiveActivitiesController {
  constructor(private readonly activities: LiveActivityRepo) {}

  @Post()
  @HttpCode(204)
  @ApiOperation({
    summary: 'Register this iOS Live Activity for server-side updates (idempotent per token)',
  })
  @ApiBody({ schema: apiSchema(RegisterLiveActivitySchema) })
  async register(
    @CurrentUser() user: AuthUser,
    @Body() body: RegisterLiveActivityDto,
  ): Promise<void> {
    await this.activities.upsert(user.userId, body.gameId, body.token);
  }

  @Delete()
  @HttpCode(204)
  @ApiOperation({ summary: 'Unregister a Live Activity token (card dismissed / game left)' })
  @ApiBody({ schema: apiSchema(RemoveLiveActivitySchema) })
  async remove(@CurrentUser() user: AuthUser, @Body() body: RemoveLiveActivityDto): Promise<void> {
    await this.activities.removeForUser(user.userId, body.token);
  }
}
