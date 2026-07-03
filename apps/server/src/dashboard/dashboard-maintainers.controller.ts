import { Body, Controller, Delete, Get, HttpCode, Param, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { apiSchema } from '../openapi/openapi';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { DashboardGuard } from './dashboard.guard';
import { RequirePermission } from './require-permission.decorator';
import { DashboardMaintainersService } from './dashboard-maintainers.service';
import {
  MaintainerPutDto,
  MaintainerPutSchema,
  MaintainerRowSchema,
  MaintainersListSchema,
} from './dashboard.schemas';

@ApiTags('dashboard')
@ApiBearerAuth('access-token')
@UseGuards(AccessTokenGuard, DashboardGuard)
@Controller('api/v1/dashboard/maintainers')
export class DashboardMaintainersController {
  constructor(private readonly maintainers: DashboardMaintainersService) {}

  @Get()
  @RequirePermission('maintainers.read')
  @ApiOperation({ summary: 'Everyone with dashboard access, with their effective permissions' })
  @ApiResponse({ status: 200, schema: apiSchema(MaintainersListSchema) })
  list() {
    return this.maintainers.list();
  }

  @Put(':userId')
  @RequirePermission('maintainers.write')
  @ApiOperation({
    summary: 'Grant or update dashboard access (owner only)',
    description:
      'Full replacement of the record: role + optional extra/denied permission overrides. ' +
      'Refuses self-modification and demoting the last owner.',
  })
  @ApiBody({ schema: apiSchema(MaintainerPutSchema) })
  @ApiResponse({ status: 200, schema: apiSchema(MaintainerRowSchema) })
  put(
    @Param('userId') userId: string,
    @CurrentUser() actor: AuthUser,
    @Body() body: MaintainerPutDto,
  ) {
    return this.maintainers.put(actor, userId, {
      role: body.role,
      ...(body.extraPermissions?.length ? { extraPermissions: body.extraPermissions } : {}),
      ...(body.deniedPermissions?.length ? { deniedPermissions: body.deniedPermissions } : {}),
    });
  }

  @Delete(':userId')
  @HttpCode(204)
  @RequirePermission('maintainers.write')
  @ApiOperation({ summary: 'Revoke dashboard access (owner only; last owner protected)' })
  revoke(@Param('userId') userId: string, @CurrentUser() actor: AuthUser) {
    return this.maintainers.revoke(actor, userId);
  }
}
