import { Body, Controller, Get, HttpCode, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { apiSchema } from '../openapi/openapi';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import {
  ConfigTrainCarSkinsPutDto,
  ConfigTrainCarSkinsPutSchema,
  ConfigTrainCarSkinsSchema,
} from '../skins/skins.schemas';
import { DashboardGuard } from './dashboard.guard';
import { RequirePermission } from './require-permission.decorator';
import { DashboardTrainCarSkinsService } from './dashboard-train-car-skins.service';

// Shares the `/dashboard/config` prefix (and the `config.features` permission) with the feature
// defaults and official-maps controllers: all three are global switches the admin app's Features
// panel edits.
@ApiTags('dashboard')
@ApiBearerAuth('access-token')
@UseGuards(AccessTokenGuard, DashboardGuard)
@Controller('api/v1/dashboard/config')
export class DashboardTrainCarSkinsController {
  constructor(private readonly skins: DashboardTrainCarSkinsService) {}

  @Get('train-car-skins')
  @RequirePermission('config.features')
  @ApiOperation({
    summary: 'Every train-card skin pack that ships with the game, and whether it is on offer',
  })
  @ApiResponse({ status: 200, schema: apiSchema(ConfigTrainCarSkinsSchema) })
  get() {
    return this.skins.get();
  }

  @Put('train-car-skins')
  @HttpCode(200)
  @RequirePermission('config.features')
  @ApiOperation({
    summary: 'Replace the set of train-card skin packs players may pick',
    description:
      'Read fresh on every settings load, never cached. Skins are cosmetic and per viewer, so a ' +
      'switch-off touches no game: accounts that had picked the pack fall back to the default ' +
      'artwork while keeping their stored choice, and switching it back on restores them. The ' +
      'default pack is always kept enabled, whether or not it was sent.',
  })
  @ApiBody({ schema: apiSchema(ConfigTrainCarSkinsPutSchema) })
  @ApiResponse({ status: 200, schema: apiSchema(ConfigTrainCarSkinsSchema) })
  set(@CurrentUser() actor: AuthUser, @Body() body: ConfigTrainCarSkinsPutDto) {
    return this.skins.set(actor, body.enabledSkinIds);
  }
}
