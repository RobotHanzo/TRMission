// Platform shim over the shared realtime client (@trm/client-core): the class itself is
// platform-neutral; mobile passes its configured absolute WS endpoint (`WS_URL`) at the
// construction site (net/connection.ts) instead of a location-derived default.
export {
  GameSocket,
  type CameraViewInit,
  type ChatContent,
  type PaymentInit,
  type SocketHandlers,
  type SocketStatus,
  type TicketRefresh,
} from '@trm/client-core';
