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

async function bootApp(db: Db, ownerIds: string[]): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MONGO_DB)
    .useValue(db)
    .overrideProvider(DashboardConfig)
    .useValue(new DashboardConfig({ ownerIds }))
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
  it('seeds owner for a registered id, idempotently across reboots', async () => {
    const db = await sharedDb();

    // Boot 1: the id isn't registered yet → warned + skipped.
    const app1 = await bootApp(db, ['not-a-real-user-id']);
    expect(await db.collection('dashboardAccounts').countDocuments()).toBe(0);

    // Register the account, then "restart" configured with its real (server-minted) id.
    const res = await request(app1.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: 'boss@example.com', password: 'password123', displayName: 'Boss' })
      .expect(201);
    const userId = res.body.user.id as string;
    await bootApp(db, [userId]);

    const account = await db.collection('dashboardAccounts').findOne({});
    expect(account?._id).toBe(userId);
    expect(account?.role).toBe('owner');
    expect(account?.grantedBy).toBe('system:env');
    expect(
      await db.collection('dashboardAudit').countDocuments({ action: 'bootstrap.grant' }),
    ).toBe(1);

    // Boot 3: already owner → no second audit entry, record unchanged.
    await bootApp(db, [userId]);
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

    await bootApp(db, [userId]);
    const account = await db.collection('dashboardAccounts').findOne({ _id: userId } as never);
    expect(account?.role).toBe('owner');
    const audit = await db
      .collection('dashboardAudit')
      .findOne({ action: 'bootstrap.grant' } as never);
    expect(audit?.params?.previousRole).toBe('viewer');
  }, 120_000);

  it('does NOT grant owner to an attacker who registers the target email first (F11)', async () => {
    // The whole point of seeding by id rather than email: registration lets anyone claim an
    // arbitrary, unverified email. An attacker who races to register the operator's intended
    // owner email before the real operator does gets their OWN random `_id` — which never
    // matches whatever id the operator actually configures in DASHBOARD_OWNER_IDS. So even
    // though the attacker's account "has the right email", it must NOT be granted owner.
    const db = await sharedDb();
    const app1 = await bootApp(db, []);

    // Attacker registers the email the maintainer intends to use, before the maintainer does.
    const attacker = await request(app1.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: 'maintainer@example.com', password: 'attacker-pw', displayName: 'Attacker' })
      .expect(201);
    const attackerId = attacker.body.user.id as string;

    // Operator configures DASHBOARD_OWNER_IDS with a DIFFERENT id (e.g. the maintainer's own
    // account id, minted whenever they actually register) — never the attacker's.
    const configuredId = 'the-real-maintainers-id-not-the-attackers';
    await bootApp(db, [configuredId]);

    // The attacker's account must not have been granted owner (or anything at all).
    const attackerAccount = await db
      .collection('dashboardAccounts')
      .findOne({ _id: attackerId } as never);
    expect(attackerAccount).toBeNull();
    expect(await db.collection('dashboardAccounts').countDocuments()).toBe(0);
    expect(
      await db.collection('dashboardAudit').countDocuments({ action: 'bootstrap.grant' }),
    ).toBe(0);
  }, 120_000);
});
