// Consecutive bot decisions until it's the human's turn or the game ends — the client-side
// port of GameHub.driveBots (apps/server/src/ws/hub.ts), minus persistence retries (the
// session already downgrades persistence failures to persistenceBroken).
import type { GameEvent } from '@trm/engine';
import type { LocalGameSession } from './localGameSession';
import { botPauseMs } from './pacing';

export interface BotBurstPorts {
  onBotMove(events: GameEvent[]): void;
  delay(ms: number): Promise<void>;
  isCancelled(): boolean;
}

export async function runBotBurst(session: LocalGameSession, ports: BotBurstPorts): Promise<void> {
  for (let guard = 0; guard < 10_000; guard++) {
    if (ports.isCancelled() || session.isGameOver) return;
    if (!session.nextActableBot()) return; // waiting on the human
    const revealed = session.raw().pendingTunnel?.revealed.length ?? 0;
    await ports.delay(botPauseMs(session.phase, revealed));
    if (ports.isCancelled()) return;
    const r = await session.botStep();
    if (r.kind !== 'moved') return;
    ports.onBotMove(r.events);
  }
}
