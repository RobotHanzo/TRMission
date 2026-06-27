import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';
import { GameRegistry } from './game/game-registry';
import { GameHub } from './ws/hub';

// Step A module: the in-memory game registry + the realtime hub, plus a health
// controller. REST/auth/lobby modules (and a Mongo-backed registry) arrive in
// Steps B/C; the hub's public surface stays the same.
@Module({
  controllers: [HealthController],
  providers: [
    GameRegistry,
    {
      provide: GameHub,
      useFactory: (registry: GameRegistry) => new GameHub(registry),
      inject: [GameRegistry],
    },
  ],
  exports: [GameHub, GameRegistry],
})
export class AppModule {}
