/**
 * The single scrubbing choke point for anything shipped to an error/monitoring backend (Sentry —
 * issue #44), shared by the server, both web apps, and mobile so the denylist cannot drift between
 * them.
 *
 * This game is hidden-information, so a leak here is an anti-cheat problem and not merely a privacy
 * one: a maintainer reading a crash report — or watching a Session Replay — of a LIVE opponent's
 * session must not be able to see that seat's hand, kept tickets, the draw deck order, or the RNG
 * seed that predicts every future draw. `redactFor` guards the wire; this guards telemetry, which is
 * the other way state leaves the process.
 *
 * It is deliberately NARROW. A scrubber that eats everything produces reports nobody can act on:
 * the account behind an error, the address a mail send failed for, the IP a burst of rejections
 * came from are all things a maintainer needs, and they are our own users' data held under our own
 * privacy policy. Only three families are withheld — game secrets, credentials, and the
 * advertising/tracking identifiers the app stores' policies govern. See `SENSITIVE_KEY`.
 *
 * Deliberately dependency-free (no Sentry import): it is typed against a structural event shape so
 * `@trm/shared` stays consumable by the engine-adjacent packages.
 */

export const TELEMETRY_REDACTED = '[trm:redacted]';

/** Depth/size caps — an event that walks a whole `GameState` would be useless anyway, and the
 *  walker must terminate on adversarial or cyclic input. */
const MAX_DEPTH = 8;
const MAX_ARRAY = 50;
const MAX_KEYS = 100;
const MAX_STRING = 4096;

/**
 * Key names whose VALUE never leaves the process. Matched case-insensitively against the whole key,
 * so `hand` also covers `playerHand`/`hands` via the alternation below rather than by substring
 * (which would swallow innocent keys like `handler` or `deckId`).
 *
 * Three families, and nothing beyond them:
 *  - **Game secrets** — every `GameState`/`SelfView` field that `redactFor` exists to withhold.
 *    Add a new secret field there ⇒ add its key name here.
 *  - **Credentials** — anything that would let the reader act as somebody else (or push to
 *    somebody else's device).
 *  - **Store-policy identifiers** — the advertising/tracking ids Apple's ATT and Play's Data
 *    Safety rules govern. They are never needed to debug, and the only place one may legitimately
 *    travel is the consented ad SDK itself.
 *
 * Ordinary identifiers are deliberately NOT here: `email`, `userId`, `displayName`, IP address.
 * They are what makes a report actionable — "which account hit this, from where" — and they are
 * our own users' data, disclosed by our own privacy policy and covered by the stores' declarations.
 * Do not re-add them to buy a feeling of safety; it costs every future investigation.
 */
const SENSITIVE_KEY =
  /^(?:.*_)?(?:(?:player|self|opponent|team|my|your)?hands?|keptTickets?|pendingTicketOffer|ticketDeck(?:Long|Short)?|ticketDiscard|deck|drawPile|discard(?:Pile)?|rng|rngState|seed|selfView|you|gameState|secretState|token|tokens|accessToken|refreshToken|idToken|deviceToken|pushToken|jwt|ticket|credential|credentials|authorization|auth|cookie|cookies|setCookie|password|passwordHash|secret|clientSecret|privateKey|apiKey|dsn|idfa|idfv|advertisingId|advertisingIdentifier|adId|gaid|appSetId)$/i;

/** Query-string parameters stripped from any URL that reaches telemetry — OAuth/ws-game
 *  credentials only. A `?redirect=` or `?email=` stays: both are what the request was about. */
const SENSITIVE_QUERY =
  /^(?:ticket|token|access_token|id_token|refresh_token|code|state|nonce|key|secret|password)$/i;

/** Free-text patterns worth redacting wherever they appear — an exception message or a breadcrumb
 *  can carry a CREDENTIAL the key-name pass never sees (e.g. `failed to verify eyJhbGci…`).
 *  Credentials only: "no account for a@b.com" is the useful half of that message, not the risk. */
const TEXT_PATTERNS: readonly RegExp[] = [
  // JSON Web Tokens (ws-game tickets, access tokens, OAuth id_tokens).
  /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\b/g,
  // `Bearer <opaque>` / `Basic <base64>` authorization values.
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
];

export function isSensitiveTelemetryKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

/** Redact credential/PII patterns inside a free-text string and cap its length. */
export function scrubTelemetryText(text: string): string {
  let out = text;
  for (const pattern of TEXT_PATTERNS) out = out.replace(pattern, TELEMETRY_REDACTED);
  return out.length > MAX_STRING ? `${out.slice(0, MAX_STRING)}…[truncated]` : out;
}

/** Strip sensitive query parameters; leaves the origin + path intact (a room code or game id in a
 *  path is already public to whoever holds the link, and it is what makes a report actionable). */
export function scrubTelemetryUrl(url: string): string {
  const [base = '', query] = splitQuery(url);
  const cleanBase = scrubTelemetryText(base);
  if (query === undefined) return cleanBase;
  const params = query
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq < 0) return pair;
      const name = pair.slice(0, eq);
      return SENSITIVE_QUERY.test(decodeURIComponent(name))
        ? `${name}=${TELEMETRY_REDACTED}`
        : scrubTelemetryText(pair);
    })
    .join('&');
  return `${cleanBase}?${params}`;
}

/** Split on the FIRST `?` only — a fragment or a nested URL keeps whatever follows. */
function splitQuery(url: string): [string, string?] {
  const q = url.indexOf('?');
  return q < 0 ? [url] : [url.slice(0, q), url.slice(q + 1)];
}

