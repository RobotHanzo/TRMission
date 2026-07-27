// The lobby's game settings as a layered board (issue #64): an index naming each group and what it
// is set to, over one page per group. The same shape — and the same primitives — as the Settings
// tab (screens/settings/chrome.tsx), because it answers the same question about a different thing.
//
// A group's page is a Modal rather than a pushed route: RoomScreen owns the poll that keeps
// `settings` live, so the page has to render inside it. It still reads as a layer — it slides in,
// carries its own header, and Android's back gesture closes it.
//
// The groups, their order, and how each value reads live in @trm/client-core, shared with web.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ChevronLeft,
  CloudLightning,
  DoorOpen,
  Lock,
  Map as MapIcon,
  ScrollText,
  Users,
} from 'lucide-react-native';
import { OFFICIAL_MAPS } from '@trm/map-data';
import type { EventsMode } from '@trm/shared';
import {
  HOUSE_RULES,
  SOLO_WAIT_RULE,
  roomSettingsGroups,
  type RoomSettingsGroupId,
  type TranslateSetting,
} from '@trm/client-core/game/roomSettingsMenu';
import type { Locale, MapSummary, RoomSettings, RoomVisibility } from '../../net/rest';
import { useTheme } from '../../theme/useTheme';
import { Card, SectionLabel } from '../../theme/chrome';
// The Settings tab's own primitives — the two boards stay one design by sharing them outright.
import { ChoiceRow, NavRow, type RowIcon, SettingsRow } from '../settings/chrome';

const GROUP_ICONS: Record<RoomSettingsGroupId, RowIcon> = {
  map: MapIcon,
  rules: ScrollText,
  events: CloudLightning,
  teams: Users,
  access: DoorOpen,
};

interface Props {
  settings: RoomSettings;
  /** Read-only for everyone but the host, and for everyone once the game has started. */
  locked: boolean;
  /** The host may pick a custom map only while holding the mapBuilder feature. */
  canBuild: boolean;
  /** Whether the random-events group is on the board at all (feature-gated for the host). */
  showEvents: boolean;
  /** Whether the solo "wait for me" rule applies — exactly one human is seated. */
  showSoloWait: boolean;
  /** Seated players, for the team-layout warning. */
  seatedCount: number;
  /** The host's own custom maps (null while still loading). */
  myMaps: MapSummary[] | null;
  /** The selected map's display name, resolved against the active locale. */
  mapName: string;
  locale: Locale;
  onChange(patch: Partial<RoomSettings>): void;
  /** Team count goes through the room's own guard (it can reject a shrink that would evict a seat). */
  onChangeTeamCount(next: number): void;
}

