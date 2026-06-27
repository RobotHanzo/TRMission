// Dynamic OpenAPI document generation (ADR A3). The document is built from the live
// Nest application at boot (and in tests), so it always reflects the actual routes —
// never a hand-maintained spec. Request/response bodies are documented from zod
// schemas via `apiSchema` (zod is the single source for validation + docs).
import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { z } from 'zod';

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('TRMission API')
    .setDescription(
      '台鐵任務 — REST control plane (auth, lobby, match history). ' +
        'Realtime gameplay is protobuf-over-WebSocket at /ws and is not described here.',
    )
    .setVersion('1')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
    .build();
  return SwaggerModule.createDocument(app, config);
}

/** A zod schema → an OpenAPI 3 schema object, for `@ApiBody`/`@ApiResponse`. */
export const apiSchema = (schema: z.ZodType): Record<string, unknown> =>
  z.toJSONSchema(schema, { unrepresentable: 'any' }) as Record<string, unknown>;
