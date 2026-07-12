import { Module } from '@nestjs/common';
import { boardForContentHash, buildBoard } from '@trm/engine';
import type { Board, GameConfig } from '@trm/engine';
import { GameRegistry } from './game-registry';
import { GameHub } from '../ws/hub';
import { JwtTicketVerifier } from '../ws/jwt-ticket';
import { GAME_STORE } from '../db/tokens';
import type { GameStorePort } from '../persistence/types';
import { TokenService } from '../auth/token.service';
import { AuthModule } from '../auth/auth.module';
import { MetricsService } from '../observability/metrics.service';
import { MapsModule } from '../maps/maps.module';
import { MapContentRepo } from '../maps/map-content.repo';
import { PushModule } from '../push/push.module';
import { PushService } from '../push/push.service';
import { env } from '../config/env';

/** Static registry first (official maps, zero I/O); fall back to Mongo for custom-map content
 *  published at start time. Recovery on an unknown hash still throws loudly either way. */
function makeBoardResolver(mapContents: MapContentRepo): (config: GameConfig) => Promise<Board> {
  return async (config) => {
    try {
      return boardForContentHash(config.contentHash);
    } catch {
      const doc = await mapContents.findByHash(config.contentHash);
      if (!doc) throw new Error(`No registered map content for hash ${config.contentHash}`);
      return buildBoard(doc.content);
    }
  };
}

// Provides the WebSocket hub through DI (verifier = JWT ws-ticket, metrics wired), so
// the lobby can start games and main can attach it to the raw ws server.
@Module({
  imports: [AuthModule, MapsModule, PushModule],
  providers: [
    GameRegistry,
    {
      provide: GameHub,
      useFactory: (
        registry: GameRegistry,
        store: GameStorePort,
        tokens: TokenService,
        metrics: MetricsService,
        mapContents: MapContentRepo,
        push: PushService,
      ) =>
        new GameHub(registry, {
          store,
          verifier: new JwtTicketVerifier(tokens),
          metrics,
          botMoveDelayMs: env.botMoveDelayMs,
          boardResolver: makeBoardResolver(mapContents),
          // The hub stays framework-free: adapt the Nest service into the plain sink.
          push: {
            yourTurn: (gameId, playerId) => push.notifyYourTurn(gameId, playerId),
            gameOver: (gameId, playerIds) => push.notifyGameOver(gameId, playerIds),
          },
          yourTurnDelayMs: env.pushYourTurnDelayMs,
        }),
      inject: [GameRegistry, GAME_STORE, TokenService, MetricsService, MapContentRepo, PushService],
    },
  ],
  exports: [GameHub, GameRegistry],
})
export class GameModule {}
