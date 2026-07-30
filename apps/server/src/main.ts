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
import { SelfUpdateService } from './selfupdate/selfupdate.service';
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

  // How a hot-applied OTA takes effect (docs/release/server-ota.md). A real `app.close()` first, so
  // the command queue drains and Mongo/sockets close cleanly; exit code 0 then lets the container's
  // restart policy start the process again — on the swapped-in source. Every client's socket drops,
  // which is also the signal the web clients use to check whether to reload themselves.
  app.get(SelfUpdateService).setRestarter(async () => {
    await app.close();
    process.exit(0);
  });

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
