/** Nominal (branded) id types so a CityId can't be passed where a RouteId is expected. */
declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type PlayerId = Brand<string, 'PlayerId'>;
export type RouteId = Brand<string, 'RouteId'>;
export type CityId = Brand<string, 'CityId'>;
export type TicketId = Brand<string, 'TicketId'>;
export type GameId = Brand<string, 'GameId'>;
export type RoomId = Brand<string, 'RoomId'>;

export const asPlayerId = (s: string): PlayerId => s as PlayerId;
export const asRouteId = (s: string): RouteId => s as RouteId;
export const asCityId = (s: string): CityId => s as CityId;
export const asTicketId = (s: string): TicketId => s as TicketId;
export const asGameId = (s: string): GameId => s as GameId;
export const asRoomId = (s: string): RoomId => s as RoomId;
