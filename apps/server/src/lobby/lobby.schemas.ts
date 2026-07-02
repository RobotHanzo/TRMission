import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

const botDifficulty = z.enum(['EASY', 'MEDIUM', 'HARD']);

export const CreateRoomSchema = z.object({ maxPlayers: z.number().int().min(2).max(5).optional() });
export const ReadySchema = z.object({ ready: z.boolean() });
export const AddBotSchema = z.object({ difficulty: botDifficulty });

export const MapSelectorSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('official'), mapId: z.string().min(1) }),
  z.object({ source: z.literal('custom'), customMapId: z.string().min(1) }),
]);

export const GameSettingsSchema = z.object({
  unlimitedStationBorrow: z.boolean(),
  secondDrawAfterBlindRainbow: z.boolean(),
  noUnfinishedTicketPenalty: z.boolean(),
  doubleRouteSingleFor23: z.boolean(),
  allowSpectating: z.boolean(),
  visibility: z.enum(['PUBLIC', 'INVITE_ONLY']),
  map: MapSelectorSchema,
});
export const UpdateSettingsSchema = GameSettingsSchema.partial();

export class CreateRoomDto extends createZodDto(CreateRoomSchema) {}
export class ReadyDto extends createZodDto(ReadySchema) {}
export class AddBotDto extends createZodDto(AddBotSchema) {}
export class UpdateSettingsDto extends createZodDto(UpdateSettingsSchema) {}

export const RoomMemberSchema = z.object({
  userId: z.string(),
  displayName: z.string(),
  isGuest: z.boolean(),
  seat: z.number(),
  ready: z.boolean(),
  isBot: z.boolean().optional(),
  difficulty: botDifficulty.optional(),
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
});
export const TicketResultSchema = z.object({ gameId: z.string(), ticket: z.string() });
