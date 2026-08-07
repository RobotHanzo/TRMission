import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { SUPPORT_CATEGORIES } from '@trm/shared';

export const SUPPORT_SUBJECT_MAX_LEN = 120;
export const SUPPORT_MESSAGE_MAX_LEN = 2000;
/** Long enough to be actionable, short enough that "hi" doesn't reach a maintainer. */
export const SUPPORT_MESSAGE_MIN_LEN = 10;

// zod is the single source for validation + the OpenAPI body/response schemas (apiSchema()).
export const SubmitSupportSchema = z.object({
  category: z.enum(SUPPORT_CATEGORIES),
  subject: z.string().trim().min(1).max(SUPPORT_SUBJECT_MAX_LEN),
  message: z.string().trim().min(SUPPORT_MESSAGE_MIN_LEN).max(SUPPORT_MESSAGE_MAX_LEN),
  /** Reply address. Optional — a guest may not have one, and the form still has to accept them
   *  — but the page says plainly that we cannot answer without it. */
  email: z.email().max(254).optional(),
  /** Who to address the reply to when the sender is anonymous (a signed-in sender's account
   *  name is used instead, and is the one the maintainer should trust). */
  name: z.string().trim().max(80).optional(),
  /** Client-declared context (`web 2026.7.1`, `ios 1.4.0`) — display-only, never an
   *  authorization input and never trusted for anything. */
  platform: z.string().trim().max(40).optional(),
  appVersion: z.string().trim().max(40).optional(),
});
export class SubmitSupportDto extends createZodDto(SubmitSupportSchema) {}

export const SupportResultSchema = z.object({ delivered: z.boolean() });

export const SupportConfigSchema = z.object({ formEnabled: z.boolean() });
