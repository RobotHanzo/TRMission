import { GameSocket } from './socket';
import { api } from './rest';
import { useGame } from '../store/game';
import { useLog } from '../store/log';
import { useChat } from '../store/chat';

// Single live game socket, wired to the game/log/chat stores.
let socket: GameSocket | null = null;

/**
 * How to re-mint a ws-game ticket when the socket reconnects: the room code plus whether this
 * viewer is watching (a spectator's ticket comes from a different endpoint than a seated player's).
 * Omit it (e.g. a sandbox with no room) to fall back to reusing the seed ticket.
 */
export interface TicketSource {
  roomCode: string;
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
    undefined,
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
