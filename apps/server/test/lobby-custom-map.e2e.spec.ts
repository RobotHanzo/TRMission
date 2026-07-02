import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildBoard, replay, stateDigest, CONTENT_HASH, boardForContentHash } from '@trm/engine';
import type { Board } from '@trm/engine';
import type { PlayerId } from '@trm/shared';
import { storedToConfig } from '../src/persistence/types';
import { createTestApp, type TestApp } from './app';
import { GameHub } from '../src/ws/hub';
import { GameRegistry } from '../src/game/game-registry';
import { MapContentRepo } from '../src/maps/map-content.repo';
import { actionToCommand, encodeClient, pickAction } from './helpers';

let t: TestApp;
const server = () => t.app.getHttpServer();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function registered(email: string, displayName: string): Promise<{ token: string; id: string }> {
  const res = await request(server())
    .post('/api/v1/auth/register')
    .send({ email, password: 'password123', displayName })
    .expect(201);
  return { token: res.body.accessToken, id: res.body.user.id };
}

// 5 cities / 7 routes (ring + a double-route chord, one tunnel, one ferry) / 10 tickets
// (all C(5,2) pairs) — small enough to play out fast, big enough to exercise every route type.
const smallDraft = {
  cities: [
    { id: 'm1', nameZh: '一', nameEn: 'M1', x: 10, y: 50, region: 'r', isIsland: false },
    { id: 'm2', nameZh: '二', nameEn: 'M2', x: 30, y: 20, region: 'r', isIsland: false },
    { id: 'm3', nameZh: '三', nameEn: 'M3', x: 60, y: 20, region: 'r', isIsland: false },
    { id: 'm4', nameZh: '四', nameEn: 'M4', x: 80, y: 50, region: 'r', isIsland: false },
    { id: 'm5', nameZh: '五', nameEn: 'M5', x: 50, y: 80, region: 'r', isIsland: true },
  ],
  routes: [
    { id: 'mr1', a: 'm1', b: 'm2', color: 'RED', length: 2, ferryLocos: 0, isTunnel: false },
    { id: 'mr2', a: 'm2', b: 'm3', color: 'BLUE', length: 3, ferryLocos: 0, isTunnel: false },
    { id: 'mr3', a: 'm3', b: 'm4', color: 'GRAY', length: 2, ferryLocos: 0, isTunnel: true },
    { id: 'mr4', a: 'm4', b: 'm5', color: 'GREEN', length: 1, ferryLocos: 0, isTunnel: false },
    { id: 'mr5', a: 'm5', b: 'm1', color: 'GRAY', length: 4, ferryLocos: 1, isTunnel: false },
    { id: 'mr6', a: 'm2', b: 'm4', color: 'YELLOW', length: 3, ferryLocos: 0, isTunnel: false, doubleGroup: 'A' },
    { id: 'mr7', a: 'm2', b: 'm4', color: 'ORANGE', length: 3, ferryLocos: 0, isTunnel: false, doubleGroup: 'A' },
  ],
  tickets: [
    { id: 'mt-l1', a: 'm1', b: 'm3', value: 8, deck: 'LONG' },
    { id: 'mt-l2', a: 'm1', b: 'm4', value: 8, deck: 'LONG' },
    { id: 'mt-s1', a: 'm1', b: 'm2', value: 2, deck: 'SHORT' },
    { id: 'mt-s2', a: 'm1', b: 'm5', value: 2, deck: 'SHORT' },
    { id: 'mt-s3', a: 'm2', b: 'm3', value: 2, deck: 'SHORT' },
    { id: 'mt-s4', a: 'm2', b: 'm4', value: 2, deck: 'SHORT' },
    { id: 'mt-s5', a: 'm2', b: 'm5', value: 2, deck: 'SHORT' },
    { id: 'mt-s6', a: 'm3', b: 'm4', value: 2, deck: 'SHORT' },
    { id: 'mt-s7', a: 'm3', b: 'm5', value: 2, deck: 'SHORT' },
    { id: 'mt-s8', a: 'm4', b: 'm5', value: 2, deck: 'SHORT' },
  ],
  rules: { trainCarsStart: 15, initialLongOffer: 1, initialShortOffer: 2, ticketDrawCount: 2 },
};

