// In-game chat (ports the web ChatPanel): free text + preset-message chips, client-side length
// and 5/5s rate guards mirroring the hub's enforcement, server chat rejections surfaced inline.
// Spectators see the panel read-only.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useChat } from '../../store/chat';
import { useGame } from '../../store/game';
import { getSocket } from '../../net/connection';
import { usePlayerName } from '../../game/playerName';
import { seatColor } from '../../theme/colors';
import { chatRejectionHintKey } from '../../game/chatErrors';
import { CHAT_PRESET_IDS, chatPresetKey } from '../../game/chatPresets';

const MAX_LEN = 2048;
const RATE_MAX = 5;
const RATE_WINDOW_MS = 5000;

export function ChatPanel({ disabled = false }: { disabled?: boolean | undefined }) {
  const { t } = useTranslation();
  const messages = useChat((s) => s.messages);
  const snapshot = useGame((s) => s.snapshot);
  const rejection = useGame((s) => s.rejection);
  const nameOf = usePlayerName();
  const me = snapshot?.you?.playerId ?? null;
  const [draft, setDraft] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const sentAt = useRef<number[]>([]);
  const listRef = useRef<ScrollView>(null);

  useEffect(() => {
    listRef.current?.scrollToEnd({ animated: false });
  }, [messages.length]);

  // Surface a server-side chat rejection (length / rate limit / unknown preset) as inline chat
  // feedback instead of the generic action toast. Client guards usually prevent it ever firing.
  useEffect(() => {
    if (!rejection) return;
    const key = chatRejectionHintKey(rejection.messageKey);
    if (key) setHint(t(key));
  }, [rejection, t]);

  const seatOf = (pid: string): number => snapshot?.players.find((p) => p.id === pid)?.seat ?? 0;

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
    getSocket()?.chat(text.slice(0, MAX_LEN));
    setDraft('');
    setHint(null);
  };

  const sendPreset = (id: string): void => {
    if (disabled) return;
    if (!withinRateLimit()) return;
    getSocket()?.chatPreset(id);
    setHint(null);
  };

  return (
    <View style={styles.panel}>
      <Text style={styles.heading}>{t('chat.heading')}</Text>
      <ScrollView ref={listRef} style={styles.messages}>
        {messages.length === 0 ? (
          <Text style={styles.empty}>{t('chat.empty')}</Text>
        ) : (
          messages.map((m) => (
            <View key={m.id} style={styles.msg}>
              <Text style={[styles.author, { color: seatColor(seatOf(m.playerId)) }]}>
                {nameOf({ id: m.playerId, seat: seatOf(m.playerId), isMe: m.playerId === me })}
              </Text>
              <Text style={styles.msgText}>
                {m.content.case === 'presetId'
                  ? t(chatPresetKey(m.content.value))
                  : m.content.value}
              </Text>
            </View>
          ))
        )}
      </ScrollView>
      {hint !== null && <Text style={styles.hint}>{hint}</Text>}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.presets}>
        {CHAT_PRESET_IDS.map((id) => (
          <Pressable
            key={id}
            style={({ pressed }) => [styles.presetBtn, pressed && styles.pressed]}
            accessibilityRole="button"
            disabled={disabled}
            onPress={() => sendPreset(id)}
          >
            <Text style={styles.presetText}>{t(chatPresetKey(id))}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <View style={styles.inputRow}>
        <TextInput
          style={[styles.input, disabled && styles.inputDisabled]}
          maxLength={MAX_LEN}
          value={draft}
          editable={!disabled}
          placeholder={disabled ? t('chat.spectatorDisabled') : t('chat.placeholder')}
          onChangeText={setDraft}
          onSubmitEditing={send}
          returnKeyType="send"
        />
        <Pressable
          style={({ pressed }) => [styles.sendBtn, pressed && styles.pressed]}
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
  panel: { gap: 4 },
  heading: { fontSize: 13, fontWeight: '700' },
  messages: { maxHeight: 160, minHeight: 60 },
  empty: { fontSize: 12, opacity: 0.55, paddingVertical: 4 },
  msg: { flexDirection: 'row', gap: 6, paddingVertical: 2, flexWrap: 'wrap' },
  author: { fontSize: 12, fontWeight: '700' },
  msgText: { flexShrink: 1, fontSize: 12, color: '#374151' },
  hint: { fontSize: 11, color: '#b3261e' },
  presets: { flexGrow: 0 },
  presetBtn: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.18)',
    backgroundColor: 'rgba(0,0,0,0.04)',
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
    borderColor: 'rgba(0,0,0,0.2)',
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    backgroundColor: '#fff',
  },
  inputDisabled: { opacity: 0.5 },
  sendBtn: {
    borderRadius: 8,
    backgroundColor: '#0f5fa6',
    paddingHorizontal: 12,
    paddingVertical: 9,
    minHeight: 40,
    justifyContent: 'center',
  },
  sendText: { color: '#fff', fontWeight: '700', fontSize: 13 },
});
