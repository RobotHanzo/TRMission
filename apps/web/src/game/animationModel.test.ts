import { describe, it, expect } from 'vitest';
import { CardColor as Pb, Phase, type GameEvent, type GameSnapshot } from '@trm/proto';
import { intentsFromEvents } from './animationModel';

const snap = {
  players: [
    { id: 'p0', seat: 0 },
    { id: 'p1', seat: 1 },
  ],
  you: { playerId: 'p0' },
  market: [Pb.RED, Pb.BLUE, Pb.GREEN, Pb.YELLOW, Pb.WHITE],
} as unknown as GameSnapshot;

const event = (e: GameEvent['event']): GameEvent => ({ event: e }) as GameEvent;

describe('intentsFromEvents', () => {
  it('RouteClaimed → glowRoute (owner seat) + scoreFloat', () => {
    const out = intentsFromEvents(snap, [
      event({
        case: 'routeClaimed',
        value: { playerId: 'p1', routeId: 'R1', pointsAwarded: 7 } as never,
      }),
    ]);
    expect(out).toContainEqual({ kind: 'glowRoute', routeId: 'R1', seat: 1 });
    expect(out).toContainEqual({ kind: 'scoreFloat', playerId: 'p1', amount: 7 });
  });

  it('StationBuilt → glowStation', () => {
    const out = intentsFromEvents(snap, [
      event({ case: 'stationBuilt', value: { playerId: 'p0', cityId: 'C1' } as never }),
    ]);
    expect(out).toContainEqual({ kind: 'glowStation', cityId: 'C1', seat: 0 });
  });

  it('my blind draw flies the real card; an opponent blind draw flies a cover', () => {
    const mine = intentsFromEvents(snap, [
      event({ case: 'cardDrawnBlind', value: { playerId: 'p0', card: Pb.RED } as never }),
    ]);
    expect(mine).toContainEqual({
      kind: 'cardFly',
      from: { at: 'deck' },
      to: { at: 'player', playerId: 'p0' },
      faceUp: false,
      color: 'RED',
    });

    const opp = intentsFromEvents(snap, [
      event({ case: 'cardDrawnBlind', value: { playerId: 'p1', card: Pb.UNSPECIFIED } as never }),
    ]);
    expect(opp).toContainEqual({
      kind: 'cardFly',
      from: { at: 'deck' },
      to: { at: 'player', playerId: 'p1' },
      faceUp: false,
      color: null,
    });
  });

  it('face-up draw flies the real card for every viewer and flips the slot', () => {
    const out = intentsFromEvents(snap, [
      event({
        case: 'cardTakenFaceup',
        value: { playerId: 'p1', slot: 2, card: Pb.GREEN } as never,
      }),
    ]);
    expect(out).toContainEqual({
      kind: 'cardFly',
      from: { at: 'market', slot: 2 },
      to: { at: 'player', playerId: 'p1' },
      faceUp: true,
      color: 'GREEN',
    });
    expect(out).toContainEqual({ kind: 'marketFlip', slot: 2 });
  });

  it('mid-draw (phase DRAWING_CARDS) covers the refilled slot instead of revealing it', () => {
    const midDraw = { ...snap, phase: Phase.DRAWING_CARDS } as unknown as GameSnapshot;
    const out = intentsFromEvents(midDraw, [
      event({ case: 'cardTakenFaceup', value: { playerId: 'p0', slot: 1, card: Pb.RED } as never }),
    ]);
    expect(out).toContainEqual({ kind: 'marketCover', slot: 1 });
    expect(out).not.toContainEqual({ kind: 'marketFlip', slot: 1 });
  });

  it('team pool moves fly in and out of the pool — but only the viewer’s own', () => {
    const teamSnap = {
      ...snap,
      players: [
        { id: 'p0', seat: 0, team: 0 },
        { id: 'p1', seat: 1, team: 1 },
      ],
    } as unknown as GameSnapshot;

    expect(
      intentsFromEvents(teamSnap, [
        event({
          case: 'teamPoolTaken',
          value: { playerId: 'p0', team: 0, card: Pb.BLUE } as never,
        }),
      ]),
    ).toContainEqual({
      kind: 'cardFly',
      from: { at: 'teamPool' },
      to: { at: 'player', playerId: 'p0' },
      faceUp: true,
      color: 'BLUE',
    });

    expect(
      intentsFromEvents(teamSnap, [
        event({
          case: 'teamPoolPushed',
          value: { playerId: 'p0', team: 0, card: Pb.BLACK } as never,
        }),
      ]),
    ).toContainEqual({
      kind: 'cardFly',
      from: { at: 'player', playerId: 'p0' },
      to: { at: 'teamPool' },
      faceUp: true,
      color: 'BLACK',
    });

    // The opposing team's pool is not on screen, so its moves have nowhere to fly.
    expect(
      intentsFromEvents(teamSnap, [
        event({ case: 'teamPoolTaken', value: { playerId: 'p1', team: 1, card: Pb.RED } as never }),
      ]),
    ).toEqual([]);
  });

  it('TurnStarted → turnCue with isYou set for the local player', () => {
    expect(
      intentsFromEvents(snap, [
        event({ case: 'turnStarted', value: { playerId: 'p0', orderIndex: 0 } as never }),
      ]),
    ).toContainEqual({
      kind: 'turnCue',
      playerId: 'p0',
      isYou: true,
    });
    expect(
      intentsFromEvents(snap, [
        event({ case: 'turnStarted', value: { playerId: 'p1', orderIndex: 1 } as never }),
      ]),
    ).toContainEqual({
      kind: 'turnCue',
      playerId: 'p1',
      isYou: false,
    });
  });
});
