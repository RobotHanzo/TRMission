// Random-events wire mapping, shared by `snapshot.ts` (RedactedView.events → GameSnapshot.random_events)
// and `events.ts` (the four EVENT_* engine events → their GameEvent oneof cases). All of this is
// PUBLIC information: `RedactedView.events` is already viewer-independent (spectators see the same
// block), and the engine's four random-event GameEvents are all `visibility: 'PUBLIC'`. The hidden
// schedule/nextIdx/suppressed never reach this module — it only ever sees what `redactFor` already
// decided is safe to project.
import { create } from '@bufbuild/protobuf';
import type {
  ActiveEvent,
  CharterContract as EngineCharterContract,
  RedactedView,
} from '@trm/engine';
import {
  CharterContractSchema,
  HotspotMarkerSchema,
  RandomEventInfoSchema,
  RandomEventsStateSchema,
  type CharterContract as PbCharterContract,
  type HotspotMarker as PbHotspotMarker,
  type RandomEventInfo as PbRandomEventInfo,
  type RandomEventsState as PbRandomEventsState,
} from '@trm/proto';

type EventsBlock = NonNullable<RedactedView['events']>;
type ForecastEntry = NonNullable<EventsBlock['forecast']>;

/** The last round an entry is active, given its start + duration. 0 when the duration is N/A
 * (instant, e.g. VIRAL_HOTSPOT) or the entry has not started yet (a forecast). */
function endsAfterRound(startRound: number, durationRounds: number): number {
  return durationRounds > 0 ? startRound + durationRounds - 1 : 0;
}

export function charterToPb(c: EngineCharterContract): PbCharterContract {
  return create(CharterContractSchema, {
    id: c.id,
    cityA: c.a as string,
    cityB: c.b as string,
    points: c.points,
    expiresAfterRound: c.expiresAfterRound,
    wonByPlayerId: (c.wonBy as string | null) ?? '',
  });
}

function hotspotToPb(h: { readonly cityId: string; readonly level: number }): PbHotspotMarker {
  return create(HotspotMarkerSchema, { cityId: h.cityId, level: h.level });
}

/** An ActiveEvent (already windowed/live) → RandomEventInfo. `start_round`/`duration_rounds` are
 * not tracked on ActiveEvent itself (only its resolved `ends_after_round` window is), so they're
 * left at the proto3 default (0); `charter` is never set here — CHARTER_SPECIAL never becomes an
 * ActiveEvent (it lives in `charters` instead, see events-state.ts). */
export function activeEventToInfo(a: ActiveEvent): PbRandomEventInfo {
  return create(RandomEventInfoSchema, {
    id: a.id,
    kind: a.kind,
    endsAfterRound: a.endsAfterRound,
    routeIds: (a.routeIds ?? []).map((r) => r as string),
    region: a.region ?? '',
  });
}

/** The one-round forecast entry → RandomEventInfo. `ends_after_round` is 0 (N/A — not started). */
export function forecastToInfo(f: ForecastEntry): PbRandomEventInfo {
  return create(RandomEventInfoSchema, {
    id: f.id,
    kind: f.kind,
    startRound: f.startRound,
    durationRounds: f.durationRounds,
    routeIds: (f.routeIds ?? []).map((r) => r as string),
    region: f.region ?? '',
    cityId: (f.cityId as string | undefined) ?? '',
  });
}

/** RedactedView.events → GameSnapshot.random_events (field-by-field; undefined when events are off). */
export function randomEventsToPb(events: EventsBlock): PbRandomEventsState {
  return create(RandomEventsStateSchema, {
    mode: events.mode,
    roundIndex: events.roundIndex,
    active: events.active.map(activeEventToInfo),
    forecast: events.forecast === null ? undefined : forecastToInfo(events.forecast),
    hotspots: events.hotspots.map((h) =>
      hotspotToPb({ cityId: h.cityId as string, level: h.level }),
    ),
    charters: events.charters.map(charterToPb),
    reopenBonusRouteIds: events.reopenBonusRouteIds.map((r) => r as string),
    closedRouteIds: events.closedRouteIds.map((r) => r as string),
    freeStationAvailable: events.freeStationAvailable,
  });
}

/** EVENT_ANNOUNCED's payload → RandomEventInfo. `ends_after_round` is 0 (forecast — not started). */
export function announcedToInfo(ev: {
  readonly id: string;
  readonly kind: string;
  readonly startRound: number;
  readonly durationRounds: number;
  readonly routeIds?: readonly string[];
  readonly region?: string;
  readonly cityId?: string;
}): PbRandomEventInfo {
  return create(RandomEventInfoSchema, {
    id: ev.id,
    kind: ev.kind,
    startRound: ev.startRound,
    durationRounds: ev.durationRounds,
    routeIds: (ev.routeIds ?? []).map((r) => r),
    region: ev.region ?? '',
    cityId: ev.cityId ?? '',
  });
}

/** EVENT_STARTED's payload → RandomEventInfo, including its resolved `ends_after_round` and the
 * charter sub-message when this is a CHARTER_SPECIAL start. */
export function startedToInfo(ev: {
  readonly id: string;
  readonly kind: string;
  readonly startRound: number;
  readonly durationRounds: number;
  readonly routeIds?: readonly string[];
  readonly region?: string;
  readonly cityId?: string;
  readonly charter?: { readonly a: string; readonly b: string; readonly points: number };
}): PbRandomEventInfo {
  return create(RandomEventInfoSchema, {
    id: ev.id,
    kind: ev.kind,
    startRound: ev.startRound,
    durationRounds: ev.durationRounds,
    endsAfterRound: endsAfterRound(ev.startRound, ev.durationRounds),
    routeIds: (ev.routeIds ?? []).map((r) => r),
    region: ev.region ?? '',
    cityId: ev.cityId ?? '',
    // The engine's EVENT_STARTED payload carries only {a, b, points} for a fresh charter — the
    // resolved contract (expiry round, and any immediate winner) is runtime-computed state that
    // rides separately (RandomEventsState.charters; an immediate win arrives as a same-tick
    // EVENT_BONUS). Recompute the expiry with the identical formula the engine uses
    // (`startRound + durationRounds - 1`) and leave `won_by_player_id` unset ("").
    charter: ev.charter
      ? create(CharterContractSchema, {
          id: ev.id,
          cityA: ev.charter.a,
          cityB: ev.charter.b,
          points: ev.charter.points,
          expiresAfterRound: endsAfterRound(ev.startRound, ev.durationRounds),
          wonByPlayerId: '',
        })
      : undefined,
  });
}
