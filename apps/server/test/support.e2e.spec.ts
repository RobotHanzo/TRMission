import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createTestApp, FakeDiscordWebhook, type TestApp } from './app';
import { SUPPORT_MESSAGE_MAX_LEN } from '../src/support/support.schemas';
import type { MatchHistoryDoc } from '../src/persistence/types';

const WEBHOOK = 'https://discord.example/api/webhooks/1/abc';

let mongod: MongoMemoryServer;
/** The configured deployment: a webhook URL is set, so the form is live. */
let on: TestApp;
let hook: FakeDiscordWebhook;
/** An unconfigured deployment — no webhook, so the form advertises itself as unavailable. */
let off: TestApp;
/** A second configured app for the rejection cases. The submit route's rate limit is per app
 *  instance and per source IP, and every spec here shares one loopback address — the rejection
 *  tests alone would otherwise eat the budget the delivery tests need. */
let alt: TestApp;

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const body = (over: Record<string, unknown> = {}) => ({
  category: 'BUG',
  subject: 'Cannot rejoin my room',
  message: 'The rejoin banner does nothing after I close the tab mid-game.',
  ...over,
});

async function guest(app: TestApp, displayName: string): Promise<{ token: string; id: string }> {
  const res = await request(app.app.getHttpServer())
    .post('/api/v1/auth/guest')
    .send({ displayName })
    .expect(201);
  return { token: res.body.accessToken, id: res.body.user.id };
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  hook = new FakeDiscordWebhook();
  on = await createTestApp({
    mongod,
    dbName: 'trm-support-on',
    supportConfig: { webhookUrl: WEBHOOK },
    discordWebhook: hook,
  });
  off = await createTestApp({
    mongod,
    dbName: 'trm-support-off',
    supportConfig: { webhookUrl: '' },
    discordWebhook: hook,
  });
  alt = await createTestApp({
    mongod,
    dbName: 'trm-support-alt',
    supportConfig: { webhookUrl: WEBHOOK },
    discordWebhook: hook,
  });
}, 120_000);

afterAll(async () => {
  await on.close();
  await off.close();
  await alt.close();
  await mongod.stop();
});

beforeEach(() => {
  hook.sent = [];
  hook.fail = false;
});

describe('GET /support/config', () => {
  it('advertises the form as live when a webhook is configured', async () => {
    const res = await request(on.app.getHttpServer()).get('/api/v1/support/config').expect(200);
    expect(res.body).toEqual({ formEnabled: true });
  });

  it('advertises the form as unavailable without one', async () => {
    const res = await request(off.app.getHttpServer()).get('/api/v1/support/config').expect(200);
    expect(res.body).toEqual({ formEnabled: false });
  });
});

describe('POST /support', () => {
  it('delivers an anonymous request to the webhook (no account required)', async () => {
    const res = await request(on.app.getHttpServer())
      .post('/api/v1/support')
      .send(body({ email: 'player@example.com', name: 'Ada', platform: 'web' }))
      .expect(201);
    expect(res.body).toEqual({ delivered: true });

    expect(hook.sent).toHaveLength(1);
    const embed = hook.sent[0]!.embeds[0]!;
    expect(embed.title).toContain('[BUG]');
    expect(embed.title).toContain('Cannot rejoin my room');
    expect(embed.description).toContain('rejoin banner');
    const fields = Object.fromEntries(embed.fields!.map((f) => [f.name, f.value]));
    expect(fields.From).toBe('Anonymous (not signed in)');
    expect(fields['Reply to']).toBe('player@example.com');
  });

  it('stamps the signed-in account onto the message when a token is presented', async () => {
    const user = await guest(on, 'Rider');
    await request(on.app.getHttpServer())
      .post('/api/v1/support')
      .set(auth(user.token))
      .send(body())
      .expect(201);

    const fields = Object.fromEntries(
      hook.sent[0]!.embeds[0]!.fields!.map((f) => [f.name, f.value]),
    );
    expect(fields.From).toContain(user.id);
    expect(fields.From).toContain('guest');
  });

  it('says the message could not be delivered when the webhook fails (502, nothing lost silently)', async () => {
    hook.fail = true;
    await request(on.app.getHttpServer()).post('/api/v1/support').send(body()).expect(502);
  });

  it('503s on a deployment with no webhook configured — the form has no other inbox', async () => {
    await request(off.app.getHttpServer()).post('/api/v1/support').send(body()).expect(503);
    expect(hook.sent).toHaveLength(0);
  });

  it('rejects an unknown category, an empty subject, and a too-short or over-long message', async () => {
    const post = () => request(alt.app.getHttpServer()).post('/api/v1/support');
    await post()
      .send(body({ category: 'NONSENSE' }))
      .expect(400);
    await post()
      .send(body({ subject: '   ' }))
      .expect(400);
    await post()
      .send(body({ message: 'help' }))
      .expect(400);
    await post()
      .send(body({ message: 'x'.repeat(SUPPORT_MESSAGE_MAX_LEN + 1) }))
      .expect(400);
    await post()
      .send(body({ email: 'not-an-address' }))
      .expect(400);
    expect(hook.sent).toHaveLength(0);
  });

  it('401s on a token that is present but invalid, rather than downgrading to anonymous', async () => {
    await request(alt.app.getHttpServer())
      .post('/api/v1/support')
      .set(auth('garbage'))
      .send(body())
      .expect(401);
  });
});

describe('POST /ratings → webhook', () => {
  it('mirrors a submitted rating into the same webhook', async () => {
    const player = await guest(on, 'Reviewer');
    await on.db.collection<MatchHistoryDoc>('matchHistory').insertOne({
      _id: 'gw1',
      players: [{ userId: player.id, seat: 0 }],
      turnOrder: [player.id],
      seed: 's',
      contentHash: 'x',
      finalScores: {
        players: [{ playerId: player.id, total: 0 }],
        ranking: [[player.id]],
      } as unknown as MatchHistoryDoc['finalScores'],
      winners: [player.id],
      completedAt: new Date(),
    });

    await request(on.app.getHttpServer())
      .post('/api/v1/ratings')
      .set(auth(player.token))
      .send({ gameId: 'gw1', roomId: 'ABCDE', stars: 5, text: 'Loved the Hualien route.' })
      .expect(201);

    // Fire-and-forget: let the un-awaited webhook call settle before asserting.
    await new Promise((r) => setImmediate(r));
    expect(hook.sent).toHaveLength(1);
    const embed = hook.sent[0]!.embeds[0]!;
    expect(embed.title).toContain('5/5');
    expect(embed.description).toBe('Loved the Hualien route.');
    expect(embed.fields!.some((f) => f.value.includes('gw1'))).toBe(true);
  });

  it('still accepts the rating when the webhook is down (it is already persisted)', async () => {
    hook.fail = true;
    const player = await guest(on, 'Reviewer2');
    await on.db.collection<MatchHistoryDoc>('matchHistory').insertOne({
      _id: 'gw2',
      players: [{ userId: player.id, seat: 0 }],
      turnOrder: [player.id],
      seed: 's',
      contentHash: 'x',
      finalScores: {
        players: [{ playerId: player.id, total: 0 }],
        ranking: [[player.id]],
      } as unknown as MatchHistoryDoc['finalScores'],
      winners: [player.id],
      completedAt: new Date(),
    });

    const res = await request(on.app.getHttpServer())
      .post('/api/v1/ratings')
      .set(auth(player.token))
      .send({ gameId: 'gw2', roomId: 'FGHIJ', stars: 2 })
      .expect(201);
    expect(res.body.stars).toBe(2);
    await new Promise((r) => setImmediate(r));
  });
});
