import { Module } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { DatabaseModule } from './db/database.module';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health/health.controller';
import { DocsController } from './openapi/docs.controller';
import { OpenApiHolder } from './openapi/openapi.holder';
import { GameRegistry } from './game/game-registry';

// REST control plane: database wiring, auth, health, and API docs. A global
// ZodValidationPipe validates every request body against its zod DTO. The GameHub
// (WebSocket) is constructed in main.ts from the DI-provided store.
@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [HealthController, DocsController],
  providers: [GameRegistry, OpenApiHolder, { provide: APP_PIPE, useClass: ZodValidationPipe }],
  exports: [GameRegistry],
})
export class AppModule {}
