import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { GameHub } from './ws/hub';
import { TokenService } from './auth/token.service';
import { attachWsServer } from './ws/ws-server';
import { OpenApiHolder } from './openapi/openapi.holder';
import { buildOpenApiDocument } from './openapi/openapi';
import { seedDevGame } from './dev-seed';
import { env } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  // CSP is disabled so the Scalar /docs page can load its CDN bundle; tighten in prod.
  // Referrer-Policy is pinned to match the web tier's nginx value (helmet's default is
  // `no-referrer`) so the proxied /api responses never carry two conflicting policies.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );
  app.use(cookieParser());
  if (env.corsOrigins.length > 0) app.enableCors({ origin: env.corsOrigins, credentials: true });

  const hub = app.get(GameHub);
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
