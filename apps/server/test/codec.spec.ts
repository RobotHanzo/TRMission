import { describe, it, expect } from 'vitest';
import { toBinary } from '@bufbuild/protobuf';
import { initGame, redactFor, taiwanBoard, CONTENT_HASH } from '@trm/engine';
import type { Action, GameConfig, GameEvent, GameState, EventsState, EventScheduleEntry } from '@trm/engine';
import { asPlayerId, asTicketId, asCityId, asRouteId } from '@trm/shared';
import type { PlayerId } from '@trm/shared';
import { CardColor, Phase, GameSnapshotSchema } from '@trm/proto';
import { viewToSnapshot, commandToAction, eventToProto } from '@trm/codec';
import { actionToCommand, encodeClient, decodeClient } from './helpers';

const p1 = asPlayerId('p1');
const p2 = asPlayerId('p2');

const config: GameConfig = {
  seed: 'codec-1',
  players: [
    { id: p1, seat: 0 },
    { id: p2, seat: 1 },
  ],
  contentHash: CONTENT_HASH,
};

describe('command codec — action ⇄ proto round-trip', () => {
  const cases: Action[] = [
    {
      t: 'CLAIM_ROUTE',
      player: p1,
      routeId: asRouteId('R50'),
      payment: { color: 'GREEN', colorCount: 6, locomotives: 2 },
    },
    { t: 'DRAW_FACEUP', player: p1, slot: 3 },
    { t: 'DRAW_BLIND', player: p1 },
    { t: 'DRAW_TICKETS', player: p1 },
    { t: 'KEEP_TICKETS', player: p1, keep: [asTicketId('S6'), asTicketId('L1')] },
    { t: 'KEEP_INITIAL_TICKETS', player: p1, keep: [asTicketId('S6'), asTicketId('S7')] },
    {
      t: 'BUILD_STATION',
      player: p1,
      cityId: asCityId('TAIPEI'),
      payment: { color: 'RED', colorCount: 2, locomotives: 0 },
    },
    {
      t: 'RESOLVE_TUNNEL',
      player: p1,
      commit: true,
      extra: { color: 'GREEN', colorCount: 1, locomotives: 0 },
    },
    { t: 'RESOLVE_TUNNEL', player: p1, commit: false },
    { t: 'PASS', player: p1 },
  ];

  it('every command survives encode → bytes → decode → engine action unchanged', () => {
    for (const action of cases) {
      const env = decodeClient(encodeClient(1, actionToCommand(action)));
      const back = commandToAction(env.command, p1);
      expect(back).toEqual(action);
    }
  });
});

describe('snapshot codec — RedactedView → GameSnapshot', () => {
  it('keeps the viewer’s own pending offer and renders opponents as counts only', () => {
    const board = taiwanBoard();
    const state = initGame(board, config);
    const view = redactFor(board, state, p1);
    const snap = viewToSnapshot(view, 0, p1);

    expect(snap.phase).toBe(Phase.SETUP_TICKETS);
    expect(snap.contentHash).toBe(CONTENT_HASH);
    expect(snap.turnOrder).toEqual(['p1', 'p2']);
    expect(snap.market.length).toBe(state.ruleParams.marketSize);

    // Self sees their own initial offer + hand.
    expect(snap.you?.playerId).toBe('p1');
    expect(snap.you?.pendingOfferTicketIds.length).toBe(
      state.ruleParams.initialLongOffer + state.ruleParams.initialShortOffer,
    );
    const handTotal =
      (snap.you?.hand?.red ?? 0) +
      (snap.you?.hand?.orange ?? 0) +
      (snap.you?.hand?.yellow ?? 0) +
      (snap.you?.hand?.green ?? 0) +
      (snap.you?.hand?.blue ?? 0) +
      (snap.you?.hand?.purple ?? 0) +
      (snap.you?.hand?.black ?? 0) +
      (snap.you?.hand?.white ?? 0) +
      (snap.you?.hand?.locomotive ?? 0);
    expect(handTotal).toBe(state.ruleParams.handStart);

    // Opponent is counts-only; the PublicPlayerState type has no hand/ticket fields at all.
    const opp = snap.players.find((p) => p.id === 'p2');
    expect(opp?.handCount).toBe(state.ruleParams.handStart);
    expect(opp).not.toHaveProperty('hand');
    expect(opp).not.toHaveProperty('keptTicketIds');
  });
});

