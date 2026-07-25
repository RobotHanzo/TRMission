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
  /** Origins allowed to complete the ws upgrade. A request that sends no Origin header at all
   *  (only browsers send one; native/mobile clients never do) is always allowed through — only a
   *  PRESENT-but-disallowed Origin is rejected. Defaults to CORS_ORIGINS; an empty list means no
   *  allowlist is configured (the dev default) and every origin is accepted, matching main.ts's
   *  REST CORS posture (`enableCors` is skipped entirely when `CORS_ORIGINS` is unset). */
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
      if (!info.origin || allowedOrigins.length === 0 || allowedOrigins.includes(info.origin)) {
        callback(true);
        return;
      }
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

function toUint8(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}
