// Boots the full REST app against an in-memory MongoDB (overriding the real MONGO_DB
// provider), with the same middleware/pipes as production. Used by the HTTP e2e specs.
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, type Db } from 'mongodb';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { MONGO_DB } from '../src/db/tokens';
import { OpenApiHolder } from '../src/openapi/openapi.holder';
import { buildOpenApiDocument } from '../src/openapi/openapi';

export interface TestApp {
  app: INestApplication;
  db: Db;
  close(): Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const mongod = await MongoMemoryServer.create();
  const client = new MongoClient(mongod.getUri());
  await client.connect();
  const db = client.db('trm-test');

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MONGO_DB)
    .useValue(db)
    .compile();

  const app = moduleRef.createNestApplication();
  app.use(cookieParser());
  await app.init();
  app.get(OpenApiHolder).set(buildOpenApiDocument(app));

  return {
    app,
    db,
    async close() {
      await app.close();
      await client.close();
      await mongod.stop();
    },
  };
}

/** Extract the `trm_refresh=...` cookie pair from a response's Set-Cookie header. */
export function refreshCookie(res: { headers: Record<string, unknown> }): string {
  const setCookie = res.headers['set-cookie'] as string[] | undefined;
  const c = setCookie?.find((s) => s.startsWith('trm_refresh='));
  return c ? (c.split(';')[0] ?? '') : '';
}
