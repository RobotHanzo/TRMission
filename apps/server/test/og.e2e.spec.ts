// Social previews: the bot-facing meta page + dynamically rendered PNG cards. These
// endpoints are unauthenticated (crawlers can't log in), so the key property under test
// is what they may reveal: a room's card renders (the code in the URL is already the
// join capability), but a replay's card/meta only carries real data when that replay is
// view-by-link — private/unknown ids degrade to the generic brand card, byte-identical
// to the site card, with no hint the game exists.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from './app';
import type { GameDoc, MatchHistoryDoc } from '../src/persistence/types';
import { escapeXml, estimateWidth, fitText } from '../src/og/card-svg';

let t: TestApp;
const server = () => t.app.getHttpServer();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const expectPng = (body: unknown): Buffer => {
  const buf = body as Buffer;
  expect(Buffer.isBuffer(buf)).toBe(true);
  expect(buf.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
  return buf;
};

async function guest(displayName: string): Promise<{ token: string; id: string }> {
  const res = await request(server()).post('/api/v1/auth/guest').send({ displayName }).expect(201);
  return { token: res.body.accessToken, id: res.body.user.id };
}

let host: { token: string; id: string };
let rival: { token: string; id: string };
let roomCode: string;
const gameId = 'g-og';
let sitePng: Buffer;

beforeAll(async () => {
  t = await createTestApp();
  host = await guest('站長小明');
  rival = await guest('Rival');

  const room = await request(server())
    .post('/api/v1/rooms')
    .set(auth(host.token))
    .send({ maxPlayers: 4 })
    .expect(201);
  roomCode = room.body.code;

  const now = new Date('2026-07-01T12:00:00Z');
  await t.db.collection<GameDoc>('games').insertOne({
    _id: gameId,
    seed: 's',
    config: {
      seed: 's',
      players: [
        { id: host.id, seat: 0 },
        { id: rival.id, seat: 1 },
      ],
      contentHash: 'x',
    },
    engineVersion: 1,
    contentHash: 'x',
    schemaVersion: 1,
    status: 'COMPLETED',
    currentSeq: 0,
    createdAt: now,
    updatedAt: now,
  });
  await t.db.collection<MatchHistoryDoc>('matchHistory').insertOne({
    _id: gameId,
    players: [
      { userId: host.id, seat: 0 },
      { userId: rival.id, seat: 1 },
    ],
    turnOrder: [host.id, rival.id],
    seed: 's',
    contentHash: 'x',
    finalScores: {
      players: [
        { playerId: host.id, total: 87 },
        { playerId: rival.id, total: 54 },
      ],
      ranking: [[host.id], [rival.id]],
    } as unknown as MatchHistoryDoc['finalScores'],
    winners: [host.id],
    completedAt: now,
  });

  sitePng = expectPng((await request(server()).get('/api/v1/og/site.png').expect(200)).body);
}, 60_000);
afterAll(() => t.close());

describe('GET /api/v1/og/site.png', () => {
  it('renders a PNG with image/png + cache headers', async () => {
    const res = await request(server()).get('/api/v1/og/site.png').expect(200);
    expect(res.headers['content-type']).toContain('image/png');
    expect(res.headers['cache-control']).toContain('public');
    expectPng(res.body);
  });
});

describe('GET /api/v1/og/page', () => {
  it('serves the generic site meta for / and for unknown paths', async () => {
    for (const q of ['', '?path=/', '?path=/history', '?path=//evil.example']) {
      const res = await request(server()).get(`/api/v1/og/page${q}`).expect(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.text).toContain('og:site_name');
      expect(res.text).toContain('/api/v1/og/site.png');
    }
  });

  it('builds absolute URLs from the forwarded proto + host', async () => {
    const res = await request(server())
      .get('/api/v1/og/page?path=/')
      .set('X-Forwarded-Proto', 'https')
      .set('Host', 'play.example.tw')
      .expect(200);
    expect(res.text).toContain('content="https://play.example.tw/api/v1/og/site.png"');
    expect(res.text).toContain('content="https://play.example.tw/"');
  });

  it('room links unfurl with the code, host, and the room card image', async () => {
    const res = await request(server()).get(`/api/v1/og/page?path=/room/${roomCode}`).expect(200);
    expect(res.text).toContain(roomCode);
    expect(res.text).toContain('站長小明');
    expect(res.text).toContain(`/api/v1/og/room/${roomCode}.png`);
    // A human who lands here bounces back to the SPA route.
    expect(res.text).toContain(`0;url=/room/${roomCode}`);
  });

  it('an unknown room degrades to the site meta', async () => {
    const res = await request(server()).get('/api/v1/og/page?path=/room/ZZZZZZ').expect(200);
    expect(res.text).toContain('/api/v1/og/site.png');
  });
});

describe('room card image', () => {
  it('renders a PNG distinct from the generic site card', async () => {
    const res = await request(server()).get(`/api/v1/og/room/${roomCode}.png`).expect(200);
    const png = expectPng(res.body);
    expect(png.equals(sitePng)).toBe(false);
  });

  it('an unknown room falls back to the generic card, not an error', async () => {
    const res = await request(server()).get('/api/v1/og/room/ZZZZZZ.png').expect(200);
    expect(expectPng(res.body).equals(sitePng)).toBe(true);
  });
});

describe('replay cards respect replay visibility', () => {
  it('private (default): meta page and image leak nothing — generic card only', async () => {
    const page = await request(server()).get(`/api/v1/og/page?path=/replay/${gameId}`).expect(200);
    expect(page.text).not.toContain('站長小明');
    expect(page.text).not.toContain(gameId);
    expect(page.text).toContain('/api/v1/og/site.png');

    const img = await request(server()).get(`/api/v1/og/replay/${gameId}.png`).expect(200);
    expect(expectPng(img.body).equals(sitePng)).toBe(true);
  });

  it('view-by-link: meta carries players/date and a dedicated card renders', async () => {
    await request(server())
      .patch(`/api/v1/history/${gameId}/visibility`)
      .set(auth(rival.token))
      .send({ visibility: 'link' })
      .expect(200);

    const page = await request(server()).get(`/api/v1/og/page?path=/replay/${gameId}`).expect(200);
    expect(page.text).toContain('站長小明');
    expect(page.text).toContain('2026-07-01');
    expect(page.text).toContain(`/api/v1/og/replay/${gameId}.png`);

    const img = await request(server()).get(`/api/v1/og/replay/${gameId}.png`).expect(200);
    expect(expectPng(img.body).equals(sitePng)).toBe(false);
  });
});

describe('shared-map cards', () => {
  let shareCode: string;
  let authorToken: string;
  let mapId: string;

  beforeAll(async () => {
    // Map authoring needs a REGISTERED user (guests are 403 on /maps).
    const reg = await request(server())
      .post('/api/v1/auth/register')
      .send({ email: 'author@example.tw', password: 'hunter2hunter2', displayName: '地圖作者' })
      .expect(201);
    authorToken = reg.body.accessToken;

    const created = await request(server())
      .post('/api/v1/maps')
      .set(auth(authorToken))
      .send({ nameZh: '幻想群島', nameEn: 'Fantasy Isles' })
      .expect(201);
    mapId = created.body.id;

    // A small draft exercising all three railway kinds + an island + geography.
    const city = (id: string, x: number, y: number, isIsland = false) => ({
      id,
      nameZh: id,
      nameEn: id,
      x,
      y,
      region: '',
      isIsland,
    });
    await request(server())
      .put(`/api/v1/maps/${mapId}`)
      .set(auth(authorToken))
      .send({
        draft: {
          cities: [
            city('c1', 20, 30),
            city('c2', 60, 25),
            city('c3', 45, 70),
            city('c4', 85, 75, true),
          ],
          routes: [
            { id: 'r1', a: 'c1', b: 'c2', color: 'RED', length: 3, ferryLocos: 0, isTunnel: false },
            { id: 'r2', a: 'c2', b: 'c3', color: 'GRAY', length: 3, ferryLocos: 0, isTunnel: true },
            {
              id: 'r3',
              a: 'c3',
              b: 'c4',
              color: 'GRAY',
              length: 4,
              ferryLocos: 1,
              isTunnel: false,
            },
          ],
          tickets: [],
          geography: {
            baseView: { x: 0, y: 0, w: 100, h: 100 },
            land: [
              [
                [10, 40],
                [40, 10],
                [75, 20],
                [70, 80],
                [30, 85],
              ],
            ],
            crop: { lonMin: 0, lonMax: 10, latMin: 0, latMax: 10 },
          },
        },
      })
      .expect(200);

    const share = await request(server())
      .post(`/api/v1/maps/${mapId}/share`)
      .set(auth(authorToken));
    shareCode = share.body.shareCode;
    expect(typeof shareCode).toBe('string');
  }, 30_000);

  it('renders a dedicated map card for a valid share code, anonymously', async () => {
    const res = await request(server()).get(`/api/v1/og/map/${shareCode}.png`).expect(200);
    expect(res.headers['content-type']).toContain('image/png');
    expect(expectPng(res.body).equals(sitePng)).toBe(false);
  });

  it('meta for /maps?code=… carries the map name, stats, and the map card image', async () => {
    const res = await request(server())
      .get(`/api/v1/og/page?path=/maps&code=${shareCode}`)
      .expect(200);
    expect(res.text).toContain('幻想群島');
    expect(res.text).toContain('4 個車站');
    expect(res.text).toContain(`/api/v1/og/map/${shareCode}.png`);
    expect(res.text).toContain(`0;url=/maps?code=${shareCode}`);
  });

  it('unknown or revoked codes degrade to the generic card and site meta', async () => {
    const badPng = await request(server()).get('/api/v1/og/map/NOPE1234.png').expect(200);
    expect(expectPng(badPng.body).equals(sitePng)).toBe(true);
    const badPage = await request(server())
      .get('/api/v1/og/page?path=/maps&code=NOPE1234')
      .expect(200);
    expect(badPage.text).not.toContain('幻想群島');
    expect(badPage.text).toContain('/api/v1/og/site.png');

    await request(server())
      .delete(`/api/v1/maps/${mapId}/share`)
      .set(auth(authorToken))
      .expect(204);
    const revoked = await request(server()).get(`/api/v1/og/map/${shareCode}.png`).expect(200);
    expect(expectPng(revoked.body).equals(sitePng)).toBe(true);
  });
});

describe('card-svg text helpers', () => {
  it('escapes XML metacharacters', () => {
    expect(escapeXml(`<b>&"'`)).toBe('&lt;b&gt;&amp;&quot;&apos;');
  });
  it('estimates CJK wider than latin and truncates with an ellipsis', () => {
    expect(estimateWidth('台鐵', 10)).toBeGreaterThan(estimateWidth('ab', 10));
    const fitted = fitText('台鐵任務台鐵任務台鐵任務', 30, 120);
    expect(fitted.endsWith('…')).toBe(true);
    expect(estimateWidth(fitted, 30)).toBeLessThanOrEqual(120);
  });
});
