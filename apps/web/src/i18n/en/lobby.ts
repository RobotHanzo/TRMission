import type { TranslationShape } from '@trm/client-core/i18n/shape';
import type zh from '../zh-Hant/lobby';

export default {
  createRoom: 'Create room',
  joinRoom: 'Join room',
  roomCode: 'Room code',
  enterRoomCode: 'Enter room code',
  mapCreateOne: 'Create a custom map',
  mapOfficialSection: 'Official maps',
  mapMineSection: 'My maps',
  mapSize: '{{cities}} stops · {{routes}} routes',
  room: 'Room',
  guest: 'Guest',
  players: 'Players',
  seat: 'Seat',
} satisfies TranslationShape<typeof zh>;
