import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const SubmitRatingSchema = z.object({
  gameId: z.string().min(1),
  roomId: z.string().min(1),
  stars: z.number().int().min(1).max(5),
});
export class SubmitRatingDto extends createZodDto(SubmitRatingSchema) {}

export const RatingResultSchema = z.object({
  id: z.string(),
  stars: z.number(),
  createdAt: z.string(),
});
