import { Controller, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { MapsService } from './maps.service';
import { MapContentResponseSchema } from './maps.schemas';
import { apiSchema } from '../openapi/openapi';
import { AccessTokenGuard } from '../auth/access-token.guard';

/**
 * Published-content resolution stays OUTSIDE the mapBuilder feature gate: players and
 * replay viewers of a custom-map game (guests included) resolve board content by hash —
 * the unguessable hash is the capability. Gating this would break live games and replays.
 */
@ApiTags('maps')
@ApiBearerAuth('access-token')
@UseGuards(AccessTokenGuard)
@Controller('api/v1/maps')
export class MapsContentController {
  constructor(private readonly maps: MapsService) {}

  @Get('content/:hash')
  @ApiOperation({ summary: 'Fetch published, immutable map content by contentHash' })
  @ApiResponse({ status: 200, schema: apiSchema(MapContentResponseSchema) })
  async content(@Param('hash') hash: string) {
    const doc = await this.maps.getContentByHash(hash);
    if (!doc) throw new NotFoundException('unknown content hash');
    return doc.content;
  }
}