describe('event codec — per-recipient redaction', () => {
  it('blanks a blind-draw card for non-owners and drops private ticket offers', () => {
    const drawn: GameEvent = {
      e: 'CARD_DRAWN_BLIND',
      player: p1,
      card: 'RED',
      visibility: { private: p1 },
    };
    expect((eventToProto(drawn, p1)?.event.value as { card: number }).card).toBe(CardColor.RED);
    expect((eventToProto(drawn, p2)?.event.value as { card: number }).card).toBe(
      CardColor.UNSPECIFIED,
    );

    const offered: GameEvent = {
      e: 'TICKETS_OFFERED',
      player: p1,
      ticketIds: [asTicketId('S1')],
      visibility: { private: p1 },
    };
    expect(eventToProto(offered, p1)).not.toBeNull();
    expect(eventToProto(offered, p2)).toBeNull();
  });
});

describe('viewToSnapshot — random-events wire leak test (risk #1, byte-level)', () => {
  it('never serializes a future unannounced entry’s id/route/city/charter-city ids to wire bytes', () => {
    const board = taiwanBoard();
    const state = initGame(board, config);
    // Live effects reused from the board so the block is non-trivial (active typhoon, hotspot,
    // open charter) — these MUST still surface; only the future schedule entry must not.
    const closed = board.content.routes[0]!.id;
    const hot = board.cityIds[0]!;
    const liveA = board.cityIds[1]!;
    const liveB = board.cityIds[2]!;

    const SECRET = {
      id: 'evSecretFutureWire',
      route: asRouteId('SECRET_WIRE_ROUTE_X'),
      city: asCityId('SECRET_WIRE_CITY_C'),
      charterA: asCityId('SECRET_WIRE_CITY_A'),
      charterB: asCityId('SECRET_WIRE_CITY_B'),
    };
    // Far-off, non-telegraphed → nothing about it may ever be projected. It carries every hidden
    // field (routeIds, cityId, charter) so the leak check below is exhaustive.
    const future: EventScheduleEntry = {
      id: SECRET.id,
      kind: 'CHARTER_SPECIAL',
      startRound: 5,
      durationRounds: 3,
      telegraphed: false,
      routeIds: [SECRET.route],
      cityId: SECRET.city,
      charter: { a: SECRET.charterA, b: SECRET.charterB, points: 20 },
    };
    const events: EventsState = {
      mode: 'light',
      roundIndex: 1,
      nextIdx: 0,
      schedule: [future],
      suppressed: [],
      active: [{ id: 'evTy', kind: 'TYPHOON_LANDFALL', endsAfterRound: 99, routeIds: [closed] }],
      hotspots: { [hot as string]: 2 },
      charters: [{ id: 'evCh', a: liveA, b: liveB, points: 8, expiresAfterRound: 99, wonBy: null }],
      reopenBonus: [],
    };
    const withEvents: GameState = { ...state, events };

    for (const viewer of [p1, p2, null] as (PlayerId | null)[]) {
      const view = redactFor(board, withEvents, viewer);
      const snap = viewToSnapshot(view, 0, viewer);
      const bytes = toBinary(GameSnapshotSchema, snap);
      // latin1 is a lossless 1-byte-per-char mapping, so this is an exact byte-substring check —
      // not a decode-to-JSON approximation.
      const raw = Buffer.from(bytes).toString('latin1');
      for (const secret of [
        SECRET.id,
        SECRET.route as string,
        SECRET.city as string,
        SECRET.charterA as string,
        SECRET.charterB as string,
      ]) {
        expect(raw.includes(secret)).toBe(false);
      }

      // Live effects DO surface — this isn't just an empty/off projection.
      expect(snap.randomEvents?.hotspots.some((h) => h.cityId === (hot as string))).toBe(true);
      expect(snap.randomEvents?.charters.some((c) => c.id === 'evCh')).toBe(true);
      expect(snap.randomEvents?.closedRouteIds).toContain(closed as string);
      expect(snap.randomEvents?.forecast).toBeUndefined(); // unannounced future ⇒ no forecast
    }
  });
});
