// Wire types for the control-plane REST API — the single source of truth for BOTH clients
// (the union of what the server actually sends; apps/web and apps/mobile previously kept
// drifting copies). Pure types only; the client factory lives in ./rest.
import type { EventsMode, ReportCategory, UserFeature } from '@trm/shared';
import type { TicketView } from '@trm/map-data';

export type Theme = 'system' | 'light' | 'dark';
export type Locale = 'zh-Hant' | 'en';
export type BoardLayout = 'rail' | 'tray';
export interface UserPreferences {
  theme: Theme;
  colorBlind: boolean;
  locale: Locale;
  boardLayout: BoardLayout;
}
export interface PublicUser {
  id: string;
  displayName: string;
  isGuest: boolean;
  preferences: UserPreferences;
  /** Per-account gated features granted from the maintainer dashboard. */
  features: UserFeature[];
  /** Whether this account has reached the guided tutorial's finale. */
  tutorialCompleted: boolean;
  email?: string;
  avatarUrl?: string;
}
export interface AuthResult {
  user: PublicUser;
  accessToken: string;
  /** Present iff the client sent `x-trm-client: mobile` — persisted to the OS keystore. */
  refreshToken?: string;
}
/** Which sign-in methods the server has enabled — drives what the login screen renders. */
export interface AuthConfig {
  passwordLogin: boolean;
  guest: boolean;
  providers: { google: boolean; discord: boolean; apple: boolean };
  googleClientId?: string;
}
export type OauthProvider = 'google' | 'discord';
export type BotDifficulty = 'EASY' | 'MEDIUM' | 'HARD';

export interface RoomMember {
  userId: string;
  displayName: string;
  isGuest: boolean;
  seat: number;
  ready: boolean;
  isBot?: boolean;
  difficulty?: BotDifficulty;
  wantsRematch?: boolean;
}
export interface RoomSpectator {
  userId: string;
  displayName: string;
  isGuest: boolean;
}
export type RoomVisibility = 'PUBLIC' | 'INVITE_ONLY';
export type MapSelector =
  | { source: 'official'; mapId: string }
  | { source: 'custom'; customMapId: string };
export interface RoomSettings {
  unlimitedStationBorrow: boolean;
  secondDrawAfterBlindRainbow: boolean;
  noUnfinishedTicketPenalty: boolean;
  doubleRouteSingleFor23: boolean;
  allowSpectating: boolean;
  visibility: RoomVisibility;
  map: MapSelector;
  eventsMode: EventsMode;
}
export interface RoomChatEntry {
  userId: string;
  ts: number;
  presetId?: string;
  text?: string;
}
export interface RoomView {
  code: string;
  hostId: string;
  status: 'LOBBY' | 'STARTED' | 'CLOSED';
  maxPlayers: number;
  members: RoomMember[];
  spectators: RoomSpectator[];
  settings: RoomSettings;
  gameId?: string;
  mapName?: { zh: string; en: string };
  chat: RoomChatEntry[];
}
export interface TicketResult {
  gameId: string;
  ticket: string;
}
export interface PracticeResult extends TicketResult {
  code: string;
}
export interface MobileCarryResult {
  code: string;
}
export interface RatingResult {
  id: string;
  stars: number;
  createdAt: string;
}
export interface HistoryPlayer {
  userId: string;
  seat: number;
  displayName?: string;
}
export interface MatchSummary {
  gameId: string;
  players: HistoryPlayer[];
  winners: string[];
  completedAt: string;
  role: 'player' | 'spectator';
  finalScores: unknown;
  replayable: boolean;
}
export interface ReplayPlayerMeta extends HistoryPlayer {
  isBot?: boolean;
  difficulty?: BotDifficulty;
}
/** Who may fetch a replay: participants only, or anyone holding the link. */
export type ReplayVisibility = 'private' | 'link';
/** actions stay `unknown[]` here so an eager bundle never imports @trm/engine types;
 *  the lazy replay feature narrows them to engine `Action[]`. */
