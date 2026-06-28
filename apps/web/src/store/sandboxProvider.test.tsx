import { describe, it, expect } from 'vitest';
import { useEffect } from 'react';
import { render, screen } from '@testing-library/react';
import { taiwanBoard, CONTENT_HASH } from '@trm/engine';
import type { GameConfig } from '@trm/engine';
import { asPlayerId } from '@trm/shared';
import { useGame, useGameStore, useGameStoreApi } from './game';
import { SandboxProvider } from './sandboxProvider';
import { SandboxSocket } from '../net/sandboxSocket';

const p0 = asPlayerId('p0');
const p1 = asPlayerId('p1');
const config: GameConfig = {
  seed: 'iso',
  players: [
    { id: p0, seat: 0 },
    { id: p1, seat: 1 },
  ],
  contentHash: CONTENT_HASH,
};

function Probe() {
  const store = useGameStoreApi();
  useEffect(() => {
    new SandboxSocket(taiwanBoard(), config, p0, {
      applySnapshot: (s) => store.getState().applySnapshot(s),
      applyEvents: (v, e) => store.getState().applyEvents(v, e),
    });
  }, [store]);
  const hasSnapshot = useGameStore((s) => !!s.snapshot);
  return <div data-testid="iso">{hasSnapshot ? 'yes' : 'no'}</div>;
}

describe('SandboxProvider isolation', () => {
  it('a sandbox under the provider writes the isolated store, never the live singleton', () => {
    useGame.getState().reset();
    render(
      <SandboxProvider>
        <Probe />
      </SandboxProvider>,
    );
    // The isolated store received the projected snapshot…
    expect(screen.getByTestId('iso').textContent).toBe('yes');
    // …while the live game store stayed untouched (the in-game encyclopedia requirement).
    expect(useGame.getState().snapshot).toBeNull();
  });
});
