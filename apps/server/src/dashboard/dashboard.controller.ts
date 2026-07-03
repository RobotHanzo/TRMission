import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { apiSchema } from '../openapi/openapi';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { DashboardGuard, type DashboardRequest } from './dashboard.guard';
import { RequirePermission } from './require-permission.decorator';
import { DashboardService } from './dashboard.service';
import { DashboardAuditRepo } from './audit.repo';
import {
  AuditListQueryDto,
  AuditListSchema,
  DashboardMeSchema,
  OverviewSchema,
} from './dashboard.schemas';

@ApiTags('dashboard')
@ApiBearerAuth('access-token')
@UseGuards(AccessTokenGuard, DashboardGuard)
@Controller('api/v1/dashboard')
export class DashboardController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly audit: DashboardAuditRepo,
  ) {}

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

  @Get('overview')
  @RequirePermission('overview.read')
  @ApiOperation({ summary: 'System vitals: live counts, users, metric snapshot, versions' })
  @ApiResponse({ status: 200, schema: apiSchema(OverviewSchema) })
  overview() {
    return this.dashboard.overview();
  }

  @Get('audit')
  @RequirePermission('audit.read')
  @ApiOperation({ summary: 'The append-only admin audit log, newest first' })
  @ApiResponse({ status: 200, schema: apiSchema(AuditListSchema) })
  async auditList(@Query() query: AuditListQueryDto) {
    const entries = await this.audit.list(query.limit, query.cursor);
    const last = entries.length === query.limit ? entries[entries.length - 1] : undefined;
    return {
      entries: entries.map((e) => ({
        id: e._id.toHexString(),
        actorId: e.actorId,
        actorName: e.actorName,
        action: e.action,
        ...(e.target ? { target: e.target } : {}),
        ...(e.params ? { params: e.params } : {}),
        at: e.at.toISOString(),
      })),
      nextCursor: last ? last._id.toHexString() : null,
    };
  }
}
