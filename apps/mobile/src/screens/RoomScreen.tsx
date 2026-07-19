// The lobby (full parity with the web RoomScreen): members with ready/host state, host bot +
// kick/transfer controls, the game-settings card (map, rule toggles, events mode, spectating,
// visibility), watch/rejoin, lobby chat, native share, and the shared join/kick/spectate poll
// semantics (client-core startLobbyPoll — the exact machine the web runs).
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Bot, Crown, UserMinus, X } from 'lucide-react-native';
import { OFFICIAL_MAPS } from '@trm/map-data';
import type { EventsMode } from '@trm/shared';
import { startLobbyPoll } from '@trm/client-core/game/lobbyPoll';
import { CHAT_PRESET_IDS, chatPresetKey } from '@trm/client-core/game/chatPresets';
import type { RootStackParamList } from '../navigation';
import {
  api,
  type BotDifficulty,
  type MapSummary,
  type RoomMember,
  type RoomSettings,
  type RoomView,
  type RoomVisibility,
} from '../net/rest';
import { SERVER_ORIGIN } from '../config';
import { useHasFeature, useSession } from '../store/session';
import { useUi } from '../store/ui';
import { soundPlayer } from '../sound/player';
import { OPPONENT_GAIN } from '../sound/cues';
import { seatColor } from '../theme/colors';
import { useTheme } from '../theme/useTheme';
import {
  Card,
  ErrorText,
  MutedText,
  PrimaryButton,
  SecondaryButton,
  SectionLabel,
} from '../theme/chrome';

type Props = NativeStackScreenProps<RootStackParamList, 'Room'>;

const DIFFICULTIES: readonly BotDifficulty[] = ['EASY', 'MEDIUM', 'HARD', 'HELL'];

