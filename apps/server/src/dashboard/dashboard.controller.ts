import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { apiSchema } from '../openapi/openapi';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { DashboardGuard, type DashboardRequest } from './dashboard.guard';
import { DashboardMeSchema } from './dashboard.schemas';

@ApiTags('dashboard')
@ApiBearerAuth('access-token')
@UseGuards(AccessTokenGuard, DashboardGuard)
@Controller('api/v1/dashboard')
export class DashboardController {
  @Get('me')
  @ApiOperation({
    summary: 'Your dashboard identity: role + effective permissions (drives UI gating)',
  })
  @ApiResponse({ status: 200, schema: apiSchema(DashboardMeSchema) })
  me(@Req() req: DashboardRequest) {
    // DashboardGuard has already resolved the account (or 404'd); both are present here.
    const user = req.user!;
    const dashboard = req.dashboard!;
    return {
      userId: user.userId,
      displayName: user.displayName,
      role: dashboard.role,
      permissions: [...dashboard.permissions].sort(),
    };
  }
}
