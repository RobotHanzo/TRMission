import type { Request } from 'express';
import { isIP } from 'node:net';

/**
 * Best-effort client IP for the moderation/audit trail (e.g. `lastLoginIp`). Production sits
 * behind Cloudflare, which terminates the real client connection at its edge and always sets
 * `CF-Connecting-IP` to the true visitor address — overwriting any client-supplied header of the
 * same name, so it can't be spoofed by a request that actually transits Cloudflare. That header is
 * checked first; `req.ip`/the raw socket address is only a fallback for direct (non-CF) traffic,
 * e.g. local dev.
 *
 * A request that reaches the origin WITHOUT transiting Cloudflare can set `cf-connecting-ip` to
 * anything it likes, so the header is only trusted when it is a syntactically well-formed
 * IPv4/IPv6 literal (`net.isIP`) — arbitrary text, an oversized string, or an IP with trailing
 * junk is rejected rather than persisted verbatim as audit/attribution data.
 */
export const clientIp = (req: Request): string | undefined => {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && isIP(cf) !== 0) return cf;
  return req.ip ?? req.socket.remoteAddress ?? undefined;
};
