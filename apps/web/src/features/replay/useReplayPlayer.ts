// Thin wrapper over the shared replay player (@trm/client-core/replay) — keeps the original
// web signature (finalDigest positional) and injects the web reduced-motion signal.
import type { Action, Board, GameConfig } from '@trm/engine';
import type { PlayerId } from '@trm/shared';
import { useReplayPlayer as useSharedReplayPlayer } from '@trm/client-core/replay/useReplayPlayer';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import type { GameStoreApi } from '../../store/game';
import type { LogStoreApi } from '../../store/log';

export { STEP_MS, type ReplayControls } from '@trm/client-core/replay/useReplayPlayer';

export function useReplayPlayer(
  board: Board,
  config: GameConfig,
  actions: readonly Action[],
  initialViewer: PlayerId | null,
  stores: { game: GameStoreApi; log: LogStoreApi },
  finalDigest?: string,
) {
  const reducedMotion = useReducedMotion();
  return useSharedReplayPlayer(board, config, actions, initialViewer, stores, {
    finalDigest,
    reducedMotion,
  });
}
