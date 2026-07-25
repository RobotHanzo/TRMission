// Playability gate for the second official map. `@trm/map-data`'s own suite proves the Greater
// Taipei content is structurally valid; this proves a real game on it actually *finishes* —
// through the same engine, the same bot policy, and the map's own curated rules (32 train cars,
// a 56-mission deck), which is what a validator alone can never establish.
import { describe, it, expect } from 'vitest';
import { buildBoard } from '@trm/engine';
import { TAIPEI_CONTENT, TAIPEI_CONTENT_HASH, TAIPEI_RULES } from '@trm/map-data';
import { A, B, driveGame } from './helpers';

const taipeiOpts = {
  board: buildBoard(TAIPEI_CONTENT),
  contentHash: TAIPEI_CONTENT_HASH,
  // The disjoint merge LobbyService.start performs: the map's curated rules feed ruleParams.
  ruleParams: { ...TAIPEI_RULES },
};

describe('Greater Taipei board', () => {
  it('drives a full 2-bot game to completion with only legal, deterministic picks', () => {
    const state = driveGame('taipei-medium', 'MEDIUM', 'MEDIUM', {
      ...taipeiOpts,
      checkDeterminism: true,
    });
    expect(state.finalScores).not.toBeNull();
    // Both seats actually BUILT — a map where a bot can never claim anything would still
    // "finish". (The net total can legitimately go negative on unfinished missions, so the
    // gate is route points, not the scoreboard.)
    for (const id of [A, B]) {
      const line = state.finalScores?.players.find((p) => p.playerId === id);
      expect({ id: id as string, built: (line?.routePoints ?? 0) > 0 }).toEqual({
        id: id as string,
        built: true,
      });
    }
  });

  it('finishes across seeds, at HELL, and with intense random events', () => {
    for (const seed of ['taipei-hell-1', 'taipei-hell-2', 'taipei-hell-3']) {
      expect(driveGame(seed, 'HELL', 'HELL', taipeiOpts).finalScores).not.toBeNull();
    }
    const withEvents = driveGame('taipei-events', 'HELL', 'HELL', {
      ...taipeiOpts,
      ruleParams: { ...TAIPEI_RULES, eventsMode: 'intense' },
    });
    expect(withEvents.finalScores).not.toBeNull();
  });
});
