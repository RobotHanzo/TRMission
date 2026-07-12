// Owns the mobile socket lifecycle: mount → REST ticket → connectGame; background = expect the OS
// to kill the socket; foreground = re-mint the short-TTL ws ticket and reconnect (the existing
// resync machinery replays the snapshot — the store drops anything stale). Ports the web
// GameScreen connect effect plus the design spec's AppState posture.
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { api } from './rest';
import { connectGame, disconnectGame } from './connection';
import { useGame } from '../store/game';
import type { SocketStatus } from './socket';

export interface GameConnection {
  status: SocketStatus;
  /** Another connection took this seat — unrecoverable; the screen shows the takeover dialog. */
  sessionReplaced: boolean;
  /** Re-mint the ticket and reconnect (the offline banner's / error state's manual retry). */
  retry(): void;
}

export function useGameConnection(roomCode: string): GameConnection {
  const status = useGame((s) => s.status);
  const sessionReplaced = useGame((s) => s.sessionReplaced);
  const [attempt, setAttempt] = useState(0);
  const connecting = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const connect = async (): Promise<void> => {
      if (connecting.current) return;
      connecting.current = true;
      try {
        const { ticket } = await api.getTicket(roomCode);
        // The room code rides along so the shared socket can re-mint a fresh ticket on every
        // in-socket reconnect attempt (the seed one expires within seconds of a drop).
        if (!cancelled) connectGame(ticket, { roomCode });
      } catch {
        // REST failure (offline / room gone): surfaces as the socket status staying 'closed';
        // the OfflineBanner + retry() cover it.
      } finally {
        connecting.current = false;
      }
    };
    void connect();

    const sub = AppState.addEventListener('change', (state) => {
      // Foregrounding after a background kill: the old ticket may be expired (short TTL) and the
      // socket dead — always re-mint + reconnect. Skipped once the seat was taken elsewhere.
      if (state === 'active' && !cancelled && !useGame.getState().sessionReplaced) void connect();
    });
    return () => {
      cancelled = true;
      sub.remove();
      disconnectGame();
    };
  }, [roomCode, attempt]);

  return { status, sessionReplaced, retry: () => setAttempt((a) => a + 1) };
}
