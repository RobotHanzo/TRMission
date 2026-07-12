import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { apiSchema } from '../openapi/openapi';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { DashboardGuard } from './dashboard.guard';
import { RequirePermission } from './require-permission.decorator';
import { DashboardReportsService } from './dashboard-reports.service';
import {
  ReportRowSchema,
  ReportsListQueryDto,
  ReportsListSchema,
  ResolveReportDto,
  ResolveReportSchema,
} from './dashboard.schemas';
import type { AuthUser } from '../auth/auth.types';

@ApiTags('dashboard')
@ApiBearerAuth('access-token')
@UseGuards(AccessTokenGuard, DashboardGuard)
@Controller('api/v1/dashboard')
export class DashboardReportsController {
  constructor(private readonly reports: DashboardReportsService) {}

  @Get('reports')
  @RequirePermission('reports.read')
  @ApiOperation({ summary: 'UGC reports (players + shared custom maps), newest first' })
  @ApiResponse({ status: 200, schema: apiSchema(ReportsListSchema) })
  list(@Query() query: ReportsListQueryDto) {
    return this.reports.list(query);
  }

  @Post('reports/:id/resolve')
  @HttpCode(200)
  @RequirePermission('reports.resolve')
  @ApiOperation({ summary: 'Mark a report resolved (audited; open→resolved is one-way)' })
  @ApiBody({ schema: apiSchema(ResolveReportSchema) })
  @ApiResponse({ status: 200, schema: apiSchema(ReportRowSchema) })
  resolve(@Param('id') id: string, @CurrentUser() actor: AuthUser, @Body() body: ResolveReportDto) {
    return this.reports.resolve(actor, id, body.note);
  }
}
