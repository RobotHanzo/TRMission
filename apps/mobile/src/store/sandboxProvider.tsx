// Ported verbatim from apps/web/src/store/sandboxProvider.tsx.
import { useState, type ReactNode } from 'react';
import { createGameStore, GameStoreProvider } from './game';
import { createAnimationsStore, AnimationsStoreProvider } from './animations';
import { createLogStore, LogStoreProvider } from './log';

/**
 * Wraps its subtree in FRESH, isolated game + animation + log stores. The offline game (and the
 * P4 tutorial) mounts the board/HUD inside one of these so its sandbox session writes only here —
 * the live game's `useGame` / `useAnimations` / `useLog` singletons (and the WebSocket feeding
 * them) are never touched. The contextual `useGameStore` / `useAnimationsStore` / `useLogStore`
 * hooks the components use resolve to these instances.
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
