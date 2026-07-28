// New-offline-game setup: pick a map, bot count, team mode, and difficulty, then replace into
// the game.
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { OFFICIAL_MAPS } from '@trm/map-data';
import { officialMapOptions } from '@trm/client-core/game/officialMaps';
import { BOT_DIFFICULTIES, type BotDifficulty } from '@trm/bots';
import { TEAM_LAYOUTS, layoutsForPlayerCount } from '@trm/shared';
import type { EventsMode, TeamLayoutId } from '@trm/shared';
import type { RootStackParamList } from '../navigation';
import { useGlassHeaderPad } from '../hooks/useGlassHeaderPad';
import { useHasFeature } from '../store/session';
import { useTheme, type ChromeTokens } from '../theme/useTheme';

type Props = NativeStackScreenProps<RootStackParamList, 'OfflineSetup'>;

const BOT_COUNTS = [1, 2, 3, 4, 5] as const;
type BotCount = (typeof BOT_COUNTS)[number];
const EVENTS_MODES = [
  'off',
  'light',
  'moderate',
  'intense',
] as const satisfies readonly EventsMode[];

/** Every team mode the rules define, free-for-all first — offered unconditionally, because here
 *  the head-count is the player's own bot count and picking a mode simply moves it (see
 *  {@link botsForTeams}). Offering only what the CURRENT count can form left the default 2-bot
 *  table with a lone free-for-all chip, which read as "offline games don't do teams" (#41). */
const TEAM_COUNTS: readonly number[] = [0, ...new Set(TEAM_LAYOUTS.map((l) => l.teamCount))];

/** The smallest bot count whose table (you on seat 0 + bots) can form `teamCount` teams. */
const botsForTeams = (teamCount: number): BotCount | undefined =>
  BOT_COUNTS.find((n) => layoutsForPlayerCount(n + 1).some((l) => l.teamCount === teamCount));

const TEAM_LAYOUT_LABEL: Record<TeamLayoutId, string> = {
  PAIRS_2: 'room.teamLayoutPairs2',
  PAIRS_3: 'room.teamLayoutPairs3',
  TRIOS_2: 'room.teamLayoutTrios2',
};

