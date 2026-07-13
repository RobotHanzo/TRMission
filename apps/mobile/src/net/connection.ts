import { GameSocket } from './socket';
import { WS_URL } from '../config';
import { api } from './rest';
import { useGame } from '../store/game';
import { useLog } from '../store/log';
import { useChat } from '../store/chat';

// Single live game socket, wired to the game/log/chat stores.
let socket: GameSocket | null = null;

/**
 * How to re-mint a ws-game ticket when the socket reconnects. The seed ticket is short-lived
 * (server default 45s) and is almost always expired by the time a socket drops, so a reconnect
 * that replays it is rejected UNAUTHENTICATED — passing the room code lets the shared socket
 * re-mint a fresh one per attempt (same contract as apps/web's connectGame).
 */
export interface TicketSource {
  roomCode: string;
  /** A watcher's ticket re-mints through /spectate (a seated player's /ticket 403s for them). */
  spectator?: boolean;
}

export function connectGame(ticket: string, ticketSource?: TicketSource): GameSocket {
  disconnectGame();
  useGame.getState().reset();
  useLog.getState().reset();
  useChat.getState().reset();
  const refreshTicket = ticketSource
    ? () =>
        (ticketSource.spectator
          ? api.spectate(ticketSource.roomCode)
          : api.getTicket(ticketSource.roomCode)
        ).then((r) => r.ticket)
    : undefined;
  socket = new GameSocket(
    ticket,
    {
      onStatus: (status) => useGame.getState().setStatus(status),
      onSnapshot: (snapshot) => useGame.getState().applySnapshot(snapshot),
      onEvents: (version, events) => {
        useGame.getState().applyEvents(version, events);
        useLog.getState().ingestLive(events);
      },
      onRejection: (r) =>
        useGame.getState().setRejection({ code: r.code, messageKey: r.messageKey }),
      onChat: (playerId, content) => useChat.getState().ingest({ playerId, content }),
      onHistory: (events, chat) => {
        useLog.getState().ingestHistory(events);
        useChat.getState().ingestHistory(chat);
      },
      onCameraMoved: (playerId, view) => useGame.getState().applyCameraMoved(playerId, view),
      onSessionReplaced: () => useGame.getState().setSessionReplaced(true),
    },
    WS_URL,
    refreshTicket,
  );
  socket.connect();
  return socket;
}

export const getSocket = (): GameSocket | null => socket;

export function disconnectGame(): void {
  socket?.close();
  socket = null;
}
