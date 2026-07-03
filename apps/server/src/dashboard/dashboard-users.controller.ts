import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { apiSchema } from '../openapi/openapi';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { DashboardGuard } from './dashboard.guard';
import { RequirePermission } from './require-permission.decorator';
import { DashboardUsersService } from './dashboard-users.service';
import {
  DashboardUserDetailSchema,
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
}
