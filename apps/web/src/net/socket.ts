// Platform shim over the shared realtime client (@trm/client-core): the class itself is
// platform-neutral; only the default WS endpoint is web-specific (derived from `location`).
export {
  GameSocket,
  type CameraViewInit,
  type ChatContent,
  type PaymentInit,
  type SocketHandlers,
  type SocketStatus,
  type TicketRefresh,
} from '@trm/client-core';

/** The same-origin WS endpoint (`/ws` behind the Vite proxy in dev, the real host in prod). */
export function defaultWsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}
