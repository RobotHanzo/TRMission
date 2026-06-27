import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

// zod is the single source for both validation (via ZodValidationPipe + these DTOs)
// and the OpenAPI body/response schemas (via apiSchema()).
const locale = z.enum(['zh-Hant', 'en']);
const theme = z.enum(['system', 'light', 'dark']);
const displayName = z.string().trim().min(1).max(24);
const password = z.string().min(8).max(200);
const email = z.email();

export const PreferencesSchema = z.object({ theme, colorBlind: z.boolean() });

export const GuestSchema = z.object({
  displayName: displayName.optional(),
  locale: locale.optional(),
});
export const RegisterSchema = z.object({ email, password, displayName, locale: locale.optional() });
export const UpgradeSchema = z.object({ email, password });
export const LoginSchema = z.object({ email, password });

export class GuestDto extends createZodDto(GuestSchema) {}
export class RegisterDto extends createZodDto(RegisterSchema) {}
export class UpgradeDto extends createZodDto(UpgradeSchema) {}
export class LoginDto extends createZodDto(LoginSchema) {}
export class UpdatePreferencesDto extends createZodDto(PreferencesSchema) {}

export const PublicUserSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  isGuest: z.boolean(),
  locale,
  preferences: PreferencesSchema,
  email: z.string().optional(),
});
export const AuthResultSchema = z.object({ user: PublicUserSchema, accessToken: z.string() });
export const AccessResultSchema = z.object({ accessToken: z.string() });