export interface ReplayPayload {
  gameId: string;
  config: {
    seed: string | number;
    players: { id: string; seat: number }[];
    contentHash: string;
    ruleParams?: Record<string, unknown>;
    shuffleTurnOrder?: boolean;
  };
  engineVersion: number;
  schemaVersion: number;
  actions: unknown[];
  players: ReplayPlayerMeta[];
  winners: string[];
  completedAt: string;
  finalDigest?: string;
  visibility: ReplayVisibility;
  /** True when the signed-in viewer is a seated player of this game. */
  canConfigureVisibility: boolean;
}
/** The ticket-authorized maintainer replay payload — no normal auth involved, the ticket minted
 *  by the dashboard is the sole authority. Covers COMPLETED and TERMINATED games alike. */
export interface AdminReplayPayload {
  gameId: string;
  config: ReplayPayload['config'];
  engineVersion: number;
  schemaVersion: number;
  actions: unknown[];
  status: 'COMPLETED' | 'TERMINATED';
  players: ReplayPlayerMeta[];
  winners?: string[];
  completedAt?: string;
  terminatedAt?: string;
  terminatedBy?: string;
  terminatedReason?: string;
  finalDigest?: string;
}

/** Roster (ids/seats/names/bot flags) for the ticket-authorized maintainer live-spectate route —
 *  no normal auth involved, the ticket minted by the dashboard is the sole authority. The live
 *  game state itself streams over the WebSocket using this same ticket. */
export interface AdminSpectatePayload {
  players: ReplayPlayerMeta[];
}

// --- custom maps (builder + shared/cloned + published content by hash) ---
export interface CityDraft {
  id: string;
  nameZh: string;
  nameEn: string;
  x: number;
  y: number;
  region: string;
  isIsland: boolean;
  tier?: string;
}
export interface RouteDraft {
  id: string;
  a: string;
  b: string;
  color: string;
  length: number;
  doubleGroup?: string;
  ferryLocos: number;
  isTunnel: boolean;
  /** Signed curve-apex deviation override (board units); absent = automatic bow. */
  bow?: number;
}
export interface TicketDraft {
  id: string;
  a: string;
  b: string;
  value: number;
  deck: 'LONG' | 'SHORT';
  /** Per-ticket displayed-area override for the mission mini-map; absent ⇒ inherit the map default. */
  view?: TicketView;
}
export interface MapGeographyDraft {
  baseView: { x: number; y: number; w: number; h: number };
  land: readonly (readonly (readonly [number, number])[])[];
  crop: { lonMin: number; lonMax: number; latMin: number; latMax: number };
  /** Map-wide default displayed area for tickets that set no `view`. */
  defaultTicketView?: TicketView;
}
export interface MapRulesDraft {
  trainCarsStart?: number;
  stationsPerPlayer?: number;
  longestPathBonus?: number;
  stationBonus?: number;
  initialLongOffer?: number;
  initialShortOffer?: number;
  ticketDrawCount?: number;
}
export interface MapDraft {
  cities: CityDraft[];
  routes: RouteDraft[];
  tickets: TicketDraft[];
  auspiciousPairs?: { id: string; a: string; b: string }[];
  geography?: MapGeographyDraft;
  rules?: MapRulesDraft;
}
export interface MapSummary {
  id: string;
  nameZh: string;
  nameEn: string;
  revision: number;
  shareCode?: string;
  updatedAt: string;
}
export interface MapDetail extends MapSummary {
  ownerId: string;
  draft: MapDraft;
}
export interface OfficialMapSummary {
  mapId: string;
  nameZh: string;
  nameEn: string;
  cities: number;
  routes: number;
}
export interface SharedMapView {
  nameZh: string;
  nameEn: string;
  draft: MapDraft;
}
export interface MapContentDto {
  meta: { mapId: string; version: number; nameZh: string; nameEn: string };
  cities: CityDraft[];
  routes: RouteDraft[];
  tickets: TicketDraft[];
  auspiciousPairs?: { id: string; a: string; b: string }[];
  geography?: MapGeographyDraft;
  rules?: MapRulesDraft;
}

// UGC compliance (Apple 1.2 / Play UGC): the client-side mute list + abuse reports.
export interface BlockList {
  blockedUserIds: string[];
}
export type { ReportCategory };
