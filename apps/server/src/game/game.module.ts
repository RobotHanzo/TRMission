import { Module } from '@nestjs/common';
import { GameRegistry } from './game-registry';
import { GameHub } from '../ws/hub';
import { JwtTicketVerifier } from '../ws/jwt-ticket';
import { GAME_STORE } from '../db/tokens';
import type { GameStorePort } from '../persistence/types';
import { TokenService } from '../auth/token.service';
import { AuthModule } from '../auth/auth.module';
import { MetricsService } from '../observability/metrics.service';

// Provides the WebSocket hub through DI (verifier = JWT ws-ticket, metrics wired), so
// the lobby can start games and main can attach it to the raw ws server.
@Module({
  imports: [AuthModule],
  providers: [
    GameRegistry,
    {
      provide: GameHub,
      useFactory: (
        registry: GameRegistry,
        store: GameStorePort,
        tokens: TokenService,
        metrics: MetricsService,
      ) => new GameHub(registry, { store, verifier: new JwtTicketVerifier(tokens), metrics }),
      inject: [GameRegistry, GAME_STORE, TokenService, MetricsService],
    },
  ],
  exports: [GameHub, GameRegistry],
})
export class GameModule {}
