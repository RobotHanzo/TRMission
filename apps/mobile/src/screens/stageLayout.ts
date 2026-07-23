// The GameStage's pure layout decisions: which adaptive tier a window width lands in, and the
// bottom-dock tab list (ports the web GameStage's dock semantics — the events tab exists only
// when the game actually carries a random-events block).
//
// `log` and `comms` are deliberately separate tabs: the action log is just a projection of events
// that already happened, so it's available in every game (live or offline/tutorial sandbox); chat
// is a live-multiplayer feature only. The `comms` tab is filtered out by the sandbox flag at the
// call site (GameStage.tsx) — `log` never is.

export type StageTier = 'compact' | 'two-pane' | 'three-pane';

/** `< 700dp` phones dock; `700–999` adds the rail pane; `≥ 1000` adds the comms column. */
export const stageTier = (widthDp: number): StageTier =>
  widthDp < 700 ? 'compact' : widthDp < 1000 ? 'two-pane' : 'three-pane';

export type DockTabKey = 'hand' | 'draw' | 'missions' | 'events' | 'players' | 'log' | 'comms';

export interface DockTab {
  key: DockTabKey;
  /** i18n key for the tab label. */
  labelKey: string;
  /** Which live count the tab badge shows (null = no badge). */
  countSource: 'hand' | 'missions' | null;
}

/** The phone dock's tabs, in web order; `events` only when the game has random events. */
export function dockTabs(hasEvents: boolean): DockTab[] {
  return [
    { key: 'hand', labelKey: 'cards', countSource: 'hand' },
    { key: 'draw', labelKey: 'dockDraw', countSource: null },
    { key: 'missions', labelKey: 'tickets', countSource: 'missions' },
    ...(hasEvents ? [{ key: 'events', labelKey: 'dockEvents', countSource: null } as const] : []),
    { key: 'players', labelKey: 'dockPlayers', countSource: null },
    { key: 'log', labelKey: 'log.heading', countSource: null },
    { key: 'comms', labelKey: 'chat.heading', countSource: null },
  ];
}
