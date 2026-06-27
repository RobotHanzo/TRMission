import { Controller, Get } from '@nestjs/common';
import { ENGINE_VERSION, CONTENT_HASH } from '@trm/engine';
import { PROTOCOL_VERSION } from '@trm/proto';

// REST is otherwise a Step-C concern (auth/lobby/OpenAPI+Scalar); this single
// liveness + version endpoint proves the NestJS HTTP host is wired now.
@Controller()
export class HealthController {
  @Get('healthz')
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('version')
  version(): { engineVersion: number; protocolVersion: number; contentHash: string } {
    return {
      engineVersion: ENGINE_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      contentHash: CONTENT_HASH,
    };
  }
}
