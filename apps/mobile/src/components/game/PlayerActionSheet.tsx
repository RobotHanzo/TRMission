// Report / block action sheet (Apple 1.2 / Play UGC). Opens from a long-press on a
// player tracker row or a chat message. Never offered for yourself or for bots —
// gate with canModerate() at the call site before opening.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { REPORT_CATEGORIES, type ReportCategory } from '@trm/shared';
import { api } from '../../net/rest';
import { useModeration } from '../../store/moderation';
import { getActiveRoomContext } from '../../game/activeRoom';

/** Report/block applies to real other humans only — bots and yourself are out of scope. */
export const canModerate = (targetId: string, meId: string | null): boolean =>
  targetId !== meId && !targetId.startsWith('bot:');

const MSG_MAX = 1000;

export function PlayerActionSheet({
  target,
  onClose,
}: {
  /** The player the sheet acts on; null renders nothing (sheet closed). */
  target: { id: string; name: string } | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const blocked = useModeration((s) => s.blocked);
  const block = useModeration((s) => s.block);
  const unblock = useModeration((s) => s.unblock);
  const [reporting, setReporting] = useState(false);
  const [category, setCategory] = useState<ReportCategory>('HARASSMENT');
  const [message, setMessage] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');

  if (!target) return null;
  const isBlocked = blocked.has(target.id);

  const close = (): void => {
    setReporting(false);
    setCategory('HARASSMENT');
    setMessage('');
    setState('idle');
    onClose();
  };

  const submit = async (): Promise<void> => {
    setState('sending');
    try {
      const ctx = getActiveRoomContext();
      await api.reportPlayer({
        userId: target.id,
        category,
        ...(message.trim() ? { message: message.trim() } : {}),
        ...(ctx.gameId ? { gameId: ctx.gameId } : {}),
        ...(ctx.roomCode ? { roomCode: ctx.roomCode } : {}),
      });
      setState('sent');
    } catch {
      setState('failed');
    }
  };

  return (
    <Modal transparent animationType="fade" visible onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} testID="player-sheet-backdrop">
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <Text style={styles.title}>{target.name}</Text>
          {state === 'sent' ? (
            <Text style={styles.done}>{t('moderation.reportDone')}</Text>
          ) : reporting ? (
            <View style={styles.stack}>
              <Text style={styles.label}>{t('moderation.reportReason')}</Text>
              {REPORT_CATEGORIES.map((c) => (
                <Pressable
                  key={c}
                  testID={`report-category-${c}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: category === c }}
                  style={[styles.option, category === c && styles.optionSelected]}
                  onPress={() => setCategory(c)}
                >
                  <Text style={styles.optionText}>{t(`report.category_${c}`)}</Text>
                </Pressable>
              ))}
              <TextInput
                style={styles.input}
                testID="report-message"
                placeholder={t('moderation.reportMessage')}
                value={message}
                maxLength={MSG_MAX}
                onChangeText={setMessage}
              />
              {state === 'failed' && (
                <Text style={styles.error}>{t('moderation.reportFailed')}</Text>
              )}
              <Pressable
                style={styles.primaryBtn}
                accessibilityRole="button"
                disabled={state === 'sending'}
                onPress={() => void submit()}
              >
                <Text style={styles.primaryText}>{t('moderation.reportSubmit')}</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.stack}>
              <Pressable
                style={styles.actionBtn}
                accessibilityRole="button"
                testID="sheet-report"
                onPress={() => setReporting(true)}
              >
                <Text style={styles.actionText}>{t('moderation.reportPlayer')}</Text>
              </Pressable>
              <Pressable
                style={styles.actionBtn}
                accessibilityRole="button"
                testID="sheet-block"
                onPress={() => {
                  void (isBlocked ? unblock(target.id) : block(target.id));
                  close();
                }}
              >
                <Text style={styles.actionText}>
                  {t(isBlocked ? 'moderation.unblockPlayer' : 'moderation.blockPlayer')}
                </Text>
              </Pressable>
            </View>
          )}
          <Pressable style={styles.cancelBtn} accessibilityRole="button" onPress={close}>
            <Text style={styles.cancelText}>{t('moderation.cancel')}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    gap: 10,
  },
  title: { fontSize: 15, fontWeight: '700' },
  stack: { gap: 8 },
  label: { fontSize: 13, fontWeight: '600' },
  option: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.15)',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  optionSelected: { borderColor: '#0f5fa6', backgroundColor: 'rgba(15,95,166,0.08)' },
  optionText: { fontSize: 13 },
  input: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.2)',
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    backgroundColor: '#fff',
  },
  error: { fontSize: 12, color: '#b3261e' },
  primaryBtn: {
    borderRadius: 8,
    backgroundColor: '#0f5fa6',
    paddingVertical: 10,
    alignItems: 'center',
  },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  actionBtn: {
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.05)',
    paddingVertical: 12,
    alignItems: 'center',
  },
  actionText: { fontSize: 14, fontWeight: '600' },
  done: { fontSize: 13, color: '#166534' },
  cancelBtn: { paddingVertical: 10, alignItems: 'center' },
  cancelText: { fontSize: 14, opacity: 0.7 },
});
