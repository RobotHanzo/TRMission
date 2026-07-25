/** True if the string contains any C0 control char or DEL (CR/LF/TAB included). */
const hasControlChar = (s: string): boolean => {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
};

/**
 * Constrain a reflected navigation target to a same-origin path so it can't be turned into an
 * open redirect (post-login redirect, or the OG page's meta-refresh / og:url / canonical sinks).
 * The value is already URL-decoded by the query parser; we deliberately do NOT decode again
 * (double-decoding is a classic bypass). Anything non-conforming falls back to '/'.
 *
 * Rejects (→ '/'): non-strings and values over 512 chars; anything not starting with a single '/'
 * ('//host' scheme-relative URLs are out); any '\' or '://' (the WHATWG URL parser treats '\' as
 * '/' for special schemes, so '/\host' resolves cross-origin); and any C0 control char or DEL —
 * CR/LF/TAB included, which the parser strips before parsing (e.g. '/%09//host' → '///host').
 */
export const safeRedirect = (p: unknown): string => {
  // `p` is `string | undefined` by type, but a raw @Query param can arrive as an array/object
  // (e.g. ?redirect=/a&redirect=/b) — guard the type before any string method runs.
  if (typeof p !== 'string' || p.length > 512) return '/';
  if (!p.startsWith('/') || p.startsWith('//')) return '/';
  if (p.includes('\\') || p.includes('://')) return '/';
  if (hasControlChar(p)) return '/'; // reject CR/LF & control chars (header-injection guard)
  return p;
};
