import { Global, Module } from '@nestjs/common';
import type { Db } from 'mongodb';
import { connectMongo } from './mongo';
import { ensureIndexes, MongoGameStore } from '../persistence/game-store';
import { MONGO_DB, GAME_STORE } from './tokens';
import { env } from '../config/env';

// Global database wiring: one Mongo connection shared across repositories + the game
// store. Eager so the app fails fast if Mongo is down. Tests override MONGO_DB with an
// in-memory server (so the real connect never runs).
@Global()
@Module({
  providers: [
    {
      provide: MONGO_DB,
      useFactory: async (): Promise<Db> => {
        const db = await connectMongo(env.mongoUrl, env.mongoDb);
        await ensureIndexes(db);
        return db;
      },
    },
    {
      provide: GAME_STORE,
      useFactory: (db: Db) => new MongoGameStore(db),
      inject: [MONGO_DB],
    },
  ],
  exports: [MONGO_DB, GAME_STORE],
})
export class DatabaseModule {}
