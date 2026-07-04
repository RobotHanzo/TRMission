// Snapshot-driven derivations for the random-events feature. Everything here reads EXCLUSIVELY from
// `snapshot.random_events` (the `RandomEventsState` wire projection) — never from engine internals —
// so the board overlays, the events panel, and (critically) the client payment hints all agree with
// the server's authoritative validation. Mirrors of the engine effect predicates are called out.
import type { RandomEventInfo, RandomEventsState } from '@trm/proto';

/** Every random-event kind the wire can carry (the `kind` string on RandomEventInfo / frames). */
export const EVENT_KINDS = [
  'TYPHOON_LANDFALL',
  'TYPHOON_DAY_OFF',
  'VIRAL_HOTSPOT',
  'CHARTER_SPECIAL',
  'SKY_LANTERN',
  'AFTERSHOCK',
  'RAILWAY_GALA',
  'STAMP_RALLY',
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

const EMPTY_SET: ReadonlySet<string> = new Set<string>();

/** The i18n key for an event kind's display name (falls back to the raw kind for unknown ones). */
export const eventNameKey = (kind: string): string =>
  (EVENT_KINDS as readonly string[]).includes(kind) ? `events.${kind}.name` : kind;

/** The i18n key for an event kind's one-line description. */
export const eventDescKey = (kind: string): string => `events.${kind}.desc`;

/** Route ids currently closed by an active typhoon landfall (desaturated + typhoon glyph). */
export function closedRouteIds(ev: RandomEventsState | undefined): ReadonlySet<string> {
  if (!ev || ev.closedRouteIds.length === 0) return EMPTY_SET;
  return new Set(ev.closedRouteIds);
}

/** Route ids carrying a reopen (+2 first-claim) bonus. */
export function reopenBonusRouteIds(ev: RandomEventsState | undefined): ReadonlySet<string> {
  if (!ev || ev.reopenBonusRouteIds.length === 0) return EMPTY_SET;
  return new Set(ev.reopenBonusRouteIds);
}

/** Route ids under an active sky-lantern (points doubled + a +1-card surcharge to claim). */
export function skyLanternRouteIds(ev: RandomEventsState | undefined): ReadonlySet<string> {
  if (!ev) return EMPTY_SET;
  const out = new Set<string>();
  for (const a of ev.active) {
    if (a.kind === 'SKY_LANTERN') for (const r of a.routeIds) out.add(r);
  }
  return out;
}

/**
 * The +1-card sky-lantern surcharge for claiming `routeId` (0 or 1). Exact mirror of the engine's
 * `skyLanternSurcharge`: 1 when the route is listed by an active SKY_LANTERN, else 0.
 */
export function skyLanternSurcharge(
  ev: RandomEventsState | undefined,
  routeId: string,
): 0 | 1 {
  return skyLanternRouteIds(ev).has(routeId) ? 1 : 0;
}

/**
 * Whether the railway-gala zero-cost first-station window is open. Exact mirror of the engine's
 * `freeStationAvailable` gate — the ONLY condition under which an empty station payment is legal.
 */
export function freeStationAvailable(ev: RandomEventsState | undefined): boolean {
  return ev?.freeStationAvailable ?? false;
}

/** cityId → hotspot level (1 or 2), for the on-board hotspot badge. */
export function hotspotLevels(ev: RandomEventsState | undefined): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  if (!ev) return out;
  for (const h of ev.hotspots) out.set(h.cityId, h.level);
  return out;
}

/** Rounds an active entry has left, computed as `ends_after_round − round_index + 1`; null for
 *  instants / forecasts (`ends_after_round === 0`, so no window to count down). */
export function roundsLeft(info: RandomEventInfo, roundIndex: number): number | null {
  if (!info.endsAfterRound) return null;
  return info.endsAfterRound - roundIndex + 1;
}

/** Whether a charter is still open (nobody has completed it yet). */
export const isCharterOpen = (c: { wonByPlayerId: string }): boolean => c.wonByPlayerId === '';

// Rejection messageKeys the server sends for event-specific rejections (from the shared
// ERROR_CATALOG) → the nested i18n key the client resolves for a meaningful inline message.
const EVENT_ERROR_KEYS: Readonly<Record<string, string>> = {
  'errors:routeClosedByEvent': 'errors.routeClosedByEvent',
  'errors:eventClaimsSuspended': 'errors.eventClaimsSuspended',
  'errors:eventStationsSuspended': 'errors.eventStationsSuspended',
};

/** The `errors.*` i18n key for an event rejection messageKey, or null if it isn't one. */
export const eventRejectionHintKey = (messageKey: string): string | null =>
  EVENT_ERROR_KEYS[messageKey] ?? null;
