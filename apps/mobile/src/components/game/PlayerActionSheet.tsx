// Report / block action sheet (Apple 1.2 / Play UGC). Opens from a long-press on a
// player tracker row or a chat message. Never offered for yourself or for bots —
// gate with canModerate() at the call site before opening.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { REPORT_CATEGORIES, type ReportCategory } from '@trm/shared';
import { api } from '../../net/rest';
import { useTheme } from '../../theme/useTheme';
import { rgba } from '../../theme/shade';
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
  const { tokens } = useTheme();
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
        <Pressable
          style={[styles.sheet, { backgroundColor: tokens.surface }]}
          onPress={() => undefined}
        >
          <Text style={[styles.title, { color: tokens.ink }]}>{target.name}</Text>
          {state === 'sent' ? (
            <Text style={[styles.done, { color: tokens.ok }]}>{t('moderation.reportDone')}</Text>
          ) : reporting ? (
            <View style={styles.stack}>
              <Text style={[styles.label, { color: tokens.ink }]}>
                {t('moderation.reportReason')}
              </Text>
              {REPORT_CATEGORIES.map((c) => (
                <Pressable
                  key={c}
                  testID={`report-category-${c}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: category === c }}
                  style={[
                    styles.option,
                    { borderColor: tokens.line },
                    category === c && {
                      borderColor: tokens.blue,
                      backgroundColor: rgba(tokens.blue, 0.08),
                    },
                  ]}
                  onPress={() => setCategory(c)}
                >
                  <Text style={[styles.optionText, { color: tokens.ink }]}>
                    {t(`report.category_${c}`)}
                  </Text>
                </Pressable>
              ))}
              <TextInput
                style={[
                  styles.input,
                  {
                    borderColor: tokens.line,
                    backgroundColor: tokens.surface,
                    color: tokens.ink,
                  },
                ]}
                testID="report-message"
                placeholderTextColor={tokens.inkSoft}
                placeholder={t('moderation.reportMessage')}
                value={message}
                maxLength={MSG_MAX}
                onChangeText={setMessage}
              />
              {state === 'failed' && (
                <Text style={[styles.error, { color: tokens.danger }]}>
                  {t('moderation.reportFailed')}
                </Text>
              )}
              <Pressable
                style={[styles.primaryBtn, { backgroundColor: tokens.blue }]}
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
                style={[styles.actionBtn, { backgroundColor: rgba(tokens.ink, 0.05) }]}
                accessibilityRole="button"
                testID="sheet-report"
                onPress={() => setReporting(true)}
              >
                <Text style={[styles.actionText, { color: tokens.ink }]}>
                  {t('moderation.reportPlayer')}
                </Text>
              </Pressable>
              <Pressable
                style={[styles.actionBtn, { backgroundColor: rgba(tokens.ink, 0.05) }]}
                accessibilityRole="button"
                testID="sheet-block"
                onPress={() => {
                  void (isBlocked ? unblock(target.id) : block(target.id));
                  close();
                }}
              >
                <Text style={[styles.actionText, { color: tokens.ink }]}>
                  {t(isBlocked ? 'moderation.unblockPlayer' : 'moderation.blockPlayer')}
                </Text>
              </Pressable>
            </View>
          )}
          <Pressable style={styles.cancelBtn} accessibilityRole="button" onPress={close}>
            <Text style={[styles.cancelText, { color: tokens.inkSoft }]}>
              {t('moderation.cancel')}
            </Text>
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
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  optionText: { fontSize: 13 },
  input: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
  },
  error: { fontSize: 12 },
  primaryBtn: {
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  actionBtn: {
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  actionText: { fontSize: 14, fontWeight: '600' },
  done: { fontSize: 13 },
  cancelBtn: { paddingVertical: 10, alignItems: 'center' },
  cancelText: { fontSize: 14 },
});
