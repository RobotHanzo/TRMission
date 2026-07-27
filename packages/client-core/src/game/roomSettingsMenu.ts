// The lobby's game settings, as a LAYERED menu (issue #64): an index that names each group and
// states what it is currently set to, plus one page per group holding the controls. Same shape as
// the mobile app's Settings tab — and for the same reason: the index has to answer "what is this
// table set to?" on its own, or the extra layer costs the reader the answer they came for.
//
// This module owns the part both clients must agree on — which groups exist, in what order, which
// rules live in which group, and how each group's current value reads. Rendering stays native
// (DOM rows on web, RN rows on mobile).
import { layoutsForPlayerCount, TEAM_LAYOUTS } from '@trm/shared';
import type { RoomSettings } from '../net/restTypes';

/** Translator the caller binds to its own namespace — web passes `t`, mobile `(k, p) => t(\`room.${k}\`, p)`. */
export type TranslateSetting = (key: string, params?: Record<string, string | number>) => string;

export type RoomSettingsGroupId = 'map' | 'rules' | 'events' | 'teams' | 'access';

/** One line on the settings board: name ── dashed leader ── current value ›. */
export interface RoomSettingsGroup {
  id: RoomSettingsGroupId;
  title: string;
  /** What the group is set to right now. Never empty — that is the index's whole job. */
  value: string;
  /** Set when the current choice would block Start (today: a team count this table can't seat). */
  warning?: string;
}

/** A boolean house rule and its three voices: the full label, the explanation on the page, and
 *  the short form the index strings together. */
export interface HouseRuleSpec {
  key: keyof Pick<
    RoomSettings,
    | 'unlimitedStationBorrow'
    | 'secondDrawAfterBlindRainbow'
    | 'noUnfinishedTicketPenalty'
    | 'doubleRouteSingleFor23'
    | 'soloWaitForHost'
  >;
  labelKey: string;
  descKey: string;
  shortKey: string;
}

/** The four rules every room has. Order is the order they render, on both clients. */
export const HOUSE_RULES: readonly HouseRuleSpec[] = [
  {
    key: 'unlimitedStationBorrow',
    labelKey: 'settingUnlimitedStationBorrow',
    descKey: 'settingUnlimitedStationBorrowDesc',
    shortKey: 'ruleShortStationBorrow',
  },
  {
    key: 'secondDrawAfterBlindRainbow',
    labelKey: 'settingSecondDrawAfterRainbow',
    descKey: 'settingSecondDrawAfterRainbowDesc',
    shortKey: 'ruleShortSecondDraw',
  },
  {
    key: 'noUnfinishedTicketPenalty',
    labelKey: 'settingNoUnfinishedPenalty',
    descKey: 'settingNoUnfinishedPenaltyDesc',
    shortKey: 'ruleShortNoPenalty',
  },
  {
    key: 'doubleRouteSingleFor23',
    labelKey: 'settingDoubleRouteSingleFor23',
    descKey: 'settingDoubleRouteSingleFor23Desc',
    shortKey: 'ruleShortSingleParallel',
  },
];

/** The fifth rule, shown only while the host is the lone human at the table (the started game then
 *  waits for them instead of running the per-turn timer). */
export const SOLO_WAIT_RULE: HouseRuleSpec = {
  key: 'soloWaitForHost',
  labelKey: 'settingSoloWaitForHost',
  descKey: 'settingSoloWaitForHostDesc',
  shortKey: 'ruleShortSoloWait',
};

export interface RoomSettingsMenuInput {
  settings: RoomSettings;
  /** The selected map's display name — the caller resolves it (it needs the locale and, for a
   *  custom map, the viewer's own map list). */
  mapName: string;
  /** Whether the random-events group is on the board at all (feature-gated for the host). */
  showEvents: boolean;
  /** Whether the solo "wait for me" rule applies — exactly one human is seated. */
  showSoloWait: boolean;
  /** Seated players, for the team-layout warning. */
  seatedCount: number;
}

/** Whether the seated head-count can actually form `teamCount` teams (4p→2, 6p→2 or 3). */
export function teamLayoutFits(teamCount: number, seatedCount: number): boolean {
  if (teamCount === 0) return true;
  return layoutsForPlayerCount(seatedCount).some((l) => l.teamCount === teamCount);
}

/** The "N teams need M players" line, or undefined while the line-up is startable. The server
 *  re-checks this at start; surfacing it early stops the host from discovering an impossible
 *  line-up only when they press Start. */
export function teamLayoutWarning(
  teamCount: number,
  seatedCount: number,
  t: TranslateSetting,
): string | undefined {
  if (teamLayoutFits(teamCount, seatedCount)) return undefined;
  return t('teamNeedsPlayers', {
    teams: teamCount,
    players: TEAM_LAYOUTS.filter((l) => l.teamCount === teamCount)
      .map((l) => l.playerCount)
      .join(' / '),
    seated: seatedCount,
  });
}

/** The rules currently in force, in board order, as their short labels. */
export function activeHouseRules(
  settings: RoomSettings,
  showSoloWait: boolean,
  t: TranslateSetting,
): string[] {
  const specs = showSoloWait ? [...HOUSE_RULES, SOLO_WAIT_RULE] : HOUSE_RULES;
  return specs.filter((r) => settings[r.key]).map((r) => t(r.shortKey));
}

/** The settings board, top to bottom. */
export function roomSettingsGroups(
  input: RoomSettingsMenuInput,
  t: TranslateSetting,
): RoomSettingsGroup[] {
  const { settings, mapName, showEvents, showSoloWait, seatedCount } = input;
  const teamCount = settings.teamCount ?? 0;

  const rules = activeHouseRules(settings, showSoloWait, t);
  const ASSIGN_KEYS = {
    random: 'teamAssignModeRandom',
    host: 'teamAssignModeHost',
    self: 'teamAssignModeSelf',
  } as const;
  // In team mode the assignment method is the second thing anyone wants to know ("do I pick my
  // own team?"), so the index states both.
  const teamValue =
    teamCount === 0
      ? t('teamModeOff')
      : `${t(teamCount === 3 ? 'teamMode3Teams' : 'teamMode2Teams')} · ${t(
          ASSIGN_KEYS[settings.teamAssignMode],
        )}`;

  const groups: RoomSettingsGroup[] = [
    { id: 'map', title: t('mapLabel'), value: mapName },
    {
      id: 'rules',
      title: t('houseRulesGroup'),
      value: rules.length > 0 ? rules.join(' · ') : t('houseRulesAllOff'),
    },
  ];
  if (showEvents) {
    groups.push({
      id: 'events',
      title: t('settingRandomEvents'),
      value: t(`eventsMode_${settings.eventsMode}`),
    });
  }
  const warning = teamLayoutWarning(teamCount, seatedCount, t);
  groups.push({
    id: 'teams',
    title: t('settingTeamMode'),
    value: teamValue,
    ...(warning != null ? { warning } : {}),
  });
  groups.push({
    id: 'access',
    title: t('roomAccessGroup'),
    value: `${t(`visibility_${settings.visibility}`)} · ${t(
      settings.allowSpectating ? 'spectatingOn' : 'spectatingOff',
    )}`,
  });
  return groups;
}
