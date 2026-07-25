import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * Device tokens are opaque platform identifiers, but they still have a well-known shape —
 * constraining them here keeps a hostile value (e.g. path-traversal segments) from ever being
 * stored, which matters because the token is later spliced verbatim into the outbound APNs
 * HTTP/2 `:path` (see `ApnsTransport.send` in `push.transports.ts`, which re-checks this same
 * shape as a second, defense-in-depth layer against any row written before this validation
 * existed).
 *
 * - iOS: an APNs device token is a fixed-length hex string (32 bytes / 64 hex chars on current
 *   APNs); a generous upper bound is kept for older/alternate token encodings.
 * - Android: an FCM registration token is base64url plus `:` (used as a separator in some legacy
 *   tokens) — never `/` or `.`, so this alone also rules out path traversal.
 */
const IOS_TOKEN_RE = /^[0-9a-fA-F]{64,200}$/;
const FCM_TOKEN_RE = /^[A-Za-z0-9_:-]{16,4096}$/;

export const RegisterDeviceSchema = z
  .object({
    platform: z.enum(['ios', 'android']),
    token: z.string().min(1).max(4096),
  })
  .superRefine((val, ctx) => {
    const re = val.platform === 'ios' ? IOS_TOKEN_RE : FCM_TOKEN_RE;
    if (!re.test(val.token)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['token'],
        message: `invalid ${val.platform} device token format`,
      });
    }
  });
export const RemoveDeviceSchema = z.object({ token: z.string().min(1).max(4096) });

export class RegisterDeviceDto extends createZodDto(RegisterDeviceSchema) {}
export class RemoveDeviceDto extends createZodDto(RemoveDeviceSchema) {}
