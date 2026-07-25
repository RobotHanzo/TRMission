// Regression coverage for the audit-log cursor: a malformed `cursor` value must fall back
// to the unfiltered first page (same "cursors are a convenience, not state" contract as
// moderation/report.repo.ts), never throw an unhandled BSONError out to a 500.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { ObjectId } from 'mongodb';
import { createTestApp, type TestApp } from './app';
import type { AuditEntryDoc } from '../src/dashboard/audit.repo';

let sharedMongod: MongoMemoryServer;
beforeAll(async () => {
  sharedMongod = await MongoMemoryServer.create();
}, 60_000);
afterAll(() => sharedMongod.stop());

let t: TestApp;
const server = () => t.app.getHttpServer();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function maintainer(email: string, role: 'viewer' | 'admin') {
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

let admin: { userId: string; token: string };
let oldestId: string;
let middleId: string;
let newestId: string;

beforeAll(async () => {
  t = await createTestApp({ mongod: sharedMongod, dbName: 'trm-test-dash-audit-cursor' });
  admin = await maintainer('admin@example.com', 'admin');

  // Three entries with distinct, deterministically ordered ObjectIds (second-resolution
  // timestamps far enough apart to avoid any tie).
  const nowSec = Math.floor(Date.now() / 1000);
  const oldest = ObjectId.createFromTime(nowSec - 20);
  const middle = ObjectId.createFromTime(nowSec - 10);
  const newest = ObjectId.createFromTime(nowSec);
  oldestId = oldest.toHexString();
  middleId = middle.toHexString();
  newestId = newest.toHexString();

  await t.db.collection<AuditEntryDoc>('dashboardAudit').insertMany([
    { _id: oldest, actorId: 'system:env', actorName: 'system', action: 'bootstrap.grant', at: new Date() },
    { _id: middle, actorId: 'system:env', actorName: 'system', action: 'bootstrap.grant', at: new Date() },
    { _id: newest, actorId: 'system:env', actorName: 'system', action: 'bootstrap.grant', at: new Date() },
  ]);
}, 60_000);
afterAll(() => t.close());

describe('dashboard audit cursor', () => {
  it('paginates newest-first with a well-formed ObjectId-hex cursor', async () => {
    const page1 = await request(server())
      .get('/api/v1/dashboard/audit')
      .query({ limit: 1 })
      .set(auth(admin.token))
      .expect(200);
    expect(page1.body.entries).toHaveLength(1);
    expect(page1.body.entries[0].id).toBe(newestId);
    expect(page1.body.nextCursor).toBe(newestId);

    const page2 = await request(server())
      .get('/api/v1/dashboard/audit')
      .query({ limit: 1, cursor: page1.body.nextCursor })
      .set(auth(admin.token))
      .expect(200);
    expect(page2.body.entries).toHaveLength(1);
    expect(page2.body.entries[0].id).toBe(middleId);
    expect(page2.body.nextCursor).toBe(middleId);

    const page3 = await request(server())
      .get('/api/v1/dashboard/audit')
      .query({ limit: 1, cursor: page2.body.nextCursor })
      .set(auth(admin.token))
      .expect(200);
    expect(page3.body.entries).toHaveLength(1);
    expect(page3.body.entries[0].id).toBe(oldestId);
  });

  it.each([
    ['a short garbage string', 'abc'],
    ['a 24-char string that is not valid hex', 'not-a-valid-hex-id-24ch'],
    ['a long garbage string under the 300-char zod cap', 'x'.repeat(250)],
  ])('falls back to the first page instead of 500ing on %s', async (_label, cursor) => {
    const res = await request(server())
      .get('/api/v1/dashboard/audit')
      .query({ cursor })
      .set(auth(admin.token))
      .expect(200);
    // Same result as no cursor at all: the malformed cursor is ignored, not enforced.
    expect(res.body.entries).toHaveLength(3);
    expect(res.body.entries[0].id).toBe(newestId);
    expect(res.body.entries[2].id).toBe(oldestId);
  });

  it('an empty-string cursor also falls back to the first page', async () => {
    const res = await request(server())
      .get('/api/v1/dashboard/audit')
      .query({ cursor: '' })
      .set(auth(admin.token))
      .expect(200);
    expect(res.body.entries).toHaveLength(3);
    expect(res.body.entries[0].id).toBe(newestId);
  });
});
