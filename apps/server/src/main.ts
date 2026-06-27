import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { GameRegistry } from './game/game-registry';
import { GameHub } from './ws/hub';
import { JwtTicketVerifier } from './ws/jwt-ticket';
import { TokenService } from './auth/token.service';
import { attachWsServer } from './ws/ws-server';
import { GAME_STORE } from './db/tokens';
import type { GameStorePort } from './persistence/types';
import { OpenApiHolder } from './openapi/openapi.holder';
import { buildOpenApiDocument } from './openapi/openapi';
import { seedDevGame } from './dev-seed';
import { env } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  app.use(cookieParser());
  if (env.corsOrigins.length > 0) app.enableCors({ origin: env.corsOrigins, credentials: true });

  const store = app.get<GameStorePort>(GAME_STORE);
  const verifier = new JwtTicketVerifier(app.get(TokenService));
  const hub = new GameHub(app.get(GameRegistry), { store, verifier });
  attachWsServer(app.getHttpServer(), hub);

  // Build the OpenAPI document from the live app and expose it via Scalar at /docs.
  app.get(OpenApiHolder).set(buildOpenApiDocument(app));

  if (env.devGame) {
    const { gameId, tickets } = await seedDevGame(hub, app.get(TokenService));
    console.log('[dev] seeded game %s; tickets:', gameId, tickets);
  }

  await app.listen(env.port);
  console.log(`TRMission server listening on :${env.port} (REST + ws /ws); docs at /docs`);
}

void bootstrap();
