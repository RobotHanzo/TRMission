import { Controller, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { MapsService } from './maps.service';
import { EnabledOfficialMapsSchema, MapContentResponseSchema } from './maps.schemas';
import { apiSchema } from '../openapi/openapi';
import { AccessTokenGuard } from '../auth/access-token.guard';

/**
 * The maps routes that stay OUTSIDE the mapBuilder feature gate.
 *
 * - Published-content resolution: players and replay viewers of a custom-map game (guests
 *   included) resolve board content by hash — the unguessable hash is the capability. Gating
 *   this would break live games and replays.
 * - The enabled official-map list: every host (guests included) picks a map from it, and
 *   map authoring has nothing to do with it.
 */
@ApiTags('maps')
@ApiBearerAuth('access-token')
@UseGuards(AccessTokenGuard)
@Controller('api/v1/maps')
export class MapsContentController {
  constructor(private readonly maps: MapsService) {}

  @Get('official/enabled')
  @ApiOperation({
    summary: 'Official maps a room may currently be set to (maintainer-switchable)',
    description:
      'Display convenience for the room settings picker. The same set is enforced on the room ' +
      'settings PATCH and again at game start — maps switched off in the dashboard cannot be ' +
      'selected or started, while games already running on one are unaffected.',
  })
  @ApiResponse({ status: 200, schema: apiSchema(EnabledOfficialMapsSchema) })
  async enabledOfficial(): Promise<{ mapIds: string[] }> {
    return { mapIds: await this.maps.enabledOfficialMapIds() };
  }

  @Get('content/:hash')
  @ApiOperation({ summary: 'Fetch published, immutable map content by contentHash' })
  @ApiResponse({ status: 200, schema: apiSchema(MapContentResponseSchema) })
  async content(@Param('hash') hash: string) {
    const doc = await this.maps.getContentByHash(hash);
    if (!doc) throw new NotFoundException('unknown content hash');
    return doc.content;
  }
}
