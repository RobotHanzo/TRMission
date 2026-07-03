import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
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
  ModerationReasonDto,
  ModerationReasonSchema,
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
}
