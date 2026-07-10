import { Body, Controller, Get, HttpCode, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { apiSchema } from '../openapi/openapi';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { DashboardGuard } from './dashboard.guard';
import { RequirePermission } from './require-permission.decorator';
import { DashboardFeatureDefaultsService } from './dashboard-feature-defaults.service';
import {
  ConfigFeaturesPutDto,
  ConfigFeaturesPutSchema,
  ConfigFeaturesSchema,
} from './dashboard.schemas';

@ApiTags('dashboard')
@ApiBearerAuth('access-token')
@UseGuards(AccessTokenGuard, DashboardGuard)
@Controller('api/v1/dashboard/config')
export class DashboardFeatureDefaultsController {
  constructor(private readonly config: DashboardFeatureDefaultsService) {}

  @Get('features')
  @RequirePermission('config.features')
  @ApiOperation({
    summary: 'Global default feature flags, granted to every account on top of any explicit grant',
  })
  @ApiResponse({ status: 200, schema: apiSchema(ConfigFeaturesSchema) })
  getFeatures() {
    return this.config.get();
  }

  @Put('features')
  @HttpCode(200)
  @RequirePermission('config.features')
  @ApiOperation({
    summary: 'Replace the global default feature set',
    description:
      'Applies on the very next request for every account that does not already hold the ' +
      'feature directly (defaults are read fresh, never cached or baked into new accounts).',
  })
  @ApiBody({ schema: apiSchema(ConfigFeaturesPutSchema) })
  @ApiResponse({ status: 200, schema: apiSchema(ConfigFeaturesSchema) })
  setFeatures(@CurrentUser() actor: AuthUser, @Body() body: ConfigFeaturesPutDto) {
    return this.config.set(actor, body.features);
  }
}
