// F24: one HS256 key signs four token kinds (access, ws-game ticket, admin-replay ticket,
// OAuth state), and only verifyAccess used to skip checking which kind it got back. That let an
// unauthenticated OAuth-state token (or any seated player's ws-game/admin-replay ticket) be
// replayed as a Bearer access token against any AccessTokenGuard-only route. These specs pin:
//   - a real access token still authenticates normally
//   - every other token kind minted by TokenService is rejected when replayed as a Bearer token
//   - the hardened guard also rejects a well-signed "access" token with a malformed identity
//     payload (defense in depth on top of the `kind` check)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { JwtService } from '@nestjs/jwt';
import { createTestApp, type TestApp } from './app';
import { TokenService } from '../src/auth/token.service';

let mongod: MongoMemoryServer;
let t: TestApp;
const server = () => t.app.getHttpServer();

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  t = await createTestApp({ mongod, dbName: 'trm-test-token-kind' });
}, 60_000);

afterAll(async () => {
  await t.close();
  await mongod.stop();
});

describe('access-token kind binding (F24)', () => {
  it('a genuine access token still authenticates normally', async () => {
    const guest = await request(server())
      .post('/api/v1/auth/guest')
      .send({ displayName: 'Real' })
      .expect(201);
    const me = await request(server())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${guest.body.accessToken}`)
      .expect(200);
    expect(me.body.id).toBe(guest.body.user.id);
  });

  it('rejects an OAuth-state token replayed as a Bearer access token', async () => {
    const tokens = t.app.get(TokenService);
    const state = tokens.signOauthState({
      provider: 'google',
      redirect: '/',
      nonce: 'nonce-value',
      codeVerifierHandle: 'handle-value',
    });
    await request(server())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${state}`)
      .expect(401);
  });

  it('rejects a ws-game ticket replayed as a Bearer access token', async () => {
    const tokens = t.app.get(TokenService);
    const ticket = tokens.signWsTicket({ gameId: 'g1', playerId: 'p1', seat: 0 });
    await request(server())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${ticket}`)
      .expect(401);
  });

  it('rejects an admin-replay ticket replayed as a Bearer access token', async () => {
    const tokens = t.app.get(TokenService);
    const ticket = tokens.signAdminReplayTicket({ gameId: 'g1', actorId: 'a1' });
    await request(server())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${ticket}`)
      .expect(401);
  });

  it('rejects the exact reports.controller exploit: an OAuth-state token can no longer file a player report', async () => {
    const target = await request(server())
      .post('/api/v1/auth/guest')
      .send({ displayName: 'Target' })
      .expect(201);
    const tokens = t.app.get(TokenService);
    const state = tokens.signOauthState({
      provider: 'google',
      redirect: '/',
      nonce: 'nonce-value',
      codeVerifierHandle: 'handle-value',
    });
    await request(server())
      .post('/api/v1/reports/player')
      .set('Authorization', `Bearer ${state}`)
      .send({ userId: target.body.user.id, category: 'OTHER' })
      .expect(401);
  });

  it('the hardened guard rejects a well-signed "access" token with a malformed identity payload', async () => {
    const jwt = t.app.get(JwtService);
    // Forged directly with the app's own JwtService, bypassing signAccess entirely, so this is
    // not just re-testing the `kind` check — sub/name/guest are the wrong types even though
    // `kind` is correct.
    const forged = jwt.sign({ kind: 'access', sub: 12345, name: null, guest: 'yes', tv: 1 });
    await request(server())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${forged}`)
      .expect(401);
  });
});
