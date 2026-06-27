import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { GameRegistry } from './game/game-registry';
import { GameHub, type GameHubOptions } from './ws/hub';
import { attachWsServer } from './ws/ws-server';
import { connectMongo } from './db/mongo';
import { MongoGameStore, ensureIndexes } from './persistence/game-store';
import { seedDevGame } from './dev-seed';
import { env } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();

  const options: GameHubOptions = {};
  if (env.persistence) {
    try {
      const db = await connectMongo(env.mongoUrl, env.mongoDb);
      await ensureIndexes(db);
      options.store = new MongoGameStore(db);
      console.log('[mongo] connected %s/%s', env.mongoUrl, env.mongoDb);
    } catch (err) {
      console.warn('[mongo] unavailable — running without persistence:', (err as Error).message);
    }
  }

  const hub = new GameHub(app.get(GameRegistry), options);
  attachWsServer(app.getHttpServer(), hub);

  if (env.devGame) {
    const { gameId, tickets } = await seedDevGame(hub);
    console.log('[dev] seeded game %s; tickets:', gameId, tickets);
  }

  await app.listen(env.port);
  console.log(`TRMission server listening on :${env.port} (REST) + ws path /ws`);
}

void bootstrap();
