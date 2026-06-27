import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const CreateRoomSchema = z.object({ maxPlayers: z.number().int().min(2).max(5).optional() });
export const ReadySchema = z.object({ ready: z.boolean() });

export class CreateRoomDto extends createZodDto(CreateRoomSchema) {}
export class ReadyDto extends createZodDto(ReadySchema) {}

export const RoomMemberSchema = z.object({
  userId: z.string(),
  displayName: z.string(),
  isGuest: z.boolean(),
  seat: z.number(),
  ready: z.boolean(),
});
export const RoomViewSchema = z.object({
  code: z.string(),
  hostId: z.string(),
  status: z.enum(['LOBBY', 'STARTED', 'CLOSED']),
  maxPlayers: z.number(),
  members: z.array(RoomMemberSchema),
  gameId: z.string().optional(),
});
export const TicketResultSchema = z.object({ gameId: z.string(), ticket: z.string() });
