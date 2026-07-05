import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { CHAT_PRESET_IDS } from '@trm/shared';

const botDifficulty = z.enum(['EASY', 'MEDIUM', 'HARD']);

export const CreateRoomSchema = z.object({ maxPlayers: z.number().int().min(2).max(5).optional() });
export const ReadySchema = z.object({ ready: z.boolean() });
export const AddBotSchema = z.object({ difficulty: botDifficulty });
export const RematchVoteSchema = z.object({ wantsRematch: z.boolean() });
export const ChatSchema = z.object({ presetId: z.enum(CHAT_PRESET_IDS) });

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
});
export const UpdateSettingsSchema = GameSettingsSchema.partial();

export class CreateRoomDto extends createZodDto(CreateRoomSchema) {}
export class ReadyDto extends createZodDto(ReadySchema) {}
export class AddBotDto extends createZodDto(AddBotSchema) {}
export class UpdateSettingsDto extends createZodDto(UpdateSettingsSchema) {}
export class RematchVoteDto extends createZodDto(RematchVoteSchema) {}
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
});
export const RoomChatEntrySchema = z.object({
  userId: z.string(),
  presetId: z.string(),
  ts: z.number(),
});
export const RoomViewSchema = z.object({
  code: z.string(),
  hostId: z.string(),
  status: z.enum(['LOBBY', 'STARTED', 'CLOSED']),
  maxPlayers: z.number(),
  members: z.array(RoomMemberSchema),
  settings: GameSettingsSchema,
  gameId: z.string().optional(),
  /** Resolved display name for settings.map, when known (e.g. an official map). */
  mapName: z.object({ zh: z.string(), en: z.string() }).optional(),
  /** Capped, preset-only chat for the lobby (empty for a game already in progress). */
  chat: z.array(RoomChatEntrySchema),
});
export const TicketResultSchema = z.object({ gameId: z.string(), ticket: z.string() });