export function RoomSettingsPanel(props: Props): React.JSX.Element {
  const { t } = useTranslation();
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState<RoomSettingsGroupId | null>(null);

  // The shared board builder takes a plain translator; the room's strings are namespaced.
  const tr: TranslateSetting = (key, params) =>
    params ? t(`room.${key}`, params) : t(`room.${key}`);
  const groups = roomSettingsGroups(
    {
      settings: props.settings,
      mapName: props.mapName,
      showEvents: props.showEvents,
      showSoloWait: props.showSoloWait,
      seatedCount: props.seatedCount,
    },
    tr,
  );
  const current = groups.find((g) => g.id === open);

  return (
    <>
      <SectionLabel>{t('room.gameSettings')}</SectionLabel>
      {props.locked && (
        <View style={styles.lockRow}>
          <Lock size={13} color={tokens.inkSoft} />
          <Text style={[styles.lockText, { color: tokens.inkSoft }]}>
            {t('room.settingsHostOnly')}
          </Text>
        </View>
      )}
      <Card style={styles.board}>
        {groups.map((g, i) => (
          <View key={g.id}>
            <NavRow
              first={i === 0}
              icon={GROUP_ICONS[g.id]}
              title={g.title}
              value={g.value}
              testID={`room-settings-nav-${g.id}`}
              onPress={() => setOpen(g.id)}
            />
            {g.warning != null && (
              <Text style={[styles.warn, { color: tokens.ember }]}>{g.warning}</Text>
            )}
          </View>
        ))}
      </Card>

      <Modal
        visible={current != null}
        animationType="slide"
        onRequestClose={() => setOpen(null)}
        transparent={false}
      >
        <View style={{ flex: 1, backgroundColor: tokens.paper, paddingTop: insets.top }}>
          <View style={[styles.pageHead, { borderBottomColor: tokens.line }]}>
            <Pressable
              accessibilityRole="button"
              testID="room-settings-back"
              hitSlop={8}
              onPress={() => setOpen(null)}
              style={styles.back}
            >
              <ChevronLeft size={20} color={tokens.blue} />
              <Text style={[styles.backText, { color: tokens.blue }]}>
                {t('room.settingsBack')}
              </Text>
            </Pressable>
            <Text style={[styles.pageTitle, { color: tokens.ink }]} numberOfLines={1}>
              {current?.title ?? ''}
            </Text>
          </View>
          <ScrollView
            contentContainerStyle={[styles.pageBody, { paddingBottom: 32 + insets.bottom }]}
          >
            {current?.warning != null && (
              <Text style={[styles.warn, styles.pageWarn, { color: tokens.ember }]}>
                {current.warning}
              </Text>
            )}
            <Card style={styles.board}>
              {current != null && <GroupControls {...props} group={current.id} />}
            </Card>
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

/** One group's controls. The layer above states the value; this layer explains what it means. */
function GroupControls({
  group,
  settings,
  locked,
  canBuild,
  showSoloWait,
  myMaps,
  mapName,
  locale,
  onChange,
  onChangeTeamCount,
}: Props & { group: RoomSettingsGroupId }): React.JSX.Element {
  const { t } = useTranslation();
  const teamCount = settings.teamCount ?? 0;
  const name = (m: { nameZh: string; nameEn: string }) => (locale === 'en' ? m.nameEn : m.nameZh);

  if (group === 'map') {
    // A member who can't edit reads the resolved name; the host gets source + list.
    if (locked) {
      return (
        <SettingsRow first label={t('room.mapLabel')} trailing={<RowText>{mapName}</RowText>} />
      );
    }
    return (
      <>
        {canBuild && (
          <ChoiceRow<'official' | 'custom'>
            first
            label={t('room.mapLabel')}
            options={[
              { value: 'official', label: t('room.mapOfficial') },
              { value: 'custom', label: t('room.mapCustom') },
            ]}
            value={settings.map.source}
            onChange={(src) => {
              if (src === 'official') {
                const first = OFFICIAL_MAPS[0];
                if (first) onChange({ map: { source: 'official', mapId: first.mapId } });
              } else if (myMaps && myMaps.length > 0) {
                onChange({ map: { source: 'custom', customMapId: myMaps[0]!.id } });
              }
            }}
          />
        )}
        {settings.map.source === 'official' ? (
          <ChoiceRow
            first={!canBuild}
            label={t('room.mapOfficial')}
            options={OFFICIAL_MAPS.map((m) => ({
              value: m.mapId,
              label: name({ nameZh: m.content.meta.nameZh, nameEn: m.content.meta.nameEn }),
            }))}
            value={settings.map.mapId}
            onChange={(mapId) => onChange({ map: { source: 'official', mapId } })}
          />
        ) : (
          <ChoiceRow
            first={!canBuild}
            label={t('room.mapCustom')}
            options={(myMaps ?? []).map((m) => ({ value: m.id, label: name(m) }))}
            value={settings.map.customMapId}
            onChange={(customMapId) => onChange({ map: { source: 'custom', customMapId } })}
          />
        )}
      </>
    );
  }

  if (group === 'rules') {
    const rules = showSoloWait ? [...HOUSE_RULES, SOLO_WAIT_RULE] : HOUSE_RULES;
    return (
      <>
        {rules.map((rule, i) => (
          <SettingsRow
            key={rule.key}
            first={i === 0}
            label={t(`room.${rule.labelKey}`)}
            hint={t(`room.${rule.descKey}`)}
            trailing={
              <Switch
                accessibilityLabel={t(`room.${rule.labelKey}`)}
                value={settings[rule.key]}
                disabled={locked}
                onValueChange={(next) => onChange({ [rule.key]: next } as Partial<RoomSettings>)}
              />
            }
          />
        ))}
      </>
    );
  }

  if (group === 'events') {
    return (
      <ChoiceRow<EventsMode>
        first
        label={t('room.settingRandomEvents')}
        hint={t('room.settingRandomEventsDesc')}
        options={(['off', 'light', 'moderate', 'intense'] as const).map((v) => ({
          value: v,
          label: t(`room.eventsMode_${v}`),
        }))}
        value={settings.eventsMode}
        onChange={(v) => onChange({ eventsMode: v })}
        disabled={locked}
      />
    );
  }

  if (group === 'teams') {
    return (
      <>
        <ChoiceRow<'0' | '2' | '3'>
          first
          label={t('room.settingTeamMode')}
          hint={t('room.settingTeamModeDesc')}
          options={[
            { value: '0', label: t('room.teamModeOff') },
            { value: '2', label: t('room.teamMode2Teams') },
            { value: '3', label: t('room.teamMode3Teams') },
          ]}
          value={String(teamCount) as '0' | '2' | '3'}
          onChange={(v) => onChangeTeamCount(Number(v))}
          disabled={locked}
        />
        {teamCount > 0 && (
          <ChoiceRow<'random' | 'host' | 'self'>
            label={t('room.settingTeamAssignMode')}
            hint={t('room.settingTeamAssignModeDesc')}
            options={[
              { value: 'random', label: t('room.teamAssignModeRandom') },
              { value: 'host', label: t('room.teamAssignModeHost') },
              { value: 'self', label: t('room.teamAssignModeSelf') },
            ]}
            value={settings.teamAssignMode}
            onChange={(v) => onChange({ teamAssignMode: v })}
            disabled={locked}
          />
        )}
      </>
    );
  }

  return (
    <>
      <ChoiceRow<RoomVisibility>
        first
        label={t('room.roomVisibility')}
        options={[
          { value: 'PUBLIC', label: t('room.visibility_PUBLIC') },
          { value: 'INVITE_ONLY', label: t('room.visibility_INVITE_ONLY') },
        ]}
        value={settings.visibility}
        onChange={(v) => onChange({ visibility: v })}
        disabled={locked}
      />
      <SettingsRow
        label={t('room.allowSpectating')}
        trailing={
          <Switch
            accessibilityLabel={t('room.allowSpectating')}
            value={settings.allowSpectating}
            disabled={locked}
            onValueChange={(next) => onChange({ allowSpectating: next })}
          />
        }
      />
    </>
  );
}

/** Right-aligned value text for a read-only row. */
function RowText({ children }: { children: string }): React.JSX.Element {
  const { tokens } = useTheme();
  return <Text style={[styles.rowValue, { color: tokens.inkSoft }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  board: { padding: 0, gap: 0, overflow: 'hidden' },
  lockRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: -4 },
  lockText: { fontSize: 12 },
  warn: { fontSize: 12, lineHeight: 17, paddingHorizontal: 14, paddingBottom: 10 },
  pageWarn: { paddingHorizontal: 4, paddingBottom: 0 },
  pageHead: {
    gap: 4,
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: { flexDirection: 'row', alignItems: 'center', marginLeft: -6 },
  backText: { fontSize: 15, fontWeight: '600' },
  pageTitle: { fontSize: 24, fontWeight: '700', letterSpacing: 0.4 },
  pageBody: { padding: 16, gap: 10 },
  rowValue: { fontSize: 13, fontWeight: '600' },
});