/**
 * Deep-scrub an arbitrary JSON-ish value: sensitive keys lose their value entirely, strings are
 * pattern-scrubbed, and the walk is bounded in depth, breadth, and cycles. Returns new containers —
 * the caller's object is never mutated.
 */
export function scrubTelemetryValue(value: unknown): unknown {
  return walk(value, 0, new WeakSet<object>());
}

function walk(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return scrubTelemetryText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return `${value.toString()}n`;
  if (typeof value === 'function' || typeof value === 'symbol') return `[${typeof value}]`;
  if (typeof value !== 'object') return String(value);

  const obj = value as object;
  if (seen.has(obj)) return '[circular]';
  if (depth >= MAX_DEPTH) return '[trm:depth-capped]';
  seen.add(obj);
  try {
    if (Array.isArray(value)) {
      const head = value.slice(0, MAX_ARRAY).map((item) => walk(item, depth + 1, seen));
      if (value.length > MAX_ARRAY) head.push(`…${value.length - MAX_ARRAY} more`);
      return head;
    }
    // Anything that isn't a plain object (Error, Date, Map, a class instance) is stringified the
    // way the backend's own normalizer would, so no exotic getter can smuggle state through.
    if (!isPlainObject(value)) return scrubTelemetryText(describe(value));

    const out: Record<string, unknown> = {};
    let kept = 0;
    for (const [key, entry] of Object.entries(value)) {
      if (kept >= MAX_KEYS) {
        out['…'] = '[trm:keys-capped]';
        break;
      }
      kept += 1;
      out[key] = isSensitiveTelemetryKey(key) ? TELEMETRY_REDACTED : walk(entry, depth + 1, seen);
    }
    return out;
  } finally {
    seen.delete(obj);
  }
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
}

function describe(value: object): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (value instanceof Date) return value.toISOString();
  try {
    return String(value);
  } catch {
    return '[unserializable]';
  }
}

// ── Structural Sentry event shape ────────────────────────────────────────────────────────────────
// Only the fields we touch, and deliberately WIDER than Sentry's own `ErrorEvent`/`TransactionEvent`
// so both are assignable to it. Declared here so this module needs no @sentry/* dependency and can
// be applied identically from every surface's `beforeSend` — including React Native's, whose SDK
// ships its own copies of these types.

export interface TelemetryBreadcrumbLike {
  message?: string | undefined;
  data?: unknown;
}

export interface TelemetryEventLike {
  message?: unknown;
  request?: { url?: string; query_string?: unknown; headers?: unknown; data?: unknown } | undefined;
  exception?: { values?: { value?: string | undefined }[] | undefined } | undefined;
  breadcrumbs?: TelemetryBreadcrumbLike[] | undefined;
  extra?: unknown;
  contexts?: unknown;
  tags?: unknown;
  user?: unknown;
}

/**
 * The `beforeSend` / `beforeSendTransaction` body every surface shares. Mutates the event in place
 * (Sentry hands us the object it is about to serialize) and returns the SAME reference, so a caller
 * can write `beforeSend: (event) => scrubTelemetryEvent(event)` and keep the SDK's own event type.
 */
export function scrubTelemetryEvent<T extends TelemetryEventLike>(event: T): T {
  // Mutate through the structural view: `T[K]` is opaque to the compiler inside a generic, and the
  // scrubbed values are `unknown` by construction.
  const e: TelemetryEventLike = event;

  if (typeof e.message === 'string') e.message = scrubTelemetryText(e.message);
  else if (e.message !== undefined) e.message = scrubTelemetryValue(e.message);

  for (const value of e.exception?.values ?? []) {
    if (typeof value.value === 'string') value.value = scrubTelemetryText(value.value);
  }

  const request = e.request;
  if (request) {
    if (typeof request.url === 'string') request.url = scrubTelemetryUrl(request.url);
    if (request.query_string !== undefined) {
      request.query_string =
        typeof request.query_string === 'string'
          ? scrubTelemetryUrl(`?${request.query_string}`).slice(1)
          : scrubTelemetryValue(request.query_string);
    }
    if (request.headers !== undefined) request.headers = scrubTelemetryValue(request.headers);
    if (request.data !== undefined) request.data = scrubTelemetryValue(request.data);
  }

  for (const crumb of e.breadcrumbs ?? []) scrubTelemetryBreadcrumb(crumb);

  if (e.extra !== undefined) e.extra = scrubTelemetryValue(e.extra);
  if (e.contexts !== undefined) e.contexts = scrubTelemetryValue(e.contexts);
  if (e.tags !== undefined) e.tags = scrubTelemetryValue(e.tags);
  if (e.user !== undefined) e.user = scrubTelemetryValue(e.user);
  return event;
}

/** The `beforeBreadcrumb` body: same denylist, applied one crumb at a time. */
export function scrubTelemetryBreadcrumb<T extends TelemetryBreadcrumbLike>(crumb: T): T {
  const c: TelemetryBreadcrumbLike = crumb;
  if (typeof c.message === 'string') c.message = scrubTelemetryText(c.message);
  if (c.data !== undefined) c.data = scrubTelemetryValue(c.data);
  return crumb;
}

/**
 * Sample-rate parser shared by every surface: an unset/blank/garbage value falls back to
 * `fallback`, and anything out of `[0, 1]` is clamped rather than silently disabling sampling.
 */
export function telemetrySampleRate(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1, Math.max(0, parsed));
}
