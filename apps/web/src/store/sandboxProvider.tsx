import { useState, type ReactNode } from 'react';
import { createGameStore, GameStoreProvider } from './game';
import { createAnimationsStore, AnimationsStoreProvider } from './animations';

/**
 * Wraps its subtree in FRESH, isolated game + animation stores. The in-game encyclopedia mounts the
 * board/HUD inside one of these so its sandbox replay writes only here — the live game's `useGame` /
 * `useAnimations` singletons (and the WebSocket feeding them) are never touched. The contextual
 * `useGameStore` / `useAnimationsStore` hooks the components use resolve to these instances.
 */
export function SandboxProvider({ children }: { children: ReactNode }) {
  const [gameStore] = useState(() => createGameStore());
  const [animStore] = useState(() => createAnimationsStore());
  return (
    <GameStoreProvider value={gameStore}>
      <AnimationsStoreProvider value={animStore}>{children}</AnimationsStoreProvider>
    </GameStoreProvider>
  );
}
