import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { GameHub } from './ws/hub';
import { attachWsServer } from './ws/ws-server';
import { seedDevGame } from './dev-seed';
import { env } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();

  const hub = app.get(GameHub);
  attachWsServer(app.getHttpServer(), hub);

  if (env.devGame) {
    const { gameId, tickets } = seedDevGame(hub);
    console.log('[dev] seeded game %s; tickets:', gameId, tickets);
  }

  await app.listen(env.port);
  console.log(`TRMission server listening on :${env.port} (REST) + ws path /ws`);
}

void bootstrap();
