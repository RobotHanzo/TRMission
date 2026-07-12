// Load + resume one stored offline game, enforcing the version pins the server stamps on
// persisted games (engineVersion + registered contentHash): a save from an incompatible
// binary is refused — never replayed against the wrong rules or the wrong board.
import { ENGINE_VERSION, boardForContentHash } from '@trm/engine';
import type { Board } from '@trm/engine';
import type { GameEvent as PbGameEvent } from '@trm/proto';
import { LocalGameSession } from './localGameSession';
import type { ResumeReport } from './localGameSession';
import type { LocalGameStorePort } from './types';

export type LoadOfflineResult =
  | {
      ok: true;
      session: LocalGameSession;
      report: ResumeReport;
      history: PbGameEvent[];
    }
  | { ok: false; reason: 'not_found' | 'engine_version' | 'unknown_content' };

export async function loadOfflineGame(
  store: LocalGameStorePort,
  gameId: string,
): Promise<LoadOfflineResult> {
  const loaded = await store.loadGame(gameId);
  if (!loaded) return { ok: false, reason: 'not_found' };
  if (loaded.setup.engineVersion !== ENGINE_VERSION) return { ok: false, reason: 'engine_version' };
  let board: Board;
  try {
    // The official-content registry (archived versions included). Throws on unknown hash —
    // same posture as server recovery: fail loudly, never fall back to the wrong board.
    board = boardForContentHash(loaded.setup.config.contentHash);
  } catch {
    return { ok: false, reason: 'unknown_content' };
  }
  const { session, report, history } = await LocalGameSession.resume(
    loaded.setup,
    board,
    store,
    loaded.actions,
  );
  if (session.isGameOver) await store.markCompleted(gameId); // idempotent catch-up
  return { ok: true, session, report, history };
}