/** Create a room for two registered users, select the given custom map, ready both, start. */
async function startCustomMapRoom(
  host: { token: string; id: string },
  member: { token: string; id: string },
  customMapId: string,
): Promise<{ code: string; gameId: string; hostTicket: string; memberTicket: string }> {
  const room = await request(server())
    .post('/api/v1/rooms')
    .set(auth(host.token))
    .send({ maxPlayers: 2 })
    .expect(201);
  const code: string = room.body.code;
  await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(member.token)).expect(200);
  await request(server())
    .patch(`/api/v1/rooms/${code}/settings`)
    .set(auth(host.token))
    .send({ map: { source: 'custom', customMapId } })
    .expect(200);
  await request(server())
    .post(`/api/v1/rooms/${code}/ready`)
    .set(auth(host.token))
    .send({ ready: true })
    .expect(200);
  await request(server())
    .post(`/api/v1/rooms/${code}/ready`)
    .set(auth(member.token))
    .send({ ready: true })
    .expect(200);
  const started = await request(server())
    .post(`/api/v1/rooms/${code}/start`)
    .set(auth(host.token))
    .expect(200);
  const memberTicket = (
    await request(server()).post(`/api/v1/rooms/${code}/ticket`).set(auth(member.token)).expect(200)
  ).body.ticket;
  return { code, gameId: started.body.gameId, hostTicket: started.body.ticket, memberTicket };
}

beforeAll(async () => {
  t = await createTestApp();
}, 60_000);
afterAll(() => t.close());

