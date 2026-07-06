import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

// zod is the single source for both validation (via ZodValidationPipe + these DTOs)
// and the OpenAPI body/response schemas (via apiSchema()).
const locale = z.enum(['zh-Hant', 'en']);
const theme = z.enum(['system', 'light', 'dark']);
const boardLayout = z.enum(['rail', 'tray']);
const displayName = z.string().trim().min(1).max(24);
const password = z.string().min(8).max(200);
const email = z.email();

export const PreferencesSchema = z.object({
  theme,
  colorBlind: z.boolean(),
  locale,
  boardLayout,
});

export const GuestSchema = z.object({
  displayName: displayName.optional(),
  locale: locale.optional(),
});
export const RegisterSchema = z.object({ email, password, displayName, locale: locale.optional() });
export const UpgradeSchema = z.object({ email, password });
export const LoginSchema = z.object({ email, password });
export const GoogleCredentialSchema = z.object({
  credential: z.string().min(1),
  /** Mobile only: the app's refresh token, so a signed-in guest upgrades in place. */
  refreshToken: z.string().min(1).optional(),
});
export const RefreshSchema = z.object({ refreshToken: z.string().min(1).optional() });
export const LogoutSchema = z.object({ refreshToken: z.string().min(1).optional() });
export const MobileExchangeSchema = z.object({ code: z.string().min(1) });
export const AppleCredentialSchema = z.object({
  identityToken: z.string().min(1),
  /** Apple surfaces the user's name ONCE, client-side, on first authorization — pass it through. */
  fullName: z.string().trim().max(48).optional(),
  /** Mobile only: the app's refresh token, so a signed-in guest upgrades in place. */
  refreshToken: z.string().min(1).optional(),
});

export class GuestDto extends createZodDto(GuestSchema) {}
export class RegisterDto extends createZodDto(RegisterSchema) {}
export class UpgradeDto extends createZodDto(UpgradeSchema) {}
export class LoginDto extends createZodDto(LoginSchema) {}
export class GoogleCredentialDto extends createZodDto(GoogleCredentialSchema) {}
export class UpdatePreferencesDto extends createZodDto(PreferencesSchema) {}
// Web sends these with NO body at all (no Content-Type ⇒ req.body is undefined), so the
// DTO defaults to {} — otherwise the zod pipe would 400 every cookie-based refresh/logout.
export class RefreshDto extends createZodDto(RefreshSchema.default({})) {}
export class LogoutDto extends createZodDto(LogoutSchema.default({})) {}
export class MobileExchangeDto extends createZodDto(MobileExchangeSchema) {}
export class AppleCredentialDto extends createZodDto(AppleCredentialSchema) {}

export const PublicUserSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  isGuest: z.boolean(),
  preferences: PreferencesSchema,
  email: z.string().optional(),
  avatarUrl: z.string().optional(),
});
export const AuthResultSchema = z.object({
  user: PublicUserSchema,
  accessToken: z.string(),
  refreshToken: z.string().optional(), // present iff the client sent x-trm-client: mobile
});
export const AccessResultSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string().optional(), // present iff the refresh token arrived in the body
});
export const MobileCarryResultSchema = z.object({ code: z.string() });
export const MobileAuthResultSchema = z.object({
  user: PublicUserSchema,
  accessToken: z.string(),
  refreshToken: z.string(),
});

// Tells the web which entry methods are available so it renders only those (the server still
// enforces each one independently). `providers` flags whether each OAuth provider is configured.
export const AuthConfigSchema = z.object({
  passwordLogin: z.boolean(),
  guest: z.boolean(),
  providers: z.object({ google: z.boolean(), discord: z.boolean(), apple: z.boolean() }),
  googleClientId: z.string().optional(),
});
