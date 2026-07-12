import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createTestApp, type TestApp } from './app';

let sharedMongod: MongoMemoryServer;
beforeAll(async () => {
  sharedMongod = await MongoMemoryServer.create();
}, 60_000);
afterAll(() => sharedMongod.stop());

let t: TestApp;
const server = () => t.app.getHttpServer();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function guest(displayName: string) {
  const res = await request(server()).post('/api/v1/auth/guest').send({ displayName }).expect(201);
  return { userId: res.body.user.id as string, token: res.body.accessToken as string };
}

async function maintainer(email: string, role: 'viewer' | 'moderator') {
  const res = await request(server())
    .post('/api/v1/auth/register')
    .send({ email, password: 'password123', displayName: role })
    .expect(201);
  await t.db.collection('dashboardAccounts').insertOne({
    _id: res.body.user.id,
    role,
    grantedBy: 'test',
    grantedAt: new Date(),
    updatedAt: new Date(),
  } as never);
  return { userId: res.body.user.id as string, token: res.body.accessToken as string };
}

async function fileReport(category: string) {
  const reporter = await guest(`R-${category}`);
  const target = await guest(`T-${category}`);
  const res = await request(server())
    .post('/api/v1/reports/player')
    .set(auth(reporter.token))
    .send({ userId: target.userId, category })
    .expect(201);
  return res.body.id as string;
}

let moderator: { userId: string; token: string };
let viewer: { userId: string; token: string };

beforeAll(async () => {
  t = await createTestApp({ mongod: sharedMongod, dbName: 'trm-test-dash-reports' });
  moderator = await maintainer('mod@example.com', 'moderator');
  viewer = await maintainer('viewer@example.com', 'viewer');
}, 60_000);
afterAll(() => t.close());

describe('dashboard reports', () => {
  it('lists open reports newest-first with cursor pagination; viewer is 403', async () => {
    const first = await fileReport('SPAM');
    const second = await fileReport('HARASSMENT');

    await request(server()).get('/api/v1/dashboard/reports').set(auth(viewer.token)).expect(403);

    const page1 = await request(server())
      .get('/api/v1/dashboard/reports')
      .query({ limit: 1 })
      .set(auth(moderator.token))
      .expect(200);
    expect(page1.body.reports).toHaveLength(1);
    expect(page1.body.reports[0].id).toBe(second);
    expect(page1.body.reports[0].status).toBe('open');
    expect(page1.body.nextCursor).toBeTruthy();

    const page2 = await request(server())
      .get('/api/v1/dashboard/reports')
      .query({ limit: 1, cursor: page1.body.nextCursor })
      .set(auth(moderator.token))
      .expect(200);
    expect(page2.body.reports[0].id).toBe(first);
  });

  it('resolves once (open→resolved CAS), audits, and 404s a second resolve', async () => {
    const id = await fileReport('CHEATING');

    const resolved = await request(server())
      .post(`/api/v1/dashboard/reports/${id}/resolve`)
      .set(auth(moderator.token))
      .send({ note: 'warned the player' })
      .expect(200);
    expect(resolved.body.status).toBe('resolved');
    expect(resolved.body.resolutionNote).toBe('warned the player');

    await request(server())
      .post(`/api/v1/dashboard/reports/${id}/resolve`)
      .set(auth(moderator.token))
      .send({})
      .expect(404);

    const audit = await t.db
      .collection('dashboardAudit')
      .findOne({ action: 'report.resolve', 'target.id': id });
    expect(audit).toBeTruthy();

    // The resolved report leaves the default (open) list but shows under status=resolved.
    const open = await request(server())
      .get('/api/v1/dashboard/reports')
      .set(auth(moderator.token))
      .expect(200);
    expect(open.body.reports.map((r: { id: string }) => r.id)).not.toContain(id);
    const done = await request(server())
      .get('/api/v1/dashboard/reports')
      .query({ status: 'resolved' })
      .set(auth(moderator.token))
      .expect(200);
    expect(done.body.reports.map((r: { id: string }) => r.id)).toContain(id);
  });
});
