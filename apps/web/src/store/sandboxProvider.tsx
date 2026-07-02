import { useState, type ReactNode } from 'react';
import { createGameStore, GameStoreProvider } from './game';
import { createAnimationsStore, AnimationsStoreProvider } from './animations';
import { createLogStore, LogStoreProvider } from './log';

/**
 * Wraps its subtree in FRESH, isolated game + animation stores. The in-game encyclopedia mounts the
 * board/HUD inside one of these so its sandbox replay writes only here — the live game's `useGame` /
 * `useAnimations` singletons (and the WebSocket feeding them) are never touched. The contextual
 * `useGameStore` / `useAnimationsStore` hooks the components use resolve to these instances.
 */
export function SandboxProvider({ children }: { children: ReactNode }) {
  const [gameStore] = useState(() => createGameStore());
  const [animStore] = useState(() => createAnimationsStore());
  const [logStore] = useState(() => createLogStore());
  return (
    <GameStoreProvider value={gameStore}>
      <AnimationsStoreProvider value={animStore}>
        <LogStoreProvider value={logStore}>{children}</LogStoreProvider>
      </AnimationsStoreProvider>
    </GameStoreProvider>
  );
}
