import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, type Db } from 'mongodb';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { MONGO_DB } from '../src/db/tokens';
import { DashboardConfig } from '../src/dashboard/dashboard-config';

// Bootstrap runs at application start, so this spec boots apps repeatedly AGAINST THE
// SAME DB to prove seeding is idempotent across restarts. (createTestApp makes a fresh
// db per call, so we manage the mongod ourselves here.)

let mongod: MongoMemoryServer | undefined;
let client: MongoClient | undefined;
let apps: INestApplication[] = [];

async function sharedDb(): Promise<Db> {
  if (!mongod) {
    mongod = await MongoMemoryServer.create();
    client = new MongoClient(mongod.getUri());
    await client.connect();
  }
  return client!.db('trm-bootstrap-test');
}

async function bootApp(db: Db, ownerEmails: string[]): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MONGO_DB)
    .useValue(db)
    .overrideProvider(DashboardConfig)
    .useValue(new DashboardConfig({ ownerEmails }))
    .compile();
  const app = moduleRef.createNestApplication();
  app.use(cookieParser());
  await app.init();
  apps.push(app);
  return app;
}

afterEach(async () => {
  for (const app of apps) await app.close();
  apps = [];
  if (client) await client.close();
  if (mongod) await mongod.stop();
  client = undefined;
  mongod = undefined;
});

describe('dashboard owner bootstrap', () => {
  it('seeds owner for a registered email, idempotently across reboots', async () => {
    const db = await sharedDb();

    // Boot 1: the account does not exist yet → warned + skipped.
    const app1 = await bootApp(db, ['boss@example.com']);
    expect(await db.collection('dashboardAccounts').countDocuments()).toBe(0);

    // Register the account, then "restart".
    await request(app1.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: 'boss@example.com', password: 'password123', displayName: 'Boss' })
      .expect(201);
    await bootApp(db, ['boss@example.com']);

    const account = await db.collection('dashboardAccounts').findOne({});
    expect(account?.role).toBe('owner');
    expect(account?.grantedBy).toBe('system:env');
    expect(
      await db.collection('dashboardAudit').countDocuments({ action: 'bootstrap.grant' }),
    ).toBe(1);

    // Boot 3: already owner → no second audit entry, record unchanged.
    await bootApp(db, ['boss@example.com']);
    expect(await db.collection('dashboardAccounts').countDocuments()).toBe(1);
    expect(
      await db.collection('dashboardAudit').countDocuments({ action: 'bootstrap.grant' }),
    ).toBe(1);
  }, 120_000);

  it('re-asserts owner over a demoted env-owner (env authoritative at boot)', async () => {
    const db = await sharedDb();
    const app1 = await bootApp(db, []);
    const res = await request(app1.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: 'healed@example.com', password: 'password123', displayName: 'Heal' })
      .expect(201);
    const userId = res.body.user.id as string;
    await db.collection('dashboardAccounts').insertOne({
      _id: userId,
      role: 'viewer',
      grantedBy: 'test',
      grantedAt: new Date(),
      updatedAt: new Date(),
    } as never);

    await bootApp(db, ['healed@example.com']);
    const account = await db.collection('dashboardAccounts').findOne({ _id: userId } as never);
    expect(account?.role).toBe('owner');
    const audit = await db
      .collection('dashboardAudit')
      .findOne({ action: 'bootstrap.grant' } as never);
    expect(audit?.params?.previousRole).toBe('viewer');
  }, 120_000);
});
