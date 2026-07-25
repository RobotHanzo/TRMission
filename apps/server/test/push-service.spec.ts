import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createTestApp, type TestApp } from './app';
import { PushService } from '../src/push/push.service';
import { DeviceRepo } from '../src/push/device.repo';
import { LiveActivityRepo } from '../src/push/live-activity.repo';
import { UserRepo } from '../src/auth/user.repo';
import { MetricsService } from '../src/observability/metrics.service';
import {
  apnsBody,
  apnsLiveActivityBody,
  fcmBody,
  ApnsProviderToken,
  ApnsTransport,
  type LiveActivityState,
  type PushDelivery,
  type PushMessage,
  type PushTransport,
} from '../src/push/push.transports';

class FakeTransport implements PushTransport {
  sent: { token: string; msg: PushMessage }[] = [];
  activities: { token: string; state: LiveActivityState; event: 'update' | 'end' }[] = [];
  result: PushDelivery = 'ok';
  constructor(readonly platform: 'ios' | 'android') {}
  async send(token: string, msg: PushMessage): Promise<PushDelivery> {
    this.sent.push({ token, msg });
    return this.result;
  }
  async sendLiveActivity(
    token: string,
    state: LiveActivityState,
    event: 'update' | 'end',
  ): Promise<PushDelivery> {
    this.activities.push({ token, state, event });
    return this.result;
  }
}

