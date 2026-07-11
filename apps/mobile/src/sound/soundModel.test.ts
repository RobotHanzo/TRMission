// Ported from apps/web/src/sound/soundModel.test.ts (vitest → jest globals; assertions verbatim).
import { Phase, type GameEvent, type GameSnapshot } from '@trm/proto';
import { cuesFromEvents, gameOverCue } from './soundModel';

const ev = (cs: string, value: Record<string, unknown>): GameEvent =>
  ({ event: { case: cs, value } }) as unknown as GameEvent;

const snap = (over: Partial<GameSnapshot>): GameSnapshot =>
  ({ you: { playerId: 'me' }, phase: Phase.AWAIT_ACTION, ...over }) as unknown as GameSnapshot;

describe('cuesFromEvents', () => {
  it('maps draws/turn/station/route with the self flag', () => {
    const s = snap({});
    const hits = cuesFromEvents(s, [
      ev('cardDrawnBlind', { playerId: 'me' }),
      ev('cardTakenFaceup', { playerId: 'p2' }),
      ev('turnStarted', { playerId: 'me' }),
      ev('turnStarted', { playerId: 'p2' }),
      ev('stationBuilt', { playerId: 'p2' }),
      ev('routeClaimed', { playerId: 'me' }),
    ]);
    expect(hits).toEqual([
      { cue: 'cardDraw', isSelf: true },
      { cue: 'cardDraw', isSelf: false },
      { cue: 'yourTurn', isSelf: true }, // opponent turnStarted yields nothing
      { cue: 'stationBuilt', isSelf: false },
      { cue: 'railwayBuilt', isSelf: true },
    ]);
  });

  it('maps a started random event to the eventStart cue at full gain', () => {
    const s = snap({});
    const hits = cuesFromEvents(s, [
      ev('randomEventStarted', { info: { kind: 'TYPHOON_LANDFALL' } }),
    ]);
    expect(hits).toEqual([{ cue: 'eventStart', isSelf: true }]);
  });
});

describe('gameOverCue', () => {
  it('returns null when not at GAME_OVER', () => {
    expect(gameOverCue(snap({ phase: Phase.AWAIT_ACTION }))).toBeNull();
  });
  it('returns win when the local player is a winner', () => {
    const s = snap({
      phase: Phase.GAME_OVER,
      finalScores: { ranking: [{ playerIds: ['me'] }] },
    } as Partial<GameSnapshot>);
    expect(gameOverCue(s)).toBe('gameOverWin');
  });
  it('returns normal when the local player did not win', () => {
    const s = snap({
      phase: Phase.GAME_OVER,
      finalScores: { ranking: [{ playerIds: ['p2'] }] },
    } as Partial<GameSnapshot>);
    expect(gameOverCue(s)).toBe('gameOverNormal');
  });
});
