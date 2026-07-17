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
  'LANTERN_HOST_CITY',
  'BENTO_RUSH',
  'SLOPE_REPAIR_ORDER',
  'STATION_FRONT_NIGHT_MARKET',
  'GODDESS_PROCESSION',
  'SPRING_FESTIVAL_RUSH',
  'ROLLING_STOCK_ALLOCATION_DAY',
  'HIVE_OF_SPARKS',
  'BREAKTHROUGH_BORING_MACHINE',
  'INTERIM_OPERATIONS_REPORT',
  'HARVEST_FESTIVAL_EXPRESS',
  'ALL_SEATS_RESERVED',
  'LUCKY_TICKET_STUB',
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const hasActiveEvent = (ev: RandomEventsState | undefined, kind: EventKind): boolean =>
  ev?.active.some((active) => active.kind === kind) ?? false;

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
export function skyLanternSurcharge(ev: RandomEventsState | undefined, routeId: string): 0 | 1 {
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

/** Everything the board draws for the random-events mode, derived in one pass — the single
 *  source for the web Board's SVG overlays AND the mobile Skia overlays (they must agree). */
export interface BoardEventOverlays {
  closedRoutes: ReadonlySet<string>;
  reopenRoutes: ReadonlySet<string>;
  skyRoutes: ReadonlySet<string>;
  harvestRoutes: ReadonlySet<string>;
  /** cityId → hotspot level (1 or 2). */
  hotspots: ReadonlyMap<string, number>;
  charterCities: ReadonlySet<string>;
  /** cityId → the open charter pair it anchors (both endpoints map to the same pair). */
  charterPairs: ReadonlyMap<string, { a: string; b: string; pts: number }>;
  luckyCities: ReadonlySet<string>;
  /** cityId → the open lucky-ticket pair it anchors. */
  luckyPairs: ReadonlyMap<string, { a: string; b: string }>;
  /** One entry per OPEN lucky contract, for the dashed A–B link line. */
  luckyLinks: readonly { id: string; a: string; b: string }[];
  lanternCity: string | null;
  processionPath: readonly string[];
  /** The procession's current city (clamped to the path tail), or null when inactive. */
  processionCity: string | null;
  bentoCities: ReadonlySet<string>;
  nightMarketCities: ReadonlySet<string>;
}

const EMPTY_OVERLAYS: BoardEventOverlays = {
  closedRoutes: EMPTY_SET,
  reopenRoutes: EMPTY_SET,
  skyRoutes: EMPTY_SET,
  harvestRoutes: EMPTY_SET,
  hotspots: new Map(),
  charterCities: EMPTY_SET,
  charterPairs: new Map(),
  luckyCities: EMPTY_SET,
  luckyPairs: new Map(),
  luckyLinks: [],
  lanternCity: null,
  processionPath: [],
  processionCity: null,
  bentoCities: EMPTY_SET,
  nightMarketCities: EMPTY_SET,
};

/** Derive the full board-overlay projection from `snapshot.randomEvents` (undefined → all empty:
 *  events-off games, sandboxes, and replays before the feature render nothing). */
export function boardEventOverlays(ev: RandomEventsState | undefined): BoardEventOverlays {
  if (!ev) return EMPTY_OVERLAYS;

  const charterCities = new Set<string>();
  const charterPairs = new Map<string, { a: string; b: string; pts: number }>();
  for (const c of ev.charters)
    if (isCharterOpen(c)) {
      const info = { a: c.cityA, b: c.cityB, pts: c.points };
      charterCities.add(c.cityA).add(c.cityB);
      charterPairs.set(c.cityA, info);
      charterPairs.set(c.cityB, info);
    }

  const luckyCities = new Set<string>();
  const luckyPairs = new Map<string, { a: string; b: string }>();
  const luckyLinks: { id: string; a: string; b: string }[] = [];
  for (const contract of ev.luckyContracts)
    if (contract.wonByPlayerId === '') {
      const info = { a: contract.cityA, b: contract.cityB };
      luckyCities.add(contract.cityA).add(contract.cityB);
      luckyPairs.set(contract.cityA, info);
      luckyPairs.set(contract.cityB, info);
      luckyLinks.push({ id: contract.eventId, ...info });
    }

  const procession = ev.active.find((a) => a.kind === 'GODDESS_PROCESSION');
  const processionPath = procession?.cityPath ?? [];
  const processionCity =
    processionPath[Math.min(procession?.position ?? 0, Math.max(0, processionPath.length - 1))] ??
    null;

  const bentoCities = new Set<string>();
  const nightMarketCities = new Set<string>();
  const harvestRoutes = new Set<string>();
  for (const a of ev.active) {
    if (a.kind === 'BENTO_RUSH' && a.cityId) bentoCities.add(a.cityId);
    if (a.kind === 'STATION_FRONT_NIGHT_MARKET' && a.cityId) nightMarketCities.add(a.cityId);
    if (a.kind === 'HARVEST_FESTIVAL_EXPRESS') for (const r of a.routeIds) harvestRoutes.add(r);
  }

  return {
    closedRoutes: closedRouteIds(ev),
    reopenRoutes: reopenBonusRouteIds(ev),
    skyRoutes: skyLanternRouteIds(ev),
    harvestRoutes,
    hotspots: hotspotLevels(ev),
    charterCities,
    charterPairs,
    luckyCities,
    luckyPairs,
    luckyLinks,
    lanternCity: ev.lanternHost?.cityId ?? null,
    processionPath,
    processionCity,
    bentoCities,
    nightMarketCities,
  };
}

// Rejection messageKeys the server sends for event-specific rejections (from the shared
// ERROR_CATALOG) → the nested i18n key the client resolves for a meaningful inline message.
const EVENT_ERROR_KEYS: Readonly<Record<string, string>> = {
  'errors:routeClosedByEvent': 'errors.routeClosedByEvent',
  'errors:eventClaimsSuspended': 'errors.eventClaimsSuspended',
  'errors:eventStationsSuspended': 'errors.eventStationsSuspended',
  'errors:eventFaceupLocoBlocked': 'errors.eventFaceupLocoBlocked',
  'errors:eventRepairUnavailable': 'errors.eventRepairUnavailable',
  'errors:eventRepairPaymentInvalid': 'errors.eventRepairPaymentInvalid',
  'errors:eventNightMarketUnavailable': 'errors.eventNightMarketUnavailable',
  'errors:eventLanternRelocationInvalid': 'errors.eventLanternRelocationInvalid',
  'errors:eventDraftChoiceInvalid': 'errors.eventDraftChoiceInvalid',
  'errors:eventHiveUnavailable': 'errors.eventHiveUnavailable',
  'errors:eventResourceUnavailable': 'errors.eventResourceUnavailable',
  'errors:routeBroken': 'errors.routeBroken',
  'errors:routeRepairExclusive': 'errors.routeRepairExclusive',
};

/** The `errors.*` i18n key for an event rejection messageKey, or null if it isn't one. */
export const eventRejectionHintKey = (messageKey: string): string | null =>
  EVENT_ERROR_KEYS[messageKey] ?? null;
