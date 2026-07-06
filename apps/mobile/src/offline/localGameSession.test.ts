import { legalActions, stateDigest, taiwanBoard } from '@trm/engine';
import { chooseBotAction } from '@trm/bots';
import { LocalGameSession } from './localGameSession';
import { InMemoryLocalGameStore } from './inMemoryStore';
import { newOfflineSetup } from './newGame';
import { LOCAL_HUMAN_ID } from './types';

const board = taiwanBoard();
const makeSetup = (gameId = 'local:test-1') =>
  newOfflineSetup({
    mapId: 'taiwan',
    botCount: 2,
    difficulty: 'MEDIUM',
    gameId,
    seed: 'offline-spec-seed',
  });

/** Bots move via botStep; when it's the human's turn, play the first legal action. */
async function playSteps(session: LocalGameSession, n: number): Promise<void> {
  let applied = 0;
  for (let guard = 0; guard < 8000 && applied < n; guard++) {
    if (session.isGameOver) return;
    const bot = await session.botStep();
    if (bot.kind === 'moved') {
      applied++;
      continue;
    }
    if (bot.kind === 'gameOver') return;
    // Drive the human purposefully (like a real player) so the game actually terminates within a
    // sane bound; still exercises the human apply() path. Falls back to the first legal move.
    const legal = legalActions(session.board, session.raw(), session.humanId);
    expect(legal.length).toBeGreaterThan(0);
    const chosen =
      chooseBotAction(session.board, session.raw(), session.humanId, 'MEDIUM') ?? legal[0]!;
    const r = await session.apply(chosen);
    expect(r.ok).toBe(true);
    applied++;
  }
}

async function playToGameOver(session: LocalGameSession): Promise<void> {
  for (let guard = 0; guard < 8000; guard++) {
    if (session.isGameOver) return;
    await playSteps(session, 1);
  }
  throw new Error('offline game did not finish');
}

describe('LocalGameSession', () => {
  it('plays a full game through the write-ahead log and completes it', async () => {
    const store = new InMemoryLocalGameStore();
    const session = await LocalGameSession.create(makeSetup(), board, store);
    await playToGameOver(session);

    expect(session.isGameOver).toBe(true);
    // Event-sourced mirror of the server: contiguous seqs 1..N, one digest per action.
    const rows = store.rows.get('local:test-1')!;
    expect(rows.length).toBe(session.stateVersion);
    rows.forEach((row, i) => expect(row.seq).toBe(i + 1));
    expect(store.games.get('local:test-1')!.status).toBe('COMPLETED');

    // The UI-facing projection is the standard redacted snapshot with a final scoreboard.
    const snap = session.projectHuman();
    expect(snap.you?.playerId).toBe(LOCAL_HUMAN_ID);
    expect(snap.finalScores).toBeDefined();
  });

  it('resume replays the stored log to the exact same digest', async () => {
    const store = new InMemoryLocalGameStore();
    const setup = makeSetup('local:test-2');
    const live = await LocalGameSession.create(setup, board, store);
    await playSteps(live, 40);
    const liveDigest = stateDigest(live.raw());

    const loaded = await store.loadGame('local:test-2');
    const { session, report } = await LocalGameSession.resume(
      loaded!.setup,
      board,
      store,
      loaded!.actions,
    );
    expect(report.discardedFromSeq).toBeNull();
    expect(stateDigest(session.raw())).toBe(liveDigest);
    expect(session.stateVersion).toBe(live.stateVersion);
  });

  it('discards a corrupt tail instead of failing resume', async () => {
    const store = new InMemoryLocalGameStore();
    const setup = makeSetup('local:test-3');
    const live = await LocalGameSession.create(setup, board, store);
    await playSteps(live, 30);

    const rows = store.rows.get('local:test-3')!;
    const badSeq = rows[rows.length - 2]!.seq;
    // Tamper the second-to-last digest: everything from that seq on is untrusted.
    rows[rows.length - 2] = { ...rows[rows.length - 2]!, stateDigest: 'corrupt' };

    const loaded = await store.loadGame('local:test-3');
    const { session, report } = await LocalGameSession.resume(
      loaded!.setup,
      board,
      store,
      loaded!.actions,
    );
    expect(report.discardedFromSeq).toBe(badSeq);
    expect(session.stateVersion).toBe(badSeq - 1);
    // The tail was deleted from the store, so the NEXT resume is clean.
    expect(store.rows.get('local:test-3')!.every((r) => r.seq < badSeq)).toBe(true);
    expect(session.isGameOver).toBe(false);
  });

  it('keeps the in-memory game alive when persistence fails (storage full)', async () => {
    const store = new InMemoryLocalGameStore();
    const session = await LocalGameSession.create(makeSetup('local:test-4'), board, store);
    await playSteps(session, 5);
    const savedCount = store.rows.get('local:test-4')!.length;

    store.failAppends = true;
    await playSteps(session, 3);
    expect(session.persistenceBroken).toBe(true);
    // No partial/gapped log: once broken, nothing more is appended.
    expect(store.rows.get('local:test-4')!.length).toBe(savedCount);
    // …but the in-memory game kept going.
    expect(session.stateVersion).toBeGreaterThanOrEqual(savedCount + 3);
  });
});
