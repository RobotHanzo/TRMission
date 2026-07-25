// Covers the ws transport's own defences (F13): a byte cap on inbound frames, an idle-unbound
// reap timer, and origin allowlisting on the upgrade — all enforced by `attachWsServer` itself,
// below/before anything in the hub ever sees a frame.
import { describe, it, expect } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { taiwanBoard, CONTENT_HASH, type PlayerSeed } from '@trm/engine';
import { asPlayerId } from '@trm/shared';
import { GameRegistry } from '../src/game/game-registry';
import { GameHub } from '../src/ws/hub';
import { attachWsServer } from '../src/ws/ws-server';
import { makeDevTicket } from '../src/ws/ticket';
import { encodeClient } from './helpers';

const listen = (server: Server): Promise<number> =>
  new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)),
  );

async function makeHub(): Promise<GameHub> {
  const hub = new GameHub(new GameRegistry());
  const players: PlayerSeed[] = [
    { id: asPlayerId('p1'), seat: 0 },
    { id: asPlayerId('p2'), seat: 1 },
  ];
  await hub.createMatch('hardening', taiwanBoard(), {
    seed: 'hardening-1',
    players,
    contentHash: CONTENT_HASH,
  });
  return hub;
}

describe('ws transport hardening', () => {
  it('closes a connection that sends a frame over maxPayload, before the hub ever sees it', async () => {
    const http = createServer();
    const hub = await makeHub();
    attachWsServer(http, hub, '/ws', { maxPayloadBytes: 1024 });
    const port = await listen(http);

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const closed = new Promise<void>((resolve) => ws.on('close', () => resolve()));

    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', reject);
    });
    // Twice the configured cap — no valid frame is anywhere near this size.
    ws.send(Buffer.alloc(2048, 1));

    await closed; // would otherwise hang/time out if the oversized frame were accepted
    expect(ws.readyState).toBe(WebSocket.CLOSED);

    await new Promise<void>((r) => http.close(() => r()));
  });

  it('closes a connection that never sends a valid hello within the timeout', async () => {
    const http = createServer();
    const hub = await makeHub();
    attachWsServer(http, hub, '/ws', { helloTimeoutMs: 50 });
    const port = await listen(http);

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const closed = new Promise<(number | undefined)[]>((resolve) => {
      ws.on('close', (code) => resolve([code]));
    });
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', reject);
    });
    // Deliberately never send a hello.
    const [code] = await closed;
    expect(code).toBe(1008);

    await new Promise<void>((r) => http.close(() => r()));
  });

  it('does NOT close a connection that hellos before the timeout fires', async () => {
    const http = createServer();
    const hub = await makeHub();
    attachWsServer(http, hub, '/ws', { helloTimeoutMs: 150 });
    const port = await listen(http);

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    let closed = false;
    ws.on('close', () => {
      closed = true;
    });

    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => {
        ws.send(
          encodeClient(1, {
            case: 'hello',
            value: {
              ticket: makeDevTicket({ gameId: 'hardening', playerId: 'p1', seat: 0 }),
              protocolVersion: 1,
            },
          }),
        );
        resolve();
      });
      ws.on('error', reject);
    });

    // Wait well past the (short) hello timeout: a bound connection must survive it.
    await new Promise((r) => setTimeout(r, 300));
    expect(closed).toBe(false);

    ws.close();
    await new Promise<void>((r) => http.close(() => r()));
  });

  it('rejects the upgrade when Origin is present but not allowlisted', async () => {
    const http = createServer();
    const hub = await makeHub();
    attachWsServer(http, hub, '/ws', { allowedOrigins: ['https://trmission.example'] });
    const port = await listen(http);

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: 'https://evil.example' });
    const failed = await new Promise<boolean>((resolve) => {
      ws.on('open', () => resolve(false));
      ws.on('error', () => resolve(true));
      ws.on('unexpected-response', () => resolve(true));
    });
    expect(failed).toBe(true);

    await new Promise<void>((r) => http.close(() => r()));
  });

  it('allows the upgrade when Origin is allowlisted, and when Origin is absent (native clients)', async () => {
    const http = createServer();
    const hub = await makeHub();
    attachWsServer(http, hub, '/ws', { allowedOrigins: ['https://trmission.example'] });
    const port = await listen(http);

    const allowed = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
      origin: 'https://trmission.example',
    });
    await new Promise<void>((resolve, reject) => {
      allowed.on('open', () => resolve());
      allowed.on('error', reject);
    });
    allowed.close();

    // A native/non-browser client sends no Origin header at all — must not be cut off.
    const native = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((resolve, reject) => {
      native.on('open', () => resolve());
      native.on('error', reject);
    });
    native.close();

    await new Promise<void>((r) => http.close(() => r()));
  });
});
