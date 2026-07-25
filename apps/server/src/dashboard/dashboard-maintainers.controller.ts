import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { apiSchema } from '../openapi/openapi';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { DashboardGuard, type DashboardRequest } from './dashboard.guard';
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
      'Refuses self-modification, demoting the last owner, granting owner as a non-owner, ' +
      "and granting any permission beyond the actor's own effective set.",
  })
  @ApiBody({ schema: apiSchema(MaintainerPutSchema) })
  @ApiResponse({ status: 200, schema: apiSchema(MaintainerRowSchema) })
  put(
    @Param('userId') userId: string,
    @CurrentUser() actor: AuthUser,
    @Req() req: DashboardRequest,
    @Body() body: MaintainerPutDto,
  ) {
    // DashboardGuard has already resolved the actor's own effective grant onto the request.
    return this.maintainers.put(actor, req.dashboard!, userId, {
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
