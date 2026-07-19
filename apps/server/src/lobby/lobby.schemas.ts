import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { CHAT_PRESET_IDS } from '@trm/shared';
import { ROOM_CHAT_MAX_LEN } from './room.repo';

const botDifficulty = z.enum(['EASY', 'MEDIUM', 'HARD', 'HELL']);

export const CreateRoomSchema = z.object({ maxPlayers: z.number().int().min(2).max(5).optional() });
export const ReadySchema = z.object({ ready: z.boolean() });
export const AddBotSchema = z.object({ difficulty: botDifficulty });
export const RematchVoteSchema = z.object({ wantsRematch: z.boolean() });
export const EndVoteSchema = z.object({ wantsEnd: z.boolean() });
export const ChatSchema = z.object({
  presetId: z.enum(CHAT_PRESET_IDS).optional(),
  text: z.string().max(ROOM_CHAT_MAX_LEN).optional(),
});

export const MapSelectorSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('official'), mapId: z.string().min(1) }),
  z.object({ source: z.literal('custom'), customMapId: z.string().min(1) }),
]);

export const GameSettingsSchema = z.object({
  unlimitedStationBorrow: z.boolean(),
  secondDrawAfterBlindRainbow: z.boolean(),
  noUnfinishedTicketPenalty: z.boolean(),
  doubleRouteSingleFor23: z.boolean(),
  eventsMode: z.enum(['off', 'light', 'moderate', 'intense']),
  allowSpectating: z.boolean(),
  visibility: z.enum(['PUBLIC', 'INVITE_ONLY']),
  map: MapSelectorSchema,
  /** Solo rooms (host + bots only): wait for the host instead of running the per-turn timer.
   *  Only honoured at start when exactly one human is seated — a multi-human room keeps its
   *  timer regardless of the stored value. */
  soloWaitForHost: z.boolean(),
});
export const UpdateSettingsSchema = GameSettingsSchema.partial();

export class CreateRoomDto extends createZodDto(CreateRoomSchema) {}
export class ReadyDto extends createZodDto(ReadySchema) {}
export class AddBotDto extends createZodDto(AddBotSchema) {}
export class UpdateSettingsDto extends createZodDto(UpdateSettingsSchema) {}
export class RematchVoteDto extends createZodDto(RematchVoteSchema) {}
export class EndVoteDto extends createZodDto(EndVoteSchema) {}
export class ChatDto extends createZodDto(ChatSchema) {}

export const RoomMemberSchema = z.object({
  userId: z.string(),
  displayName: z.string(),
  isGuest: z.boolean(),
  seat: z.number(),
  ready: z.boolean(),
  isBot: z.boolean().optional(),
  difficulty: botDifficulty.optional(),
  wantsRematch: z.boolean().optional(),
  wantsEnd: z.boolean().optional(),
});
export const RoomChatEntrySchema = z.object({
  userId: z.string(),
  ts: z.number(),
  presetId: z.string().optional(),
  text: z.string().optional(),
});
export const RoomSpectatorSchema = z.object({
  userId: z.string(),
  displayName: z.string(),
  isGuest: z.boolean(),
});
export const RoomViewSchema = z.object({
  code: z.string(),
  hostId: z.string(),
  status: z.enum(['LOBBY', 'STARTED', 'CLOSED']),
  maxPlayers: z.number(),
  members: z.array(RoomMemberSchema),
  spectators: z.array(RoomSpectatorSchema),
  settings: GameSettingsSchema,
  gameId: z.string().optional(),
  /** Resolved display name for settings.map, when known (e.g. an official map). */
  mapName: z.object({ zh: z.string(), en: z.string() }).optional(),
  /** Capped, preset-only chat for the lobby (empty for a game already in progress). */
  chat: z.array(RoomChatEntrySchema),
});
export const TicketResultSchema = z.object({ gameId: z.string(), ticket: z.string() });
export const PracticeResultSchema = TicketResultSchema.extend({ code: z.string() });
