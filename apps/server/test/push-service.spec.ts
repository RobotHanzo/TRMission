import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createTestApp, type TestApp } from './app';
import { PushService } from '../src/push/push.service';
import { DeviceRepo } from '../src/push/device.repo';
import { UserRepo } from '../src/auth/user.repo';
import { MetricsService } from '../src/observability/metrics.service';
import {
  apnsBody,
  fcmBody,
  type PushDelivery,
  type PushMessage,
  type PushTransport,
} from '../src/push/push.transports';

class FakeTransport implements PushTransport {
  sent: { token: string; msg: PushMessage }[] = [];
  result: PushDelivery = 'ok';
  constructor(readonly platform: 'ios' | 'android') {}
  async send(token: string, msg: PushMessage): Promise<PushDelivery> {
    this.sent.push({ token, msg });
    return this.result;
  }
}

let sharedMongod: MongoMemoryServer;
beforeAll(async () => {
  sharedMongod = await MongoMemoryServer.create();
}, 60_000);
afterAll(() => sharedMongod.stop());

let t: TestApp;
const server = () => t.app.getHttpServer();

beforeAll(async () => {
  t = await createTestApp({ mongod: sharedMongod, dbName: 'trm-test-push-svc' });
}, 60_000);
afterAll(() => t.close());

const guest = async () => {
  const res = await request(server())
    .post('/api/v1/auth/guest')
    .set('x-trm-client', 'mobile')
    .send({})
    .expect(201);
  return res.body.user.id as string;
};

const buildService = (transports: PushTransport[]): PushService =>
  new PushService(
    t.app.get(DeviceRepo),
    t.app.get(UserRepo),
    t.app.get(MetricsService),
    transports,
  );

describe('push service fan-out', () => {
  it('sends per device on the matching platform transport, localized per user', async () => {
    const android = new FakeTransport('android');
    const ios = new FakeTransport('ios');
    const svc = buildService([android, ios]);
    const devices = t.app.get(DeviceRepo);

    const zh = await guest(); // default locale zh-Hant
    const en = await guest();
    await t.db
      .collection('users')
      .updateOne({ _id: en as never }, { $set: { 'preferences.locale': 'en' } });
    await devices.upsert(zh, 'android', 'tok-zh-android');
    await devices.upsert(en, 'ios', 'tok-en-ios');

    await svc.notify([zh, en, 'bot:whatever'], 'your_turn', { gameId: 'g1' });

    expect(android.sent).toHaveLength(1);
    expect(android.sent[0]?.token).toBe('tok-zh-android');
    expect(android.sent[0]?.msg.body).toBe('輪到你了！');
    expect(android.sent[0]?.msg.data).toEqual({ kind: 'your_turn', gameId: 'g1' });
    expect(ios.sent).toHaveLength(1);
    expect(ios.sent[0]?.msg.body).toBe("It's your turn!");
  });

  it('prunes a token the transport declares dead', async () => {
    const android = new FakeTransport('android');
    android.result = 'prune';
    const svc = buildService([android]);
    const devices = t.app.get(DeviceRepo);

    const u = await guest();
    await devices.upsert(u, 'android', 'tok-dead');
    await svc.notify([u], 'game_over', { gameId: 'g2' });

    expect(android.sent).toHaveLength(1);
    expect(await t.db.collection('userDevices').countDocuments({ _id: 'tok-dead' as never })).toBe(
      0,
    );
  });

  it('is a no-op with no transports configured and never throws', async () => {
    const svc = buildService([]);
    expect(svc.enabled).toBe(false);
    await expect(svc.notify(['nobody'], 'game_started', {})).resolves.toBeUndefined();
  });
});

describe('transport request shapes (pure helpers)', () => {
  const msg: PushMessage = { title: 'T', body: 'B', data: { kind: 'your_turn', gameId: 'g' } };

  it('fcm: notification + string data map under message', () => {
    expect(fcmBody('tok', msg)).toEqual({
      message: {
        token: 'tok',
        notification: { title: 'T', body: 'B' },
        data: { kind: 'your_turn', gameId: 'g' },
      },
    });
  });

  it('apns: aps.alert + custom keys at the top level', () => {
    expect(apnsBody(msg)).toEqual({
      aps: { alert: { title: 'T', body: 'B' }, sound: 'default' },
      kind: 'your_turn',
      gameId: 'g',
    });
  });
});
