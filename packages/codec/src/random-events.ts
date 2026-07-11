// Random-events wire mapping, shared by `snapshot.ts` (RedactedView.events → GameSnapshot.random_events)
// and `events.ts` (the generic and expansion EVENT_* engine events → their GameEvent oneof cases).
// All of this is
// PUBLIC information: `RedactedView.events` is already viewer-independent (spectators see the same
// block), and the engine's random-event GameEvents are all `visibility: 'PUBLIC'`. The hidden
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
  CityPairSchema,
  LanternHostStateSchema,
  LanternRelocationStateSchema,
  LuckyContractSchema,
  EventDraftStateSchema,
  EventPerkPickSchema,
  HiveDrawStateSchema,
  type CharterContract as PbCharterContract,
  type HotspotMarker as PbHotspotMarker,
  type RandomEventInfo as PbRandomEventInfo,
  type RandomEventsState as PbRandomEventsState,
} from '@trm/proto';
import { cardToPb, eventPerkToPb } from './enums';

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
    cityId: (a.cityId as string | undefined) ?? '',
    cityPath: (a.cityPath ?? []).map((city) => city as string),
    position: a.position ?? 0,
    pair: a.pair
      ? create(CityPairSchema, { cityA: a.pair.a as string, cityB: a.pair.b as string })
      : undefined,
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
    cityPath: (f.cityPath ?? []).map((city) => city as string),
    pair: f.pair
      ? create(CityPairSchema, { cityA: f.pair.a as string, cityB: f.pair.b as string })
      : undefined,
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
    lanternHost: events.lanternHost
      ? create(LanternHostStateSchema, {
          eventId: events.lanternHost.eventId,
          cityId: events.lanternHost.cityId as string,
          points: events.lanternHost.points,
        })
      : undefined,
    lanternPendingRelocation: events.lanternPendingRelocation
      ? create(LanternRelocationStateSchema, {
          playerId: events.lanternPendingRelocation.playerId as string,
          candidateCityIds: events.lanternPendingRelocation.candidateCityIds.map(String),
        })
      : undefined,
    luckyContracts: events.luckyContracts.map((contract) =>
      create(LuckyContractSchema, {
        eventId: contract.id,
        cityA: contract.a as string,
        cityB: contract.b as string,
        points: contract.points,
        wonByPlayerId: (contract.wonBy as string | null) ?? '',
      }),
    ),
    repairedRouteIds: events.repairedRouteIds.map(String),
    eventDraft: events.eventDraft
      ? create(EventDraftStateSchema, {
          order: events.eventDraft.order.map(String),
          pickIndex: events.eventDraft.pickIndex,
          currentPlayerId:
            (events.eventDraft.order[events.eventDraft.pickIndex] as string | undefined) ?? '',
          availablePerks: [
            eventPerkToPb('CLAIM_DISCOUNT'),
            eventPerkToPb('DRAW_TWO'),
            eventPerkToPb('REPAIR_PERMIT'),
          ],
          picks: events.eventDraft.picks.map((pick) =>
            create(EventPerkPickSchema, {
              playerId: pick.playerId as string,
              perk: eventPerkToPb(pick.perk),
            }),
          ),
        })
      : undefined,
    pendingHiveDraw: events.pendingHiveDraw
      ? create(HiveDrawStateSchema, {
          playerId: events.pendingHiveDraw.playerId as string,
          revealed: events.pendingHiveDraw.revealed.map(cardToPb),
          maxDraws: events.pendingHiveDraw.maxDraws,
        })
      : undefined,
    boringActive: events.boringActive,
    nightMarketSwapAvailable: events.nightMarketSwapAvailable,
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
  readonly cityPath?: readonly string[];
  readonly pair?: { readonly a: string; readonly b: string };
}): PbRandomEventInfo {
  return create(RandomEventInfoSchema, {
    id: ev.id,
    kind: ev.kind,
    startRound: ev.startRound,
    durationRounds: ev.durationRounds,
    routeIds: (ev.routeIds ?? []).map((r) => r),
    region: ev.region ?? '',
    cityId: ev.cityId ?? '',
    cityPath: [...(ev.cityPath ?? [])],
    pair: ev.pair ? create(CityPairSchema, { cityA: ev.pair.a, cityB: ev.pair.b }) : undefined,
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
  readonly cityPath?: readonly string[];
  readonly pair?: { readonly a: string; readonly b: string };
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
    cityPath: [...(ev.cityPath ?? [])],
    pair: ev.pair ? create(CityPairSchema, { cityA: ev.pair.a, cityB: ev.pair.b }) : undefined,
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
