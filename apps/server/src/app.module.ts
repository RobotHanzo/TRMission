import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';
import { GameRegistry } from './game/game-registry';

// Step A/B module: the in-memory live-game registry + a health controller. The
// GameHub is constructed in main.ts because it depends on the (runtime-acquired)
// Mongo store. REST/auth/lobby modules arrive in Step C.
@Module({
  controllers: [HealthController],
  providers: [GameRegistry],
  exports: [GameRegistry],
})
export class AppModule {}
