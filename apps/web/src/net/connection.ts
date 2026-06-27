import { GameSocket } from './socket';
import { useGame } from '../store/game';

// Single live game socket, wired to the game store.
let socket: GameSocket | null = null;

export function connectGame(ticket: string): GameSocket {
  disconnectGame();
  useGame.getState().reset();
  socket = new GameSocket(ticket, {
    onStatus: (status) => useGame.getState().setStatus(status),
    onSnapshot: (snapshot) => useGame.getState().applySnapshot(snapshot),
    onEvents: (version, events) => useGame.getState().applyEvents(version, events),
    onRejection: (r) => useGame.getState().setRejection({ code: r.code, messageKey: r.messageKey }),
  });
  socket.connect();
  return socket;
}

export const getSocket = (): GameSocket | null => socket;

export function disconnectGame(): void {
  socket?.close();
  socket = null;
}
