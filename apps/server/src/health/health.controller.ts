import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { ENGINE_VERSION } from '@trm/engine';
import { OFFICIAL_MAPS } from '@trm/map-data';
import { PROTOCOL_VERSION } from '@trm/proto';

// Liveness + build/version metadata. Documented so the generated OpenAPI has at least
// one tag group; auth/lobby controllers add the rest in the next increment.
@ApiTags('system')
@SkipThrottle()
@Controller()
export class HealthController {
  @Get('healthz')
  @ApiOperation({ summary: 'Liveness probe' })
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('version')
  @ApiOperation({ summary: 'Engine / protocol / content versions' })
  version(): { engineVersion: number; protocolVersion: number; contentHash: string } {
    return {
      engineVersion: ENGINE_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      contentHash: OFFICIAL_MAPS[0]?.hash ?? '',
    };
  }
}
