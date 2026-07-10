import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { apiSchema } from '../openapi/openapi';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { DashboardGuard } from './dashboard.guard';
import { RequirePermission } from './require-permission.decorator';
import { DashboardRatingsService } from './dashboard-ratings.service';
import { RatingsListQueryDto, RatingsListSchema } from './dashboard.schemas';

@ApiTags('dashboard')
@ApiBearerAuth('access-token')
@UseGuards(AccessTokenGuard, DashboardGuard)
@Controller('api/v1/dashboard')
export class DashboardRatingsController {
  constructor(private readonly ratings: DashboardRatingsService) {}

  @Get('ratings')
  @RequirePermission('ratings.read')
  @ApiOperation({ summary: 'List submitted app ratings, most recent first, with average/total' })
  @ApiResponse({ status: 200, schema: apiSchema(RatingsListSchema) })
  list(@Query() query: RatingsListQueryDto) {
    return this.ratings.list(query);
  }
}
