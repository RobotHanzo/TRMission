import { Body, Controller, Get, HttpCode, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { apiSchema } from '../openapi/openapi';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { DashboardGuard } from './dashboard.guard';
import { RequirePermission } from './require-permission.decorator';
import { DashboardOfficialMapsService } from './dashboard-official-maps.service';
import {
  ConfigOfficialMapsPutDto,
  ConfigOfficialMapsPutSchema,
  ConfigOfficialMapsSchema,
} from './dashboard.schemas';

// Shares the `/dashboard/config` prefix (and the `config.features` permission) with the feature
// defaults controller: both are the global switches the admin app's Features panel edits.
@ApiTags('dashboard')
@ApiBearerAuth('access-token')
@UseGuards(AccessTokenGuard, DashboardGuard)
@Controller('api/v1/dashboard/config')
export class DashboardOfficialMapsController {
  constructor(private readonly officialMaps: DashboardOfficialMapsService) {}

  @Get('official-maps')
  @RequirePermission('config.features')
  @ApiOperation({
    summary: 'Every official map that ships with the game, and whether it is on offer',
  })
  @ApiResponse({ status: 200, schema: apiSchema(ConfigOfficialMapsSchema) })
  get() {
    return this.officialMaps.get();
  }

  @Put('official-maps')
  @HttpCode(200)
  @RequirePermission('config.features')
  @ApiOperation({
    summary: 'Replace the set of official maps players may pick',
    description:
      'Applies to the very next room-settings change and to every game start (read fresh, never ' +
      'cached). Games already running on a map switched off here are unaffected — they resolve ' +
      'their board from the contentHash they were created with, as do their replays. At least ' +
      'one official map must stay enabled.',
  })
  @ApiBody({ schema: apiSchema(ConfigOfficialMapsPutSchema) })
  @ApiResponse({ status: 200, schema: apiSchema(ConfigOfficialMapsSchema) })
  set(@CurrentUser() actor: AuthUser, @Body() body: ConfigOfficialMapsPutDto) {
    return this.officialMaps.set(actor, body.enabledMapIds);
  }
}
