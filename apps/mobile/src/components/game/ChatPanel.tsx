// In-game chat (ports the web ChatPanel): free text + preset-message chips, client-side length
// and 5/5s rate guards mirroring the hub's enforcement, server chat rejections surfaced inline.
// Spectators see the panel read-only.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useChat } from '../../store/chat';
import { useGame } from '../../store/game';
import { useModeration } from '../../store/moderation';
import { useRoster } from '../../store/roster';
import { getSocket } from '../../net/connection';
import { usePlayerName } from '../../game/playerName';
import { seatColor } from '../../theme/colors';
import { useTheme } from '../../theme/useTheme';
import { chatRejectionHintKey } from '../../game/chatErrors';
import { rgba } from '../../theme/shade';
import { TrayHead } from '../../theme/gameChrome';
import { CHAT_PRESET_IDS, chatPresetKey } from '@trm/client-core';
import { isTeamGame } from '@trm/client-core/game/teams';
import { PlayerActionSheet, canModerate } from './PlayerActionSheet';

const MAX_LEN = 2048;
const RATE_MAX = 5;
const RATE_WINDOW_MS = 5000;

export function ChatPanel({ disabled = false }: { disabled?: boolean | undefined }) {
  const { t } = useTranslation();
  const messages = useChat((s) => s.messages);
  const snapshot = useGame((s) => s.snapshot);
  const rejection = useGame((s) => s.rejection);
  const nameOf = usePlayerName();
  const rosterById = useRoster((s) => s.byId);
  const { tokens } = useTheme();
  const me = snapshot?.you?.playerId ?? null;
  const blocked = useModeration((s) => s.blocked);
  const [draft, setDraft] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const teamsOn = snapshot ? isTeamGame(snapshot) : false;
  const [teamChannel, setTeamChannel] = useState(false);
  const [sheetTarget, setSheetTarget] = useState<{ id: string; name: string } | null>(null);
  const sentAt = useRef<number[]>([]);
  const listRef = useRef<ScrollView>(null);

  // Blocked authors are muted client-side: their free text AND presets never render.
  const visible = messages.filter((m) => !blocked.has(m.playerId));

  useEffect(() => {
    listRef.current?.scrollToEnd({ animated: false });
  }, [visible.length]);

  // Surface a server-side chat rejection (length / rate limit / unknown preset) as inline chat
  // feedback instead of the generic action toast. Client guards usually prevent it ever firing.
  useEffect(() => {
    if (!rejection) return;
    const key = chatRejectionHintKey(rejection.messageKey);
    if (key) setHint(t(key));
  }, [rejection, t]);

  // null for a spectator author (not in the seated snapshot.players list) — never seat 0.
  const seatOf = (pid: string): number | null =>
    snapshot?.players.find((p) => p.id === pid)?.seat ?? null;

  const withinRateLimit = (): boolean => {
    const now = Date.now();
    sentAt.current = sentAt.current.filter((ts) => now - ts < RATE_WINDOW_MS);
    if (sentAt.current.length >= RATE_MAX) {
      setHint(t('chat.rateLimited'));
      return false;
    }
    sentAt.current.push(now);
    return true;
  };

  const send = (): void => {
    const text = draft.trim();
    if (!text || disabled) return;
    if (!withinRateLimit()) return;
    getSocket()?.chat(text.slice(0, MAX_LEN), teamChannel);
    setDraft('');
    setHint(null);
  };

  const sendPreset = (id: string): void => {
    if (disabled) return;
    if (!withinRateLimit()) return;
    getSocket()?.chatPreset(id, teamChannel);
    setHint(null);
  };

  return (
    <View style={styles.panel}>
      <TrayHead title={t('chat.heading')} />
      {teamsOn && (
        // Team games get a second channel. It is live-only: the server never persists a team
        // line, so it cannot resurface to an opponent in a later reconnect backfill.
        <View style={styles.channels}>
          {(
            [
              [false, t('chat.channelAll')],
              [true, t('chat.channelTeam')],
            ] as const
          ).map(([value, label]) => (
            <Pressable
              key={String(value)}
              accessibilityRole="button"
              accessibilityState={{ selected: teamChannel === value }}
              onPress={() => setTeamChannel(value)}
              style={[
                styles.channel,
                { borderColor: teamChannel === value ? tokens.blue : tokens.line },
                teamChannel === value && { backgroundColor: `${tokens.blue}22` },
              ]}
            >
              <Text
                style={[
                  styles.channelText,
                  { color: teamChannel === value ? tokens.blue : tokens.inkSoft },
                ]}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      <ScrollView ref={listRef} style={styles.messages}>
        {visible.length === 0 ? (
          <Text style={[styles.empty, { color: tokens.inkSoft }]}>{t('chat.empty')}</Text>
        ) : (
          visible.map((m) => {
            const seat = seatOf(m.playerId);
            // A null seat means a spectator author (never a seated player): tag them "[旁觀者]"
            // and use their roster display name — NOT the seat-0 "P{seat+1}" fallback, which
            // would mislabel every spectator as "P1". The tag stands alone until the roster
            // resolves (e.g. right after they joined mid-game).
            const isSpectator = seat === null;
            const author = isSpectator
              ? [t('chat.spectatorTag'), rosterById[m.playerId]?.displayName]
                  .filter(Boolean)
                  .join(' ')
              : nameOf({ id: m.playerId, seat, isMe: m.playerId === me });
            return (
              <Pressable
                key={m.id}
                style={styles.msg}
                onLongPress={() => {
                  if (!canModerate(m.playerId, me)) return;
                  setSheetTarget({ id: m.playerId, name: author });
                }}
              >
                <Text
                  style={[styles.author, { color: isSpectator ? tokens.inkSoft : seatColor(seat) }]}
                >
                  {author}
                </Text>
                <Text style={[styles.msgText, { color: tokens.ink }]}>
                  {m.content.case === 'presetId'
                    ? t(chatPresetKey(m.content.value))
                    : m.content.value}
                </Text>
              </Pressable>
            );
          })
        )}
      </ScrollView>
      {sheetTarget && (
        <PlayerActionSheet target={sheetTarget} onClose={() => setSheetTarget(null)} />
      )}
      {hint !== null && <Text style={[styles.hint, { color: tokens.danger }]}>{hint}</Text>}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.presets}>
        {CHAT_PRESET_IDS.map((id) => (
          <Pressable
            key={id}
            style={({ pressed }) => [
              styles.presetBtn,
              { borderColor: tokens.line, backgroundColor: rgba(tokens.ink, 0.04) },
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            disabled={disabled}
            onPress={() => sendPreset(id)}
          >
            <Text style={[styles.presetText, { color: tokens.ink }]}>{t(chatPresetKey(id))}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <View style={styles.inputRow}>
        <TextInput
          style={[
            styles.input,
            {
              borderColor: tokens.line,
              backgroundColor: tokens.surface,
              color: tokens.ink,
            },
            disabled && styles.inputDisabled,
          ]}
          placeholderTextColor={tokens.inkSoft}
          maxLength={MAX_LEN}
          value={draft}
          editable={!disabled}
          placeholder={disabled ? t('chat.spectatorDisabled') : t('chat.placeholder')}
          onChangeText={setDraft}
          onSubmitEditing={send}
          returnKeyType="send"
        />
        <Pressable
          style={({ pressed }) => [
            styles.sendBtn,
            { backgroundColor: tokens.blue },
            pressed && styles.pressed,
          ]}
          accessibilityRole="button"
          disabled={disabled || draft.trim().length === 0}
          onPress={send}
        >
          <Text style={styles.sendText}>{t('chat.send')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  channels: { flexDirection: 'row', gap: 6, marginBottom: 4 },
  channel: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2 },
  channelText: { fontSize: 11, fontWeight: '600' },
  panel: { gap: 4 },
  messages: { maxHeight: 160, minHeight: 60 },
  empty: { fontSize: 12, paddingVertical: 4 },
  msg: { flexDirection: 'row', gap: 6, paddingVertical: 2, flexWrap: 'wrap' },
  author: { fontSize: 12, fontWeight: '700' },
  msgText: { flexShrink: 1, fontSize: 12 },
  hint: { fontSize: 11 },
  presets: { flexGrow: 0 },
  presetBtn: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 6,
  },
  presetText: { fontSize: 12 },
  pressed: { opacity: 0.7 },
  inputRow: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  input: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
  },
  inputDisabled: { opacity: 0.5 },
  sendBtn: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    minHeight: 40,
    justifyContent: 'center',
  },
  sendText: { color: '#fff', fontWeight: '700', fontSize: 13 },
});
