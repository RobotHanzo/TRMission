import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { REPORT_CATEGORIES } from '@trm/shared';

// zod is the single source for validation + OpenAPI (apiSchema()), per the auth/maps modules.

export const BlockListSchema = z.object({ blockedUserIds: z.array(z.string()) });

export const ReportCategorySchema = z.enum(REPORT_CATEGORIES);

export const ReportPlayerSchema = z.object({
  userId: z.string().min(1).max(100),
  category: ReportCategorySchema,
  message: z.string().trim().max(1000).optional(),
  /** Optional context the client attaches (never trusted for authorization, display only). */
  gameId: z.string().max(100).optional(),
  roomCode: z.string().max(20).optional(),
});
export class ReportPlayerDto extends createZodDto(ReportPlayerSchema) {}

export const ReportMapSchema = z.object({
  shareCode: z.string().trim().min(1).max(20),
  category: ReportCategorySchema,
  message: z.string().trim().max(1000).optional(),
});
export class ReportMapDto extends createZodDto(ReportMapSchema) {}

export const ReportCreatedSchema = z.object({ id: z.string() });
