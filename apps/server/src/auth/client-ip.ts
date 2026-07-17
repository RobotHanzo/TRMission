import type { Request } from 'express';

/**
 * Best-effort client IP for the moderation/audit trail (e.g. `lastLoginIp`). Production sits
 * behind Cloudflare, which terminates the real client connection at its edge and always sets
 * `CF-Connecting-IP` to the true visitor address — overwriting any client-supplied header of the
 * same name, so it can't be spoofed by a request that actually transits Cloudflare. That header is
 * checked first; `req.ip`/the raw socket address is only a fallback for direct (non-CF) traffic,
 * e.g. local dev.
 */
export const clientIp = (req: Request): string | undefined => {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf) return cf;
  return req.ip ?? req.socket.remoteAddress ?? undefined;
};
