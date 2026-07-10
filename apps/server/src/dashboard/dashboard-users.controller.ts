import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { apiSchema } from '../openapi/openapi';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { DashboardGuard } from './dashboard.guard';
import { RequirePermission } from './require-permission.decorator';
import { DashboardUsersService } from './dashboard-users.service';
import {
  DashboardUserDetailSchema,
  FeaturedUsersSchema,
  ModerationReasonDto,
  ModerationReasonSchema,
  UserFeaturesPutDto,
  UserFeaturesPutSchema,
  UsersListQueryDto,
  UsersListSchema,
} from './dashboard.schemas';

@ApiTags('dashboard')
@ApiBearerAuth('access-token')
@UseGuards(AccessTokenGuard, DashboardGuard)
@Controller('api/v1/dashboard/users')
export class DashboardUsersController {
  constructor(private readonly users: DashboardUsersService) {}

  @Get()
  @RequirePermission('users.read')
  @ApiOperation({ summary: 'List/search users (registered + guests), newest first' })
  @ApiResponse({ status: 200, schema: apiSchema(UsersListSchema) })
  list(@Query() query: UsersListQueryDto) {
    return this.users.list(query);
  }

  // Declared BEFORE ':id' — express matches in declaration order, so 'features' must not
  // be captured as a user id.
  @Get('features')
  @RequirePermission('users.features')
  @ApiOperation({ summary: 'Accounts holding at least one gated feature' })
  @ApiResponse({ status: 200, schema: apiSchema(FeaturedUsersSchema) })
  listFeatured() {
    return this.users.listFeatured();
  }

  @Get(':id')
  @RequirePermission('users.read')
  @ApiOperation({ summary: 'One user: profile, sessions, active rooms, match history' })
  @ApiResponse({ status: 200, schema: apiSchema(DashboardUserDetailSchema) })
  detail(@Param('id') id: string) {
    return this.users.detail(id);
  }

  @Post(':id/disable')
  @HttpCode(200)
  @RequirePermission('users.ban')
  @ApiOperation({
    summary: 'Ban an account',
    description:
      'Revokes all refresh sessions and refuses new logins/refreshes/ws-game tickets ' +
      'immediately. Already-issued access tokens remain valid for up to 15 minutes on ' +
      'read-only REST routes; an already-open game socket stays bound until it disconnects ' +
      '(reconnecting requires a fresh ticket, which is refused).',
  })
  @ApiBody({ schema: apiSchema(ModerationReasonSchema) })
  @ApiResponse({ status: 200, schema: apiSchema(DashboardUserDetailSchema) })
  disable(
    @Param('id') id: string,
    @CurrentUser() actor: AuthUser,
    @Body() body: ModerationReasonDto,
  ) {
    return this.users.disable(actor, id, body.reason);
  }

  @Post(':id/enable')
  @HttpCode(200)
  @RequirePermission('users.ban')
  @ApiOperation({ summary: 'Lift a ban' })
  @ApiResponse({ status: 200, schema: apiSchema(DashboardUserDetailSchema) })
  enable(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.users.enable(actor, id);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('users.delete')
  @ApiOperation({
    summary: 'Permanently delete an account',
    description:
      'Irreversible. Terminates any LIVE game the user is seated in (no scores, not ' +
      'replayable) and closes their rooms, revokes all sessions, deletes their owned ' +
      'custom-map drafts, then removes the account. Completed-game match history and ' +
      'published map content are retained as an anonymised archive. Refused (409) while ' +
      'the target still holds dashboard access.',
  })
  @ApiBody({ schema: apiSchema(ModerationReasonSchema) })
  @ApiResponse({ status: 204, description: 'Account deleted' })
  remove(
    @Param('id') id: string,
    @CurrentUser() actor: AuthUser,
    @Body() body: ModerationReasonDto,
  ) {
    return this.users.delete(actor, id, body.reason);
  }

  @Put(':id/features')
  @HttpCode(200)
  @RequirePermission('users.features')
  @ApiOperation({
    summary: "Replace a registered account's gated features (replayReview / mapBuilder)",
    description:
      'Grants apply on the very next request (features are read per request, never from ' +
      'token claims). Guests can never hold features.',
  })
  @ApiBody({ schema: apiSchema(UserFeaturesPutSchema) })
  @ApiResponse({ status: 200, schema: apiSchema(DashboardUserDetailSchema) })
  setFeatures(
    @Param('id') id: string,
    @CurrentUser() actor: AuthUser,
    @Body() body: UserFeaturesPutDto,
  ) {
    return this.users.setFeatures(actor, id, body.features);
  }
}
