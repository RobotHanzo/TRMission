import { taiwanBoard } from '@trm/engine';
import { InMemoryLocalGameStore } from './inMemoryStore';
import { LocalGameSession } from './localGameSession';
import { loadOfflineGame } from './loadGame';
import { newOfflineSetup } from './newGame';

const board = taiwanBoard();
const setupFor = (gameId: string) =>
  newOfflineSetup({
    mapId: 'taiwan',
    botCount: 1,
    difficulty: 'EASY',
    eventsMode: 'off',
    gameId,
    seed: 's1',
  });

describe('loadOfflineGame', () => {
  it('loads and resumes a stored game', async () => {
    const store = new InMemoryLocalGameStore();
    await LocalGameSession.create(setupFor('local:lg-1'), board, store);
    const res = await loadOfflineGame(store, 'local:lg-1');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.session.stateVersion).toBe(0);
  });

  it('404s an unknown id', async () => {
    const res = await loadOfflineGame(new InMemoryLocalGameStore(), 'local:nope');
    expect(res).toEqual({ ok: false, reason: 'not_found' });
  });

  it('refuses a save from a different engine version', async () => {
    const store = new InMemoryLocalGameStore();
    // engineVersion is a number (ENGINE_VERSION); force a mismatch with a bogus version.
    const setup = { ...setupFor('local:lg-2'), engineVersion: 999 };
    await LocalGameSession.create(setup, board, store);
    const res = await loadOfflineGame(store, 'local:lg-2');
    expect(res).toEqual({ ok: false, reason: 'engine_version' });
  });

  it('refuses an unregistered content hash', async () => {
    const store = new InMemoryLocalGameStore();
    const s0 = setupFor('local:lg-3');
    const setup = { ...s0, config: { ...s0.config, contentHash: 'not-a-registered-hash' } };
    await LocalGameSession.create(setup, board, store);
    const res = await loadOfflineGame(store, 'local:lg-3');
    expect(res).toEqual({ ok: false, reason: 'unknown_content' });
  });
});
