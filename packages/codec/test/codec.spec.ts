import { describe, it, expect } from 'vitest';
import { create } from '@bufbuild/protobuf';
import { initGame, redactFor, taiwanBoard, CONTENT_HASH } from '@trm/engine';
import type { GameConfig, GameEvent } from '@trm/engine';
import { asPlayerId, asTicketId, asRouteId } from '@trm/shared';
import { CardColor, Phase, ClientEnvelopeSchema } from '@trm/proto';
import { viewToSnapshot, eventToProto, commandToAction } from '../src';

const p1 = asPlayerId('p1');
const p2 = asPlayerId('p2');
const config: GameConfig = {
  seed: 'codec-pkg',
  players: [
    { id: p1, seat: 0 },
    { id: p2, seat: 1 },
  ],
  contentHash: CONTENT_HASH,
};

describe('@trm/codec viewToSnapshot', () => {
  it('keeps the viewer’s own offer and renders opponents as counts only', () => {
    const board = taiwanBoard();
    const state = initGame(board, config);
    const snap = viewToSnapshot(redactFor(board, state, p1), 0, p1);

    expect(snap.phase).toBe(Phase.SETUP_TICKETS);
    expect(snap.contentHash).toBe(CONTENT_HASH);
    expect(snap.turnOrder).toEqual(['p1', 'p2']);
    expect(snap.you?.playerId).toBe('p1');
    const opp = snap.players.find((p) => p.id === 'p2');
    expect(opp?.handCount).toBe(state.ruleParams.handStart);
    expect(opp).not.toHaveProperty('hand');
    expect(opp).not.toHaveProperty('keptTicketIds');
  });
});

describe('@trm/codec eventToProto', () => {
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

describe('@trm/codec commandToAction', () => {
  it('maps a claimRoute command onto the engine action bound to the player', () => {
    const env = create(ClientEnvelopeSchema, {
      clientSeq: 1,
      command: {
        case: 'claimRoute',
        value: {
          routeId: 'R50',
          payment: { color: CardColor.GREEN, colorCount: 6, locomotives: 2 },
        },
      },
    });
    expect(commandToAction(env.command, p1)).toEqual({
      t: 'CLAIM_ROUTE',
      player: p1,
      routeId: asRouteId('R50'),
      payment: { color: 'GREEN', colorCount: 6, locomotives: 2 },
    });
  });

  it('returns null for non-game frames (ping)', () => {
    const env = create(ClientEnvelopeSchema, { command: { case: 'ping', value: { nonce: 1 } } });
    expect(commandToAction(env.command, p1)).toBeNull();
  });
});
