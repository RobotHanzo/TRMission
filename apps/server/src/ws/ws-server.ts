// Thin glue between a raw `ws` server and the transport-agnostic GameHub. The hub
// holds all protocol logic; this file only moves bytes and manages socket lifecycle.
import { randomUUID } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import { Logger } from '@nestjs/common';
import { WebSocketServer, type WebSocket, type RawData } from 'ws';
import { env } from '../config/env';
import type { GameHub } from './hub';

const log = new Logger('ws');

// Every real ClientEnvelope is tiny: chat text is capped at 2048 chars (hub.ts's
// CHAT_MAX_LEN), every other command is a handful of short ids/enums. This is deliberately
// generous headroom, not a tight fit — and nowhere near ws's 100 MiB default, which otherwise
// lets an unauthenticated remote pin ~100 MiB per socket before ever sending a valid hello.
const MAX_PAYLOAD_BYTES = 64 * 1024;

// A ws-game ticket (WS_TICKET_TTL, default 45s) is redeemed as the very first frame on a fresh
// socket, so a legitimate client hellos almost immediately. A connection that never completes a
// valid hello within this window can't be legitimate and is dropped, so an unauthenticated socket
// can't be held open (and unreaped) indefinitely.
const HELLO_TIMEOUT_MS = 15_000;

// RFC 6455 §7.4.1: "Policy Violation" — used for both server-enforced closes below.
const POLICY_VIOLATION_CLOSE_CODE = 1008;

export interface AttachWsServerOptions {
  /** EXTRA cross-origin origins allowed to complete the ws upgrade, on top of the same-origin
   *  requests `isSameOrigin` always admits. A request that sends no Origin header at all
   *  (only browsers send one; native/mobile clients never do) is always allowed through — only a
   *  PRESENT, cross-origin, non-allowlisted Origin is rejected. Defaults to CORS_ORIGINS; an empty
   *  list means no allowlist is configured (the dev default) and every origin is accepted, matching
   *  main.ts's REST CORS posture (`enableCors` is skipped entirely when `CORS_ORIGINS` is unset). */
  allowedOrigins?: readonly string[];
  /** ms an unbound connection is given to send a valid hello before being closed. */
  helloTimeoutMs?: number;
  /** ws's own per-message byte cap (RangeError + connection close past this). */
  maxPayloadBytes?: number;
}

export function attachWsServer(
  httpServer: HttpServer,
  hub: GameHub,
  path = '/ws',
  options: AttachWsServerOptions = {},
): WebSocketServer {
  const allowedOrigins = options.allowedOrigins ?? env.corsOrigins;
  const helloTimeoutMs = options.helloTimeoutMs ?? HELLO_TIMEOUT_MS;
  const maxPayload = options.maxPayloadBytes ?? MAX_PAYLOAD_BYTES;

  const wss = new WebSocketServer({
    server: httpServer,
    path,
    maxPayload,
    verifyClient: (info, callback) => {
      if (
        !info.origin ||
        isSameOrigin(info.origin, info.req.headers.host) ||
        allowedOrigins.length === 0 ||
        allowedOrigins.includes(info.origin)
      ) {
        callback(true);
        return;
      }
      log.warn(
        `ws upgrade rejected: origin ${info.origin} not allowed (host ${String(info.req.headers.host)})`,
      );
      callback(false, 403, 'origin not allowed');
    },
  });

  wss.on('connection', (socket: WebSocket) => {
    const id = randomUUID();
    const conn = hub.openConnection(
      id,
      (bytes) => {
        if (socket.readyState === socket.OPEN) socket.send(bytes);
      },
      (code, reason) => socket.close(code, reason),
    );

    // Reap a connection that never binds (no valid hello) within the budget — otherwise a socket
    // can sit open indefinitely at zero cost to whoever opened it. Cleared as soon as the
    // connection binds, or on close.
    let helloTimer: NodeJS.Timeout | undefined = setTimeout(() => {
      helloTimer = undefined;
      if (!conn.binding) socket.close(POLICY_VIOLATION_CLOSE_CODE, 'hello timeout');
    }, helloTimeoutMs);
    helloTimer.unref?.();
    const clearHelloTimer = (): void => {
      if (helloTimer) {
        clearTimeout(helloTimer);
        helloTimer = undefined;
      }
    };

    socket.on('message', (data: RawData) => {
      // `hub.receive` handles its own errors; this catch is the last line of defence, because an
      // unhandled rejection here would take the whole server down with every other game on it.
      hub
        .receive(id, toUint8(data))
        .catch((err: unknown) => {
          log.error(`ws receive failed for ${id}: ${err instanceof Error ? err.message : err}`);
        })
        .finally(() => {
          if (conn.binding) clearHelloTimer();
        });
    });
    socket.on('close', () => {
      clearHelloTimer();
      hub.closeConnection(id);
    });
    socket.on('error', () => {
      clearHelloTimer();
      hub.closeConnection(id);
    });
  });

  return wss;
}

/**
 * True when the browser's `Origin` names the very host it sent this request to — i.e. the page
 * opening the socket is served by this same deployment.
 *
 * This is admitted unconditionally, ahead of the allowlist, because a same-origin upgrade is
 * exactly what the allowlist is NOT about. `CORS_ORIGINS` describes *cross*-origin browser
 * clients; in the shipped topology nginx serves the SPA and proxies `/api` + `/ws` from one
 * origin, so CORS is never exercised and `CORS_ORIGINS` is routinely unset or stale (the deploy
 * templates carried `http://localhost:8080` long after the real origin moved). Keying the ws
 * upgrade off that value turned a dormant misconfiguration into "every browser is refused at the
 * handshake while native clients, which send no Origin, keep working".
 *
 * Safe against the cross-site-hijacking (CSWSH) case the check exists for, because that threat is
 * strictly browser-driven: a browser sets both headers itself and will not let attacker.example
 * send `Host: our.host` — so `Origin.host === Host` holds only for our own pages. A non-browser
 * caller can spoof both, but it can equally just omit `Origin`, which is already (and must remain)
 * allowed for native clients — so this concedes nothing that wasn't already reachable.
 *
 * Compared on host (name + port), not scheme: TLS terminates at the proxy, so the server sees
 * plain http and a scheme comparison would reject every real https client.
 */
function isSameOrigin(origin: string, host: string | undefined): boolean {
  if (!host) return false;
  let originHost: string;
  try {
    // Opaque origins serialize as the literal "null" (sandboxed iframe, file://) — `new URL`
    // throws on it, so those fall through to the allowlist rather than passing as same-origin.
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  return originHost !== '' && originHost.toLowerCase() === host.toLowerCase();
}

function toUint8(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}
