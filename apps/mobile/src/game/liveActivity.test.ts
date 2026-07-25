import { create } from '@bufbuild/protobuf';
import {
  EndgameSchema,
  GameSnapshotSchema,
  Phase,
  PublicPlayerStateSchema,
  SelfViewSchema,
} from '@trm/proto';
import {
  liveActivityAttributes,
  liveActivityContent,
  sameLiveActivityContent,
  turnLabelsFor,
} from './liveActivity';

const player = (id: string, seat: number, trainCars: number, routePoints: number) =>
  create(PublicPlayerStateSchema, { id, seat, trainCars, routePoints });

const snapshot = (over: boolean, currentPlayerId: string, endgameTurns = 0) =>
  create(GameSnapshotSchema, {
    phase: over ? Phase.GAME_OVER : Phase.AWAIT_ACTION,
    currentPlayerId: over ? '' : currentPlayerId,
    players: [player('me', 0, 31, 18), player('them', 1, 12, 44)],
    you: create(SelfViewSchema, { playerId: 'me' }),
    ...(endgameTurns > 0
      ? { endgame: create(EndgameSchema, { triggered: true, finalTurnsRemaining: endgameTurns }) }
      : {}),
  });

describe('liveActivityContent', () => {
  it("reads the current seat and the VIEWER's own figures", () => {
    expect(liveActivityContent(snapshot(false, 'them'), null)).toEqual({
      currentSeat: 1,
      myTrains: 31,
      myScore: 18,
      finalTurnsRemaining: 0,
      over: false,
      turnEndsAt: 0,
    });
  });

  it('converts the client-local turn deadline to epoch seconds', () => {
    expect(liveActivityContent(snapshot(false, 'me'), 1_700_000_123_400).turnEndsAt).toBe(
      1_700_000_123,
    );
  });

  it('carries the final-round counter only once the endgame has triggered', () => {
    expect(liveActivityContent(snapshot(false, 'me', 2), null).finalTurnsRemaining).toBe(2);
    expect(liveActivityContent(snapshot(false, 'me'), null).finalTurnsRemaining).toBe(0);
  });

  it('game over: nobody on the clock, no countdown, no last-round chip', () => {
    const content = liveActivityContent(snapshot(true, '', 1), 1_700_000_000_000);
    expect(content.over).toBe(true);
    expect(content.currentSeat).toBe(-1);
    expect(content.turnEndsAt).toBe(0);
    expect(content.finalTurnsRemaining).toBe(0);
  });

  it('a spectator (no SelfView) still renders, with zeroed own figures', () => {
    const spectating = create(GameSnapshotSchema, {
      phase: Phase.AWAIT_ACTION,
      currentPlayerId: 'them',
      players: [player('me', 0, 31, 18), player('them', 1, 12, 44)],
    });
    expect(liveActivityContent(spectating, null)).toMatchObject({
      currentSeat: 1,
      myTrains: 0,
      myScore: 0,
    });
  });
});

describe('sameLiveActivityContent', () => {
  const base = liveActivityContent(snapshot(false, 'them'), null);

  it('null previous is never "same" (the first content must always be sent)', () => {
    expect(sameLiveActivityContent(null, base)).toBe(false);
  });

  it('field-for-field equality, so a re-broadcast snapshot spends no update budget', () => {
    expect(sameLiveActivityContent({ ...base }, base)).toBe(true);
    expect(sameLiveActivityContent({ ...base, currentSeat: 0 }, base)).toBe(false);
    expect(sameLiveActivityContent({ ...base, myTrains: 30 }, base)).toBe(false);
    expect(sameLiveActivityContent({ ...base, turnEndsAt: 1 }, base)).toBe(false);
  });
});

describe('turnLabelsFor', () => {
  const labels = (mySeat: number) =>
    turnLabelsFor(
      [
        { seat: 0, name: 'Ada' },
        { seat: 1, name: 'Bo' },
      ],
      mySeat,
      'YOUR TURN',
      (name) => `${name}'s turn`,
    );

  it("indexes by seat and phrases the viewer's own seat differently", () => {
    expect(labels(1)).toEqual(["Ada's turn", 'YOUR TURN']);
    expect(labels(0)).toEqual(['YOUR TURN', "Bo's turn"]);
  });

  it('fills a seat the roster has not resolved with the neutral seat label', () => {
    expect(turnLabelsFor([{ seat: 2, name: 'Cy' }], 0, 'YOU', (name) => `${name}!`)).toEqual([
      'YOU',
      'P2!',
      'Cy!',
    ]);
  });
});

describe('liveActivityAttributes', () => {
  it('derives one seat colour per turn label from the shared tokens', () => {
    const attrs = liveActivityAttributes({
      roomCode: 'ABC123',
      mySeat: 1,
      turnLabels: ['a', 'b', 'c'],
      strings: {
        trains: 'T',
        score: 'S',
        lastRound: 'L',
        gameOver: 'G',
        waiting: 'W',
      },
    });
    expect(attrs.seatColors).toHaveLength(3);
    expect(attrs.seatColors[0]).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(attrs.mySeat).toBe(1);
    expect(attrs.roomCode).toBe('ABC123');
  });
});
