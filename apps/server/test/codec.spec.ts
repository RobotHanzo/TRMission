import { describe, it, expect } from 'vitest';
import { initGame, redactFor, taiwanBoard, CONTENT_HASH } from '@trm/engine';
import type { Action, GameConfig, GameEvent } from '@trm/engine';
import { asPlayerId, asTicketId, asCityId, asRouteId } from '@trm/shared';
import { CardColor, Phase } from '@trm/proto';
import { viewToSnapshot, commandToAction, eventToProto } from '../src/codec';
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
    const state = initGame(taiwanBoard(), config);
    const view = redactFor(state, p1);
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
