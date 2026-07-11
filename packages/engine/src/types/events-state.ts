import type { RouteId, CityId, PlayerId, EventsMode, CardColor } from '@trm/shared';
import type { EventPerk } from './actions';

export type RandomEventKind =
  | 'TYPHOON_LANDFALL'
  | 'TYPHOON_DAY_OFF'
  | 'VIRAL_HOTSPOT'
  | 'CHARTER_SPECIAL'
  | 'SKY_LANTERN'
  | 'AFTERSHOCK'
  | 'RAILWAY_GALA'
  | 'STAMP_RALLY'
  | 'LANTERN_HOST_CITY'
  | 'BENTO_RUSH'
  | 'SLOPE_REPAIR_ORDER'
  | 'STATION_FRONT_NIGHT_MARKET'
  | 'GODDESS_PROCESSION'
  | 'SPRING_FESTIVAL_RUSH'
  | 'ROLLING_STOCK_ALLOCATION_DAY'
  | 'HIVE_OF_SPARKS'
  | 'BREAKTHROUGH_BORING_MACHINE'
  | 'INTERIM_OPERATIONS_REPORT'
  | 'HARVEST_FESTIVAL_EXPRESS'
  | 'ALL_SEATS_RESERVED'
  | 'LUCKY_TICKET_STUB';

export interface CityPair {
  readonly a: CityId;
  readonly b: CityId;
}

/** A single seeded schedule entry. The full list is hidden from every projection. */
export interface EventScheduleEntry {
  readonly id: string;
  readonly kind: RandomEventKind;
  readonly startRound: number;
  readonly durationRounds: number;
  readonly telegraphed: boolean;
  readonly routeIds?: readonly RouteId[];
  readonly region?: string;
  readonly cityId?: CityId;
  readonly charter?: { readonly a: CityId; readonly b: CityId; readonly points: number };
  readonly cityPath?: readonly CityId[];
  readonly pair?: CityPair;
  /** Seeded selector resolved against the live deck size when the boring machine starts. */
  readonly markerSelector?: number;
}

/** A currently-live, round-windowed event. */
export interface ActiveEvent {
  readonly id: string;
  readonly kind: RandomEventKind;
  readonly endsAfterRound: number;
  readonly routeIds?: readonly RouteId[];
  readonly region?: string;
  readonly cityId?: CityId;
  readonly cityPath?: readonly CityId[];
  readonly position?: number;
  readonly pair?: CityPair;
}

export interface CharterContract {
  readonly id: string;
  readonly a: CityId;
  readonly b: CityId;
  readonly points: number;
  readonly expiresAfterRound: number;
  readonly wonBy: PlayerId | null;
}

export interface LuckyContract {
  readonly id: string;
  readonly a: CityId;
  readonly b: CityId;
  readonly points: number;
  readonly wonBy: PlayerId | null;
}

export interface EventResources {
  readonly bentoTokens: number;
  readonly blessings: number;
  readonly claimDiscounts: number;
  readonly repairPermits: number;
}

export interface LanternHostState {
  readonly eventId: string;
  readonly cityId: CityId;
  readonly points: number;
}

export interface LanternRelocationState {
  readonly playerId: PlayerId;
  readonly candidateCityIds: readonly CityId[];
}

export interface EventDraftState {
  readonly eventId: string;
  readonly order: readonly PlayerId[];
  readonly pickIndex: number;
  readonly resumeOrderIndex: number;
  readonly picks: readonly { readonly playerId: PlayerId; readonly perk: EventPerk }[];
}

export interface PendingHiveDraw {
  readonly playerId: PlayerId;
  readonly revealed: readonly CardColor[];
  readonly maxDraws: number;
}

export interface BoringMachineState {
  readonly eventId: string;
  /** Number of real card draws remaining before the hidden marker surfaces. */
  readonly remainingDraws: number;
}

export interface EventsState {
  readonly mode: Exclude<EventsMode, 'off'>;
  readonly roundIndex: number;
  readonly nextIdx: number;
  readonly schedule: readonly EventScheduleEntry[];
  readonly suppressed: readonly string[];
  readonly active: readonly ActiveEvent[];
  readonly hotspots: Readonly<Record<string, number>>;
  readonly charters: readonly CharterContract[];
  readonly luckyContracts: readonly LuckyContract[];
  readonly reopenBonus: readonly RouteId[];
  readonly repairedRouteIds: readonly RouteId[];
  readonly resources: Readonly<Record<string, EventResources>>;
  readonly freeStation?: { readonly untilRound: number };
  readonly lanternHost?: LanternHostState;
  readonly lanternPendingRelocation?: LanternRelocationState;
  readonly eventDraft?: EventDraftState;
  readonly pendingHiveDraw?: PendingHiveDraw;
  readonly boringMachine?: BoringMachineState;
}
