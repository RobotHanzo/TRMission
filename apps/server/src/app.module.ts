import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';
import { DocsController } from './openapi/docs.controller';
import { OpenApiHolder } from './openapi/openapi.holder';
import { GameRegistry } from './game/game-registry';

// Step A/B/C module: the in-memory live-game registry, health + API docs. The
// GameHub is constructed in main.ts because it depends on the (runtime-acquired)
// Mongo store. Auth/lobby modules arrive in the next Step C increment.
@Module({
  controllers: [HealthController, DocsController],
  providers: [GameRegistry, OpenApiHolder],
  exports: [GameRegistry],
})
export class AppModule {}