function Choice({
  label,
  selected,
  onPress,
  tokens,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  tokens: ChromeTokens;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.choice,
        { borderColor: selected ? tokens.blue : tokens.line },
        selected && { backgroundColor: `${tokens.blue}22` },
      ]}
    >
      <Text style={[styles.choiceText, { color: selected ? tokens.blue : tokens.ink }]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function OfflineSetupScreen({ navigation }: Props) {
  const { t, i18n } = useTranslation();
  const { tokens } = useTheme();
  const headerPad = useGlassHeaderPad();
  const zh = i18n.language.startsWith('zh');
  const canConfigureEvents = useHasFeature('randomEvents');
  const [mapId, setMapId] = useState(OFFICIAL_MAPS[0]!.mapId);
  const [botCount, setBotCount] = useState<BotCount>(2);
  const [difficulty, setDifficulty] = useState<BotDifficulty>('MEDIUM');
  // Mirrors DEFAULT_ROOM_SETTINGS.eventsMode; clamped to 'off' at start time if the feature was
  // revoked meanwhile (same "silent downgrade" LobbyService.start applies online).
  const [eventsMode, setEventsMode] = useState<EventsMode>('moderate');
  const [teamCount, setTeamCount] = useState(0);

  /** The layout the current selection actually plays as — named under the picker so "two teams"
   *  on a 6-player table reads as trios rather than silently changing meaning. */
  const layout = TEAM_LAYOUTS.find(
    (l) => l.teamCount === teamCount && l.playerCount === botCount + 1,
  );

  /** Picking a mode the current table can't form moves the bot count to the smallest table that
   *  can, rather than leaving an impossible selection standing (the inverse of the bot-count
   *  handler below, which drops back to free-for-all). */
  const chooseTeamCount = (n: number): void => {
    setTeamCount(n);
    if (n > 0 && !layoutsForPlayerCount(botCount + 1).some((l) => l.teamCount === n)) {
      const fit = botsForTeams(n);
      if (fit) setBotCount(fit);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.root}>
      {/* Reserves room under the floating iOS Liquid Glass header (navigation.tsx); 0 on Android. */}
      {headerPad > 0 && <View style={{ height: headerPad }} />}

      <Text style={[styles.label, { color: tokens.inkSoft }]}>{t('offline.map')}</Text>
      <View style={styles.row}>
        {/* Offline play bundles every official map (no server switch applies without a server);
            the shared options carry a community map's author credit in the label, and a map meant
            for team mode says so next to it. */}
        {officialMapOptions(null, zh ? 'zh-Hant' : 'en').map((m) => (
          <Choice
            key={m.mapId}
            label={
              m.recommendedTeamMode ? `${m.label} · ${t('offline.mapTeamRecommended')}` : m.label
            }
            selected={mapId === m.mapId}
            onPress={() => setMapId(m.mapId)}
            tokens={tokens}
          />
        ))}
      </View>

      <Text style={[styles.label, { color: tokens.inkSoft }]}>{t('offline.botCount')}</Text>
      <View style={styles.row}>
        {BOT_COUNTS.map((n) => (
          <Choice
            key={n}
            label={String(n)}
            selected={botCount === n}
            onPress={() => {
              setBotCount(n);
              // A layout that no longer divides the table would be refused at start, so drop back
              // to free-for-all rather than leaving an impossible selection standing.
              if (
                teamCount > 0 &&
                !layoutsForPlayerCount(n + 1).some((l) => l.teamCount === teamCount)
              )
                setTeamCount(0);
            }}
            tokens={tokens}
          />
        ))}
      </View>

      <Text style={[styles.label, { color: tokens.inkSoft }]}>{t('room.settingTeamMode')}</Text>
      <Text style={[styles.desc, { color: tokens.inkSoft }]}>{t('room.settingTeamModeDesc')}</Text>
      <View style={styles.row}>
        {TEAM_COUNTS.map((n) => (
          <Choice
            key={n}
            label={n === 0 ? t('room.teamModeOff') : t(`room.teamMode${n}Teams`)}
            selected={teamCount === n}
            onPress={() => chooseTeamCount(n)}
            tokens={tokens}
          />
        ))}
      </View>
      {layout && (
        <Text style={[styles.desc, { color: tokens.inkSoft }]}>
          {t(TEAM_LAYOUT_LABEL[layout.id])}
        </Text>
      )}

      <Text style={[styles.label, { color: tokens.inkSoft }]}>{t('offline.difficulty')}</Text>
      <View style={styles.row}>
        {BOT_DIFFICULTIES.map((d) => (
          <Choice
            key={d}
            label={t(`offline.difficulty${d}`)}
            selected={difficulty === d}
            onPress={() => setDifficulty(d)}
            tokens={tokens}
          />
        ))}
      </View>

      {canConfigureEvents && (
        <>
          <Text style={[styles.label, { color: tokens.inkSoft }]}>{t('offline.events')}</Text>
          <Text style={[styles.desc, { color: tokens.inkSoft }]}>{t('offline.eventsDesc')}</Text>
          <View style={styles.row}>
            {EVENTS_MODES.map((m) => (
              <Choice
                key={m}
                label={t(`offline.eventsMode_${m}`)}
                selected={eventsMode === m}
                onPress={() => setEventsMode(m)}
                tokens={tokens}
              />
            ))}
          </View>
        </>
      )}

      <Pressable
        accessibilityRole="button"
        style={[styles.start, { backgroundColor: tokens.blue }]}
        onPress={() =>
          navigation.replace('OfflineGame', {
            mode: 'new',
            mapId,
            botCount,
            difficulty,
            eventsMode: canConfigureEvents ? eventsMode : 'off',
            ...(teamCount > 0 ? { teamCount } : {}),
          })
        }
      >
        <Text style={styles.startText}>{t('offline.start')}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { padding: 20, gap: 8 },
  label: { fontSize: 14, marginTop: 12 },
  desc: { fontSize: 12, marginTop: 2 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  choice: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 40,
    justifyContent: 'center',
  },
  choiceText: { fontSize: 15 },
  start: {
    marginTop: 24,
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    minHeight: 44,
  },
  startText: { fontSize: 16, fontWeight: '700', color: '#fff' },
});
