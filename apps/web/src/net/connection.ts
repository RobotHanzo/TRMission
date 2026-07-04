import { GameSocket } from './socket';
import { useGame } from '../store/game';
import { useLog } from '../store/log';
import { useChat } from '../store/chat';

// Single live game socket, wired to the game/log/chat stores.
let socket: GameSocket | null = null;

export function connectGame(ticket: string): GameSocket {
  disconnectGame();
  useGame.getState().reset();
  useLog.getState().reset();
  useChat.getState().reset();
  socket = new GameSocket(ticket, {
    onStatus: (status) => useGame.getState().setStatus(status),
    onSnapshot: (snapshot) => useGame.getState().applySnapshot(snapshot),
    onEvents: (version, events) => {
      useGame.getState().applyEvents(version, events);
      useLog.getState().ingestLive(events);
    },
    onRejection: (r) => useGame.getState().setRejection({ code: r.code, messageKey: r.messageKey }),
    onChat: (playerId, text) => useChat.getState().ingest({ playerId, text }),
    onHistory: (events, chat) => {
      useLog.getState().ingestHistory(events);
      useChat.getState().ingestHistory(chat);
    },
    onCameraMoved: (playerId, view) => useGame.getState().applyCameraMoved(playerId, view),
    onSessionReplaced: () => useGame.getState().setSessionReplaced(true),
  });
  socket.connect();
  return socket;
}

export const getSocket = (): GameSocket | null => socket;

export function disconnectGame(): void {
  socket?.close();
  socket = null;
}
