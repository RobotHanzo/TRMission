// Client-side analytics. GA4 is loaded by Cloudflare Zaraz at the edge, so events are sent through
// `zaraz.track` (which fans out to the GA4 Managed Component). This module is the ONLY analytics
// egress; its typed event map is the leak guard — params are safe primitives, never game secrets.
import type { View } from '../store/ui';

/** Every event name → its exact, safe param shape. Do NOT widen a value to carry game state/PII. */
export interface AnalyticsEvents {
  // auth
  login: { method: 'guest' | 'password' | 'google' | 'oauth' };
  sign_up: { method: 'password' };
  guest_upgrade: Record<string, never>;
  logout: Record<string, never>;
  // navigation
  page_view: { screen: string; page_path: string; page_title: string };
  // lobby
  room_create: Record<string, never>;
  room_join: { via: 'code' | 'public_list' | 'rejoin' };
  spectate_start: Record<string, never>;
  practice_start: Record<string, never>;
  bot_add: { difficulty: 'EASY' | 'MEDIUM' | 'HARD' | 'HELL' };
  room_leave: Record<string, never>;
  game_start: {
    player_count: number;
    human_count: number;
    bot_count: number;
    map_source: 'official' | 'custom';
    map_id?: string;
    events_mode: string;
    is_spectator: boolean;
    is_practice?: boolean;
  };
  // in-game (LIVE only)
  game_first_action: { action: string };
  game_complete: {
    won: boolean;
    final_score: number;
    player_count: number;
    bot_count: number;
    duration_sec?: number;
    tickets_completed?: number;
    longest_path: boolean;
    is_spectator: boolean;
    map_id?: string;
  };
  route_claimed: { length: number; is_tunnel: boolean; is_ferry: boolean; map_id?: string };
  chat_send: { kind: 'text' | 'preset'; context: 'lobby' | 'game' };
  reconnect: Record<string, never>;
  session_replaced: Record<string, never>;
  // end-of-game
  rating_submit: { stars: number };
  rematch_vote: { wants: boolean };
  play_again: Record<string, never>;
  discord_click: { source: 'welcome' | 'endgame' | 'header' };
  // onboarding
  tutorial_begin: { scope: 'full' | 'core' };
  tutorial_complete: Record<string, never>;
  welcome_shown: Record<string, never>;
  encyclopedia_open: Record<string, never>;
  // replay
  replay_open: { source: 'history' | 'link' };
  replay_share_change: { visibility: 'private' | 'link' };
  // builder
  map_create: Record<string, never>;
  map_fork: { map_id: string };
  map_clone: Record<string, never>;
  map_share_mint: { map_id: string };
  map_testplay: { map_id: string };
  map_delete: Record<string, never>;
  // settings
  settings_change: {
    setting: 'locale' | 'theme' | 'board_layout' | 'colorblind' | 'sound';
    value: string;
  };
  room_settings_change: { setting: string };
}

export type AnalyticsEventName = keyof AnalyticsEvents;

interface ZarazLike {
  track?: (name: string, params?: Record<string, unknown>) => void;
}
type GtagLike = (command: 'event', name: string, params?: Record<string, unknown>) => void;

function sink(): { zaraz?: ZarazLike; gtag?: GtagLike } {
  if (typeof window === 'undefined') return {};
  return window as unknown as { zaraz?: ZarazLike; gtag?: GtagLike };
}

export function track<K extends AnalyticsEventName>(name: K, params: AnalyticsEvents[K]): void {
  const p = params as Record<string, unknown>;
  if (import.meta.env.DEV) console.debug('[analytics]', name, p);
  const { zaraz, gtag } = sink();
  if (zaraz?.track) zaraz.track(name, p);
  else if (gtag) gtag('event', name, p);
}

/** Screen → route template. Room codes / game ids are intentionally NOT interpolated, so page paths
 *  stay low-cardinality; those ids ride on domain events (`game_start`, `replay_open`) instead. */
const SCREEN_TO_PATH: Record<View, string> = {
  home: '/',
  room: '/room/:code',
  game: '/room/:code',
  tutorial: '/tutorial',
  login: '/login',
  loginCallback: '/login/callback',
  history: '/history',
  replay: '/replay/:gameId',
  adminReplay: '/admin-replay/:gameId',
  adminSpectate: '/admin-spectate/:gameId',
  maps: '/maps',
  mapEditor: '/maps/:id/edit',
  deleteAccount: '/account/delete',
  privacy: '/privacy',
};

export function trackPageView(screen: View): void {
  track('page_view', {
    screen,
    page_path: SCREEN_TO_PATH[screen] ?? '/',
    page_title: typeof document === 'undefined' ? '' : document.title,
  });
}