describe('lobby + custom map: full lifecycle', () => {
  it('rejects starting a room on an unowned/nonexistent custom map selector', async () => {
    const a = await registered('cma1@example.com', 'A1');
    const room = await request(server()).post('/api/v1/rooms').set(auth(a.token)).send({}).expect(201);
    await request(server())
      .patch(`/api/v1/rooms/${room.body.code}/settings`)
      .set(auth(a.token))
      .send({ map: { source: 'custom', customMapId: 'no-such-map' } })
      .expect(404);
  });

  it('plays a custom map to completion, publishes its content, and replays it after the draft is deleted', async () => {
    const host = await registered('cma2@example.com', 'Host2');
    const member = await registered('cmb2@example.com', 'Member2');

    const created = await request(server())
      .post('/api/v1/maps')
      .set(auth(host.token))
      .send({ nameZh: '小地圖', nameEn: 'Small Map' })
      .expect(201);
    const mapId: string = created.body.id;
    await request(server())
      .put(`/api/v1/maps/${mapId}`)
      .set(auth(host.token))
      .send({ draft: smallDraft })
      .expect(200);

    const { gameId, hostTicket, memberTicket } = await startCustomMapRoom(host, member, mapId);

    const hub = t.app.get(GameHub);
    const registry = t.app.get(GameRegistry);
    const match = registry.get(gameId)!;
    const board = match.session.board;
    expect(match.session.raw().contentHash).not.toBe(CONTENT_HASH);

    // The published content is queryable by hash — even by a user who never touched the map.
    const contentRes = await request(server())
      .get(`/api/v1/maps/content/${match.session.raw().contentHash}`)
      .set(auth(member.token))
      .expect(200);
    expect(contentRes.body.cities).toHaveLength(5);

    const conns: Record<string, { connId: string; ticket: string; seq: number }> = {
      [host.id]: { connId: 'cm-host', ticket: hostTicket, seq: 0 },
      [member.id]: { connId: 'cm-member', ticket: memberTicket, seq: 0 },
    };
    for (const c of Object.values(conns)) {
      hub.openConnection(c.connId, () => {});
      await hub.receive(
        c.connId,
        encodeClient(++c.seq, { case: 'hello', value: { ticket: c.ticket, protocolVersion: 1 } }),
      );
    }

    let guard = 0;
    while (match.session.phase !== 'GAME_OVER') {
      if (++guard > 5000) throw new Error('custom-map game did not terminate');
      const state = match.session.raw();
      const actor =
        state.turn.phase === 'SETUP_TICKETS'
          ? match.session.turnOrder.find((p) => match.session.hasPendingOffer(p))
          : match.session.currentPlayer;
      if (!actor) throw new Error('no actor');
      const c = conns[actor as string];
      if (!c) throw new Error(`unknown actor ${actor}`);
      await hub.receive(
        c.connId,
        encodeClient(++c.seq, actionToCommand(pickAction(board, state, actor as PlayerId))),
      );
    }

    const list = await request(server()).get('/api/v1/history').set(auth(host.token)).expect(200);
    const row = list.body.find((g: { gameId: string }) => g.gameId === gameId);
    expect(row).toBeTruthy();
    expect(row.replayable).toBe(true);

    // Delete the draft — the published, hash-addressed content must outlive it.
    await request(server()).delete(`/api/v1/maps/${mapId}`).set(auth(host.token)).expect(204);

    const replayRes = await request(server())
      .get(`/api/v1/history/${gameId}/replay`)
      .set(auth(host.token))
      .expect(200);
    expect(replayRes.body.actions.length).toBeGreaterThan(0);
    const rep = replay(board, storedToConfig(replayRes.body.config), replayRes.body.actions);
    expect(rep.state.turn.phase).toBe('GAME_OVER');
    expect(stateDigest(rep.state)).toBe(replayRes.body.finalDigest);

    // The list still marks it replayable post-deletion (isReplayable falls back to mapContents).
    const listAfter = await request(server()).get('/api/v1/history').set(auth(host.token)).expect(200);
    expect(listAfter.body.find((g: { gameId: string }) => g.gameId === gameId).replayable).toBe(true);
  });

  it('recovers a live custom-map game from mapContents when it is evicted from memory', async () => {
    const host = await registered('cma3@example.com', 'Host3');
    const member = await registered('cmb3@example.com', 'Member3');

    const created = await request(server())
      .post('/api/v1/maps')
      .set(auth(host.token))
      .send({ nameZh: '復原地圖', nameEn: 'Recovery Map' })
      .expect(201);
    const mapId: string = created.body.id;
    await request(server())
      .put(`/api/v1/maps/${mapId}`)
      .set(auth(host.token))
      .send({ draft: smallDraft })
      .expect(200);

    const { gameId, hostTicket, memberTicket } = await startCustomMapRoom(host, member, mapId);

    const hub = t.app.get(GameHub);
    const registry = t.app.get(GameRegistry);
    const contentHash = registry.get(gameId)!.session.raw().contentHash;

    const conns: Record<string, { connId: string; ticket: string; seq: number }> = {
      [host.id]: { connId: 'cr-host', ticket: hostTicket, seq: 0 },
      [member.id]: { connId: 'cr-member', ticket: memberTicket, seq: 0 },
    };
    for (const c of Object.values(conns)) {
      hub.openConnection(c.connId, () => {});
      await hub.receive(
        c.connId,
        encodeClient(++c.seq, { case: 'hello', value: { ticket: c.ticket, protocolVersion: 1 } }),
      );
    }
    // Play a handful of actions so recovery has real state to reproduce.
    for (let i = 0; i < 6; i++) {
      const match = registry.get(gameId)!;
      if (match.session.phase === 'GAME_OVER') break;
      const state = match.session.raw();
      const actor =
        state.turn.phase === 'SETUP_TICKETS'
          ? match.session.turnOrder.find((p) => match.session.hasPendingOffer(p))
          : match.session.currentPlayer;
      if (!actor) break;
      const c = conns[actor as string];
      if (!c) throw new Error(`unknown actor ${actor}`);
      await hub.receive(
        c.connId,
        encodeClient(++c.seq, actionToCommand(pickAction(match.session.board, state, actor as PlayerId))),
      );
    }
    const before = registry.get(gameId)!;
    const digestBefore = before.session.digest();
    const versionBefore = before.session.stateVersion;

    // Confirm the content is NOT in the static bundled registry — recovery must hit Mongo.
    let staticallyKnown = true;
    try {
      boardForContentHash(contentHash);
    } catch {
      staticallyKnown = false;
    }
    expect(staticallyKnown).toBe(false);

    // Simulate a cold start: drop the in-memory match, force the hub to recover it.
    registry.remove(gameId);
    const recovered = await hub.recoverMatch(gameId);
    expect(recovered).not.toBeNull();
    expect(recovered!.session.digest()).toBe(digestBefore);
    expect(recovered!.session.stateVersion).toBe(versionBefore);

    // The recovered board really did come from mapContents, not a hand-authored fallback.
    const contentDoc = await t.app.get(MapContentRepo).findByHash(contentHash);
    expect(contentDoc).not.toBeNull();
    const rebuilt: Board = buildBoard(contentDoc!.content);
    expect(rebuilt.cityIds.length).toBe(5);
  });
});
