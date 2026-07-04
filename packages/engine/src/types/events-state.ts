import type { RouteId, CityId, PlayerId, EventsMode } from '@trm/shared';

/**
 * Random-events state model (feature is OFF when `GameState.events` is absent).
 *
 * A seeded {@link EventScheduleEntry} list is drawn once at genesis (see `events/schedule.ts`) and
 * plays out at round boundaries (see `events/runtime.ts`). The schedule itself is HIDDEN information
 * — only a one-round "forecast" of the next telegraphed entry and the currently-live effects are
 * ever projected to a viewer (see `redactFor`). M1 lands the skeleton (schedule, round ticking,
 * redaction) only; the rule EFFECTS (route closures, claim surcharges, bonuses) arrive in M2/M3.
 */
export type RandomEventKind =
  | 'TYPHOON_LANDFALL'
  | 'TYPHOON_DAY_OFF'
  | 'VIRAL_HOTSPOT'
  | 'CHARTER_SPECIAL'
  | 'SKY_LANTERN'
  | 'AFTERSHOCK'
  | 'RAILWAY_GALA'
  | 'STAMP_RALLY';

/** A single scheduled event. Part of the HIDDEN schedule — never projected wholesale. */
export interface EventScheduleEntry {
  readonly id: string; // 'ev1', 'ev2', … in schedule order
  readonly kind: RandomEventKind;
  readonly startRound: number;
  readonly durationRounds: number; // 0 = instant/permanent (VIRAL_HOTSPOT)
  readonly telegraphed: boolean; // true: TYPHOON_*, SKY_LANTERN, AFTERSHOCK
  readonly routeIds?: readonly RouteId[]; // typhoon picks / sky-lantern resolved region routes
  readonly region?: string;
  readonly cityId?: CityId; // hotspot
  readonly charter?: { readonly a: CityId; readonly b: CityId; readonly points: number };
}

/** A currently-live windowed event (public — surfaced to every viewer). */
export interface ActiveEvent {
  readonly id: string;
  readonly kind: RandomEventKind;
  readonly endsAfterRound: number; // last round it is active
  readonly routeIds?: readonly RouteId[];
  readonly region?: string;
}

/** An open (or already-won) charter mission, live until its expiry round. */
export interface CharterContract {
  readonly id: string;
  readonly a: CityId;
  readonly b: CityId;
  readonly points: number;
  readonly expiresAfterRound: number;
  readonly wonBy: PlayerId | null;
}

/** Runtime state for the random-events feature; present on `GameState.events` only when ON. */
export interface EventsState {
  readonly mode: Exclude<EventsMode, 'off'>;
  readonly roundIndex: number; // 1 when play begins; +1 per orderIndex wrap in endTurn
  readonly nextIdx: number; // next unprocessed schedule entry
  readonly schedule: readonly EventScheduleEntry[]; // HIDDEN info — never projected wholesale
  readonly suppressed: readonly string[]; // entry ids skipped by quiet-endgame
  readonly active: readonly ActiveEvent[];
  readonly hotspots: Readonly<Record<string, number>>; // cityId → 1|2, permanent
  readonly charters: readonly CharterContract[]; // open + won, until expiry
  readonly reopenBonus: readonly RouteId[]; // typhoon routes carrying +2 first-claim
  readonly freeStation?: { readonly untilRound: number };
}
