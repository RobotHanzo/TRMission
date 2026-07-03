import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from './app';
import { DashboardAuditRepo } from '../src/dashboard/audit.repo';

let t: TestApp;
const server = () => t.app.getHttpServer();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function registered(email: string, displayName: string) {
  const res = await request(server())
    .post('/api/v1/auth/register')
    .send({ email, password: 'password123', displayName })
    .expect(201);
  return { userId: res.body.user.id as string, token: res.body.accessToken as string };
}

let owner: Awaited<ReturnType<typeof registered>>;

beforeAll(async () => {
  t = await createTestApp();
  owner = await registered('owner@example.com', 'Owner');
  await t.db.collection('dashboardAccounts').insertOne({
    _id: owner.userId,
    role: 'owner',
    grantedBy: 'test',
    grantedAt: new Date(),
    updatedAt: new Date(),
  } as never);
}, 60_000);

afterAll(() => t.close());

describe('maintainers CRUD', () => {
  it('grants, updates, lists, and revokes with audit entries', async () => {
    const alice = await registered('alice@example.com', 'Alice');

    // Grant viewer.
    const granted = await request(server())
      .put(`/api/v1/dashboard/maintainers/${alice.userId}`)
      .set(auth(owner.token))
      .send({ role: 'viewer' })
      .expect(200);
    expect(granted.body.role).toBe('viewer');
    expect(granted.body.permissions).toContain('overview.read');
    // Alice can now reach /me.
    const me = await request(server())
      .get('/api/v1/dashboard/me')
      .set(auth(alice.token))
      .expect(200);
    expect(me.body.role).toBe('viewer');

    // Update to moderator with a denied override; overrides replace fully.
    const updated = await request(server())
      .put(`/api/v1/dashboard/maintainers/${alice.userId}`)
      .set(auth(owner.token))
      .send({ role: 'moderator', deniedPermissions: ['rooms.close'] })
      .expect(200);
    expect(updated.body.permissions).toContain('games.terminate');
    expect(updated.body.permissions).not.toContain('rooms.close');

    // A later PUT without overrides clears them.
    const cleared = await request(server())
      .put(`/api/v1/dashboard/maintainers/${alice.userId}`)
      .set(auth(owner.token))
      .send({ role: 'moderator' })
      .expect(200);
    expect(cleared.body.deniedPermissions).toEqual([]);
    expect(cleared.body.permissions).toContain('rooms.close');

    // Listing shows both maintainers with effective permissions.
    const list = await request(server())
      .get('/api/v1/dashboard/maintainers')
      .set(auth(owner.token))
      .expect(200);
    expect(list.body.maintainers).toHaveLength(2);
    const aliceRow = list.body.maintainers.find(
      (m: { userId: string }) => m.userId === alice.userId,
    );
    expect(aliceRow.displayName).toBe('Alice');
    expect(aliceRow.dangling).toBe(false);

    // Revoke; access dies on the next request.
    await request(server())
      .delete(`/api/v1/dashboard/maintainers/${alice.userId}`)
      .set(auth(owner.token))
      .expect(204);
    await request(server()).get('/api/v1/dashboard/me').set(auth(alice.token)).expect(404);

    // Audit: grant + 2 updates + revoke.
    const audit = t.db.collection('dashboardAudit');
    expect(await audit.countDocuments({ action: 'maintainer.grant' } as never)).toBe(1);
    expect(await audit.countDocuments({ action: 'maintainer.update' } as never)).toBe(2);
    expect(await audit.countDocuments({ action: 'maintainer.revoke' } as never)).toBe(1);
  });

  it('non-owners can read but not write; guests and unknowns are refused', async () => {
    const reader = await registered('reader@example.com', 'Reader');
    await request(server())
      .put(`/api/v1/dashboard/maintainers/${reader.userId}`)
      .set(auth(owner.token))
      .send({ role: 'admin' })
      .expect(200);

    // admin: maintainers.read yes, maintainers.write no.
    await request(server())
      .get('/api/v1/dashboard/maintainers')
      .set(auth(reader.token))
      .expect(200);
    const somebody = await registered('somebody@example.com', 'Some');
    await request(server())
      .put(`/api/v1/dashboard/maintainers/${somebody.userId}`)
      .set(auth(reader.token))
      .send({ role: 'viewer' })
      .expect(403);

    // Guests and unknown users cannot be granted.
    const g = await request(server())
      .post('/api/v1/auth/guest')
      .send({ displayName: 'Ghost' })
      .expect(201);
    await request(server())
      .put(`/api/v1/dashboard/maintainers/${g.body.user.id}`)
      .set(auth(owner.token))
      .send({ role: 'viewer' })
      .expect(400);
    await request(server())
      .put('/api/v1/dashboard/maintainers/nope')
      .set(auth(owner.token))
      .send({ role: 'viewer' })
      .expect(404);
    // Unknown role / permission strings are rejected by zod.
    await request(server())
      .put(`/api/v1/dashboard/maintainers/${somebody.userId}`)
      .set(auth(owner.token))
      .send({ role: 'root' })
      .expect(400);
  });

  it('protects against self-modification and last-owner lockout', async () => {
    // Self-modification (even a no-op) is refused.
    await request(server())
      .put(`/api/v1/dashboard/maintainers/${owner.userId}`)
      .set(auth(owner.token))
      .send({ role: 'owner' })
      .expect(403);
    await request(server())
      .delete(`/api/v1/dashboard/maintainers/${owner.userId}`)
      .set(auth(owner.token))
      .expect(403);

    // A non-owner holding maintainers.write via an extra grant cannot demote/revoke
    // the last owner.
    const lieutenant = await registered('lt@example.com', 'Lt');
    await request(server())
      .put(`/api/v1/dashboard/maintainers/${lieutenant.userId}`)
      .set(auth(owner.token))
      .send({ role: 'viewer', extraPermissions: ['maintainers.write', 'maintainers.read'] })
      .expect(200);
    await request(server())
      .put(`/api/v1/dashboard/maintainers/${owner.userId}`)
      .set(auth(lieutenant.token))
      .send({ role: 'viewer' })
      .expect(409);
    await request(server())
      .delete(`/api/v1/dashboard/maintainers/${owner.userId}`)
      .set(auth(lieutenant.token))
      .expect(409);

    // With a second owner present, demotion of the first is allowed.
    const owner2 = await registered('owner2@example.com', 'Owner2');
    await request(server())
      .put(`/api/v1/dashboard/maintainers/${owner2.userId}`)
      .set(auth(owner.token))
      .send({ role: 'owner' })
      .expect(200);
    await request(server())
      .put(`/api/v1/dashboard/maintainers/${owner.userId}`)
      .set(auth(owner2.token))
      .send({ role: 'admin' })
      .expect(200);
    // Restore for other tests.
    await request(server())
      .put(`/api/v1/dashboard/maintainers/${owner.userId}`)
      .set(auth(owner2.token))
      .send({ role: 'owner' })
      .expect(200);
  });

  it('the audit repo is append-only by surface', () => {
    const repo = t.app.get(DashboardAuditRepo) as unknown as Record<string, unknown>;
    expect(repo.update).toBeUndefined();
    expect(repo.updateOne).toBeUndefined();
    expect(repo.delete).toBeUndefined();
    expect(repo.deleteOne).toBeUndefined();
    expect(repo.remove).toBeUndefined();
    expect(typeof repo.append).toBe('function');
    expect(typeof repo.list).toBe('function');
  });
});