/** A row of exclusive chips (the RN stand-in for the web Segmented control). */
function Chips<T extends string>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange(v: T): void;
  disabled?: boolean;
}) {
  const { tokens } = useTheme();
  return (
    <View style={styles.chips}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="button"
            accessibilityState={{ selected: on, disabled: disabled === true }}
            disabled={disabled}
            onPress={() => onChange(o.value)}
            style={[
              styles.chip,
              { borderColor: on ? tokens.blue : tokens.line },
              on && { backgroundColor: `${tokens.blue}22` },
            ]}
          >
            <Text style={[styles.chipText, { color: on ? tokens.blue : tokens.ink }]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** One labelled settings row with a description and a trailing control. */
function SettingRow({
  label,
  desc,
  control,
}: {
  label: string;
  desc?: string | undefined;
  control: React.ReactNode;
}) {
  return (
    <View style={styles.settingRow}>
      <View style={styles.settingLabels}>
        <Text style={styles.settingLabel}>{label}</Text>
        {desc ? <MutedText>{desc}</MutedText> : null}
      </View>
      {control}
    </View>
  );
}

export function RoomScreen({ route, navigation }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const { code } = route.params;
  const user = useSession((s) => s.user);
  const canBuild = useHasFeature('mapBuilder');
  const canConfigureEvents = useHasFeature('randomEvents');
  const locale = useUi((s) => s.locale);
  const { tokens } = useTheme();

  const [room, setRoom] = useState<RoomView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [kicked, setKicked] = useState(false);
  const [ownerLeaveOpen, setOwnerLeaveOpen] = useState(false);
  const [chatDraft, setChatDraft] = useState('');
  const [myMaps, setMyMaps] = useState<MapSummary[] | null>(null);

  // The host's own custom maps for the picker — lazily, only for a mapBuilder holder
  // (the endpoint 403s without the feature).
  useEffect(() => {
    if (!user || !canBuild) return;
    api
      .listMaps()
      .then(setMyMaps)
      .catch(() => setMyMaps([]));
  }, [user, canBuild]);

  // The shared lobby poll: join-via-link, kick detection, auto-spectate, start handoff.
  useEffect(() => {
    return startLobbyPoll(code, user?.id, api, {
      onRoom: setRoom,
      onEnterGame: (_tk, { spectator }) =>
        navigation.replace(
          'Game',
          spectator ? { roomCode: code, spectator: true } : { roomCode: code },
        ),
      onGone: () => navigation.popToTop(),
      onKicked: () => setKicked(true),
      onFullRoomSpectateNotice: () => setNotice(t('room.fullRoomSpectateNotice')),
      onError: (message) => setErr(message),
    });
  }, [code, user?.id, navigation, t]);

  // Play the same chatMessage cue the in-game chat uses (see useSoundDriver's seenChatId) — keyed
  // on ts rather than array index since the server caps room.chat to its last N entries, so an
  // index count would silently stop firing once a long-lived lobby chat gets truncated.
  const seenChatTs = useRef<number | null>(null);
  useEffect(() => {
    if (!room) return;
    const last = room.chat.at(-1)?.ts ?? 0;
    if (seenChatTs.current === null) {
      seenChatTs.current = last;
      return;
    }
    for (const entry of room.chat) {
      if (entry.ts <= seenChatTs.current) continue;
      soundPlayer.play('chatMessage', entry.userId === user?.id ? 1 : OPPONENT_GAIN);
    }
    seenChatTs.current = last;
  }, [room, user?.id]);

  if (!room) {
    return (
      <View style={styles.loading}>
        <MutedText center>{err ?? t('game.connecting')}</MutedText>
      </View>
    );
  }

  const me = room.members.find((m) => m.userId === user?.id);
  const mySpectator = room.spectators.find((s) => s.userId === user?.id);
  const isHost = room.hostId === user?.id;
  const allReady = room.members.length >= 2 && room.members.every((m) => m.ready);
  const canAddBot = isHost && room.members.length < room.maxPlayers;
  const settings = room.settings;
  const settingsLocked = !isHost || room.status !== 'LOBBY';
  const showEventsPicker = isHost ? canConfigureEvents : settings.eventsMode !== 'off';
  const otherHumans = room.members.filter((m) => m.userId !== user?.id && !m.isBot);

  const memberName = (m: RoomMember): string =>
    m.isBot
      ? t('room.botName', { level: t(`room.difficulty_${m.difficulty ?? 'EASY'}`) })
      : m.displayName;
  const chatAuthorName = (userId: string): string => {
    const m = room.members.find((x) => x.userId === userId);
    if (m) return memberName(m);
    const s = room.spectators.find((x) => x.userId === userId);
    return s ? s.displayName : userId;
  };
  const mapSel = settings.map;
  const mapName = ((): string => {
    if (room.mapName) return locale === 'en' ? room.mapName.en : room.mapName.zh;
    if (mapSel.source === 'official') {
      const wanted = mapSel.mapId;
      const m = OFFICIAL_MAPS.find((x) => x.mapId === wanted);
      return m ? (locale === 'en' ? m.content.meta.nameEn : m.content.meta.nameZh) : '…';
    }
    const wanted = mapSel.customMapId;
    const m = myMaps?.find((x) => x.id === wanted);
    return m ? (locale === 'en' ? m.nameEn : m.nameZh) : '…';
  })();

  const guard = (p: Promise<RoomView>): void =>
    void p.then(setRoom).catch((e: Error) => setErr(e.message));
  const setSetting = (patch: Partial<RoomSettings>): void =>
    guard(api.updateRoomSettings(code, patch));

  const confirm = (title: string, body: string, action: () => void): void =>
    Alert.alert(title, body, [
      { text: t('room.cancel'), style: 'cancel' },
      { text: title, style: 'destructive', onPress: action },
    ]);

  const shareRoom = (): void => {
    // The web link joins on open (after login); the custom scheme opens the app directly.
    void Share.share({ message: `${SERVER_ORIGIN}/room/${code}` }).catch(() => undefined);
  };
  const start = async (): Promise<void> => {
    try {
      await api.startRoom(code);
      navigation.replace('Game', { roomCode: code });
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const leave = async (): Promise<void> => {
    await api.leaveRoom(code).catch(() => undefined);
    navigation.popToTop();
  };
  const closeAndGoHome = async (): Promise<void> => {
    await api.closeRoom(code).catch(() => undefined);
    navigation.popToTop();
  };
  const transferAndLeave = async (targetId: string): Promise<void> => {
    setOwnerLeaveOpen(false);
    await api.transferOwnership(code, targetId).catch(() => undefined);
    await leave();
  };
  const onLeavePress = (): void => {
    if (!isHost) {
      confirm(t('room.leaveConfirmTitle'), t('room.leaveConfirmBody'), () => void leave());
    } else if (otherHumans.length === 0) {
      confirm(
        t('room.closeRoomConfirmTitle'),
        t('room.closeRoomConfirmBody'),
        () => void closeAndGoHome(),
      );
    } else {
      setOwnerLeaveOpen(true);
    }
  };

  return (
    <ScrollView
      style={{ backgroundColor: tokens.paper }}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      {/* ── header: the code IS the invite — selectable for copy, one tap to share ── */}
      <View style={styles.headerRow}>
        <Text selectable style={[styles.codeText, { color: tokens.brandNavy }]}>
          {code}
        </Text>
        <SecondaryButton title={t('room.shareLink')} onPress={shareRoom} testID="room-share" />
      </View>
      {notice && <MutedText>{notice}</MutedText>}

      {/* ── members ── */}
      <SectionLabel>{t('room.members')}</SectionLabel>
      <Card>
        {room.members.map((m) => (
          <View key={m.userId} style={styles.memberRow} testID={`member-${m.userId}`}>
            <View style={[styles.seatDot, { backgroundColor: seatColor(m.seat) }]} />
            {m.isBot && <Bot size={14} color={tokens.inkSoft} />}
            <Text style={[styles.memberName, { color: tokens.ink }]} numberOfLines={1}>
              {memberName(m)}
              {m.userId === room.hostId ? ` · ${t('room.host')}` : ''}
              {m.userId === user?.id ? ` · ${t('room.you')}` : ''}
            </Text>
            <Text
              style={[
                styles.readyBadge,
                { color: m.isBot || m.ready ? '#2e7d32' : tokens.inkSoft },
              ]}
            >
              {m.isBot ? t('room.botTag') : m.ready ? t('room.ready') : t('room.notReady')}
            </Text>
            {isHost && m.isBot && (
              <Pressable
                testID={`remove-bot-${m.userId}`}
                accessibilityRole="button"
                accessibilityLabel={t('room.removeBot')}
                hitSlop={8}
                style={styles.iconBtn}
                onPress={() => guard(api.removeBot(code, m.userId))}
              >
                <X size={16} color={tokens.inkSoft} />
              </Pressable>
            )}
            {isHost && !m.isBot && m.userId !== room.hostId && (
              <>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('room.makeOwner')}
                  hitSlop={8}
                  style={styles.iconBtn}
                  onPress={() =>
                    confirm(t('room.transferConfirmTitle'), t('room.transferConfirmBody'), () =>
                      guard(api.transferOwnership(code, m.userId)),
                    )
                  }
                >
                  <Crown size={16} color={tokens.inkSoft} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('room.kickPlayer')}
                  hitSlop={8}
                  style={styles.iconBtn}
                  onPress={() => guard(api.kickPlayer(code, m.userId))}
                >
                  <UserMinus size={16} color={tokens.inkSoft} />
                </Pressable>
              </>
            )}
          </View>
        ))}
        {canAddBot && (
          <View style={styles.botRow}>
            <MutedText>{t('room.addBot')}</MutedText>
            {DIFFICULTIES.map((d) => (
              <Pressable
                key={d}
                testID={`add-bot-${d}`}
                accessibilityRole="button"
                style={[styles.chip, { borderColor: tokens.line }]}
                onPress={() => guard(api.addBot(code, d))}
              >
                <Text style={[styles.chipText, { color: tokens.ink }]}>
                  {t(`room.difficulty_${d}`)}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </Card>

      {/* ── spectators ── */}
      {room.spectators.length > 0 && (
        <>
          <SectionLabel>{t('room.spectatorsHeading')}</SectionLabel>
          <Card>
            {room.spectators.map((s) => (
              <View key={s.userId} style={styles.memberRow}>
                <Text style={[styles.memberName, { color: tokens.ink }]} numberOfLines={1}>
                  {s.displayName}
                  {s.userId === user?.id ? ` · ${t('room.you')}` : ''}
                </Text>
                {isHost && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('room.kickPlayer')}
                    hitSlop={8}
                    style={styles.iconBtn}
                    onPress={() => guard(api.kickPlayer(code, s.userId))}
                  >
                    <UserMinus size={16} color={tokens.inkSoft} />
                  </Pressable>
                )}
              </View>
            ))}
          </Card>
        </>
      )}

      {/* ── game settings (host edits in lobby; everyone else reads) ── */}
      <SectionLabel>{t('room.gameSettings')}</SectionLabel>
      <Card>
        <SettingRow
          label={t('room.mapLabel')}
          control={
            settingsLocked ? (
              <Text style={{ color: tokens.ink }}>{mapName}</Text>
            ) : (
              <View style={styles.mapPicker}>
                {canBuild && (
                  <Chips<'official' | 'custom'>
                    options={[
                      { value: 'official', label: t('room.mapOfficial') },
                      { value: 'custom', label: t('room.mapCustom') },
                    ]}
                    value={settings.map.source}
                    onChange={(src) => {
                      if (src === 'official') {
                        const first = OFFICIAL_MAPS[0];
                        if (first) setSetting({ map: { source: 'official', mapId: first.mapId } });
                      } else if (myMaps && myMaps.length > 0) {
                        setSetting({ map: { source: 'custom', customMapId: myMaps[0]!.id } });
                      }
                    }}
                  />
                )}
                {mapSel.source === 'official' ? (
                  <Chips
                    options={OFFICIAL_MAPS.map((m) => ({
                      value: m.mapId,
                      label: locale === 'en' ? m.content.meta.nameEn : m.content.meta.nameZh,
                    }))}
                    value={mapSel.mapId}
                    onChange={(mapId) => setSetting({ map: { source: 'official', mapId } })}
                  />
                ) : (
                  <Chips
                    options={(myMaps ?? []).map((m) => ({
                      value: m.id,
                      label: locale === 'en' ? m.nameEn : m.nameZh,
                    }))}
                    value={mapSel.customMapId}
                    onChange={(customMapId) =>
                      setSetting({ map: { source: 'custom', customMapId } })
                    }
                  />
                )}
              </View>
            )
          }
        />
        {(
          [
            ['unlimitedStationBorrow', 'settingUnlimitedStationBorrow'],
            ['secondDrawAfterBlindRainbow', 'settingSecondDrawAfterRainbow'],
            ['noUnfinishedTicketPenalty', 'settingNoUnfinishedPenalty'],
            ['doubleRouteSingleFor23', 'settingDoubleRouteSingleFor23'],
          ] as const
        ).map(([key, label]) => (
          <SettingRow
            key={key}
            label={t(`room.${label}`)}
            desc={t(`room.${label}Desc`)}
            control={
              <Switch
                value={settings[key]}
                disabled={settingsLocked}
                onValueChange={(next) => setSetting({ [key]: next } as Partial<RoomSettings>)}
              />
            }
          />
        ))}
        {showEventsPicker && (
          <SettingRow
            label={t('room.settingRandomEvents')}
            desc={t('room.settingRandomEventsDesc')}
            control={
              <Chips<EventsMode>
                options={(['off', 'light', 'moderate', 'intense'] as const).map((v) => ({
                  value: v,
                  label: t(`room.eventsMode_${v}`),
                }))}
                value={settings.eventsMode}
                onChange={(v) => setSetting({ eventsMode: v })}
                disabled={settingsLocked}
              />
            }
          />
        )}
        {room.members.filter((m) => !m.isBot).length === 1 && (
          // Only meaningful (and only shown) while the host is the lone human at the table:
          // the started game then waits for them instead of running the per-turn timer.
          <SettingRow
            label={t('room.settingSoloWaitForHost')}
            desc={t('room.settingSoloWaitForHostDesc')}
            control={
              <Switch
                value={settings.soloWaitForHost}
                disabled={settingsLocked}
                onValueChange={(next) => setSetting({ soloWaitForHost: next })}
              />
            }
          />
        )}
        <SettingRow
          label={t('room.allowSpectating')}
          control={
            <Switch
              value={settings.allowSpectating}
              disabled={settingsLocked}
              onValueChange={(next) => setSetting({ allowSpectating: next })}
            />
          }
        />
        <SettingRow
          label={t('room.roomVisibility')}
          control={
            <Chips<RoomVisibility>
              options={[
                { value: 'PUBLIC', label: t('room.visibility_PUBLIC') },
                { value: 'INVITE_ONLY', label: t('room.visibility_INVITE_ONLY') },
              ]}
              value={settings.visibility}
              onChange={(v) => setSetting({ visibility: v })}
              disabled={settingsLocked}
            />
          }
        />
      </Card>

      {/* ── lobby chat ── */}
      <SectionLabel>{t('chat.heading')}</SectionLabel>
      <Card>
        {room.chat.length === 0 ? (
          <MutedText>{t('chat.empty')}</MutedText>
        ) : (
          room.chat.slice(-30).map((c, i) => (
            <Text key={i} style={[styles.chatMsg, { color: tokens.ink }]}>
              <Text style={{ fontWeight: '700' }}>{chatAuthorName(c.userId)}</Text>{' '}
              {c.text ?? t(chatPresetKey(c.presetId ?? ''))}
            </Text>
          ))
        )}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.presetScroll}>
          <View style={styles.chips}>
            {CHAT_PRESET_IDS.map((id) => (
              <Pressable
                key={id}
                accessibilityRole="button"
                style={[styles.chip, { borderColor: tokens.line }]}
                onPress={() => guard(api.sendRoomChat(code, { presetId: id }))}
              >
                <Text style={[styles.chipText, { color: tokens.ink }]}>{t(chatPresetKey(id))}</Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
        <View style={styles.chatInputRow}>
          <TextInput
            style={[styles.chatInput, { borderColor: tokens.line, color: tokens.ink }]}
            value={chatDraft}
            maxLength={2048}
            placeholder={t('chat.placeholder')}
            placeholderTextColor={tokens.inkSoft}
            onChangeText={setChatDraft}
          />
          <SecondaryButton
            title={t('chat.send')}
            disabled={chatDraft.trim().length === 0}
            onPress={() => {
              const text = chatDraft.trim();
              if (!text) return;
              setChatDraft('');
              guard(api.sendRoomChat(code, { text }));
            }}
          />
        </View>
      </Card>

      {/* ── actions ── */}
      <View style={styles.actions}>
        {me && (
          <SecondaryButton
            title={me.ready ? t('room.cancelReady') : t('room.markReady')}
            onPress={() => guard(api.setReady(code, !me.ready))}
            testID="room-ready"
          />
        )}
        {me && !isHost && (
          <SecondaryButton
            title={t('room.watch')}
            disabled={room.members.length <= 1}
            onPress={() => guard(api.watchRoom(code))}
          />
        )}
        {mySpectator && (
          <SecondaryButton
            title={t('room.becomePlayer')}
            disabled={room.members.length >= room.maxPlayers}
            onPress={() => guard(api.rejoinRoom(code))}
          />
        )}
        {isHost && (
          <PrimaryButton
            title={t('room.start')}
            disabled={!allReady}
            onPress={() => void start()}
            testID="room-start"
          />
        )}
        <SecondaryButton title={t('room.leave')} onPress={onLeavePress} testID="room-leave" />
      </View>
      <MutedText center>
        {room.members.length < 2
          ? t('room.waitingForPlayers')
          : !allReady
            ? t('room.waitingForReady')
            : ''}
      </MutedText>
      {err && <ErrorText>{err}</ErrorText>}

      {/* ── kicked ── */}
      <Modal visible={kicked} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: tokens.surface }]}>
            <Text style={[styles.modalTitle, { color: tokens.ink }]}>{t('room.kickedTitle')}</Text>
            <Text style={{ color: tokens.ink }}>{t('room.kickedBody')}</Text>
            <PrimaryButton title={t('room.kickedAck')} onPress={() => navigation.popToTop()} />
          </View>
        </View>
      </Modal>

      {/* ── owner leaving: transfer to a human or close the room ── */}
      <Modal
        visible={ownerLeaveOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setOwnerLeaveOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: tokens.surface }]}>
            <Text style={[styles.modalTitle, { color: tokens.ink }]}>
              {t('room.ownerLeaveTitle')}
            </Text>
            <Text style={{ color: tokens.ink }}>{t('room.ownerLeaveBody')}</Text>
            <SectionLabel>{t('room.selectNewOwner')}</SectionLabel>
            {otherHumans.map((m) => (
              <SecondaryButton
                key={m.userId}
                title={`${t('room.transferAndLeave')} · ${m.displayName}`}
                onPress={() => void transferAndLeave(m.userId)}
              />
            ))}
            <SecondaryButton title={t('room.closeRoom')} onPress={() => void closeAndGoHome()} />
            <SecondaryButton title={t('room.cancel')} onPress={() => setOwnerLeaveOpen(false)} />
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  container: { padding: 16, gap: 10, paddingBottom: 40 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  codeText: { fontSize: 30, fontWeight: '800', letterSpacing: 4, fontVariant: ['tabular-nums'] },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40 },
  seatDot: { width: 10, height: 10, borderRadius: 5 },
  memberName: { flexShrink: 1, fontSize: 15, fontWeight: '600' },
  readyBadge: { marginLeft: 'auto', fontSize: 12, fontWeight: '700' },
  iconBtn: { padding: 8 },
  botRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    minHeight: 34,
    justifyContent: 'center',
  },
  chipText: { fontSize: 13, fontWeight: '600' },
  settingRow: { gap: 6, paddingVertical: 8 },
  settingLabels: { gap: 2 },
  settingLabel: { fontSize: 14, fontWeight: '700' },
  mapPicker: { gap: 6 },
  chatMsg: { fontSize: 13, marginBottom: 2 },
  presetScroll: { flexGrow: 0, marginTop: 6 },
  chatInputRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 8 },
  chatInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    minHeight: 44,
    fontSize: 14,
  },
  actions: { gap: 8 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: { width: '100%', maxWidth: 420, borderRadius: 14, padding: 18, gap: 10 },
  modalTitle: { fontSize: 17, fontWeight: '800' },
});
