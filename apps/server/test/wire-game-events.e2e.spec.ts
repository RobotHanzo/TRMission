import { describe, it, expect, beforeAll } from 'vitest';
import { create, toBinary } from '@bufbuild/protobuf';
import { taiwanBoard, initGame, CONTENT_HASH, type GameConfig, type PlayerSeed } from '@trm/engine';
import { asPlayerId, type PlayerId, type SeatIndex } from '@trm/shared';
import { GameSnapshotSchema, ServerEnvelopeSchema, type ServerEnvelope } from '@trm/proto';
import { GameRegistry } from '../src/game/game-registry';
import { GameHub } from '../src/ws/hub';
import type { GameSession } from '../src/game/game-session';
import { makeDevTicket } from '../src/ws/ticket';
import { actionToCommand, encodeClient, decodeServer, pickAction } from './helpers';

const players: PlayerSeed[] = [
  { id: asPlayerId('p1'), seat: 0 as SeatIndex },
  { id: asPlayerId('p2'), seat: 1 as SeatIndex },
  { id: asPlayerId('p3'), seat: 2 as SeatIndex },
];
const playerIds = players.map((p) => p.id);
const gameId = 'g-events';
const SPECTATOR = 'watcher';

/** An intense-mode seed whose schedule fires an event within the first couple of rounds, so the
 *  test observes an EVENT_* frame after only a handful of turns (probed via the engine). */
function pickEarlyEventSeed(): GameConfig {
  const board = taiwanBoard();
  for (let i = 0; i < 500; i++) {
    const config: GameConfig = {
      seed: `wire-events-intense-${i}`,
      players,
      contentHash: CONTENT_HASH,
      ruleParams: { eventsMode: 'intense' },
    };
    const first = initGame(board, config).events?.schedule[0];
    if (first && first.startRound <= 3) return config;
  }
  throw new Error('no intense seed with an early event found');
}

// Captured per-recipient frames (3 players + 1 spectator) + the live session, set by the driven run.
const received = new Map<string, ServerEnvelope[]>();
let config: GameConfig;
let session: GameSession;

const recipients = (): string[] => [...playerIds.map((p) => p as string), SPECTATOR];

/** Any random-event (announced/started) frame observed by a given recipient. */
function sawEventFrame(recipient: string): boolean {
  for (const env of received.get(recipient) ?? []) {
    if (env.event.case !== 'events') continue;
    for (const ev of env.event.value.events) {
      if (ev.event.case === 'randomEventAnnounced' || ev.event.case === 'randomEventStarted') {
        return true;
      }
    }
  }
  return false;
}

beforeAll(async () => {
  config = pickEarlyEventSeed();

  const board = taiwanBoard();
  const hub = new GameHub(new GameRegistry());
  const match = await hub.createMatch(gameId, board, config);
  session = match.session;

  const seq = new Map<string, number>();
  const openAndHello = async (connId: string, playerId: string, seat: number): Promise<void> => {
    received.set(connId, []);
    seq.set(connId, 0);
    hub.openConnection(connId, (bytes) => received.get(connId)!.push(decodeServer(bytes)));
    await hub.receive(
      connId,
      encodeClient(1, {
        case: 'hello',
        value: { ticket: makeDevTicket({ gameId, playerId, seat }), protocolVersion: 1 },
      }),
    );
    seq.set(connId, 1);
  };

  for (const p of players) await openAndHello(p.id as string, p.id as string, p.seat);
  await openAndHello(SPECTATOR, SPECTATOR, -1); // seat -1 ⇒ spectator binding

  const send = async (player: PlayerId): Promise<void> => {
    const connId = player as string;
    const next = (seq.get(connId) ?? 0) + 1;
    seq.set(connId, next);
    await hub.receive(
      connId,
      encodeClient(next, actionToCommand(pickAction(board, session.raw(), player))),
    );
  };

  // Drive scripted turns until every recipient has seen a random-event frame (or a guard trips).
  let guard = 0;
  while (session.phase !== 'GAME_OVER') {
    if (++guard > 5000) throw new Error('no random-event frame observed before the game ended');
    const state = session.raw();
    const actor =
      state.turn.phase === 'SETUP_TICKETS'
        ? playerIds.find((p) => session.hasPendingOffer(p))
        : session.currentPlayer;
    if (!actor) throw new Error(`no actor in phase ${state.turn.phase}`);
    await send(actor);
    if (recipients().every(sawEventFrame)) break;
  }
}, 60_000);

