// New-offline-game setup: pick a map, bot count, and difficulty, then replace into the game.
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { OFFICIAL_MAPS } from '@trm/map-data';
import { BOT_DIFFICULTIES, type BotDifficulty } from '@trm/bots';
import { layoutsForPlayerCount, type EventsMode } from '@trm/shared';
import type { RootStackParamList } from '../navigation';
import { useHasFeature } from '../store/session';

type Props = NativeStackScreenProps<RootStackParamList, 'OfflineSetup'>;

const BOT_COUNTS = [1, 2, 3, 4, 5] as const;
const EVENTS_MODES = [
  'off',
  'light',
  'moderate',
  'intense',
] as const satisfies readonly EventsMode[];

function Choice({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.choice, selected && styles.choiceSelected]}
    >
      <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{label}</Text>
    </Pressable>
  );
}

export function OfflineSetupScreen({ navigation }: Props) {
  const { t, i18n } = useTranslation();
  const zh = i18n.language.startsWith('zh');
  const canConfigureEvents = useHasFeature('randomEvents');
  const [mapId, setMapId] = useState(OFFICIAL_MAPS[0]!.mapId);
  const [botCount, setBotCount] = useState<(typeof BOT_COUNTS)[number]>(2);
  const [difficulty, setDifficulty] = useState<BotDifficulty>('MEDIUM');
  // Mirrors DEFAULT_ROOM_SETTINGS.eventsMode; clamped to 'off' at start time if the feature was
  // revoked meanwhile (same "silent downgrade" LobbyService.start applies online).
  const [eventsMode, setEventsMode] = useState<EventsMode>('moderate');
  const [teamCount, setTeamCount] = useState(0);

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Text style={styles.title}>{t('offline.newGame')}</Text>

      <Text style={styles.label}>{t('offline.map')}</Text>
      <View style={styles.row}>
        {OFFICIAL_MAPS.map((m) => (
          <Choice
            key={m.mapId}
            label={zh ? m.content.meta.nameZh : m.content.meta.nameEn}
            selected={mapId === m.mapId}
            onPress={() => setMapId(m.mapId)}
          />
        ))}
      </View>

      <Text style={styles.label}>{t('offline.botCount')}</Text>
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
          />
        ))}
      </View>

      <Text style={styles.label}>{t('room.settingTeamMode')}</Text>
      <Text style={styles.desc}>{t('room.settingTeamModeDesc')}</Text>
      <View style={styles.row}>
        {/* Only layouts the current head-count (you + bots) can actually form are offered. */}
        {[0, ...layoutsForPlayerCount(botCount + 1).map((l) => l.teamCount)].map((n) => (
          <Choice
            key={n}
            label={n === 0 ? t('room.teamModeOff') : t(`room.teamMode${n}Teams`)}
            selected={teamCount === n}
            onPress={() => setTeamCount(n)}
          />
        ))}
      </View>

      <Text style={styles.label}>{t('offline.difficulty')}</Text>
      <View style={styles.row}>
        {BOT_DIFFICULTIES.map((d) => (
          <Choice
            key={d}
            label={t(`offline.difficulty${d}`)}
            selected={difficulty === d}
            onPress={() => setDifficulty(d)}
          />
        ))}
      </View>

      {canConfigureEvents && (
        <>
          <Text style={styles.label}>{t('offline.events')}</Text>
          <Text style={styles.desc}>{t('offline.eventsDesc')}</Text>
          <View style={styles.row}>
            {EVENTS_MODES.map((m) => (
              <Choice
                key={m}
                label={t(`offline.eventsMode_${m}`)}
                selected={eventsMode === m}
                onPress={() => setEventsMode(m)}
              />
            ))}
          </View>
        </>
      )}

      <Pressable
        accessibilityRole="button"
        style={styles.start}
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
  title: { fontSize: 22, fontWeight: '700', marginBottom: 8 },
  label: { fontSize: 14, opacity: 0.7, marginTop: 12 },
  desc: { fontSize: 12, opacity: 0.6, marginTop: 2 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  choice: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.25)',
    minHeight: 40,
    justifyContent: 'center',
  },
  choiceSelected: { borderColor: '#0f5fa6', backgroundColor: 'rgba(15,95,166,0.12)' },
  choiceText: { fontSize: 15 },
  choiceTextSelected: { fontWeight: '700', color: '#0f5fa6' },
  start: {
    marginTop: 24,
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: '#0f5fa6',
    minHeight: 44,
  },
  startText: { fontSize: 16, fontWeight: '700', color: '#fff' },
});
