import type { TranslationShape } from '../../shape';
import type zh from '../zh-Hant/room';

export default {
  host: 'Host',
  ready: 'Ready',
  notReady: 'Not ready',
  markReady: "I'm ready",
  cancelReady: 'Cancel ready',
  start: 'Start game',
  leave: 'Leave room',

  botTag: 'BOT',
  addBot: 'Add bot',
  removeBot: 'Remove bot',

  makeOwner: 'Make owner',
  kickPlayer: 'Remove player',
  kickedTitle: "You've been removed",
  kickedBody: 'The host removed you from this room.',
  kickedAck: 'Back to home',

  spectatorsHeading: 'Spectators',
  watch: 'Watch',
  becomePlayer: 'Join as player',
  spectateDisabledOnlyMember: "You're the only one here — can't spectate",
  becomePlayerDisabledFull: 'Room is full — cannot join as a player',
  fullRoomSpectateNotice: 'Room is full — you joined as a spectator.',

  ownerLeaveTitle: 'Leave room',
  ownerLeaveBody:
    "You're the room owner. Transfer ownership to another player before leaving, or close the whole room.",
  selectNewOwner: 'Choose a new owner',
  transferAndLeave: 'Transfer & leave',
  closeRoom: 'Close room',
  closeRoomConfirmTitle: 'Close room?',
  closeRoomConfirmBody: 'This removes everyone and closes the room. Are you sure?',
  transferConfirmTitle: 'Make new owner?',
  transferConfirmBody: 'You will lose host controls. Transfer ownership to this player?',

  publicRooms: 'Public rooms',
  noPublicRooms: 'No public rooms right now',
} satisfies TranslationShape<typeof zh>;