describe('random-events over the wire (in-memory) — players and a spectator', () => {
  it('delivers a random-event frame to every player AND the spectator', () => {
    for (const r of recipients()) {
      expect(sawEventFrame(r), `${r} saw a random-event frame`).toBe(true);
    }
  });

  it('every recipient’s latest snapshot carries the intense-mode random_events block', () => {
    for (const r of recipients()) {
      const frames = received.get(r) ?? [];
      const lastSnap = [...frames].reverse().find((e) => e.event.case === 'snapshot');
      expect(lastSnap, `${r} got a snapshot`).toBeDefined();
      if (lastSnap?.event.case !== 'snapshot') throw new Error('unreachable');
      const snap = lastSnap.event.value.snapshot;
      expect(snap?.gameSettings?.eventsMode).toBe('intense');
      expect(snap?.randomEvents).toBeDefined();
      expect(snap?.randomEvents?.mode).toBe('intense');
    }
  });
});

describe('random-events wire leak test (byte-level) — no future unannounced entry leaks', () => {
  it('never serializes a not-yet-announced schedule entry’s id/route/city ids to any recipient', () => {
    // Hidden = schedule entries that have NOT yet started (index ≥ nextIdx) and are not the current
    // one-round forecast. Started entries (index < nextIdx) were legitimately public when they fired.
    const ev = session.raw().events;
    if (!ev) throw new Error('expected an events block on the driven game');
    const roundIndex = ev.roundIndex;
    const forecast = ev.schedule[ev.nextIdx];
    const forecastId =
      forecast && forecast.telegraphed && forecast.startRound === roundIndex + 1
        ? forecast.id
        : null;
    const hidden = ev.schedule
      .filter((_, idx) => idx >= ev.nextIdx)
      .filter((e) => e.id !== forecastId);
    expect(hidden.length, 'the run stopped with a genuinely-hidden tail to check').toBeGreaterThan(
      0,
    );

    const hiddenIds = hidden.map((e) => e.id);
    const mapIdsOf = (e: (typeof ev.schedule)[number]) => [
      ...(e.routeIds ?? []).map((r) => r as string),
      ...(e.cityId ? [e.cityId as string] : []),
      ...(e.charter ? [e.charter.a as string, e.charter.b as string] : []),
    ];
    // Route/city ids that already-announced (active, or the one-round forecast) events legitimately
    // expose — a hidden future entry that merely REUSES one of them is not leaking it. Only ids that
    // belong EXCLUSIVELY to hidden entries can constitute a leak.
    const publicMapIds = new Set(
      ev.schedule.filter((e, idx) => idx < ev.nextIdx || e.id === forecastId).flatMap(mapIdsOf),
    );
    const hiddenMapIds = [...new Set(hidden.flatMap(mapIdsOf))].filter(
      (id) => !publicMapIds.has(id),
    );

    for (const r of recipients()) {
      for (const env of received.get(r) ?? []) {
        // (1) A hidden entry's id ('evN') is distinctive and must not appear anywhere in the frame.
        const frameRaw = Buffer.from(toBinary(ServerEnvelopeSchema, env)).toString('latin1');
        for (const id of hiddenIds) {
          expect(frameRaw.includes(id), `${r}: hidden entry id ${id} leaked in a frame`).toBe(
            false,
          );
        }
        // (2) Hidden route/city ids must not appear inside the random_events sub-message. Re-encode a
        //     snapshot carrying ONLY that block so a legitimately-claimed route id elsewhere in the
        //     snapshot (ownership/stations) can never cause a false positive.
        if (env.event.case === 'snapshot' && env.event.value.snapshot?.randomEvents) {
          const blockOnly = create(GameSnapshotSchema, {
            randomEvents: env.event.value.snapshot.randomEvents,
          });
          const blockRaw = Buffer.from(toBinary(GameSnapshotSchema, blockOnly)).toString('latin1');
          for (const mid of hiddenMapIds) {
            // Search for the id in its protobuf-framed form — a length-delimited string is preceded
            // by its byte length as a varint (a single byte for the short ids here) — rather than as
            // a raw substring, so a short id ('R7') is not falsely matched as a prefix of a longer id
            // that IS in the block ('R71'). A genuine leak still encodes the id as its own field.
            const framed = String.fromCharCode(mid.length) + mid;
            expect(
              blockRaw.includes(framed),
              `${r}: hidden map id ${mid} leaked in random_events`,
            ).toBe(false);
          }
        }
      }
    }
  });
});
