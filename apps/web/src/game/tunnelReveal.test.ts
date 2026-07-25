// `useTunnelReveal` lives in @trm/client-core (shared web+mobile) but needs a React renderer, so
// its test rides in the web app's jsdom suite (per client-core's CLAUDE.md).
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { create } from '@bufbuild/protobuf';
import { CardColor, GameSnapshotSchema, Phase, type GameSnapshot } from '@trm/proto';
import { useTunnelReveal } from './tunnel';

const pendingSnap = (routeId: string): GameSnapshot =>
  create(GameSnapshotSchema, {
    stateVersion: 7,
    phase: Phase.TUNNEL_PENDING,
    currentPlayerId: 'p0',
    pendingTunnel: {
      playerId: 'p0',
      routeId,
      revealed: [CardColor.RED, CardColor.BLUE, CardColor.RED],
      extraRequired: 2,
      playedColor: CardColor.BLUE,
    },
  });

const resolvedSnap = (): GameSnapshot =>
  create(GameSnapshotSchema, {
    stateVersion: 8,
    phase: Phase.AWAIT_ACTION,
    currentPlayerId: 'p1',
  });

describe('useTunnelReveal', () => {
  it('shows a pending reveal and hides nothing when there is no tunnel', () => {
    const { result, rerender } = renderHook(
      ({ s }: { s: GameSnapshot }) => useTunnelReveal(s, true),
      {
        initialProps: { s: pendingSnap('r1') },
      },
    );
    expect(result.current.visible).toBe(true);
    rerender({ s: resolvedSnap() });
    expect(result.current.visible).toBe(false);
  });

  it('read-only playback can dismiss the reveal; the NEXT tunnel still opens', () => {
    const { result, rerender } = renderHook(
      ({ s }: { s: GameSnapshot }) => useTunnelReveal(s, true),
      {
        initialProps: { s: pendingSnap('r1') },
      },
    );
    act(() => result.current.dismiss());
    expect(result.current.visible).toBe(false);
    // Same snapshot re-delivered (a re-render, a perspective switch): stays closed.
    rerender({ s: pendingSnap('r1') });
    expect(result.current.visible).toBe(false);
    // A different tunnel is a different reveal.
    rerender({ s: pendingSnap('r2') });
    expect(result.current.visible).toBe(true);
  });

  it('seeking away and back re-opens a dismissed reveal', () => {
    const { result, rerender } = renderHook(
      ({ s }: { s: GameSnapshot }) => useTunnelReveal(s, true),
      {
        initialProps: { s: pendingSnap('r1') },
      },
    );
    act(() => result.current.dismiss());
    expect(result.current.visible).toBe(false);
    rerender({ s: resolvedSnap() });
    rerender({ s: pendingSnap('r1') });
    expect(result.current.visible).toBe(true);
  });

  it('a live game (not read-only) cannot dismiss it — the server closes it by resolving', () => {
    const { result } = renderHook(() => useTunnelReveal(pendingSnap('r1'), false));
    act(() => result.current.dismiss());
    expect(result.current.visible).toBe(true);
  });
});
