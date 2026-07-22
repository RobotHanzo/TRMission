// Owns one offline game for a mounted screen: create/resume the session, feed the SAME
// isolated game/log stores the live client uses (snapshot-authoritative, so GameStage
// cannot tell online from offline), and pace bot turns. Mirrors the web replay driver's
// store discipline (apps/web/src/features/replay/useReplayPlayer.ts).
import { useEffect, useRef, useState } from 'react';
import { boardForContentHash } from '@trm/engine';
import type { Action, GameEvent } from '@trm/engine';
import type { BotDifficulty } from '@trm/bots';
import type { EventsMode } from '@trm/shared';
import type { GameStoreApi } from '../store/game';
import type { LogStoreApi } from '../store/log';
import type { GameCommands } from '../net/commands';
import { LocalGameSession } from './localGameSession';
import { LocalSocket } from './localSocket';
import { runBotBurst } from './botDriver';
import { loadOfflineGame } from './loadGame';
import { newOfflineSetup } from './newGame';
import { openLocalGameStore } from './localStore';
import { randomGameId, randomSeed } from './seed';
import type { LocalGameStorePort } from './types';

export type LocalGameInput =
  | {
      mode: 'new';
      mapId: string;
      botCount: 1 | 2 | 3 | 4 | 5;
      difficulty: BotDifficulty;
      eventsMode: EventsMode;
      /** Team game: number of teams (omit / 0 for free-for-all). */
      teamCount?: number;
    }
  | { mode: 'resume'; gameId: string };

export interface LocalGameHandle {
  ready: boolean;
  error: 'load_failed' | 'engine_version' | 'unknown_content' | null;
  socket: GameCommands | null;
  gameId: string | null;
  /** Persistence failed: game continues in memory only (banner). */
  saveBroken: boolean;
  /** Resume truncated a corrupt tail (toast). */
  resumeTruncated: boolean;
}

export function useLocalGame(
  input: LocalGameInput,
  stores: { game: GameStoreApi; log: LogStoreApi },
  deps?: { store?: LocalGameStorePort },
): LocalGameHandle {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<LocalGameHandle['error']>(null);
  const [socket, setSocket] = useState<GameCommands | null>(null);
  const [gameId, setGameId] = useState<string | null>(null);
  const [saveBroken, setSaveBroken] = useState(false);
  const [resumeTruncated, setResumeTruncated] = useState(false);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    let session: LocalGameSession | null = null;

    const project = () => {
      if (session) stores.game.getState().applySnapshot(session.projectHuman());
    };
    const afterMove = (events: GameEvent[]) => {
      if (!session) return;
      project();
      const pb = session.redactEvents(events);
      if (pb.length > 0) {
        stores.game.getState().applyEvents(session.stateVersion, pb);
        stores.log.getState().ingestLive(pb);
      }
      if (session.persistenceBroken) setSaveBroken(true);
    };
    const burst = () => {
      if (!session) return;
      void runBotBurst(session, {
        onBotMove: afterMove,
        delay: (ms) => new Promise((r) => setTimeout(r, ms)),
        isCancelled: () => cancelled.current,
      });
    };

    void (async () => {
      try {
        const store = deps?.store ?? (await openLocalGameStore());
        if (input.mode === 'new') {
          const setup = newOfflineSetup({
            mapId: input.mapId,
            botCount: input.botCount,
            difficulty: input.difficulty,
            eventsMode: input.eventsMode,
            gameId: randomGameId(),
            seed: randomSeed(),
            ...(input.teamCount !== undefined ? { teamCount: input.teamCount } : {}),
          });
          const board = boardForContentHash(setup.config.contentHash);
          session = await LocalGameSession.create(setup, board, store);
        } else {
          const res = await loadOfflineGame(store, input.gameId);
          if (!res.ok) {
            setError(res.reason === 'not_found' ? 'load_failed' : res.reason);
            return;
          }
          session = res.session;
          if (res.report.discardedFromSeq !== null) setResumeTruncated(true);
          stores.log.getState().ingestHistory(res.history);
        }
        if (cancelled.current) return;
        setGameId(session.setup.gameId);
        project();
        const active = session;
        setSocket(
          new LocalSocket(active.humanId, (action: Action) => {
            void (async () => {
              const r = await active.apply(action);
              if (!r.ok) {
                stores.game.getState().setRejection({ code: 0, messageKey: 'actionRejected' });
                return;
              }
              afterMove(r.events);
              burst();
            })();
          }),
        );
        setReady(true);
        burst(); // bots may hold the very first decisions (setup keeps / first turn)
      } catch {
        setError('load_failed');
      }
    })();

    return () => {
      cancelled.current = true;
      stores.game.getState().reset();
      stores.log.getState().reset();
    };
    // Mount-only by design: input/stores are stable for the screen mount's lifetime
    // (same discipline as useReplayPlayer).
  }, []);

  return { ready, error, socket, gameId, saveBroken, resumeTruncated };
}
