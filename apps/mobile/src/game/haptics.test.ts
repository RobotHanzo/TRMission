import { create } from '@bufbuild/protobuf';
import {
  GameEventSchema,
  RouteClaimedSchema,
  TunnelRevealedSchema,
  TicketCompletedSchema,
  GameEndedSchema,
  CardDrawnBlindSchema,
  TurnStartedSchema,
} from '@trm/proto';
import { cuesForEvents } from './haptics';

const ev = (kase: string, schema: never) =>
  create(GameEventSchema, { event: { case: kase as never, value: create(schema, {} as never) } });

const turnOf = (playerId: string) =>
  create(GameEventSchema, {
    event: { case: 'turnStarted', value: create(TurnStartedSchema, { playerId }) },
  });

describe('cuesForEvents', () => {
  it('maps exactly the four spec beats and ignores everything else', () => {
    const events = [
      ev('routeClaimed', RouteClaimedSchema as never),
      ev('cardDrawnBlind', CardDrawnBlindSchema as never), // no cue
      ev('tunnelRevealed', TunnelRevealedSchema as never),
      ev('ticketCompleted', TicketCompletedSchema as never),
      ev('gameEnded', GameEndedSchema as never),
    ];
    expect(cuesForEvents(events)).toEqual([
      'route-claim',
      'tunnel-reveal',
      'ticket-complete',
      'game-end',
    ]);
  });

  it('empty batch → no cues', () => {
    expect(cuesForEvents([])).toEqual([]);
  });

  it('buzzes for the viewer’s own turn only', () => {
    const events = [turnOf('p2'), turnOf('me')];
    expect(cuesForEvents(events, 'me')).toEqual(['your-turn']);
  });

  it('no viewer (replay / demo clip) → turnStarted never buzzes', () => {
    const events = [turnOf('p2'), turnOf('me'), ev('routeClaimed', RouteClaimedSchema as never)];
    expect(cuesForEvents(events)).toEqual(['route-claim']);
  });
});
