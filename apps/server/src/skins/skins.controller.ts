import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { TrainCarSkin } from '@trm/shared';
import { apiSchema } from '../openapi/openapi';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { SkinsService } from './skins.service';
import { EnabledTrainCarSkinsSchema } from './skins.schemas';

/**
 * Cosmetics availability. Ungated beyond a valid session (guests included) for the same reason
 * as `GET /maps/official/enabled`: every player's settings screen reads this list, and there is
 * nothing sensitive in it.
 */
@ApiTags('skins')
@ApiBearerAuth('access-token')
@UseGuards(AccessTokenGuard)
@Controller('api/v1/skins')
export class SkinsController {
  constructor(private readonly skins: SkinsService) {}

  @Get('train-cars/enabled')
  @ApiOperation({
    summary: 'Train-card skin packs currently on offer (maintainer-switchable)',
    description:
      'Drives the settings picker. A pack switched off here stops being offered and stops being ' +
      'drawn — clients fall back to the default pack — but an account that had picked it keeps ' +
      'the stored value, so switching the pack back on restores it. The default pack is always ' +
      'present.',
  })
  @ApiResponse({ status: 200, schema: apiSchema(EnabledTrainCarSkinsSchema) })
  async enabledTrainCars(): Promise<{ skinIds: TrainCarSkin[] }> {
    return { skinIds: await this.skins.enabledTrainCarSkinIds() };
  }
}
