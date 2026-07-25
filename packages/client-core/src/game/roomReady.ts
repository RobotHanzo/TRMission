import type { RoomMember } from '../net/restTypes';

/**
 * Ready-up view logic, shared by both clients and mirrored by the server's `LobbyService.start`.
 *
 * Bots are always ready, so a table whose only human is the host has nobody to coordinate with:
 * the ready flag carries no information there. Such a room hides the ready button entirely and
 * lets the host start straight away.
 */

/** A room with at most one human seat — the ready handshake is meaningless. */
export const isSoloHumanRoom = (members: readonly RoomMember[]): boolean =>
  members.filter((m) => !m.isBot).length <= 1;

/** Whether the host may start: a full table, with everyone ready unless it's a solo-human room. */
export const canStartRoom = (members: readonly RoomMember[]): boolean =>
  members.length >= 2 && (isSoloHumanRoom(members) || members.every((m) => m.ready));