/** An Android-only transport: no `sendLiveActivity` at all (the iOS-only shape of the feature). */
class FakeAndroidTransport implements PushTransport {
  readonly platform = 'android' as const;
  sent: { token: string; msg: PushMessage }[] = [];
  async send(token: string, msg: PushMessage): Promise<PushDelivery> {
    this.sent.push({ token, msg });
    return 'ok';
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
    t.app.get(LiveActivityRepo),
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

describe('live activity fan-out (issue #43)', () => {
  const update = (over: boolean, recipients: { playerId: string; seat: number }[]) => ({
    gameId: 'game-la-1',
    currentSeat: 1,
    finalTurnsRemaining: 0,
    over,
    turnEndsAt: 1_700_000_000,
    recipients: recipients.map((r) => ({ ...r, trainCars: 30 + r.seat, routePoints: 7 + r.seat })),
  });
  const token = (n: number) => `${n}`.repeat(64);

  it("pushes each activity its OWN player's figures, and nothing to a stranger's row", async () => {
    const ios = new FakeTransport('ios');
    const svc = buildService([ios]);
    const repo = t.app.get(LiveActivityRepo);

    const seated = await guest();
    const other = await guest();
    const outsider = await guest();
    await repo.upsert(seated, 'game-la-1', token(1));
    await repo.upsert(other, 'game-la-1', token(2));
    // A token registered against a game this account isn't seated in: the hub never lists it as a
    // recipient, so it must receive nothing at all (hidden-information guard).
    await repo.upsert(outsider, 'game-la-1', token(3));

    const res = await svc.updateLiveActivities(
      update(false, [
        { playerId: seated, seat: 0 },
        { playerId: other, seat: 2 },
      ]),
    );

    expect(res).toMatchObject({ activityCount: 3, sent: 2, failed: 0 });
    expect(ios.activities.map((a) => a.token).sort()).toEqual([token(1), token(2)]);
    const mine = ios.activities.find((a) => a.token === token(1));
    expect(mine?.state).toEqual({
      currentSeat: 1,
      myTrains: 30,
      myScore: 7,
      finalTurnsRemaining: 0,
      over: false,
      turnEndsAt: 1_700_000_000,
    });
    expect(ios.activities.find((a) => a.token === token(2))?.state.myTrains).toBe(32);
    expect(mine?.event).toBe('update');
  });

  it('game over ends the cards and forgets every token for that game', async () => {
    const ios = new FakeTransport('ios');
    const svc = buildService([ios]);
    const repo = t.app.get(LiveActivityRepo);

    const seated = await guest();
    await repo.upsert(seated, 'game-la-1', token(4));
    await svc.updateLiveActivities(update(true, [{ playerId: seated, seat: 0 }]));

    expect(ios.activities.map((a) => a.event)).toEqual(['end']);
    expect(await repo.listForGame('game-la-1')).toHaveLength(0);
  });

  it('prunes a token APNs declares dead', async () => {
    const ios = new FakeTransport('ios');
    ios.result = 'prune';
    const svc = buildService([ios]);
    const repo = t.app.get(LiveActivityRepo);

    const seated = await guest();
    await repo.upsert(seated, 'game-la-2', token(5));
    const res = await svc.updateLiveActivities({
      ...update(false, [{ playerId: seated, seat: 0 }]),
      gameId: 'game-la-2',
    });

    expect(res).toMatchObject({ sent: 0, failed: 1 });
    expect(await repo.listForGame('game-la-2')).toHaveLength(0);
  });

  it('is a no-op with no iOS transport (Android-only credentials, or push disabled)', async () => {
    const repo = t.app.get(LiveActivityRepo);
    const seated = await guest();
    await repo.upsert(seated, 'game-la-3', token(6));

    const android = new FakeAndroidTransport();
    const res = await buildService([android]).updateLiveActivities({
      ...update(false, [{ playerId: seated, seat: 0 }]),
      gameId: 'game-la-3',
    });
    expect(res).toEqual({ activityCount: 0, sent: 0, failed: 0 });
    expect(android.sent).toHaveLength(0);
    // The rows survive: the feature is just off, not invalid.
    expect(await repo.listForGame('game-la-3')).toHaveLength(1);
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

  // The `content-state` keys ARE the Swift ContentState's property names
  // (apps/mobile/modules/live-activity/ios/TRMissionActivityAttributes.swift). A rename on either
  // side decodes to nothing and blanks the widget with no error anywhere, so pin them here.
  const state: LiveActivityState = {
    currentSeat: 2,
    myTrains: 31,
    myScore: 18,
    finalTurnsRemaining: 0,
    over: false,
    turnEndsAt: 1_700_000_075,
  };

  it('apns live activity: timestamp + event + content-state, no dismissal date on an update', () => {
    expect(apnsLiveActivityBody(state, 'update', 1_700_000_000)).toEqual({
      aps: { timestamp: 1_700_000_000, event: 'update', 'content-state': state },
    });
  });

  it('apns live activity: an `end` carries a dismissal date so the card retires itself', () => {
    const body = apnsLiveActivityBody({ ...state, over: true }, 'end', 1_700_000_000);
    const aps = body.aps as Record<string, unknown>;
    expect(aps.event).toBe('end');
    expect(aps['dismissal-date']).toBeGreaterThan(1_700_000_000);
  });
});

describe('ApnsTransport sink-level token validation (defense in depth)', () => {
  // `token` is spliced verbatim into the outbound HTTP/2 `:path`; this re-checks the same
  // hex-token shape as `RegisterDeviceSchema` so a row written before that schema validation
  // existed can't reintroduce request-line injection through this sink. Asserted independently
  // of the schema by spying on the provider-token fetch: a malformed token must never get far
  // enough to mint a bearer token or open a session to Apple.
  const msg: PushMessage = { title: 'T', body: 'B', data: {} };

  it('refuses a path-traversal-shaped token without ever contacting APNs', async () => {
    const transport = new ApnsTransport();
    const getSpy = vi.spyOn(ApnsProviderToken.prototype, 'get');
    const outcome = await transport.send('../../1/apps/com.example.app', msg);
    expect(outcome).toBe('error');
    expect(getSpy).not.toHaveBeenCalled();
    getSpy.mockRestore();
  });

  it('refuses a right-length-but-non-hex token without ever contacting APNs', async () => {
    const transport = new ApnsTransport();
    const getSpy = vi.spyOn(ApnsProviderToken.prototype, 'get');
    const outcome = await transport.send('z'.repeat(64), msg);
    expect(outcome).toBe('error');
    expect(getSpy).not.toHaveBeenCalled();
    getSpy.mockRestore();
  });

  it('passes a well-formed 64-hex-char device token through to the send path', async () => {
    const transport = new ApnsTransport();
    // No APNs credentials are configured in the test env, so the provider-token fetch itself
    // fails (empty ES256 key) and `send` still resolves 'error' — the point here is only that,
    // unlike the malformed cases above, the well-formed token reaches that call at all.
    const getSpy = vi.spyOn(ApnsProviderToken.prototype, 'get');
    const outcome = await transport.send('a'.repeat(64), msg);
    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(outcome).toBe('error');
    getSpy.mockRestore();
  });
});
