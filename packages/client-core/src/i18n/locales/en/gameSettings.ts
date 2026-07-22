import type { TranslationShape } from '../../shape';
import type zh from '../zh-Hant/gameSettings';

export default {
  gameSettings: 'Game settings',
  mapLabel: 'Map',
  mapOfficial: 'Official',
  mapCustom: 'Custom',
  settingUnlimitedStationBorrow: 'Unlimited station borrowing',
  settingUnlimitedStationBorrowDesc:
    'Each station may borrow every adjacent opponent route; tickets lock in and score the moment they connect.',
  settingSecondDrawAfterRainbow: 'Second draw after a blind rainbow',
  settingSecondDrawAfterRainbowDesc:
    'When off, drawing a rainbow (locomotive) as your first blind draw ends your draw.',
  settingNoUnfinishedPenalty: 'No penalty for unfinished tickets',
  settingNoUnfinishedPenaltyDesc:
    'When on, unfinished destination tickets score 0 instead of subtracting their value.',
  settingDoubleRouteSingleFor23: 'Single-track parallel routes for 2–3 players',
  settingDoubleRouteSingleFor23Desc:
    'When on, only one of each pair of parallel routes can be claimed in a 2–3 player game; turn off to allow both to be claimed.',
  settingRandomEvents: 'Random events',
  settingRandomEventsDesc: 'Typhoon-warning inspired events: closures, bonuses and surprises',
  settingSoloWaitForHost: 'Wait for me (solo room)',
  settingSoloWaitForHostDesc:
    'With only you and bots in the room, the game waits for you — no turn countdown, no auto-draw.',
  settingTeamMode: 'Team mode',
  settingTeamModeDesc:
    'Teammates share one network for tickets, score a single combined longest route, and see each other’s tickets. Hands stay secret — cards only move through the team pool.',
  teamModeOff: 'Free-for-all',
  teamMode2Teams: 'Two teams',
  teamMode3Teams: 'Three teams',
  teamLayoutPairs2: '4 players · pairs',
  teamLayoutPairs3: '6 players · pairs',
  teamLayoutTrios2: '6 players · trios',
  settingTeamAssignMode: 'Team assignment',
  settingTeamAssignModeDesc:
    'Choose how players get sorted into teams: random, host-assigned, or self-join.',
  teamAssignModeRandom: 'Random',
  teamAssignModeHost: 'Host assigns',
  teamAssignModeSelf: 'Players choose',
  teamSeatingTitle: 'Team line-up',
  shuffleTeams: 'Shuffle teams',
  teamJoinButton: 'Join',
  teamHintRandom: 'The host can shuffle everyone into new teams with the button below.',
  teamHintHost: 'Tap a player, then tap a team to move them there.',
  teamHintSelf: 'Tap Join under the team you want to play on.',
  teamNeedsPlayers: '{{teams}} teams need {{players}} players ({{seated}} seated)',
  allowSpectating: 'Allow spectating',
  roomVisibility: 'Room visibility',
  visibility_PUBLIC: 'Public',
  visibility_INVITE_ONLY: 'Invite only',
  waitingForPlayers: 'Waiting for players (need at least 2)…',
  waitingForReady: 'Waiting for everyone to be ready…',
} satisfies TranslationShape<typeof zh>;
