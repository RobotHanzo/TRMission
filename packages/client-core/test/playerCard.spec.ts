import { describe, it, expect } from 'vitest';
import { create } from '@bufbuild/protobuf';
import { GameSnapshotSchema } from '@trm/proto';
import {
  playerCardView,
  claimedRouteIds,
  trainSupplyFraction,
  isLowOnTrains,
  LOW_TRAIN_CARS,
} from '../src/game/playerCard';
import { playerAvatar, initialOf } from '../src/game/playerAvatar';

// L1 (penghu–taipei, 23) and S1 (matsu–keelung, 8) are authored Taiwan missions; the module reads
// their values off the active content tables, which default to Taiwan.
const snapshot = create(GameSnapshotSchema, {
  currentPlayerId: 'p2',
  players: [
    {
      id: 'p1',
      seat: 0,
      team: -1,
      trainCars: 18,
      stationsRemaining: 1,
      routePoints: 69,
      handCount: 6,
      ticketCount: 3,
      bentoTokens: 2,
      blessings: 1,
    },
    { id: 'p2', seat: 1, team: -1, trainCars: 4, routePoints: 12, stationsRemaining: 3 },
  ],
  completedTickets: [
    { playerId: 'p1', ticketId: 'L1' },
    { playerId: 'p1', ticketId: 'S1' },
    { playerId: 'p2', ticketId: 'S1' },
  ],
  stations: [
    { playerId: 'p1', cityId: 'taichung' },
    { playerId: 'p1', cityId: 'yilan' },
    { playerId: 'p2', cityId: 'kaohsiung' },
  ],
  ownership: [
    { routeId: 'r1', cell: { case: 'ownerPlayerId', value: 'p1' } },
    { routeId: 'r2', cell: { case: 'ownerPlayerId', value: 'p2' } },
    { routeId: 'r3', cell: { case: 'ownerPlayerId', value: 'p1' } },
    { routeId: 'r4', cell: { case: 'locked', value: true } },
  ],
});

describe('playerCardView (issue #14)', () => {
  it('splits the live score into route points and completed-mission value', () => {
    const view = playerCardView(snapshot, 'p1');
    expect(view).not.toBeNull();
    expect(view!.routePoints).toBe(69);
    expect(view!.ticketPoints).toBe(31); // L1 23 + S1 8
    expect(view!.total).toBe(100);
    expect(view!.completedTicketIds).toEqual(['L1', 'S1']);
  });

  it('counts only this player’s routes and stations', () => {
    const view = playerCardView(snapshot, 'p1')!;
    expect(view.claimedRouteIds).toEqual(['r1', 'r3']);
    expect(view.stationCityIds).toEqual(['taichung', 'yilan']);
    // Built + remaining, so a custom map's stationsPerPlayer needs no separate lookup.
    expect(view.stationsTotal).toBe(3);
  });

  it('a locked (unclaimed) route belongs to nobody', () => {
    expect(claimedRouteIds(snapshot, 'p2')).toEqual(['r2']);
  });

  it('lists only non-zero event resources, in display order', () => {
    expect(playerCardView(snapshot, 'p1')!.resources).toEqual([
      { key: 'bentoTokens', n: 2 },
      { key: 'blessings', n: 1 },
    ]);
    expect(playerCardView(snapshot, 'p2')!.resources).toEqual([]);
  });

  it('marks the acting player and a bot id', () => {
    expect(playerCardView(snapshot, 'p2')!.isCurrent).toBe(true);
    expect(playerCardView(snapshot, 'p1')!.isCurrent).toBe(false);
    expect(playerCardView(snapshot, 'p1')!.isBot).toBe(false);
  });

  it('returns null for an id that is not seated', () => {
    expect(playerCardView(snapshot, 'ghost')).toBeNull();
  });

  it('defaults the gauge denominator to the active content’s starting train count', () => {
    expect(playerCardView(snapshot, 'p1')!.trainCarsStart).toBe(45);
  });
});

describe('train supply gauge', () => {
  it('is a clamped 0–1 fraction', () => {
    expect(trainSupplyFraction(45, 45)).toBe(1);
    expect(trainSupplyFraction(0, 45)).toBe(0);
    expect(trainSupplyFraction(-3, 45)).toBe(0);
    // Content whose rules failed to load must not overflow the bar.
    expect(trainSupplyFraction(45, 15)).toBe(1);
    expect(trainSupplyFraction(10, 0)).toBe(0);
  });

  it('warns before the engine’s endgame trigger, not at it', () => {
    expect(isLowOnTrains(LOW_TRAIN_CARS)).toBe(true);
    expect(isLowOnTrains(LOW_TRAIN_CARS + 1)).toBe(false);
    expect(LOW_TRAIN_CARS).toBeGreaterThan(2); // DEFAULT_RULE_PARAMS.endgameTrainThreshold
  });
});

describe('playerAvatar', () => {
  it('a bot is a bot before anything else', () => {
    expect(playerAvatar({ displayName: 'Bot', isBot: true, avatarUrl: 'x' })).toEqual({
      kind: 'bot',
    });
  });

  it('a guest reads as a guest rather than a picture', () => {
    expect(playerAvatar({ displayName: 'Guest', isGuest: true, avatarUrl: 'x' })).toEqual({
      kind: 'guest',
    });
  });

  it('shows the account picture when there is one', () => {
    expect(playerAvatar({ displayName: 'Ada', avatarUrl: 'https://x/a.png' })).toEqual({
      kind: 'photo',
      url: 'https://x/a.png',
    });
  });

  it('suppresses a blocked player’s picture, like their name', () => {
    expect(playerAvatar({ displayName: 'P2', avatarUrl: 'https://x/a.png', masked: true })).toEqual(
      {
        kind: 'initial',
        letter: 'P',
      },
    );
  });

  it('falls back to the initial of the resolved label', () => {
    expect(playerAvatar({ displayName: 'ada' })).toEqual({ kind: 'initial', letter: 'A' });
  });

  it('takes one whole glyph for CJK and astral names', () => {
    expect(initialOf('  小玫 ')).toBe('小');
    expect(initialOf('🚆 express')).toBe('🚆');
    expect(initialOf('')).toBe('?');
  });
});
