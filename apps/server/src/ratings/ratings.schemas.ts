import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const RATING_TEXT_MAX_LEN = 500;

export const SubmitRatingSchema = z.object({
  gameId: z.string().min(1),
  roomId: z.string().min(1),
  stars: z.number().int().min(1).max(5),
  text: z.string().trim().max(RATING_TEXT_MAX_LEN).optional(),
});
export class SubmitRatingDto extends createZodDto(SubmitRatingSchema) {}

export const RatingResultSchema = z.object({
  id: z.string(),
  stars: z.number(),
  text: z.string().optional(),
  createdAt: z.string(),
});
