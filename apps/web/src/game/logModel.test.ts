import { describe, it, expect } from 'vitest';
import { create } from '@bufbuild/protobuf';
import { GameEventSchema, CardColor } from '@trm/proto';
import { entriesFromEvents } from './logModel';

const ev = (event: Parameters<typeof create<typeof GameEventSchema>>[1]['event']) =>
  create(GameEventSchema, { event });

describe('entriesFromEvents', () => {
  it('maps important actions with the right importance', () => {
    const out = entriesFromEvents([
      ev({ case: 'routeClaimed', value: { playerId: 'p1', routeId: 'R1', pointsAwarded: 7 } }),
      ev({ case: 'stationBuilt', value: { playerId: 'p2', cityId: 'C9' } }),
      ev({ case: 'endgameTriggered', value: { playerId: 'p1', finalTurnsRemaining: 2 } }),
    ]);
    expect(out).toEqual([
      { kind: 'routeClaimed', playerId: 'p1', data: { routeId: 'R1', points: 7 }, importance: 'highlight' },
      { kind: 'stationBuilt', playerId: 'p2', data: { cityId: 'C9' }, importance: 'highlight' },
      { kind: 'endgame', playerId: 'p1', data: { turns: 2 }, importance: 'alert' },
    ]);
  });

  it('omits noisy ambient events', () => {
    const out = entriesFromEvents([
      ev({ case: 'marketRefilled', value: { market: [] } }),
      ev({ case: 'deckReshuffled', value: {} }),
      ev({ case: 'turnEnded', value: { playerId: 'p1' } }),
      ev({ case: 'initialTicketsOffered', value: { playerId: 'p1', ticketIds: ['L1'] } }),
    ]);
    expect(out).toEqual([]);
  });

  it('reads the face-up card colour but not blind draws', () => {
    const out = entriesFromEvents([
      ev({ case: 'cardTakenFaceup', value: { playerId: 'p1', slot: 0, card: CardColor.BLUE } }),
      ev({ case: 'cardDrawnBlind', value: { playerId: 'p1', card: CardColor.UNSPECIFIED } }),
    ]);
    expect(out[0]).toMatchObject({ kind: 'tookFaceup', data: { color: 'BLUE' } });
    expect(out[1]).toMatchObject({ kind: 'drewBlind', data: {} });
  });
});
